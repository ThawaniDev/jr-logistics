-- Invoice detail views look up a company's neighbouring invoices (previous / next) and the other invoices of one order.
CREATE INDEX IF NOT EXISTS "invoices_business_created_idx" ON "invoices" ("business_id", "created_at");
