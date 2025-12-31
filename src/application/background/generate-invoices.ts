import cron from 'node-cron';
import { SolarUnit } from '../../infrastructure/entities/SolarUnit';
import { EnergyGenerationRecord } from '../../infrastructure/entities/EnergyGenerationRecord';
import { Invoice, PAYMENT_STATUS } from '../../infrastructure/entities/Invoice';

/**
 * Invoice Generation Background Job
 * 
 * Generates monthly invoices for each active solar unit.
 * The billing cycle is anchored to each unit's installation date.
 * 
 * For example, if a unit was installed on the 15th:
 * - January billing period: Jan 15 - Feb 14
 * - February billing period: Feb 15 - Mar 14
 * etc.
 */

// Price per kWh in cents (e.g., $0.12 per kWh = 12 cents)
const PRICE_PER_KWH_CENTS = parseInt(process.env.PRICE_PER_KWH_CENTS || '12');

/**
 * Calculate the billing period for a solar unit based on current date
 */
function calculateBillingPeriod(installationDate: Date, targetDate: Date = new Date()): {
  start: Date;
  end: Date;
} {
  const installDay = installationDate.getDate();
  
  // Get the billing period that ended most recently
  const currentMonth = targetDate.getMonth();
  const currentYear = targetDate.getFullYear();
  const currentDay = targetDate.getDate();
  
  let periodEndMonth, periodEndYear;
  
  // If we're past the install day this month, the period ended this month
  // Otherwise, it ended last month
  if (currentDay >= installDay) {
    periodEndMonth = currentMonth;
    periodEndYear = currentYear;
  } else {
    periodEndMonth = currentMonth - 1;
    periodEndYear = currentYear;
    if (periodEndMonth < 0) {
      periodEndMonth = 11;
      periodEndYear--;
    }
  }
  
  // Period end is the day before the install day of the end month
  const periodEnd = new Date(periodEndYear, periodEndMonth, installDay - 1, 23, 59, 59, 999);
  
  // Period start is the install day of the previous month
  let periodStartMonth = periodEndMonth - 1;
  let periodStartYear = periodEndYear;
  if (periodStartMonth < 0) {
    periodStartMonth = 11;
    periodStartYear--;
  }
  
  const periodStart = new Date(periodStartYear, periodStartMonth, installDay, 0, 0, 0, 0);
  
  return { start: periodStart, end: periodEnd };
}

/**
 * Generate invoice for a single solar unit
 */
async function generateInvoiceForUnit(solarUnit: any): Promise<{
  success: boolean;
  invoiceId?: string;
  error?: string;
}> {
  try {
    const { start, end } = calculateBillingPeriod(solarUnit.installationDate);
    
    // Check if invoice already exists for this period
    const existingInvoice = await Invoice.findOne({
      solarUnitId: solarUnit._id,
      billingPeriodStart: start,
      billingPeriodEnd: end,
    });
    
    if (existingInvoice) {
      return { success: true, invoiceId: existingInvoice._id.toString() };
    }
    
    // Calculate total energy generated during the billing period
    const energyRecords = await EnergyGenerationRecord.aggregate([
      {
        $match: {
          solarUnitId: solarUnit._id,
          timestamp: {
            $gte: start,
            $lte: end,
          },
        },
      },
      {
        $group: {
          _id: null,
          totalEnergy: { $sum: '$energyGenerated' },
        },
      },
    ]);
    
    const totalEnergyGenerated = energyRecords[0]?.totalEnergy || 0;
    
    // Skip if no energy was generated
    if (totalEnergyGenerated <= 0) {
      console.log(`[Invoice] Skipping ${solarUnit.serialNumber}: No energy generated in billing period`);
      return { success: true };
    }
    
    // Calculate amount
    const amountCents = Math.round(totalEnergyGenerated * PRICE_PER_KWH_CENTS);
    
    // Generate invoice number
    const invoiceNumber = await (Invoice as any).generateInvoiceNumber();
    
    // Calculate due date (30 days from now)
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);
    
    // Create the invoice
    const invoice = await Invoice.create({
      solarUnitId: solarUnit._id,
      userId: solarUnit.userId,
      billingPeriodStart: start,
      billingPeriodEnd: end,
      totalEnergyGenerated,
      amountCents,
      paymentStatus: PAYMENT_STATUS.PENDING,
      invoiceNumber,
      dueDate,
    });
    
    console.log(`[Invoice] Created ${invoiceNumber} for ${solarUnit.serialNumber}: ${totalEnergyGenerated.toFixed(2)} kWh = $${(amountCents / 100).toFixed(2)}`);
    
    return { success: true, invoiceId: invoice._id.toString() };
  } catch (error: any) {
    console.error(`[Invoice] Error generating for ${solarUnit.serialNumber}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Run invoice generation for all active solar units
 */
export async function runInvoiceGenerationJob(): Promise<{
  processed: number;
  invoicesCreated: number;
  errors: number;
}> {
  console.log(`[${new Date().toISOString()}] Starting invoice generation job...`);
  
  const activeSolarUnits = await SolarUnit.find({ status: 'ACTIVE' });
  let invoicesCreated = 0;
  let errors = 0;
  
  for (const solarUnit of activeSolarUnits) {
    const result = await generateInvoiceForUnit(solarUnit);
    if (result.success && result.invoiceId) {
      invoicesCreated++;
    } else if (!result.success) {
      errors++;
    }
  }
  
  console.log(`[${new Date().toISOString()}] Invoice generation complete. Processed: ${activeSolarUnits.length}, Created: ${invoicesCreated}, Errors: ${errors}`);
  
  return {
    processed: activeSolarUnits.length,
    invoicesCreated,
    errors,
  };
}

/**
 * Initialize the invoice generation scheduler
 * Runs on the 1st of every month at midnight
 */
export const initializeInvoiceScheduler = () => {
  // Run on the 1st of every month at 00:00
  const schedule = process.env.INVOICE_CRON_SCHEDULE || '0 0 1 * *';
  
  cron.schedule(schedule, async () => {
    console.log(`[${new Date().toISOString()}] Starting scheduled invoice generation...`);
    try {
      const result = await runInvoiceGenerationJob();
      console.log(`[${new Date().toISOString()}] Scheduled invoice generation completed:`, result);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Scheduled invoice generation failed:`, error);
    }
  });
  
  console.log(`[Scheduler] Invoice generation scheduled for: ${schedule}`);
};

/**
 * Manually trigger invoice generation (for testing or admin use)
 */
export const triggerInvoiceGeneration = async () => {
  console.log(`[${new Date().toISOString()}] Manually triggering invoice generation...`);
  return await runInvoiceGenerationJob();
};
