import { Router } from "express";
import { requireAuth, getAuth } from "@clerk/express";
import {
  getAnomaliesForSolarUnit,
  getAllAnomalies,
  updateAnomalyStatus,
  getAnomalyStats,
  detectAnomaliesForSolarUnit,
} from "../application/anomaly";
import { triggerAnomalyDetection } from "../application/background/anomaly-detection-job";
import { ANOMALY_TYPES, SEVERITY_LEVELS, RESOLUTION_STATUS } from "../infrastructure/entities/Anomaly";
import { SolarUnit } from "../infrastructure/entities/SolarUnit";
import { User } from "../infrastructure/entities/User";
import mongoose from "mongoose";

const anomalyRouter = Router();

/**
 * GET /api/anomalies/my
 * Get anomalies for the current user's solar unit
 */
anomalyRouter.get("/my", requireAuth(), async (req, res, next) => {
  try {
    const { userId } = getAuth(req);
    
    // Get user's internal ID
    const user = await User.findOne({ clerkUserId: userId });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get user's solar unit
    const solarUnit = await SolarUnit.findOne({ userId: user._id });
    if (!solarUnit) {
      return res.status(404).json({ error: "No solar unit found for user" });
    }

    const { type, severity, status, limit } = req.query;

    const anomalies = await getAnomaliesForSolarUnit(solarUnit._id, {
      type: type as string,
      severity: severity as string,
      status: status as string,
      limit: limit ? parseInt(limit as string) : undefined,
    });

    res.json(anomalies);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/anomalies/my/stats
 * Get anomaly statistics for the current user's solar unit
 */
anomalyRouter.get("/my/stats", requireAuth(), async (req, res, next) => {
  try {
    const { userId } = getAuth(req);
    
    const user = await User.findOne({ clerkUserId: userId });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const solarUnit = await SolarUnit.findOne({ userId: user._id });
    if (!solarUnit) {
      return res.status(404).json({ error: "No solar unit found for user" });
    }

    const stats = await getAnomalyStats(solarUnit._id);
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/anomalies
 * Get all anomalies (admin only)
 */
anomalyRouter.get("/", requireAuth(), async (req, res, next) => {
  try {
    const { userId } = getAuth(req);
    
    const user = await User.findOne({ clerkUserId: userId });
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { type, severity, status, limit, offset } = req.query;

    const result = await getAllAnomalies({
      type: type as string,
      severity: severity as string,
      status: status as string,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/anomalies/stats
 * Get overall anomaly statistics (admin only)
 */
anomalyRouter.get("/stats", requireAuth(), async (req, res, next) => {
  try {
    const { userId } = getAuth(req);
    
    const user = await User.findOne({ clerkUserId: userId });
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const stats = await getAnomalyStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/anomalies/types
 * Get available anomaly types, severities, and statuses
 */
anomalyRouter.get("/types", async (req, res) => {
  res.json({
    anomalyTypes: ANOMALY_TYPES,
    severityLevels: SEVERITY_LEVELS,
    resolutionStatuses: RESOLUTION_STATUS,
  });
});

/**
 * GET /api/anomalies/solar-unit/:solarUnitId
 * Get anomalies for a specific solar unit (admin only)
 */
anomalyRouter.get("/solar-unit/:solarUnitId", requireAuth(), async (req, res, next) => {
  try {
    const { userId } = getAuth(req);
    const { solarUnitId } = req.params;
    
    const user = await User.findOne({ clerkUserId: userId });
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { type, severity, status, limit } = req.query;

    const anomalies = await getAnomaliesForSolarUnit(
      new mongoose.Types.ObjectId(solarUnitId),
      {
        type: type as string,
        severity: severity as string,
        status: status as string,
        limit: limit ? parseInt(limit as string) : undefined,
      }
    );

    res.json(anomalies);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/anomalies/:anomalyId/acknowledge
 * Acknowledge an anomaly
 */
anomalyRouter.post("/:anomalyId/acknowledge", requireAuth(), async (req, res, next) => {
  try {
    const { userId } = getAuth(req);
    const { anomalyId } = req.params;
    
    const user = await User.findOne({ clerkUserId: userId });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Verify user has access to this anomaly
    const solarUnit = await SolarUnit.findOne({ userId: user._id });
    if (solarUnit) {
      // Check if anomaly belongs to user's solar unit (unless admin)
      const { Anomaly } = await import("../infrastructure/entities/Anomaly");
      const anomaly = await Anomaly.findById(anomalyId);
      if (!anomaly) {
        return res.status(404).json({ error: "Anomaly not found" });
      }
      if (user.role !== "admin" && anomaly.solarUnitId.toString() !== solarUnit._id.toString()) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    const updatedAnomaly = await updateAnomalyStatus(
      new mongoose.Types.ObjectId(anomalyId),
      user._id,
      'acknowledge'
    );

    res.json(updatedAnomaly);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/anomalies/:anomalyId/resolve
 * Resolve an anomaly
 */
anomalyRouter.post("/:anomalyId/resolve", requireAuth(), async (req, res, next) => {
  try {
    const { userId } = getAuth(req);
    const { anomalyId } = req.params;
    const { notes } = req.body;
    
    const user = await User.findOne({ clerkUserId: userId });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Verify user has access to this anomaly
    const solarUnit = await SolarUnit.findOne({ userId: user._id });
    if (solarUnit) {
      const { Anomaly } = await import("../infrastructure/entities/Anomaly");
      const anomaly = await Anomaly.findById(anomalyId);
      if (!anomaly) {
        return res.status(404).json({ error: "Anomaly not found" });
      }
      if (user.role !== "admin" && anomaly.solarUnitId.toString() !== solarUnit._id.toString()) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    const updatedAnomaly = await updateAnomalyStatus(
      new mongoose.Types.ObjectId(anomalyId),
      user._id,
      'resolve',
      notes
    );

    res.json(updatedAnomaly);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/anomalies/:anomalyId/false-positive
 * Mark an anomaly as false positive
 */
anomalyRouter.post("/:anomalyId/false-positive", requireAuth(), async (req, res, next) => {
  try {
    const { userId } = getAuth(req);
    const { anomalyId } = req.params;
    const { notes } = req.body;
    
    const user = await User.findOne({ clerkUserId: userId });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Verify user has access
    const solarUnit = await SolarUnit.findOne({ userId: user._id });
    if (solarUnit) {
      const { Anomaly } = await import("../infrastructure/entities/Anomaly");
      const anomaly = await Anomaly.findById(anomalyId);
      if (!anomaly) {
        return res.status(404).json({ error: "Anomaly not found" });
      }
      if (user.role !== "admin" && anomaly.solarUnitId.toString() !== solarUnit._id.toString()) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    const updatedAnomaly = await updateAnomalyStatus(
      new mongoose.Types.ObjectId(anomalyId),
      user._id,
      'false_positive',
      notes
    );

    res.json(updatedAnomaly);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/anomalies/trigger-detection
 * Manually trigger anomaly detection (admin only)
 */
anomalyRouter.post("/trigger-detection", requireAuth(), async (req, res, next) => {
  try {
    const { userId } = getAuth(req);
    
    const user = await User.findOne({ clerkUserId: userId });
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const result = await triggerAnomalyDetection();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/anomalies/detect/:solarUnitId
 * Run detection for a specific solar unit (admin only)
 */
anomalyRouter.post("/detect/:solarUnitId", requireAuth(), async (req, res, next) => {
  try {
    const { userId } = getAuth(req);
    const { solarUnitId } = req.params;
    
    const user = await User.findOne({ clerkUserId: userId });
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const anomalies = await detectAnomaliesForSolarUnit(
      new mongoose.Types.ObjectId(solarUnitId)
    );

    res.json({
      solarUnitId,
      anomaliesDetected: anomalies.length,
      anomalies,
    });
  } catch (error) {
    next(error);
  }
});

export default anomalyRouter;
