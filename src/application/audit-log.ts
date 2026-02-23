import { NextFunction, Request, Response } from "express";
import { AuditLog } from "../infrastructure/entities/AuditLog";
import { User } from "../infrastructure/entities/User";
import { getAuth } from "@clerk/express";
import mongoose from "mongoose";

/**
 * Helper to create an audit log entry from anywhere in the application.
 * Can be called directly from other application handlers.
 */
export const createAuditLog = async (params: {
  action: string;
  performedBy?: mongoose.Types.ObjectId | string;
  targetType: "User" | "SolarUnit" | "Invoice" | "Anomaly";
  targetId: mongoose.Types.ObjectId | string;
  details?: Record<string, any>;
}) => {
  try {
    await AuditLog.create({
      action: params.action,
      performedBy: params.performedBy,
      targetType: params.targetType,
      targetId: params.targetId,
      details: params.details,
    });
  } catch (error) {
    // Audit logging should never break the main flow
    console.error("Failed to create audit log:", error);
  }
};

/**
 * Helper to resolve the performing user's _id from the Clerk auth context.
 */
export const resolvePerformerId = async (req: Request): Promise<string | undefined> => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) return undefined;
    const user = await User.findOne({ clerkUserId: auth.userId }).select("_id");
    return user?._id?.toString();
  } catch {
    return undefined;
  }
};

/**
 * GET /api/audit-logs
 * Query params: action, targetType, targetId, performedBy, limit, offset
 */
export const getAuditLogs = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { action, targetType, targetId, performedBy, limit = "50", offset = "0" } = req.query;

    const filter: Record<string, any> = {};
    if (action) filter.action = action;
    if (targetType) filter.targetType = targetType;
    if (targetId) filter.targetId = targetId;
    if (performedBy) filter.performedBy = performedBy;

    const total = await AuditLog.countDocuments(filter);
    const logs = await AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(Number(offset))
      .limit(Number(limit))
      .populate("performedBy", "firstName lastName email role");

    res.status(200).json({ logs, total });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/audit-logs/stats
 * Returns counts grouped by action for a quick overview.
 */
export const getAuditLogStats = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const stats = await AuditLog.aggregate([
      {
        $group: {
          _id: "$action",
          count: { $sum: 1 },
          lastOccurrence: { $max: "$createdAt" },
        },
      },
      { $sort: { count: -1 } },
    ]);

    const totalLogs = await AuditLog.countDocuments();

    // Recent activity: count of logs in last 24h and 7d
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [count24h, count7d] = await Promise.all([
      AuditLog.countDocuments({ createdAt: { $gte: last24h } }),
      AuditLog.countDocuments({ createdAt: { $gte: last7d } }),
    ]);

    res.status(200).json({
      total: totalLogs,
      last24h: count24h,
      last7d: count7d,
      byAction: stats,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/audit-logs/target/:targetType/:targetId
 * Get audit trail for a specific resource.
 */
export const getAuditLogsForTarget = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { targetType, targetId } = req.params;

    const logs = await AuditLog.find({ targetType, targetId })
      .sort({ createdAt: -1 })
      .populate("performedBy", "firstName lastName email role");

    res.status(200).json(logs);
  } catch (error) {
    next(error);
  }
};
