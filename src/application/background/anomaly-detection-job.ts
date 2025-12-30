import cron from 'node-cron';
import { runAnomalyDetectionJob } from '../../application/anomaly';

// /**
//  * Scheduled job for running anomaly detection
//  * 
//  * Default schedule: Every 6 hours (0 */6 * * *)
//  * Can be configured via ANOMALY_DETECTION_SCHEDULE env variable
//  * 
//  * Detection runs analyze the past 14 days of data to identify:
//  * - Zero production events
//  * - Significant drops
//  * - Gradual degradation
//  * - Sensor spikes
//  * - Intermittent failures
//  * - Below threshold performance
//  */

export const initializeAnomalyDetectionScheduler = () => {
  // Run every 6 hours by default, or use custom schedule from env
  const schedule = process.env.ANOMALY_DETECTION_SCHEDULE || '0 */6 * * *';

  cron.schedule(schedule, async () => {
    console.log(`[${new Date().toISOString()}] Starting scheduled anomaly detection...`);
    try {
      const result = await runAnomalyDetectionJob();
      console.log(`[${new Date().toISOString()}] Anomaly detection completed:`, result);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Anomaly detection failed:`, error);
    }
  });

  console.log(`[Scheduler] Anomaly detection scheduled for: ${schedule}`);
};

/**
 * Run anomaly detection immediately (for testing or manual trigger)
 */
export const triggerAnomalyDetection = async () => {
  console.log(`[${new Date().toISOString()}] Manually triggering anomaly detection...`);
  try {
    const result = await runAnomalyDetectionJob();
    console.log(`[${new Date().toISOString()}] Manual anomaly detection completed:`, result);
    return result;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Manual anomaly detection failed:`, error);
    throw error;
  }
};
