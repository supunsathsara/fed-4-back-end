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
});

export const User = mongoose.model("User", userSchema);
