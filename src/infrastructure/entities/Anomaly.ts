import mongoose from "mongoose";

/**
 * Anomaly Entity
 * 
 * Stores detected anomalies in solar energy generation data.
 * 
 * Anomaly Types:
 * - ZERO_PRODUCTION: Complete failure - no energy generated during daylight hours
 * - SIGNIFICANT_DROP: Production dropped significantly below expected (>50% below average)
 * - GRADUAL_DEGRADATION: Consistent decline in production over time
 * - SENSOR_SPIKE: Unrealistic spike in readings (likely sensor malfunction)
 * - INTERMITTENT_FAILURE: Sporadic failures with gaps in production
 * - BELOW_THRESHOLD: Production below minimum expected threshold
 * 
 * Severity Levels:
 * - CRITICAL: Immediate action required (equipment failure, zero production)
 * - WARNING: Attention needed soon (significant drops, degradation)
 * - INFO: Informational anomaly, may resolve naturally (minor variations)
 */

export const ANOMALY_TYPES = {
  ZERO_PRODUCTION: 'ZERO_PRODUCTION',
  SIGNIFICANT_DROP: 'SIGNIFICANT_DROP',
  GRADUAL_DEGRADATION: 'GRADUAL_DEGRADATION',
  SENSOR_SPIKE: 'SENSOR_SPIKE',
  INTERMITTENT_FAILURE: 'INTERMITTENT_FAILURE',
  BELOW_THRESHOLD: 'BELOW_THRESHOLD',
} as const;

export const SEVERITY_LEVELS = {
  CRITICAL: 'CRITICAL',
  WARNING: 'WARNING',
  INFO: 'INFO',
} as const;

export const RESOLUTION_STATUS = {
  OPEN: 'OPEN',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  RESOLVED: 'RESOLVED',
  FALSE_POSITIVE: 'FALSE_POSITIVE',
} as const;

const anomalySchema = new mongoose.Schema({
  // Reference to the affected solar unit
  solarUnitId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SolarUnit",
    required: true,
    index: true,
  },
  
  // Type of anomaly detected
  anomalyType: {
    type: String,
    required: true,
    enum: Object.values(ANOMALY_TYPES),
  },
  
  // Severity level
  severity: {
    type: String,
    required: true,
    enum: Object.values(SEVERITY_LEVELS),
    index: true,
  },
  
  // When the anomaly was detected by our system
  detectedAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  
  // The time period affected by the anomaly
  affectedPeriod: {
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
  },
  
  // Human-readable description of the anomaly
  description: {
    type: String,
    required: true,
  },
  
  // Technical details about detection
  detectionDetails: {
    // The method used to detect this anomaly
    method: {
      type: String,
      required: true,
    },
    // Expected value (if applicable)
    expectedValue: {
      type: Number,
    },
    // Actual value observed
    actualValue: {
      type: Number,
    },
    // Deviation percentage from expected
    deviationPercent: {
      type: Number,
    },
    // Threshold that was exceeded
    threshold: {
      type: Number,
    },
    // Additional context data
    context: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  
  // Resolution status
  status: {
    type: String,
    required: true,
    enum: Object.values(RESOLUTION_STATUS),
    default: 'OPEN',
    index: true,
  },
  
  // When the anomaly was acknowledged
  acknowledgedAt: {
    type: Date,
  },
  
  // Who acknowledged the anomaly
  acknowledgedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  
  // When the anomaly was resolved
  resolvedAt: {
    type: Date,
  },
  
  // Who resolved the anomaly
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  
  // Resolution notes
  resolutionNotes: {
    type: String,
  },
  
  // Recommended action for the user
  recommendedAction: {
    type: String,
  },
  
  // Impact assessment
  estimatedEnergyLoss: {
    type: Number, // in kWh
  },
}, {
  timestamps: true, // Adds createdAt and updatedAt
});

// Compound indexes for common queries
anomalySchema.index({ solarUnitId: 1, status: 1 });
anomalySchema.index({ solarUnitId: 1, detectedAt: -1 });
anomalySchema.index({ severity: 1, status: 1 });

// Virtual for checking if anomaly is active
anomalySchema.virtual('isActive').get(function() {
  return this.status === 'OPEN' || this.status === 'ACKNOWLEDGED';
});

export const Anomaly = mongoose.model("Anomaly", anomalySchema);
