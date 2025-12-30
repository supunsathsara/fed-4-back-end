import { GetAllEnergyGenerationRecordsQueryDto } from "../domain/dtos/solar-unit";
import { ValidationError, NotFoundError } from "../domain/errors/errors";
import { EnergyGenerationRecord } from "../infrastructure/entities/EnergyGenerationRecord";
import { SolarUnit } from "../infrastructure/entities/SolarUnit";
import { NextFunction, Request, Response } from "express";

export const getAllEnergyGenerationRecordsBySolarUnitId = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const results = GetAllEnergyGenerationRecordsQueryDto.safeParse(req.query);
    if (!results.success) {
      throw new ValidationError(results.error.message);
    }

    const { groupBy, limit } = results.data;

    if (!groupBy) {
      const energyGenerationRecords = await EnergyGenerationRecord.find({
        solarUnitId: id,
      }).sort({ timestamp: -1 });
      res.status(200).json(energyGenerationRecords);
    }

    if (groupBy === "date") {
      if (!limit) {
        const energyGenerationRecords = await EnergyGenerationRecord.aggregate([
          {
            $group: {
              _id: {
                date: {
                  $dateToString: { format: "%Y-%m-%d", date: "$timestamp" },
                },
              },
              totalEnergy: { $sum: "$energyGenerated" },
            },
          },
          {
            $sort: { "_id.date": -1 },
          },
        ]);

        res.status(200).json(energyGenerationRecords);
      }

      const energyGenerationRecords = await EnergyGenerationRecord.aggregate([
        {
          $group: {
            _id: {
              date: {
                $dateToString: { format: "%Y-%m-%d", date: "$timestamp" },
              },
            },
            totalEnergy: { $sum: "$energyGenerated" },
          },
        },
        {
          $sort: { "_id.date": -1 },
        },
      ]);

      res.status(200).json(energyGenerationRecords.slice(0, parseInt(limit)));
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Calculate Capacity Factor for a Solar Unit
 * Capacity Factor = (Actual Energy Generated / Theoretical Maximum) × 100%
 * 
 * Theoretical Maximum = Capacity (W) × Hours × Days / 1000 (to convert to kWh)
 * Assuming average peak sun hours per day (typically 4-6 hours for solar)
 */
export const getCapacityFactor = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { solarUnitId } = req.params;
    const days = parseInt(req.query.days as string) || 7;
    
    // Get the solar unit to retrieve its capacity
    const solarUnit = await SolarUnit.findById(solarUnitId);
    if (!solarUnit) {
      throw new NotFoundError("Solar unit not found");
    }

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get actual energy generated in the period
    const energyRecords = await EnergyGenerationRecord.aggregate([
      {
        $match: {
          solarUnitId: solarUnit._id,
          timestamp: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalEnergy: { $sum: "$energyGenerated" },
          recordCount: { $sum: 1 }
        }
      }
    ]);

    const actualEnergy = energyRecords.length > 0 ? energyRecords[0].totalEnergy : 0;
    const recordCount = energyRecords.length > 0 ? energyRecords[0].recordCount : 0;

    // Calculate theoretical maximum
    // Capacity is in Watts, assuming 5 peak sun hours per day (average for solar)
    const peakSunHours = 5;
    const capacityWatts = solarUnit.capacity; // Already in Watts
    const theoreticalMaximum = (capacityWatts * peakSunHours * days) / 1000; // Convert to kWh

    // Calculate capacity factor
    const capacityFactor = theoreticalMaximum > 0 
      ? Math.min(100, (actualEnergy / theoreticalMaximum) * 100) 
      : 0;

    // Calculate daily breakdown for the chart
    const dailyRecords = await EnergyGenerationRecord.aggregate([
      {
        $match: {
          solarUnitId: solarUnit._id,
          timestamp: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } }
          },
          dailyEnergy: { $sum: "$energyGenerated" }
        }
      },
      {
        $sort: { "_id.date": 1 }
      }
    ]);

    // Calculate daily capacity factors
    const dailyTheoreticalMax = (capacityWatts * peakSunHours) / 1000;
    const dailyCapacityFactors = dailyRecords.map(record => ({
      date: record._id.date,
      actualEnergy: record.dailyEnergy,
      theoreticalMax: dailyTheoreticalMax,
      capacityFactor: dailyTheoreticalMax > 0 
        ? Math.min(100, (record.dailyEnergy / dailyTheoreticalMax) * 100)
        : 0
    }));

    // Determine performance rating
    let performanceRating: "excellent" | "good" | "average" | "poor";
    if (capacityFactor >= 80) {
      performanceRating = "excellent";
    } else if (capacityFactor >= 60) {
      performanceRating = "good";
    } else if (capacityFactor >= 40) {
      performanceRating = "average";
    } else {
      performanceRating = "poor";
    }

    res.status(200).json({
      solarUnitId: solarUnit._id,
      serialNumber: solarUnit.serialNumber,
      capacity: solarUnit.capacity,
      period: {
        days,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      },
      metrics: {
        actualEnergy: Math.round(actualEnergy * 100) / 100,
        theoreticalMaximum: Math.round(theoreticalMaximum * 100) / 100,
        capacityFactor: Math.round(capacityFactor * 100) / 100,
        performanceRating,
        recordCount
      },
      dailyBreakdown: dailyCapacityFactors
    });
  } catch (error) {
    next(error);
  }
};
