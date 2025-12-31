import { Router } from "express";
import { requireAuth, getAuth } from "@clerk/express";
import { Invoice, PAYMENT_STATUS } from "../infrastructure/entities/Invoice";
import { SolarUnit } from "../infrastructure/entities/SolarUnit";
import { User } from "../infrastructure/entities/User";
import { triggerInvoiceGeneration } from "../application/background/generate-invoices";
import mongoose from "mongoose";

const invoiceRouter = Router();

/**
 * GET /api/invoices
 * Get all invoices for the authenticated user
 */
invoiceRouter.get("/", requireAuth(), async (req, res, next) => {
  try {
    const { userId } = getAuth(req);
    const { status, limit, offset } = req.query;
    
    // Get user
    const user = await User.findOne({ clerkUserId: userId });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    // Build query
    const query: any = { userId: user._id };
    if (status && Object.values(PAYMENT_STATUS).includes(status as any)) {
      query.paymentStatus = status;
    }
    
    const [invoices, total] = await Promise.all([
      Invoice.find(query)
        .sort({ createdAt: -1 })
        .skip(parseInt(offset as string) || 0)
        .limit(parseInt(limit as string) || 50)
        .populate('solarUnitId', 'serialNumber capacity'),
      Invoice.countDocuments(query),
    ]);
    
    // Get counts by status for the filter badges
    const statusCounts = await Invoice.aggregate([
      { $match: { userId: user._id } },
      { $group: { _id: '$paymentStatus', count: { $sum: 1 } } },
    ]);
    
    const counts = {
      total,
      PENDING: 0,
      PAID: 0,
      FAILED: 0,
    };
    statusCounts.forEach((s: any) => {
      counts[s._id as keyof typeof counts] = s.count;
    });
    
    res.json({ invoices, counts });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/invoices/pending-count
 * Get count of pending invoices (for sidebar badge)
 */
invoiceRouter.get("/pending-count", requireAuth(), async (req, res, next) => {
  try {
    const { userId } = getAuth(req);
    
    const user = await User.findOne({ clerkUserId: userId });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    const count = await Invoice.countDocuments({
      userId: user._id,
      paymentStatus: PAYMENT_STATUS.PENDING,
    });
    
    res.json({ count });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/invoices/:id
 * Get a single invoice by ID
 */
invoiceRouter.get("/:id", requireAuth(), async (req, res, next) => {
  try {
    const { userId } = getAuth(req);
    const { id } = req.params;
    
    const user = await User.findOne({ clerkUserId: userId });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    const invoice = await Invoice.findById(id)
      .populate('solarUnitId', 'serialNumber capacity installationDate')
      .populate('userId', 'firstName lastName email');
    
    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }
    
    // Check access
    if (invoice.userId._id.toString() !== user._id.toString() && user.role !== "admin") {
      return res.status(403).json({ error: "Access denied" });
    }
    
    res.json(invoice);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/invoices/admin/all
 * Get all invoices (admin only)
 */
invoiceRouter.get("/admin/all", requireAuth(), async (req, res, next) => {
  try {
    const { userId } = getAuth(req);
    const { status, limit, offset } = req.query;
    
    const user = await User.findOne({ clerkUserId: userId });
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }
    
    // Build query
    const query: any = {};
    if (status && Object.values(PAYMENT_STATUS).includes(status as any)) {
      query.paymentStatus = status;
    }
    
    const [invoices, total] = await Promise.all([
      Invoice.find(query)
        .sort({ createdAt: -1 })
        .skip(parseInt(offset as string) || 0)
        .limit(parseInt(limit as string) || 50)
        .populate('solarUnitId', 'serialNumber capacity')
        .populate('userId', 'firstName lastName email'),
      Invoice.countDocuments(query),
    ]);
    
    // Get counts by status
    const statusCounts = await Invoice.aggregate([
      { $group: { _id: '$paymentStatus', count: { $sum: 1 } } },
    ]);
    
    const counts = {
      total,
      PENDING: 0,
      PAID: 0,
      FAILED: 0,
    };
    statusCounts.forEach((s: any) => {
      counts[s._id as keyof typeof counts] = s.count;
    });
    
    // Count overdue invoices
    const overdueCount = await Invoice.countDocuments({
      paymentStatus: PAYMENT_STATUS.PENDING,
      dueDate: { $lt: new Date() },
    });
    
    res.json({ invoices, counts, overdueCount, total });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/invoices/generate
 * Manually trigger invoice generation (admin only)
 */
invoiceRouter.post("/generate", requireAuth(), async (req, res, next) => {
  try {
    const { userId } = getAuth(req);
    
    const user = await User.findOne({ clerkUserId: userId });
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }
    
    const result = await triggerInvoiceGeneration();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default invoiceRouter;
