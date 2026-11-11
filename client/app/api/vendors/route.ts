// POST /api/vendors: adds a vendor typed into the bill form's "Add new vendor". A vendor
// can't be saved without a payment link and the payment methods it accepts; the form
// derives those from the chosen payment type, defaulting to "Card, ACH".

import type { NextRequest } from 'next/server';
import { createUserClient, readJsonObject, reply, replyWithError } from '@/lib/supabase';

const LINK = /^https?:\/\/\S+$/i;

/** Adds a vendor from the bill form. vendors needs a payment link and payment methods. */
export async function POST(request: NextRequest) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const body = await readJsonObject(request);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const link = typeof body?.payment_portal_url === 'string' ? body.payment_portal_url.trim() : '';
  const methods =
    typeof body?.supported_payment_methods === 'string' && body.supported_payment_methods.trim()
      ? body.supported_payment_methods.trim()
      : 'Card, ACH';
  if (!name || !LINK.test(link)) {
    return reply({
      status: 400,
      body: {
        error: 'Enter the vendor name and a payment link starting with https://.',
        code: 'invalid_vendor',
      },
    });
  }

  const { data, error } = await supabase
    .from('vendors')
    .insert({ name, payment_portal_url: link, supported_payment_methods: methods })
    .select('id:vendor_id, name, payment_portal_url')
    .single();
  if (error) return replyWithError(error, "Couldn't add the vendor. Try again.");
  return reply({ status: 201, body: { vendor: data } });
}
