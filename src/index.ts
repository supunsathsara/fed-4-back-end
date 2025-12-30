import "dotenv/config";
import express from "express";
import energyGenerationRecordRouter from "./api/energy-generation-record";
import { globalErrorHandler } from "./api/middlewares/global-error-handling-middleware";
import { loggerMiddleware } from "./api/middlewares/logger-middleware";
import solarUnitRouter from "./api/solar-unit";
import weatherRouter from "./api/weather";
import anomalyRouter from "./api/anomaly";
import { connectDB } from "./infrastructure/db";
import { initializeScheduler } from "./infrastructure/scheduler";
import { initializeAnomalyDetectionScheduler } from "./application/background/anomaly-detection-job";
import cors from "cors";
import webhooksRouter from "./api/webhooks";
import { clerkMiddleware } from "@clerk/express";
import usersRouter from "./api/users";

const server = express();
// Allow CORS from any origin
server.use(cors());

server.use(loggerMiddleware);

server.use("/api/webhooks", webhooksRouter);

server.use(clerkMiddleware())

server.use(express.json());

server.use("/api/solar-units", solarUnitRouter);
server.use("/api/energy-generation-records", energyGenerationRecordRouter);
server.use("/api/users", usersRouter);
server.use("/api/weather", weatherRouter);
server.use("/api/anomalies", anomalyRouter);

server.use(globalErrorHandler);

connectDB();
initializeScheduler();
initializeAnomalyDetectionScheduler();

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
