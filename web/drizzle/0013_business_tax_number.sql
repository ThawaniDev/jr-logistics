-- Companies carry a VAT / tax number like offices do (invoices, onboarding, admin-created accounts).
ALTER TABLE "business_profiles" ADD COLUMN IF NOT EXISTS "tax_number" text;
