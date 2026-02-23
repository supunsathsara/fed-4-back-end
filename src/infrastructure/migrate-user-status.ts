/**
 * Migration script to set status for existing users who don't have one.
 * 
 * Run once after deploying the onboarding workflow:
 *   npx ts-node src/infrastructure/migrate-user-status.ts
 * 
 * Or add to package.json scripts:
 *   "migrate:user-status": "ts-node src/infrastructure/migrate-user-status.ts"
 */

import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

async function migrate() {
  const MONGODB_URL = process.env.MONGODB_URL;
  if (!MONGODB_URL) {
    throw new Error("MONGODB_URL is not defined");
  }

  await mongoose.connect(MONGODB_URL);
  console.log("Connected to MongoDB");

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("Database connection not established");
  }

  // Find all users without a status field
  const usersWithoutStatus = await db.collection("users").countDocuments({
    status: { $exists: false },
  });

  console.log(`Found ${usersWithoutStatus} users without a status field`);

  if (usersWithoutStatus === 0) {
    console.log("No migration needed — all users already have a status.");
    await mongoose.disconnect();
    return;
  }

  // Set all existing users without status to ACTIVE (they were already using the system)
  const result = await db.collection("users").updateMany(
    { status: { $exists: false } },
    {
      $set: {
        status: "ACTIVE",
        statusUpdatedAt: new Date(),
      },
    }
  );

  console.log(`Updated ${result.modifiedCount} users to ACTIVE status`);
  await mongoose.disconnect();
  console.log("Migration complete");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
