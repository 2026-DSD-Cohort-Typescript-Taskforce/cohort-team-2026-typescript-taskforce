-- The SHA-256 fingerprint of a bill's PDF. The upload route and extract-invoices look a
-- bill up by it to catch the same PDF uploaded twice; the file in Storage is named after
-- it too (bills/<sha256>.pdf). 20261111062000 makes it unique.
ALTER TABLE public.bills ADD COLUMN pdf_sha256 TEXT;
CREATE INDEX bills_pdf_sha256_idx ON public.bills (pdf_sha256);
