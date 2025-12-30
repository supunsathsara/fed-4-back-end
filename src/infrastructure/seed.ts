import mongoose from "mongoose";
import { SolarUnit } from "./entities/SolarUnit";
import { User } from "./entities/User";
import dotenv from "dotenv";
import { connectDB } from "./db";

dotenv.config();

async function seed() {
  try {
    // Connect to DB
    await connectDB();

    // Find first user (or specify by email)
    const user = await User.findOne();
    
    if (!user) {
      console.log("No users found. Please create a user first via sign up.");
      return;
    }

    // Clear existing solar units
    await SolarUnit.deleteMany({});

    // Create a new solar unit assigned to the user
    const solarUnit = await SolarUnit.create({
      serialNumber: "SU-0001",
      installationDate: new Date("2025-08-01"),
      capacity: 5000,
      status: "ACTIVE",
      userId: user._id, // Assign to user
    });

    console.log(
      `Database seeded successfully. Created solar unit: ${solarUnit.serialNumber} for user: ${user.email}`
    );
  } catch (err) {
    console.error("Seeding error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

seed();
