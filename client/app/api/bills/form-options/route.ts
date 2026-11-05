import type { NextRequest } from "next/server";
import { createUserClient, reply, replyWithError } from "@/lib/supabase";

/** The bill form's choices: vendors, properties and payment methods, each by name. */
export async function GET(request: NextRequest) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const [vendors, properties, paymentMethods] = await Promise.all([
    supabase.from("vendors").select("id:vendor_id, name:vendor_name, payment_portal_url").order("vendor_name"),
    supabase.from("properties").select("id:property_id, name:property_name").order("property_name"),
    // Only these three columns are readable (payment_methods_read_for_signed_in_users).
    supabase.from("payment_methods").select("id:payment_id, type:payment_type, name").order("name"),
  ]);
  const error = vendors.error ?? properties.error ?? paymentMethods.error;
  if (error) return replyWithError(error, "Couldn't load the bill form's choices. Try again.");
  return reply({
    body: { vendors: vendors.data, properties: properties.data, paymentMethods: paymentMethods.data },
  });
}
