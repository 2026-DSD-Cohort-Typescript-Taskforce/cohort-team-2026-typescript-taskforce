import type { NextRequest } from "next/server";
import { invalidBill } from "@/lib/bill-errors";
import { validateBill } from "@/lib/bill-validation";
import { BILL_SELECT } from "@/lib/bill-view";
import {
  createUserClient,
  getProfileId,
  readJsonObject,
  reply,
  replyWithError,
  replyWithWriteError,
} from "@/lib/supabase";

/** Every bill the user can see, newest first. */
export async function GET(request: NextRequest) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const { data, error } = await supabase
    .from("bills")
    .select(BILL_SELECT)
    .order("created_at", { ascending: false })
    // Bills inserted together share a created_at.
    .order("bill_id", { ascending: false });
  if (error) return replyWithError(error, "Couldn't load the bills. Try again.");
  return reply({ body: { bills: data } });
}

/**
 * Saves a new draft bill. The server sets the status and the user who entered it;
 * validateBill() drops any other field in the body.
 */
export async function POST(request: NextRequest) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const body = await readJsonObject(request);
  const result = body ? validateBill(body) : null;
  if (!result?.input) return reply(invalidBill(Object.keys(result?.errors ?? {})));

  const userId = await getProfileId(request, supabase);
  if (userId instanceof Response) return userId;

  const { data, error } = await supabase
    .from("bills")
    .insert({ ...result.input, status: "draft", user_id: userId })
    .select(BILL_SELECT)
    .single();
  if (error) return replyWithWriteError(error);
  return reply({ status: 201, body: { bill: data } });
}
