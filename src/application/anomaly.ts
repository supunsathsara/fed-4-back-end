import { EnergyGenerationRecord } from "../infrastructure/entities/EnergyGenerationRecord";
import { SolarUnit } from "../infrastructure/entities/SolarUnit";
import { Anomaly, ANOMALY_TYPES, SEVERITY_LEVELS, RESOLUTION_STATUS } from "../infrastructure/entities/Anomaly";
import mongoose from "mongoose";

/**
 * Anomaly Detection Application Service
 * 
 * This module implements detection algorithms for 6 types of anomalies:
 * 
 * 1. ZERO_PRODUCTION (Critical)
 *    - Complete failure: no energy generated during daylight hours
 *    - Detection: Check for 0 kWh during expected generation hours (6 AM - 6 PM)
 *    - User Impact: Equipment may be damaged or disconnected
 *    - Action: Immediate inspection of solar unit and connections
 * 
 * 2. SIGNIFICANT_DROP (Warning)
 *    - Production dropped significantly below the window average
 *    - Detection: Compare daily output to 7-day rolling average; flag if >50% below
 *    - User Impact: Partial system failure or environmental obstruction
 *    - Action: Check for shading, dirt, or partial equipment failure
 * 
 * 3. GRADUAL_DEGRADATION (Warning)
 *    - Consistent decline in production over time
 *    - Detection: Linear regression on 14-day window; flag if negative slope > threshold
 *    - User Impact: Panel aging, dirt accumulation, or slow equipment degradation
 *    - Action: Schedule maintenance, panel cleaning, or system check
 * 
 * 4. SENSOR_SPIKE (Info)
 *    - Unrealistic spike in readings (likely sensor malfunction)
 *    - Detection: Flag values that exceed physical capacity by >50%
 *    - User Impact: Data quality issue, not actual production problem
 *    - Action: Check sensor calibration, may need sensor replacement
 * 
 * 5. INTERMITTENT_FAILURE (Warning)
 *    - Sporadic failures with gaps in production
 *    - Detection: Multiple zero-production days within a week with recovery in between
 *    - User Impact: Connection issues, inverter problems
 *    - Action: Check electrical connections and inverter
 * 
 * 6. BELOW_THRESHOLD (Info)
 *    - Production consistently below minimum expected threshold
 *    - Detection: Daily production below capacity-based minimum for multiple days
 *    - User Impact: Underperforming system
 *    - Action: Review installation, check for obstructions
 */

interface DailyRecord {
  date: Date;
  totalEnergy: number;
}

interface DetectedAnomaly {
  solarUnitId: mongoose.Types.ObjectId;
  anomalyType: string;
  severity: string;
  affectedPeriod: {
    startDate: Date;
    endDate: Date;
  };
  description: string;
  detectionDetails: {
    method: string;
    expectedValue?: number;
    actualValue?: number;
    deviationPercent?: number;
    threshold?: number;
    context?: Record<string, any>;
  };
  recommendedAction: string;
  estimatedEnergyLoss?: number;
}

/**
 * Get daily aggregated energy records for a solar unit
 */
async function getDailyRecords(solarUnitId: mongoose.Types.ObjectId, days: number): Promise<DailyRecord[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const records = await EnergyGenerationRecord.aggregate([
    {
      $match: {
        solarUnitId: solarUnitId,
        timestamp: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: "$timestamp" },
          month: { $month: "$timestamp" },
          day: { $dayOfMonth: "$timestamp" },
        },
        totalEnergy: { $sum: "$energyGenerated" },
        date: { $first: "$timestamp" },
      },
    },
    {
      $sort: { date: 1 },
    },
  ]);

  return records.map(r => ({
    date: new Date(r._id.year, r._id.month - 1, r._id.day),
    totalEnergy: r.totalEnergy,
  }));
}

/**
 * Detect ZERO_PRODUCTION anomalies
 * Flags days with zero or near-zero production
 */
function detectZeroProduction(
  records: DailyRecord[],
  solarUnitId: mongoose.Types.ObjectId,
  capacity: number
): DetectedAnomaly[] {
  const anomalies: DetectedAnomaly[] = [];
  const threshold = capacity * 0.01; // Less than 1% of capacity is considered zero

  for (const record of records) {
    if (record.totalEnergy <= threshold) {
      anomalies.push({
        solarUnitId,
        anomalyType: ANOMALY_TYPES.ZERO_PRODUCTION,
        severity: SEVERITY_LEVELS.CRITICAL,
        affectedPeriod: {
          startDate: record.date,
          endDate: record.date,
        },
        description: `Zero energy production detected on ${record.date.toLocaleDateString()}. Total output: ${record.totalEnergy.toFixed(2)} kWh.`,
        detectionDetails: {
          method: 'absolute_threshold',
          expectedValue: capacity * 0.5, // Expected at least 50% of daily capacity
          actualValue: record.totalEnergy,
          deviationPercent: 100,
          threshold: threshold,
        },
        recommendedAction: 'Immediately inspect the solar unit, check electrical connections, and verify inverter status.',
        estimatedEnergyLoss: capacity * 0.5 - record.totalEnergy,
      });
    }
  }

  return anomalies;
}

/**
 * Detect SIGNIFICANT_DROP anomalies
 * Compares each day to the rolling average
 */
function detectSignificantDrop(
  records: DailyRecord[],
  solarUnitId: mongoose.Types.ObjectId,
  dropThresholdPercent: number = 50
): DetectedAnomaly[] {
  const anomalies: DetectedAnomaly[] = [];
  
  if (records.length < 3) return anomalies;

  const totalEnergy = records.reduce((sum, r) => sum + r.totalEnergy, 0);
  const averageEnergy = totalEnergy / records.length;

  for (const record of records) {
    // Skip zero production (handled by different detector)
    if (record.totalEnergy === 0) continue;

    const deviationPercent = ((averageEnergy - record.totalEnergy) / averageEnergy) * 100;

    if (deviationPercent > dropThresholdPercent) {
      anomalies.push({
        solarUnitId,
        anomalyType: ANOMALY_TYPES.SIGNIFICANT_DROP,
        severity: SEVERITY_LEVELS.WARNING,
        affectedPeriod: {
          startDate: record.date,
          endDate: record.date,
        },
        description: `Production dropped ${deviationPercent.toFixed(1)}% below the ${records.length}-day average on ${record.date.toLocaleDateString()}. Expected ~${averageEnergy.toFixed(1)} kWh, got ${record.totalEnergy.toFixed(1)} kWh.`,
        detectionDetails: {
          method: 'window_average_comparison',
          expectedValue: averageEnergy,
          actualValue: record.totalEnergy,
          deviationPercent: deviationPercent,
          threshold: dropThresholdPercent,
          context: {
            windowSize: records.length,
            windowAverage: averageEnergy,
          },
        },
        recommendedAction: 'Check for new shading sources, dirt accumulation on panels, or partial equipment failure.',
        estimatedEnergyLoss: averageEnergy - record.totalEnergy,
      });
    }
  }

  return anomalies;
}

/**
 * Detect GRADUAL_DEGRADATION using linear regression
 */
function detectGradualDegradation(
  records: DailyRecord[],
  solarUnitId: mongoose.Types.ObjectId,
  degradationThresholdPercent: number = 15 // 15% decline over the window
): DetectedAnomaly[] {
  const anomalies: DetectedAnomaly[] = [];
  
  if (records.length < 7) return anomalies;

  // Simple linear regression to detect trend
  const n = records.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += records[i].totalEnergy;
    sumXY += i * records[i].totalEnergy;
    sumX2 += i * i;
  }

  // Calculate slope (rate of change)
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const averageEnergy = sumY / n;
  
  // Calculate total decline over the window
  const totalDecline = slope * (n - 1);
  const declinePercent = (Math.abs(totalDecline) / averageEnergy) * 100;

  if (slope < 0 && declinePercent > degradationThresholdPercent) {
    const startDate = records[0].date;
    const endDate = records[records.length - 1].date;
    
    anomalies.push({
      solarUnitId,
      anomalyType: ANOMALY_TYPES.GRADUAL_DEGRADATION,
      severity: SEVERITY_LEVELS.WARNING,
      affectedPeriod: {
        startDate,
        endDate,
      },
      description: `Gradual degradation detected: Production declined ${declinePercent.toFixed(1)}% over ${n} days. Average daily decline: ${Math.abs(slope).toFixed(2)} kWh.`,
      detectionDetails: {
        method: 'linear_regression',
        expectedValue: records[0].totalEnergy,
        actualValue: records[records.length - 1].totalEnergy,
        deviationPercent: declinePercent,
        threshold: degradationThresholdPercent,
        context: {
          slope,
          windowSize: n,
          averageEnergy,
        },
      },
      recommendedAction: 'Schedule maintenance to inspect panel condition. Consider cleaning panels and checking for equipment wear.',
      estimatedEnergyLoss: Math.abs(totalDecline) * n / 2, // Rough estimate
    });
  }

  return anomalies;
}

/**
 * Detect SENSOR_SPIKE anomalies
 * Flags unrealistic readings that exceed system capacity
 */
function detectSensorSpike(
  records: DailyRecord[],
  solarUnitId: mongoose.Types.ObjectId,
  capacity: number,
  spikeThresholdMultiplier: number = 1.5
): DetectedAnomaly[] {
  const anomalies: DetectedAnomaly[] = [];
  
  // Maximum theoretical daily output: capacity * peak sun hours (~6-8 hours)
  const maxDailyOutput = capacity * 8;
  const spikeThreshold = maxDailyOutput * spikeThresholdMultiplier;

  for (const record of records) {
    if (record.totalEnergy > spikeThreshold) {
      anomalies.push({
        solarUnitId,
        anomalyType: ANOMALY_TYPES.SENSOR_SPIKE,
        severity: SEVERITY_LEVELS.INFO,
        affectedPeriod: {
          startDate: record.date,
          endDate: record.date,
        },
        description: `Unrealistic energy reading detected: ${record.totalEnergy.toFixed(1)} kWh on ${record.date.toLocaleDateString()}. Maximum expected: ${maxDailyOutput.toFixed(1)} kWh.`,
        detectionDetails: {
          method: 'capacity_threshold',
          expectedValue: maxDailyOutput,
          actualValue: record.totalEnergy,
          deviationPercent: ((record.totalEnergy - maxDailyOutput) / maxDailyOutput) * 100,
          threshold: spikeThreshold,
          context: {
            systemCapacity: capacity,
            maxPeakSunHours: 8,
          },
        },
        recommendedAction: 'Check sensor calibration and data transmission. This reading likely indicates a sensor malfunction.',
      });
    }
  }

  return anomalies;
}

/**
 * Detect INTERMITTENT_FAILURE anomalies
 * Identifies sporadic zero-production days with recovery
 */
function detectIntermittentFailure(
  records: DailyRecord[],
  solarUnitId: mongoose.Types.ObjectId,
  capacity: number
): DetectedAnomaly[] {
  const anomalies: DetectedAnomaly[] = [];
  
  if (records.length < 5) return anomalies;

  const threshold = capacity * 0.05; // 5% of capacity considered failure
  let failureDays: Date[] = [];
  let recoveryDays: Date[] = [];

  for (const record of records) {
    if (record.totalEnergy <= threshold) {
      failureDays.push(record.date);
    } else {
      recoveryDays.push(record.date);
    }
  }

  // Intermittent failure: 2+ failure days with recovery days in between
  if (failureDays.length >= 2 && recoveryDays.length >= 2) {
    // Check if failures are non-consecutive
    let hasIntermittentPattern = false;
    for (let i = 1; i < failureDays.length; i++) {
      const daysBetween = Math.floor((failureDays[i].getTime() - failureDays[i-1].getTime()) / (1000 * 60 * 60 * 24));
      if (daysBetween > 1) {
        hasIntermittentPattern = true;
        break;
      }
    }

    if (hasIntermittentPattern) {
      anomalies.push({
        solarUnitId,
        anomalyType: ANOMALY_TYPES.INTERMITTENT_FAILURE,
        severity: SEVERITY_LEVELS.WARNING,
        affectedPeriod: {
          startDate: records[0].date,
          endDate: records[records.length - 1].date,
        },
        description: `Intermittent failure pattern detected: ${failureDays.length} failure days out of ${records.length} days, with recovery periods in between.`,
        detectionDetails: {
          method: 'pattern_analysis',
          threshold: threshold,
          context: {
            failureDays: failureDays.map(d => d.toLocaleDateString()),
            recoveryDays: recoveryDays.length,
            totalDays: records.length,
          },
        },
        recommendedAction: 'Check electrical connections, inverter, and wiring for loose connections or intermittent faults.',
        estimatedEnergyLoss: failureDays.length * (capacity * 0.5),
      });
    }
  }

  return anomalies;
}

/**
 * Detect BELOW_THRESHOLD anomalies
 * Flags consistent underperformance
 */
function detectBelowThreshold(
  records: DailyRecord[],
  solarUnitId: mongoose.Types.ObjectId,
  capacity: number,
  thresholdPercent: number = 20 // 20% of expected capacity
): DetectedAnomaly[] {
  const anomalies: DetectedAnomaly[] = [];
  
  if (records.length < 3) return anomalies;

  // Expected daily output: capacity * 4 average sun hours = baseline
  const expectedDailyOutput = capacity * 4;
  const threshold = expectedDailyOutput * (thresholdPercent / 100);

  const belowThresholdDays = records.filter(r => r.totalEnergy > 0 && r.totalEnergy < threshold);

  if (belowThresholdDays.length >= Math.ceil(records.length * 0.5)) {
    // More than 50% of days are below threshold
    anomalies.push({
      solarUnitId,
      anomalyType: ANOMALY_TYPES.BELOW_THRESHOLD,
      severity: SEVERITY_LEVELS.INFO,
      affectedPeriod: {
        startDate: records[0].date,
        endDate: records[records.length - 1].date,
      },
      description: `System consistently underperforming: ${belowThresholdDays.length} out of ${records.length} days produced less than ${thresholdPercent}% of expected capacity.`,
      detectionDetails: {
        method: 'capacity_percentage_threshold',
        expectedValue: expectedDailyOutput,
        threshold: threshold,
        context: {
          systemCapacity: capacity,
          expectedDailyOutput,
          belowThresholdDays: belowThresholdDays.length,
          averageProduction: records.reduce((sum, r) => sum + r.totalEnergy, 0) / records.length,
        },
      },
      recommendedAction: 'Review system installation, check for persistent shading, or consider system inspection for underlying issues.',
    });
  }

  return anomalies;
}

/**
 * Run all anomaly detection algorithms for a solar unit
 */
export async function detectAnomaliesForSolarUnit(
  solarUnitId: mongoose.Types.ObjectId,
  windowDays: number = 14
): Promise<DetectedAnomaly[]> {
  const solarUnit = await SolarUnit.findById(solarUnitId);
  if (!solarUnit) {
    throw new Error(`Solar unit ${solarUnitId} not found`);
  }

  const capacity = solarUnit.capacity;
  const records = await getDailyRecords(solarUnitId, windowDays);

  if (records.length === 0) {
    return [];
  }

  const allAnomalies: DetectedAnomaly[] = [];

  // Run all detection algorithms
  allAnomalies.push(...detectZeroProduction(records, solarUnitId, capacity));
  allAnomalies.push(...detectSignificantDrop(records, solarUnitId));
  allAnomalies.push(...detectGradualDegradation(records, solarUnitId));
  allAnomalies.push(...detectSensorSpike(records, solarUnitId, capacity));
  allAnomalies.push(...detectIntermittentFailure(records, solarUnitId, capacity));
  allAnomalies.push(...detectBelowThreshold(records, solarUnitId, capacity));

  return allAnomalies;
}

/**
 * Run anomaly detection for all active solar units
 */
export async function runAnomalyDetectionJob(): Promise<{
  processed: number;
  anomaliesFound: number;
  newAnomalies: number;
}> {
  console.log(`[${new Date().toISOString()}] Starting anomaly detection job...`);
  
  const activeSolarUnits = await SolarUnit.find({ status: 'ACTIVE' });
  let totalAnomaliesFound = 0;
  let newAnomaliesSaved = 0;

  for (const solarUnit of activeSolarUnits) {
    try {
      const detectedAnomalies = await detectAnomaliesForSolarUnit(solarUnit._id);
      totalAnomaliesFound += detectedAnomalies.length;

      // Save new anomalies (avoid duplicates based on type, date, and solar unit)
      for (const anomaly of detectedAnomalies) {
        // Check if a similar anomaly already exists
        const existingAnomaly = await Anomaly.findOne({
          solarUnitId: anomaly.solarUnitId,
          anomalyType: anomaly.anomalyType,
          'affectedPeriod.startDate': anomaly.affectedPeriod.startDate,
          'affectedPeriod.endDate': anomaly.affectedPeriod.endDate,
        });

        if (!existingAnomaly) {
          await Anomaly.create({
            ...anomaly,
            status: RESOLUTION_STATUS.OPEN,
          });
          newAnomaliesSaved++;
        }
      }
    } catch (error) {
      console.error(`Error detecting anomalies for solar unit ${solarUnit._id}:`, error);
    }
  }

  console.log(`[${new Date().toISOString()}] Anomaly detection complete. Processed: ${activeSolarUnits.length}, Found: ${totalAnomaliesFound}, New: ${newAnomaliesSaved}`);

  return {
    processed: activeSolarUnits.length,
    anomaliesFound: totalAnomaliesFound,
    newAnomalies: newAnomaliesSaved,
  };
}

/**
 * Get anomalies for a specific solar unit
 */
export async function getAnomaliesForSolarUnit(
  solarUnitId: mongoose.Types.ObjectId,
  filters?: {
    type?: string;
    severity?: string;
    status?: string;
    limit?: number;
  }
) {
  const query: any = { solarUnitId };

  if (filters?.type) {
    query.anomalyType = filters.type;
  }
  if (filters?.severity) {
    query.severity = filters.severity;
  }
  if (filters?.status) {
    query.status = filters.status;
  }

  const anomalies = await Anomaly.find(query)
    .sort({ detectedAt: -1 })
    .limit(filters?.limit || 100)
    .populate('acknowledgedBy', 'firstName lastName email')
    .populate('resolvedBy', 'firstName lastName email');

  return anomalies;
}

/**
 * Get all anomalies (admin view)
 */
export async function getAllAnomalies(filters?: {
  type?: string;
  severity?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  const query: any = {};

  if (filters?.type) {
    query.anomalyType = filters.type;
  }
  if (filters?.severity) {
    query.severity = filters.severity;
  }
  if (filters?.status) {
    query.status = filters.status;
  }

  const [anomalies, total] = await Promise.all([
    Anomaly.find(query)
      .sort({ detectedAt: -1 })
      .skip(filters?.offset || 0)
      .limit(filters?.limit || 100)
      .populate('solarUnitId', 'serialNumber capacity status')
      .populate('acknowledgedBy', 'firstName lastName email')
      .populate('resolvedBy', 'firstName lastName email'),
    Anomaly.countDocuments(query),
  ]);

  return { anomalies, total };
}

/**
 * Update anomaly status (acknowledge, resolve, mark as false positive)
 */
export async function updateAnomalyStatus(
  anomalyId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId,
  action: 'acknowledge' | 'resolve' | 'false_positive',
  notes?: string
) {
  const anomaly = await Anomaly.findById(anomalyId);
  
  if (!anomaly) {
    throw new Error('Anomaly not found');
  }

  const now = new Date();

  switch (action) {
    case 'acknowledge':
      anomaly.status = RESOLUTION_STATUS.ACKNOWLEDGED;
      anomaly.acknowledgedAt = now;
      anomaly.acknowledgedBy = userId;
      break;
    case 'resolve':
      anomaly.status = RESOLUTION_STATUS.RESOLVED;
      anomaly.resolvedAt = now;
      anomaly.resolvedBy = userId;
      if (notes) anomaly.resolutionNotes = notes;
      break;
    case 'false_positive':
      anomaly.status = RESOLUTION_STATUS.FALSE_POSITIVE;
      anomaly.resolvedAt = now;
      anomaly.resolvedBy = userId;
      if (notes) anomaly.resolutionNotes = notes;
      break;
  }

  await anomaly.save();
  return anomaly;
}

/**
 * Get anomaly statistics for a solar unit
 */
export async function getAnomalyStats(solarUnitId?: mongoose.Types.ObjectId) {
  const match: any = {};
  if (solarUnitId) {
    match.solarUnitId = solarUnitId;
  }

  const [byType, bySeverity, byStatus, recentTrend] = await Promise.all([
    // Count by type
    Anomaly.aggregate([
      { $match: match },
      { $group: { _id: '$anomalyType', count: { $sum: 1 } } },
    ]),
    // Count by severity
    Anomaly.aggregate([
      { $match: match },
      { $group: { _id: '$severity', count: { $sum: 1 } } },
    ]),
    // Count by status
    Anomaly.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    // Recent trend (last 30 days, grouped by day)
    Anomaly.aggregate([
      {
        $match: {
          ...match,
          detectedAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: '$detectedAt' },
            month: { $month: '$detectedAt' },
            day: { $dayOfMonth: '$detectedAt' },
          },
          count: { $sum: 1 },
          critical: { $sum: { $cond: [{ $eq: ['$severity', 'CRITICAL'] }, 1, 0] } },
          warning: { $sum: { $cond: [{ $eq: ['$severity', 'WARNING'] }, 1, 0] } },
          info: { $sum: { $cond: [{ $eq: ['$severity', 'INFO'] }, 1, 0] } },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
    ]),
  ]);

  return {
    byType: byType.reduce((acc, item) => ({ ...acc, [item._id]: item.count }), {}),
    bySeverity: bySeverity.reduce((acc, item) => ({ ...acc, [item._id]: item.count }), {}),
    byStatus: byStatus.reduce((acc, item) => ({ ...acc, [item._id]: item.count }), {}),
    recentTrend: recentTrend.map(item => ({
      date: `${item._id.year}-${String(item._id.month).padStart(2, '0')}-${String(item._id.day).padStart(2, '0')}`,
      total: item.count,
      critical: item.critical,
      warning: item.warning,
      info: item.info,
    })),
  };
}
