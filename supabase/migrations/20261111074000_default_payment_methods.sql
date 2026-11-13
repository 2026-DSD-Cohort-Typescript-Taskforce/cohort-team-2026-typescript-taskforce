-- The company's default card and default bank account. Extraction pays a bill with the
-- default of a type the vendor accepts. At most one default per type.
ALTER TABLE public.payment_methods
  ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX payment_methods_one_default_per_type
  ON public.payment_methods (payment_type)
  WHERE is_default;

-- Pick the real defaults in Studio later; these are the first card and bank account.
UPDATE public.payment_methods SET is_default = true
WHERE payment_id IN (
  (SELECT min(payment_id) FROM public.payment_methods WHERE payment_type = 'card'),
  (SELECT min(payment_id) FROM public.payment_methods WHERE payment_type = 'bank')
);

-- Extraction runs as the signed-in user.
GRANT SELECT (is_default) ON public.payment_methods TO authenticated;
