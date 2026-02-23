import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
  },
  lastName: {
    type: String,
  },
  role:{
    type: String,
    enum: ["admin", "staff"],
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  clerkUserId: {
    type: String,
    required: true,
    unique: true,
  },
  status: {
    type: String,
    enum: ["PENDING", "APPROVED", "ACTIVE", "REJECTED", "SUSPENDED"],
    default: "PENDING",
  },
  statusUpdatedAt: {
    type: Date,
  },
  statusUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  rejectionReason: {
    type: String,
  },
}, {
  timestamps: true,
});

export const User = mongoose.model("User", userSchema);
