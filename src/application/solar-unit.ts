import { z } from "zod";
import { AssignSolarUnitDto, CreateSolarUnitDto, UpdateSolarUnitDto } from "../domain/dtos/solar-unit";
import { SolarUnit } from "../infrastructure/entities/SolarUnit";
import { NextFunction, Request, Response } from "express";
import { NotFoundError, ValidationError } from "../domain/errors/errors";
import { User } from "../infrastructure/entities/User";
import { getAuth } from "@clerk/express";
import { createAuditLog, resolvePerformerId } from "./audit-log";
import { syncUnitCreated, syncUnitStatusUpdated, syncUnitDeleted, syncRotateApiKey } from "../infrastructure/data-api-sync";

export const getAllSolarUnits = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const solarUnits = await SolarUnit.find().populate("userId", "firstName lastName email");
    res.status(200).json(solarUnits);
  } catch (error) {
    next(error);
  }
};

export const createSolarUnitValidator = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const result = CreateSolarUnitDto.safeParse(req.body);
  if (!result.success) {
    throw new ValidationError(result.error.message);
  }
  next();
};

export const createSolarUnit = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const data: z.infer<typeof CreateSolarUnitDto> = req.body;

    const newSolarUnit: Record<string, any> = {
      serialNumber: data.serialNumber,
      installationDate: new Date(data.installationDate),
      capacity: data.capacity,
      status: data.status,
    };

    if (data.userId) {
      const user = await User.findById(data.userId);
      if (!user) {
        throw new NotFoundError("User not found");
      }
      // Check if user already has a solar unit assigned
      const existingUnit = await SolarUnit.findOne({ userId: data.userId });
      if (existingUnit) {
        throw new ValidationError("This user already has a solar unit assigned");
      }
      newSolarUnit.userId = data.userId;
    }

    const createdSolarUnit = await SolarUnit.create(newSolarUnit);

    // Sync to Data API so the cron starts generating data for this unit
    // Await so we can capture the device API key to return to the admin
    const syncResult = await syncUnitCreated({
      serialNumber: data.serialNumber,
      name: `Solar Unit ${data.serialNumber}`,
      capacity: data.capacity,
    });

    const performerId = await resolvePerformerId(req);
    await createAuditLog({
      action: "SOLAR_UNIT_CREATED",
      performedBy: performerId,
      targetType: "SolarUnit",
      targetId: createdSolarUnit._id,
      details: {
        serialNumber: createdSolarUnit.serialNumber,
        capacity: createdSolarUnit.capacity,
        status: createdSolarUnit.status,
        assignedTo: data.userId || null,
      },
    });

    // Return the unit data along with the one-time device API key
    res.status(201).json({
      ...createdSolarUnit.toObject(),
      deviceApiKey: syncResult.apiKey || null,
    });
  } catch (error) {
    next(error);
  }
};

export const getSolarUnitById = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const solarUnit = await SolarUnit.findById(id).populate("userId", "firstName lastName email");

    if (!solarUnit) {
      throw new NotFoundError("Solar unit not found");
    }
    res.status(200).json(solarUnit);
  } catch (error) {
    next(error);
  }
};

export const getSolarUnitForUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const auth = getAuth(req);
    const clerkUserId = auth.userId;

    const user = await User.findOne({ clerkUserId });
    if (!user) {
      throw new NotFoundError("User not found");
    }

    const solarUnits = await SolarUnit.find({ userId: user._id });
    res.status(200).json(solarUnits[0]);
  } catch (error) {
    next(error);
  }
};

export const updateSolarUnitValidator = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const result = UpdateSolarUnitDto.safeParse(req.body);
  if (!result.success) {
    throw new ValidationError(result.error.message);
  }
  next();
};

export const updateSolarUnit = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { id } = req.params;
  const { serialNumber, installationDate, capacity, status, userId } = req.body;
  const solarUnit = await SolarUnit.findById(id);

  if (!solarUnit) {
    throw new NotFoundError("Solar unit not found");
  }

  const updatedSolarUnit = await SolarUnit.findByIdAndUpdate(id, {
    serialNumber,
    installationDate,
    capacity,
    status,
    userId,
  });

  // If status changed, sync to Data API
  if (status && status !== solarUnit.status) {
    syncUnitStatusUpdated(serialNumber || solarUnit.serialNumber, status);
  }

  const performerId = await resolvePerformerId(req);
  await createAuditLog({
    action: "SOLAR_UNIT_UPDATED",
    performedBy: performerId,
    targetType: "SolarUnit",
    targetId: solarUnit._id,
    details: { serialNumber, capacity, status },
  });

  res.status(200).json(updatedSolarUnit);
};

export const deleteSolarUnit = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const solarUnit = await SolarUnit.findById(id);

    if (!solarUnit) {
      throw new NotFoundError("Solar unit not found");
    }

    await SolarUnit.findByIdAndDelete(id);

    // Mark as OFFLINE in Data API (preserves historical data)
    syncUnitDeleted(solarUnit.serialNumber);

    const performerId = await resolvePerformerId(req);
    await createAuditLog({
      action: "SOLAR_UNIT_DELETED",
      performedBy: performerId,
      targetType: "SolarUnit",
      targetId: solarUnit._id,
      details: { serialNumber: solarUnit.serialNumber },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

export const assignSolarUnitValidator = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const result = AssignSolarUnitDto.safeParse(req.body);
  if (!result.success) {
    throw new ValidationError(result.error.message);
  }
  next();
};

export const assignSolarUnit = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    const solarUnit = await SolarUnit.findById(id);
    if (!solarUnit) {
      throw new NotFoundError("Solar unit not found");
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    // Check if user already has a solar unit assigned
    const existingUnit = await SolarUnit.findOne({ userId });
    if (existingUnit && existingUnit._id.toString() !== id) {
      throw new ValidationError("This user already has a solar unit assigned");
    }

    // Check if user is in a valid status for assignment
    if (user.status !== "APPROVED" && user.status !== "ACTIVE") {
      throw new ValidationError(`Cannot assign a solar unit to a user with status "${user.status}". User must be approved first.`);
    }

    const updatedSolarUnit = await SolarUnit.findByIdAndUpdate(
      id,
      { userId },
      { new: true }
    ).populate("userId", "firstName lastName email");

    // Update user status to ACTIVE
    user.status = "ACTIVE";
    user.statusUpdatedAt = new Date();
    await user.save();

    const performerId = await resolvePerformerId(req);
    await createAuditLog({
      action: "SOLAR_UNIT_ASSIGNED",
      performedBy: performerId,
      targetType: "SolarUnit",
      targetId: solarUnit._id,
      details: {
        serialNumber: solarUnit.serialNumber,
        userId: user._id,
        userEmail: user.email,
      },
    });

    res.status(200).json(updatedSolarUnit);
  } catch (error) {
    next(error);
  }
};

export const unassignSolarUnit = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    const solarUnit = await SolarUnit.findById(id);
    if (!solarUnit) {
      throw new NotFoundError("Solar unit not found");
    }

    // If there was a user, set them back to APPROVED
    if (solarUnit.userId) {
      const user = await User.findById(solarUnit.userId);
      if (user && user.status === "ACTIVE") {
        user.status = "APPROVED";
        user.statusUpdatedAt = new Date();
        await user.save();
      }
    }

    const previousUserId = solarUnit.userId;
    const updatedSolarUnit = await SolarUnit.findByIdAndUpdate(
      id,
      { $unset: { userId: 1 } },
      { new: true }
    );

    const performerId = await resolvePerformerId(req);
    await createAuditLog({
      action: "SOLAR_UNIT_UNASSIGNED",
      performedBy: performerId,
      targetType: "SolarUnit",
      targetId: solarUnit._id,
      details: {
        serialNumber: solarUnit.serialNumber,
        previousUserId,
      },
    });

    res.status(200).json(updatedSolarUnit);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /solar-units/:id/rotate-key
 * Rotate the IoT device API key for a solar unit.
 * Proxies to the Data API's rotate-key endpoint.
 * Returns the new key once — admin must flash it to the device.
 */
export const rotateDeviceApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const solarUnit = await SolarUnit.findById(id);

    if (!solarUnit) {
      throw new NotFoundError("Solar unit not found");
    }

    const result = await syncRotateApiKey(solarUnit.serialNumber);

    if (!result.apiKey) {
      return res.status(502).json({
        error: "SYNC_FAILED",
        message: "Failed to rotate API key in the Data API. The unit may not be registered yet.",
      });
    }

    const performerId = await resolvePerformerId(req);
    await createAuditLog({
      action: "SOLAR_UNIT_UPDATED",
      performedBy: performerId,
      targetType: "SolarUnit",
      targetId: solarUnit._id,
      details: {
        serialNumber: solarUnit.serialNumber,
        action: "API_KEY_ROTATED",
      },
    });

    res.status(200).json({
      serialNumber: solarUnit.serialNumber,
      deviceApiKey: result.apiKey,
      message: "API key rotated successfully. Flash this key to the device firmware.",
    });
  } catch (error) {
    next(error);
  }
};