/**
 * Data Repair Script
 *
 * Fixes inconsistencies in existing data WITHOUT deleting any user accounts.
 * Safe to run multiple times (idempotent).
 *
 * What it fixes:
 *  1. Admin role — sets known admins to role: "admin"
 *  2. User status/solar-unit consistency:
 *       - ACTIVE users with no solar unit → APPROVED (they haven't been assigned yet)
 *       - Users with a solar unit assigned but status is PENDING/APPROVED → ACTIVE
 *  3. Missing statusUpdatedAt — fills it in from updatedAt or createdAt
 *  4. Dangling solar unit refs — solar units whose userId points to a deleted/missing user
 *       → unset userId (unit becomes unassigned again)
 */

import mongoose from "mongoose";
import { User } from "./entities/User";
import { SolarUnit } from "./entities/SolarUnit";
import dotenv from "dotenv";
import { connectDB } from "./db";

dotenv.config();

const ADMIN_EMAILS = [""];

async function repair() {
  await connectDB();

  console.log("───────────────────────────────────────");
  console.log(" SolarPulse Backend — Data Repair");
  console.log("───────────────────────────────────────\n");

  let fixed = 0;

  // ── 1. Ensure admin roles ───────────────────────────────────────
  console.log("1. Checking admin roles...");
  for (const email of ADMIN_EMAILS) {
    const result = await User.findOneAndUpdate(
      { email, role: { $ne: "admin" } },
      { role: "admin" },
      { new: true }
    );
    if (result) {
      console.log(`   ✓ Set ${email} → admin`);
      fixed++;
    } else {
      console.log(`   · ${email} already correct`);
    }
  }

  // ── 2. Fix dangling solar unit refs ────────────────────────────
  console.log("\n2. Checking for dangling solar unit userId references...");
  const allUnitsWithUser = await SolarUnit.find({ userId: { $exists: true, $ne: null } });
  for (const unit of allUnitsWithUser) {
    const userExists = await User.findById(unit.userId);
    if (!userExists) {
      await SolarUnit.findByIdAndUpdate(unit._id, { $unset: { userId: 1 } });
      console.log(`   ✓ Cleared dangling userId from ${unit.serialNumber} (user ${unit.userId} not found)`);
      fixed++;
    }
  }
  if (fixed === 0) console.log("   · No dangling refs found");

  // ── 3. Build user → solar unit map for status checks ───────────
  const assignedUnits = await SolarUnit.find({ userId: { $exists: true, $ne: null } });
  const unitByUserId = new Map<string, typeof assignedUnits[0]>();
  for (const unit of assignedUnits) {
    unitByUserId.set(unit.userId!.toString(), unit);
  }

  // ── 4. Fix user status consistency ─────────────────────────────
  console.log("\n3. Checking user status consistency...");
  const allUsers = await User.find();
  for (const user of allUsers) {
    const userId = user._id.toString();
    const hasUnit = unitByUserId.has(userId);
    const status = user.status as string;

    // ACTIVE but no solar unit → downgrade to APPROVED
    if (status === "ACTIVE" && !hasUnit && user.role !== "admin") {
      await User.findByIdAndUpdate(user._id, {
        status: "APPROVED",
        statusUpdatedAt: user.statusUpdatedAt || user.updatedAt || new Date(),
      });
      console.log(`   ✓ ${user.email}: ACTIVE → APPROVED (no solar unit assigned)`);
      fixed++;
    }

    // Has solar unit but still PENDING or APPROVED → upgrade to ACTIVE
    else if (hasUnit && (status === "PENDING" || status === "APPROVED")) {
      await User.findByIdAndUpdate(user._id, {
        status: "ACTIVE",
        statusUpdatedAt: new Date(),
      });
      console.log(`   ✓ ${user.email}: ${status} → ACTIVE (has solar unit ${unitByUserId.get(userId)?.serialNumber})`);
      fixed++;
    }

    // Status is fine but statusUpdatedAt is missing
    else if (!user.statusUpdatedAt) {
      await User.findByIdAndUpdate(user._id, {
        statusUpdatedAt: (user as any).updatedAt || (user as any).createdAt || new Date(),
      });
      console.log(`   ✓ ${user.email}: filled missing statusUpdatedAt`);
      fixed++;
    }
  }
  if (allUsers.length === 0) console.log("   · No users found");

  // ── 5. Summary ─────────────────────────────────────────────────
  console.log("\n───────────────────────────────────────");
  if (fixed > 0) {
    console.log(` Repair complete — ${fixed} issue(s) fixed.`);
  } else {
    console.log(" Everything looks consistent — nothing to fix.");
  }
  console.log("───────────────────────────────────────\n");

  await mongoose.disconnect();
}

repair().catch((err) => {
  console.error("Repair error:", err);
  process.exit(1);
});
