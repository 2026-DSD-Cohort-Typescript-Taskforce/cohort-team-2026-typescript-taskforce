import type { NextRequest } from 'next/server';
import { invalidBill, notDeletable, notDraft } from '@/lib/bill-errors';
import { validateBill } from '@/lib/bill-validation';
import { BILL_SELECT, parseBillId } from '@/lib/bill-view';
import { BILL_NOT_FOUND } from '@/lib/submit-errors';
import {
  createUserClient,
  readJsonObject,
  reply,
  replyWithError,
  replyWithWriteError,
} from '@/lib/supabase';

const UPDATE_FAILED = "Couldn't update the bill. Try again.";
const DELETE_FAILED = "Couldn't delete the bill. Try again.";

export async function GET(request: NextRequest, ctx: RouteContext<'/api/bills/[id]'>) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const billId = parseBillId((await ctx.params).id);
  if (billId === null) return reply(BILL_NOT_FOUND);

  const { data, error } = await supabase
    .from('bills')
    .select(BILL_SELECT)
    .eq('bill_id', billId)
    .maybeSingle();
  if (error) return replyWithError(error, "Couldn't load the bill. Try again.");
  // Also a bill that RLS hides from this user.
  if (!data) return reply(BILL_NOT_FOUND);
  return reply({ body: { bill: data } });
}

/** Edits a draft bill. Only the fields in the body change; a bill that left draft can't. */
export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/bills/[id]'>) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const billId = parseBillId((await ctx.params).id);
  if (billId === null) return reply(BILL_NOT_FOUND);

  const body = await readJsonObject(request);
  const result = body ? validateBill(body, { partial: true }) : null;
  if (!result?.input) return reply(invalidBill(Object.keys(result?.errors ?? {})));
  if (Object.keys(result.input).length === 0) return reply(invalidBill());

  // The draft-only update policy makes a bill that left draft match no row.
  const { data, error } = await supabase
    .from('bills')
    .update({ ...result.input, updated_at: new Date().toISOString() })
    .eq('bill_id', billId)
    .select(BILL_SELECT)
    .maybeSingle();
  if (error) return replyWithWriteError(error, UPDATE_FAILED);
  if (data) return reply({ body: { bill: data } });

  // Nothing changed: the bill left draft, or this user can't see it.
  const { data: current, error: readError } = await supabase
    .from('bills')
    .select('status')
    .eq('bill_id', billId)
    .maybeSingle();
  if (readError) return replyWithError(readError, UPDATE_FAILED);
  return reply(current ? notDraft(current.status) : BILL_NOT_FOUND);
}

/**
 * Deletes a bill, with its approvals rows. RLS decides who may (20261118235000): anyone a
 * never-reviewed draft, approvers and admins a reviewed bill before payment.
 */
export async function DELETE(request: NextRequest, ctx: RouteContext<'/api/bills/[id]'>) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const billId = parseBillId((await ctx.params).id);
  if (billId === null) return reply(BILL_NOT_FOUND);

  const { data, error } = await supabase
    .from('bills')
    .delete()
    .eq('bill_id', billId)
    .select('bill_id')
    .maybeSingle();
  if (error) return replyWithError(error, DELETE_FAILED);
  if (data) return reply({ body: { deleted: data.bill_id } });

  // Nothing deleted: the policies refused it, or this user can't see the bill.
  const { data: current, error: readError } = await supabase
    .from('bills')
    .select('status')
    .eq('bill_id', billId)
    .maybeSingle();
  if (readError) return replyWithError(readError, DELETE_FAILED);
  return reply(current ? notDeletable(current.status) : BILL_NOT_FOUND);
}
