import type { NextRequest } from 'next/server';
import {
  PROPERTY_IN_USE,
  PROPERTY_NOT_FOUND,
  PROPERTY_SELECT,
  invalidProperty,
  parsePropertyId,
  validateProperty,
} from '@/lib/property-validation';
import { createUserClient, readJsonObject, reply, replyWithError } from '@/lib/supabase';

/** Edits a property. Only the fields in the body change. */
export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/properties/[id]'>) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const propertyId = parsePropertyId((await ctx.params).id);
  if (propertyId === null) return reply(PROPERTY_NOT_FOUND);

  const body = await readJsonObject(request);
  const result = body ? validateProperty(body, { partial: true }) : null;
  if (!result?.input || Object.keys(result.input).length === 0) {
    return reply(invalidProperty(Object.keys(result?.errors ?? {})));
  }

  const { data, error } = await supabase
    .from('properties')
    .update(result.input)
    .eq('property_id', propertyId)
    .select(PROPERTY_SELECT)
    .maybeSingle();
  if (error) return replyWithError(error, "Couldn't save the property. Try again.");
  // No row: it was deleted, or RLS hides it from this user.
  return reply(data ? { body: { property: data } } : PROPERTY_NOT_FOUND);
}

export async function DELETE(request: NextRequest, ctx: RouteContext<'/api/properties/[id]'>) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const propertyId = parsePropertyId((await ctx.params).id);
  if (propertyId === null) return reply(PROPERTY_NOT_FOUND);

  const { data, error } = await supabase
    .from('properties')
    .delete()
    .eq('property_id', propertyId)
    .select(PROPERTY_SELECT)
    .maybeSingle();
  // foreign_key_violation: bills or users still point at it.
  if (error?.code === '23503') return reply(PROPERTY_IN_USE);
  if (error) return replyWithError(error, "Couldn't delete the property. Try again.");
  return reply(data ? { body: { property: data } } : PROPERTY_NOT_FOUND);
}
