import mongoose from "mongoose";
import { SolarUnit } from "./entities/SolarUnit";
import { User } from "./entities/User";
import dotenv from "dotenv";
import { connectDB } from "./db";

dotenv.config();

/**
 * Solar unit definitions — must match the Data API's registered units
 * so the sync service can pull energy records for each serial number.
 */
const SOLAR_UNIT_DEFINITIONS = [
  {
    serialNumber: "SU-0001",
    installationDate: new Date("2025-08-01"),
    capacity: 5000,
    status: "ACTIVE" as const,
  },
  {
    serialNumber: "SU-0002",
    installationDate: new Date("2025-08-15"),
    capacity: 10000,
    status: "ACTIVE" as const,
  },
  {
    serialNumber: "SU-0003",
    installationDate: new Date("2025-09-01"),
    capacity: 3000,
    status: "ACTIVE" as const,
  },
  {
    serialNumber: "SU-0004",
    installationDate: new Date("2025-09-10"),
    capacity: 8000,
    status: "ACTIVE" as const,
  },
  {
    serialNumber: "SU-0005",
    installationDate: new Date("2025-10-01"),
    capacity: 2000,
    status: "ACTIVE" as const,
  },
];

async function seed() {
  try {
    // Connect to DB
    await connectDB();

    console.log("───────────────────────────────────────");
    console.log(" SolarPulse Backend — Seeding");
    console.log("───────────────────────────────────────\n");


    const ADMIN_EMAIL = ""
    // Update to admin role
    const adminUser = await User.findOneAndUpdate(
      { email: ADMIN_EMAIL },
      { role: "admin" },
      { new: true }
    );

    if (adminUser) {
      console.log(`  ✓ Updated ${adminUser.email} to admin role`);
    } else {
      console.log(`  ⚠ User ${ADMIN_EMAIL} not found`);
    }

    // Find first non-admin user to assign SU-0001
    const user = await User.findOne({ role: { $ne: "admin" } });

    if (!user) {
      console.log("  ⚠ No non-admin users found. Solar units won't be assigned to anyone.");
    }

    // Clear existing solar units and drop any stale indexes
    await SolarUnit.deleteMany({});
    // Drop the stale apiKey unique index if it exists (leftover from a previous schema version)
    try {
      await SolarUnit.collection.dropIndex("apiKey_1");
      console.log("  ✓ Dropped stale apiKey_1 index");
    } catch {
      // Index doesn't exist — that's fine
    }

    // Create all solar units
    console.log(`\n  Creating ${SOLAR_UNIT_DEFINITIONS.length} solar units...\n`);

    for (let i = 0; i < SOLAR_UNIT_DEFINITIONS.length; i++) {
      const def = SOLAR_UNIT_DEFINITIONS[i];

      const unitData: Record<string, any> = { ...def };

      // Assign the first unit to the first user (if exists)
      if (i === 0 && user) {
        unitData.userId = user._id;
      }

      const created = await SolarUnit.create(unitData);
      const assignee = unitData.userId ? ` → assigned to ${user?.email}` : "";
      console.log(
        `  ✓ ${created.serialNumber} | ${created.capacity}W | ${created.status}${assignee}`
      );
    }

    console.log("\n───────────────────────────────────────");
    console.log(` Seed complete! ${SOLAR_UNIT_DEFINITIONS.length} units created.`);
    console.log("───────────────────────────────────────\n");
  } catch (err) {
    console.error("Seeding error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

seed();
