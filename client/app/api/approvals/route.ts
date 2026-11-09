import type { NextRequest } from "next/server";
import { BILL_SELECT } from "@/lib/bill-view";
import { createUserClient, reply, replyWithError } from "@/lib/supabase";

/**
 * The bills waiting for an approval decision, soonest due first. Any signed-in user can
 * read them (RLS decides what they see); only decide_bill() limits who can decide.
 */
export async function GET(request: NextRequest) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const { data, error } = await supabase
    .from("bills")
    .select(BILL_SELECT)
    .eq("status", "pending_approval")
    .order("date_due", { ascending: true, nullsFirst: false })
    .order("bill_id", { ascending: true });
  if (error) return replyWithError(error, "Couldn't load the bills. Try again.");
  return reply({ body: { bills: data } });
}
