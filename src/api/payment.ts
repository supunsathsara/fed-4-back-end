import { Router } from "express";
import { requireAuth } from "@clerk/express";
import { createCheckoutSession, getSessionStatus } from "../application/payment";

const paymentRouter = Router();

/**
 * POST /api/payments/create-checkout-session
 * Create a Stripe checkout session for an invoice
 */
paymentRouter.post("/create-checkout-session", requireAuth(), createCheckoutSession);

/**
 * GET /api/payments/session-status
 * Get the status of a Stripe checkout session
 */
paymentRouter.get("/session-status", requireAuth(), getSessionStatus);

export default paymentRouter;
