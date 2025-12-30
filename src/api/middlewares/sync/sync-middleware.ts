import { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { NotFoundError } from "../../../domain/errors/errors";
import { User } from "../../../infrastructure/entities/User"
import { SolarUnit } from "../../../infrastructure/entities/SolarUnit";
import { EnergyGenerationRecord } from "../../../infrastructure/entities/EnergyGenerationRecord";

import { z } from "zod";

export const DataAPIEnergyGenerationRecordDto = z.object({
    _id: z.string(),
    serialNumber: z.string(),
    energyGenerated: z.number(),
    timestamp: z.string(),
    intervalHours: z.number(),
    __v: z.number(),
});

/**
 * Synchronizes energy generation records from the data API
 * Fetches latest records and merges new data with existing records
 */
export const syncMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
    try {
        const auth = getAuth(req);
        const user = await User.findOne({ clerkUserId: auth.userId });
        if (!user) {
            throw new NotFoundError("User not found");
        }
        
        const solarUnit = await SolarUnit.findOne({ userId: user._id });
        if (!solarUnit) {
            throw new NotFoundError("Solar unit not found");
        }

        // Fetch latest records from data API
        const dataAPIResponse = await fetch(
            `http://localhost:8001/api/energy-generation-records/solar-unit/${solarUnit.serialNumber}`
        );
        if (!dataAPIResponse.ok) {
            throw new Error("Failed to fetch energy generation records from data API");
        }

        const latestEnergyGenerationRecords = DataAPIEnergyGenerationRecordDto
            .array()
            .parse(await dataAPIResponse.json());

        // Get latest synced timestamp to only fetch new data
        const lastSyncedRecord = await EnergyGenerationRecord
            .findOne({ solarUnitId: solarUnit._id })
            .sort({ timestamp: -1 });

        // Filter records that are new (not yet in database)
        const newRecords = latestEnergyGenerationRecords.filter(apiRecord => {
            if (!lastSyncedRecord) return true; // First sync, add all
            return new Date(apiRecord.timestamp) > lastSyncedRecord.timestamp;
        });

        if (newRecords.length > 0) {
            // Transform API records to match schema
            const recordsToInsert = newRecords.map(record => ({
                solarUnitId: solarUnit._id,
                energyGenerated: record.energyGenerated,
                timestamp: new Date(record.timestamp),
                intervalHours: record.intervalHours,
            }));

            await EnergyGenerationRecord.insertMany(recordsToInsert);
            console.log(`Synced ${recordsToInsert.length} new energy generation records`);
        } else {
            console.log("No new records to sync");
        }

        next();
    } catch (error) {
        console.error("Sync middleware error:", error);
        next(error);
    }
};