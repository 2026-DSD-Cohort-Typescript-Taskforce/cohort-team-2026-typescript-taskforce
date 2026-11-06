-- DC-71: signed-in users can read the payment methods, so the bills list can show each
-- bill's payment type and method and the bill form can offer them. Only the id, type and
-- name are readable; billing_zip stays hidden. Writes still match no policy, so they're
-- refused, and cards and bank_accounts stay locked (RLS on, no policies).

create policy "authenticated users can read payment methods"
  on public.payment_methods for select
  to authenticated
  using (true);

-- Supabase's default privileges grant SELECT on the whole table; narrow it to three columns.
revoke select on public.payment_methods from authenticated;
grant select (payment_id, payment_type, name) on public.payment_methods to authenticated;
