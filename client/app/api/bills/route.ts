import type { NextRequest } from "next/server";
import { BILL_SELECT } from "@/lib/bill-view";
import { createUserClient, reply, replyWithError } from "@/lib/supabase";

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
