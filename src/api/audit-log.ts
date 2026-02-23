import express from "express";
import { authenticationMiddleware } from "./middlewares/authentication-middleware";
import { authorizationMiddleware } from "./middlewares/authorization-middleware";
import {
  getAuditLogs,
  getAuditLogStats,
  getAuditLogsForTarget,
} from "../application/audit-log";

const auditLogRouter = express.Router();

// All audit log routes are admin-only
auditLogRouter
  .route("/")
  .get(authenticationMiddleware, authorizationMiddleware, getAuditLogs);

auditLogRouter
  .route("/stats")
  .get(authenticationMiddleware, authorizationMiddleware, getAuditLogStats);

auditLogRouter
  .route("/target/:targetType/:targetId")
  .get(authenticationMiddleware, authorizationMiddleware, getAuditLogsForTarget);

export default auditLogRouter;
