import mongoose from "mongoose";

/**
 * Invoice Entity
 * 
 * Stores billing invoices for solar unit energy generation.
 * Generated monthly based on the solar unit's installation date.
 */

export const PAYMENT_STATUS = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
} as const;

const invoiceSchema = new mongoose.Schema({
  // Reference to the solar unit being billed
  solarUnitId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SolarUnit",
    required: true,
    index: true,
  },
  
  // Reference to the user who owns the solar unit
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  
  // Billing period start date
  billingPeriodStart: {
    type: Date,
    required: true,
  },
  
  // Billing period end date
  billingPeriodEnd: {
    type: Date,
    required: true,
  },
  
  // Total energy generated during the billing period (kWh)
  totalEnergyGenerated: {
    type: Number,
    required: true,
    min: 0,
  },
  
  // Amount to be paid (in cents for Stripe compatibility)
  amountCents: {
    type: Number,
    required: true,
    min: 0,
  },
  
  // Payment status
  paymentStatus: {
    type: String,
    required: true,
    enum: Object.values(PAYMENT_STATUS),
    default: 'PENDING',
    index: true,
  },
  
  // When the payment was completed
  paidAt: {
    type: Date,
  },
  
  // Stripe session ID for tracking
  stripeSessionId: {
    type: String,
  },
  
  // Stripe payment intent ID
  stripePaymentIntentId: {
    type: String,
  },
  
  // Invoice number for display (e.g., INV-2025-001)
  invoiceNumber: {
    type: String,
    unique: true,
    required: true,
  },
  
  // Due date (typically 30 days after generation)
  dueDate: {
    type: Date,
    required: true,
  },
}, {
  timestamps: true,
});

// Compound indexes for common queries
invoiceSchema.index({ userId: 1, paymentStatus: 1 });
invoiceSchema.index({ solarUnitId: 1, billingPeriodStart: 1 });
invoiceSchema.index({ createdAt: -1 });

// Virtual to check if invoice is overdue
invoiceSchema.virtual('isOverdue').get(function() {
  return this.paymentStatus === 'PENDING' && new Date() > this.dueDate;
});

// Static method to generate invoice number
invoiceSchema.statics.generateInvoiceNumber = async function(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await this.countDocuments({
    createdAt: {
      $gte: new Date(year, 0, 1),
      $lt: new Date(year + 1, 0, 1),
    },
  });
  const paddedCount = String(count + 1).padStart(4, '0');
  return `INV-${year}-${paddedCount}`;
};

export const Invoice = mongoose.model("Invoice", invoiceSchema);
