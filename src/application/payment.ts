import Stripe from "stripe";
import { Request, Response } from "express";
import { Invoice, PAYMENT_STATUS } from "../infrastructure/entities/Invoice";
import { User } from "../infrastructure/entities/User";
import { getAuth } from "@clerk/express";

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/**
 * Payment Application Service
 * Handles Stripe checkout sessions and payment processing
 */

/**
 * Create a Stripe Checkout Session for an invoice
 */
export const createCheckoutSession = async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    const { invoiceId } = req.body;
    
    if (!invoiceId) {
      return res.status(400).json({ error: "Invoice ID is required" });
    }
    
    // Get user
    const user = await User.findOne({ clerkUserId: userId });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    // Get invoice and verify ownership
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }
    
    // Check user has access to this invoice (owns it or is admin)
    if (invoice.userId.toString() !== user._id.toString() && user.role !== "admin") {
      return res.status(403).json({ error: "Access denied" });
    }
    
    // Check if already paid
    if (invoice.paymentStatus === PAYMENT_STATUS.PAID) {
      return res.status(400).json({ error: "Invoice already paid" });
    }
    
    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      ui_mode: "embedded",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Solar Energy Invoice ${invoice.invoiceNumber}`,
              description: `Energy generated: ${invoice.totalEnergyGenerated.toFixed(2)} kWh`,
            },
            unit_amount: invoice.amountCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      return_url: `${process.env.FRONTEND_URL}/dashboard/invoices/complete?session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        invoiceId: invoice._id.toString(),
        invoiceNumber: invoice.invoiceNumber,
      },
      customer_email: user.email,
    });
    
    // Store session ID on invoice for tracking
    invoice.stripeSessionId = session.id;
    await invoice.save();
    
    res.json({ clientSecret: session.client_secret });
  } catch (error: any) {
    console.error("[Payment] Error creating checkout session:", error);
    res.status(500).json({ error: "Failed to create payment session" });
  }
};

/**
 * Get the status of a Stripe Checkout Session
 */
export const getSessionStatus = async (req: Request, res: Response) => {
  try {
    const { session_id } = req.query;
    
    if (!session_id || typeof session_id !== "string") {
      return res.status(400).json({ error: "Session ID is required" });
    }
    
    const session = await stripe.checkout.sessions.retrieve(session_id);
    
    res.json({
      status: session.status,
      paymentStatus: session.payment_status,
      amountTotal: session.amount_total,
      invoiceId: session.metadata?.invoiceId,
      invoiceNumber: session.metadata?.invoiceNumber,
    });
  } catch (error: any) {
    console.error("[Payment] Error getting session status:", error);
    res.status(500).json({ error: "Failed to get session status" });
  }
};

/**
 * Handle Stripe Webhook Events
 * This endpoint receives events from Stripe and updates invoice status
 */
export const handleStripeWebhook = async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"] as string;
  let event: Stripe.Event;
  
  // Verify webhook signature
  try {
    event = stripe.webhooks.constructEvent(
      req.body, // Must be raw body, not parsed JSON
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("[Webhook] Signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  console.log(`[Webhook] Received event: ${event.type}`);
  
  // Handle specific events
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const invoiceId = session.metadata?.invoiceId;
      
      if (invoiceId && session.payment_status === "paid") {
        try {
          const invoice = await Invoice.findByIdAndUpdate(
            invoiceId,
            {
              paymentStatus: PAYMENT_STATUS.PAID,
              paidAt: new Date(),
              stripePaymentIntentId: session.payment_intent as string,
            },
            { new: true }
          );
          
          if (invoice) {
            console.log(`[Webhook] Invoice ${invoice.invoiceNumber} marked as PAID`);
          } else {
            console.warn(`[Webhook] Invoice ${invoiceId} not found`);
          }
        } catch (error) {
          console.error(`[Webhook] Error updating invoice ${invoiceId}:`, error);
        }
      }
      break;
    }
    
    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;
      const invoiceId = session.metadata?.invoiceId;
      
      if (invoiceId) {
        console.log(`[Webhook] Checkout session expired for invoice ${invoiceId}`);
        // Optionally update invoice or notify user
      }
      break;
    }
    
    case "payment_intent.payment_failed": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      console.log(`[Webhook] Payment failed: ${paymentIntent.id}`);
      
      // Find invoice by payment intent and mark as failed
      const invoice = await Invoice.findOne({ stripePaymentIntentId: paymentIntent.id });
      if (invoice) {
        invoice.paymentStatus = PAYMENT_STATUS.FAILED;
        await invoice.save();
        console.log(`[Webhook] Invoice ${invoice.invoiceNumber} marked as FAILED`);
      }
      break;
    }
    
    default:
      console.log(`[Webhook] Unhandled event type: ${event.type}`);
  }
  
  // Always return 200 to acknowledge receipt
  res.status(200).json({ received: true });
};
