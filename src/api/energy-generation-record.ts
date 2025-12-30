import express from "express";
import { getAllEnergyGenerationRecordsBySolarUnitId, getCapacityFactor } from "../application/energy-generation-record";
import { authenticationMiddleware } from "./middlewares/authentication-middleware";

const energyGenerationRecordRouter = express.Router();

energyGenerationRecordRouter
  .route("/solar-unit/:id")
  .get(authenticationMiddleware, getAllEnergyGenerationRecordsBySolarUnitId);

energyGenerationRecordRouter
  .route("/capacity-factor/:solarUnitId")
  .get(authenticationMiddleware, getCapacityFactor);

export default energyGenerationRecordRouter;
