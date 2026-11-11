ALTER TABLE public.bills ADD COLUMN pdf_sha256 TEXT;
CREATE INDEX bills_pdf_sha256_idx ON public.bills (pdf_sha256);