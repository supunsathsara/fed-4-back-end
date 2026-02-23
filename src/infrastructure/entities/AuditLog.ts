import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      enum: [
        // User lifecycle
        "USER_CREATED",
        "USER_APPROVED",
        "USER_REJECTED",
        "USER_SUSPENDED",
        "USER_REACTIVATED",
        // Solar unit lifecycle
        "SOLAR_UNIT_CREATED",
        "SOLAR_UNIT_UPDATED",
        "SOLAR_UNIT_DELETED",
        "SOLAR_UNIT_ASSIGNED",
        "SOLAR_UNIT_UNASSIGNED",
        // Invoice
        "INVOICE_GENERATED",
        "INVOICE_PAID",
        // Anomaly
        "ANOMALY_ACKNOWLEDGED",
        "ANOMALY_RESOLVED",
        "ANOMALY_FALSE_POSITIVE",
      ],
      index: true,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    targetType: {
      type: String,
      required: true,
      enum: ["User", "SolarUnit", "Invoice", "Anomaly"],
      index: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient querying
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

export const AuditLog = mongoose.model("AuditLog", auditLogSchema);
