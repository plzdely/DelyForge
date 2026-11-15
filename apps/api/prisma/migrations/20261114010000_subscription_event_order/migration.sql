-- Ignore Stripe events that arrive out of order.
ALTER TABLE "Subscription" ADD COLUMN "lastEventAt" TIMESTAMP(3);
