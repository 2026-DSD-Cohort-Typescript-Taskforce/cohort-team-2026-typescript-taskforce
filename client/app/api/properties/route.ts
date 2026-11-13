// POST /api/properties: adds a property typed into the bill form's "Add new property".
// Only the name is needed; address and contact details can be filled in later.

import type { NextRequest } from 'next/server';
import { createUserClient, readJsonObject, reply, replyWithError } from '@/lib/supabase';

/** Adds a property from the bill form by name. */
export async function POST(request: NextRequest) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const body = await readJsonObject(request);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return reply({
      status: 400,
      body: { error: 'Enter the property name.', code: 'invalid_property' },
    });
  }

  const { data, error } = await supabase
    .from('properties')
    .insert({ name })
    .select('id:property_id, name')
    .single();
  if (error) return replyWithError(error, "Couldn't add the property. Try again.");
  return reply({ status: 201, body: { property: data } });
}
