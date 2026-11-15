import type { NextRequest } from 'next/server';
import { PROPERTY_SELECT, invalidProperty, validateProperty } from '@/lib/property-validation';
import { createUserClient, readJsonObject, reply, replyWithError } from '@/lib/supabase';

/** Every property the user can see, by name (DC-83). */
export async function GET(request: NextRequest) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const { data, error } = await supabase.from('properties').select(PROPERTY_SELECT).order('name');
  if (error) return replyWithError(error, "Couldn't load the properties. Try again.");
  return reply({ body: { properties: data } });
}

export async function POST(request: NextRequest) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const body = await readJsonObject(request);
  const result = body ? validateProperty(body) : null;
  if (!result?.input) return reply(invalidProperty(Object.keys(result?.errors ?? {})));

  const { data, error } = await supabase
    .from('properties')
    .insert(result.input)
    .select(PROPERTY_SELECT)
    .single();
  if (error) return replyWithError(error, "Couldn't create the property. Try again.");
  return reply({ status: 201, body: { property: data } });
}
