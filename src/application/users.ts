import { NextFunction, Request, Response } from "express";
import { User } from "../infrastructure/entities/User";
import { SolarUnit } from "../infrastructure/entities/SolarUnit";
import { NotFoundError, ValidationError, ForbiddenError } from "../domain/errors/errors";
import { getAuth } from "@clerk/express";
import { createAuditLog } from "./audit-log";

export const getAllUsers = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const users = await User.find();
      res.status(200).json(users);
    } catch (error) {
      next(error);
    }
  };

export const getCurrentUser = async (
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

      // Also check if user has a solar unit
      const solarUnit = await SolarUnit.findOne({ userId: user._id });

      res.status(200).json({
        ...user.toObject(),
        hasSolarUnit: !!solarUnit,
        solarUnit: solarUnit ? { _id: solarUnit._id, serialNumber: solarUnit.serialNumber } : null,
      });
    } catch (error) {
      next(error);
    }
  };

export const getUnassignedUsers = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      // Find all user IDs that are already assigned to a solar unit
      const assignedSolarUnits = await SolarUnit.find({ userId: { $exists: true, $ne: null } }).select("userId");
      const assignedUserIds = assignedSolarUnits.map((unit) => unit.userId);

      // Find users whose _id is NOT in the assigned list and are APPROVED or ACTIVE
      const unassignedUsers = await User.find({ 
        _id: { $nin: assignedUserIds },
        status: { $in: ["APPROVED", "ACTIVE"] },
      });
      res.status(200).json(unassignedUsers);
    } catch (error) {
      next(error);
    }
  };

export const getUsersWithAssignmentStatus = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const users = await User.find();
      const solarUnits = await SolarUnit.find({ userId: { $exists: true, $ne: null } })
        .select("userId serialNumber _id")
        .populate("userId", "firstName lastName email");

      // Build a map of userId -> solar unit info
      const userSolarUnitMap = new Map<string, { solarUnitId: string; serialNumber: string }>();
      for (const unit of solarUnits) {
        if (unit.userId) {
          userSolarUnitMap.set(unit.userId.toString(), {
            solarUnitId: unit._id.toString(),
            serialNumber: unit.serialNumber,
          });
        }
      }

      const usersWithStatus = users.map((user) => {
        const solarUnit = userSolarUnitMap.get(user._id.toString());
        return {
          ...user.toObject(),
          solarUnit: solarUnit || null,
        };
      });

      res.status(200).json(usersWithStatus);
    } catch (error) {
      next(error);
    }
  };

export const getPendingUsers = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const pendingUsers = await User.find({ status: "PENDING" }).sort({ createdAt: -1 });
      res.status(200).json(pendingUsers);
    } catch (error) {
      next(error);
    }
  };

export const approveUser = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const auth = getAuth(req);

      const user = await User.findById(id);
      if (!user) {
        throw new NotFoundError("User not found");
      }

      if (user.status !== "PENDING") {
        throw new ValidationError(`Cannot approve a user with status "${user.status}". Only PENDING users can be approved.`);
      }

      // Find the admin performing this action
      const adminUser = await User.findOne({ clerkUserId: auth.userId });

      user.status = "APPROVED";
      user.statusUpdatedAt = new Date();
      user.statusUpdatedBy = adminUser?._id;
      await user.save();

      await createAuditLog({
        action: "USER_APPROVED",
        performedBy: adminUser?._id,
        targetType: "User",
        targetId: user._id,
        details: { userEmail: user.email, previousStatus: "PENDING" },
      });

      res.status(200).json(user);
    } catch (error) {
      next(error);
    }
  };

export const rejectUser = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const auth = getAuth(req);

      const user = await User.findById(id);
      if (!user) {
        throw new NotFoundError("User not found");
      }

      if (user.status !== "PENDING") {
        throw new ValidationError(`Cannot reject a user with status "${user.status}". Only PENDING users can be rejected.`);
      }

      const adminUser = await User.findOne({ clerkUserId: auth.userId });

      user.status = "REJECTED";
      user.rejectionReason = reason || "No reason provided";
      user.statusUpdatedAt = new Date();
      user.statusUpdatedBy = adminUser?._id;
      await user.save();

      await createAuditLog({
        action: "USER_REJECTED",
        performedBy: adminUser?._id,
        targetType: "User",
        targetId: user._id,
        details: { userEmail: user.email, reason: user.rejectionReason },
      });

      res.status(200).json(user);
    } catch (error) {
      next(error);
    }
  };

export const suspendUser = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const auth = getAuth(req);

      const user = await User.findById(id);
      if (!user) {
        throw new NotFoundError("User not found");
      }

      if (user.status === "SUSPENDED") {
        throw new ValidationError("User is already suspended.");
      }

      if (user.role === "admin") {
        throw new ForbiddenError("Cannot suspend an admin user.");
      }

      const adminUser = await User.findOne({ clerkUserId: auth.userId });

      user.status = "SUSPENDED";
      user.rejectionReason = reason || "No reason provided";
      user.statusUpdatedAt = new Date();
      user.statusUpdatedBy = adminUser?._id;
      await user.save();

      await createAuditLog({
        action: "USER_SUSPENDED",
        performedBy: adminUser?._id,
        targetType: "User",
        targetId: user._id,
        details: { userEmail: user.email, reason: user.rejectionReason },
      });

      res.status(200).json(user);
    } catch (error) {
      next(error);
    }
  };

export const reactivateUser = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const auth = getAuth(req);

      const user = await User.findById(id);
      if (!user) {
        throw new NotFoundError("User not found");
      }

      if (!["REJECTED", "SUSPENDED"].includes(user.status as string)) {
        throw new ValidationError(`Cannot reactivate a user with status "${user.status}".`);
      }

      const adminUser = await User.findOne({ clerkUserId: auth.userId });

      // Check if user has a solar unit to determine ACTIVE vs APPROVED
      const solarUnit = await SolarUnit.findOne({ userId: user._id });

      const previousStatus = user.status;
      user.status = solarUnit ? "ACTIVE" : "APPROVED";
      user.rejectionReason = undefined;
      user.statusUpdatedAt = new Date();
      user.statusUpdatedBy = adminUser?._id;
      await user.save();

      await createAuditLog({
        action: "USER_REACTIVATED",
        performedBy: adminUser?._id,
        targetType: "User",
        targetId: user._id,
        details: { userEmail: user.email, previousStatus, newStatus: user.status },
      });

      res.status(200).json(user);
    } catch (error) {
      next(error);
    }
  };