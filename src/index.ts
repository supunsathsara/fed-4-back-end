import "dotenv/config";
import express from "express";
import energyGenerationRecordRouter from "./api/energy-generation-record";
import { globalErrorHandler } from "./api/middlewares/global-error-handling-middleware";
import { loggerMiddleware } from "./api/middlewares/logger-middleware";
import solarUnitRouter from "./api/solar-unit";
import weatherRouter from "./api/weather";
import anomalyRouter from "./api/anomaly";
import invoiceRouter from "./api/invoice";
import paymentRouter from "./api/payment";
import { handleStripeWebhook } from "./application/payment";
import { connectDB } from "./infrastructure/db";
import { initializeScheduler } from "./infrastructure/scheduler";
import { initializeAnomalyDetectionScheduler } from "./application/background/anomaly-detection-job";
import { initializeInvoiceScheduler } from "./application/background/generate-invoices";
import cors from "cors";
import webhooksRouter from "./api/webhooks";
import { clerkMiddleware } from "@clerk/express";
import usersRouter from "./api/users";
import auditLogRouter from "./api/audit-log";

const server = express();
// Allow CORS from any origin
server.use(cors());

server.use(loggerMiddleware);

// Clerk webhooks (needs raw body for signature verification)
server.use("/api/webhooks", webhooksRouter);

// Stripe webhook - MUST be before express.json() for signature verification
server.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
);

server.use(clerkMiddleware())

server.use(express.json());

server.use("/api/solar-units", solarUnitRouter);
server.use("/api/energy-generation-records", energyGenerationRecordRouter);
server.use("/api/users", usersRouter);
server.use("/api/weather", weatherRouter);
server.use("/api/anomalies", anomalyRouter);
server.use("/api/invoices", invoiceRouter);
server.use("/api/payments", paymentRouter);
server.use("/api/audit-logs", auditLogRouter);

server.use(globalErrorHandler);

connectDB();
initializeScheduler();
initializeAnomalyDetectionScheduler();
initializeInvoiceScheduler();

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
