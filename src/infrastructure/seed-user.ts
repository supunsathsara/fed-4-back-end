import mongoose from "mongoose";
import { SolarUnit } from "./entities/SolarUnit";
import { User } from "./entities/User";
import { EnergyGenerationRecord } from "./entities/EnergyGenerationRecord";
import dotenv from "dotenv";
import { connectDB } from "./db";

dotenv.config();

const TARGET_EMAIL = "anon@gmail.com";

async function seedAnonData() {
  try {
    // Connect to DB
    await connectDB();

    // Find the user by email
    const user = await User.findOne({ email: TARGET_EMAIL });

    if (!user) {
      console.log(`User with email ${TARGET_EMAIL} not found. Please create the user first via sign up.`);
      return;
    }

    console.log(`Found user: ${user.email} (ID: ${user._id})`);

    // Check if solar unit already exists for this user
    let solarUnit = await SolarUnit.findOne({ userId: user._id });

    if (!solarUnit) {
      // Create a new solar unit for this user
      solarUnit = await SolarUnit.create({
        serialNumber: `SU-ANON-001`,
        installationDate: new Date("2025-06-15"),
        capacity: 6000, // 6kW capacity
        status: "ACTIVE",
        userId: user._id,
      });
      console.log(`Created solar unit: ${solarUnit.serialNumber}`);
    } else {
      console.log(`Solar unit already exists: ${solarUnit.serialNumber}`);
    }

    // Delete existing records for this solar unit to avoid duplicates
    await EnergyGenerationRecord.deleteMany({ solarUnitId: solarUnit._id });
    console.log("Cleared existing energy generation records for this solar unit");

    // Generate energy records for the past 30 days
    const records = [];
    const now = new Date();
    
    for (let day = 0; day < 30; day++) {
      // Generate 12 records per day (every 2 hours)
      for (let hour = 6; hour <= 18; hour += 2) {
        const timestamp = new Date(now);
        timestamp.setDate(timestamp.getDate() - day);
        timestamp.setHours(hour, 0, 0, 0);

        // Simulate energy generation based on time of day
        // Peak generation around noon, lower in morning/evening
        let baseEnergy = 0;
        if (hour >= 10 && hour <= 14) {
          baseEnergy = 800 + Math.random() * 200; // Peak hours: 800-1000 kWh
        } else if (hour >= 8 && hour <= 16) {
          baseEnergy = 500 + Math.random() * 200; // Mid hours: 500-700 kWh
        } else {
          baseEnergy = 100 + Math.random() * 200; // Early/late: 100-300 kWh
        }

        // Add some random variation for weather simulation
        const weatherFactor = 0.7 + Math.random() * 0.3; // 70-100% efficiency
        const energyGenerated = Math.round(baseEnergy * weatherFactor);

        records.push({
          solarUnitId: solarUnit._id,
          energyGenerated,
          timestamp,
          intervalHours: 2,
        });
      }
    }

    // Insert all records
    await EnergyGenerationRecord.insertMany(records);
    console.log(`Created ${records.length} energy generation records for the past 30 days`);

    console.log("\n✅ Seed completed successfully for user:", TARGET_EMAIL);
    console.log(`   Solar Unit: ${solarUnit.serialNumber}`);
    console.log(`   Capacity: ${solarUnit.capacity}W`);
    console.log(`   Total Records: ${records.length}`);

  } catch (err) {
    console.error("Seeding error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

seedAnonData();
