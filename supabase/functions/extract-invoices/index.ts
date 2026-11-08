/**
 * This function extracts invoice fields from a PDF using OpenRouter and the Nemotron model.
 * 
 * /**
 * extract-invoices
 *
 * POST a PDF (raw body) with `Authorization: Bearer <user access token>`.
 * Optional header `x-property-id` sets bills.property_id.
 *
 * Flow:
 * 1. Validate request: POST, Bearer token, non-empty body.
 * 2. Resolve the caller: auth.getUser() -> public.users.id via auth_user_id.
 * 3. Send the PDF to OpenRouter (free VL model) with a JSON schema:
 *    vendor (From), bill-to (Bill To), invoice (number, dates, total, line items).
 * 4. Validate the reply with Zod and trim blank strings to null.
 * 5. Vendor: match by name (case-insensitive) and fill only empty columns,
 *    or insert a new vendor. No name -> no vendor.
 * 6. Amount: use the invoice total, else the sum of line items.
 *    Still none -> 422, nothing written.
 * 7. Insert a draft bill. Duplicate vendor + invoice number -> update that bill.
 *
 * Returns { extracted, vendor, bill }. Bill-to, currency and line items are
 * returned but not stored. No retry yet: an empty model reply fails with 422.
 */
 
import { encodeBase64 } from "jsr:@std/encoding/base64";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@4.6.7";
/**
 * this is the model that is used to extract invoice fields from a PDF. 
 * The line items are extracted as an array of objects, each containing a description, quantity, 
 * unit price,and amount.*/ 
const MODEL = "nvidia/nemotron-3.5-super-vl:free";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";


function parseMoney(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const n = Number(value.replace(/[$,]/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function totalFromLineItems(
  items: { amount?: number | null }[] | null | undefined,
): number | null {
  if (!items?.length) return null;
  const amounts = items
    .map((item) => item.amount)
    .filter((amount): amount is number => amount != null);
  if (amounts.length === 0) return null;
  return amounts.reduce((sum, amount) => sum + amount, 0);
}

const moneySchema = z
  .union([z.number(), z.string()])
  .nullish()
  .transform(parseMoney);


const lineItemSchema = z.object({
  description: z.string().nullish(),
  quantity: z.union([z.number(), z.string()]).nullish().transform(parseMoney),
  unit_price: moneySchema,
  amount: moneySchema,
});

const invoiceSchema = z.object({
  vendor_name: z.string().nullish(),
  vendor_address: z.string().nullish(),
  contact_name: z.string().nullish(),
  vendor_phone: z.string().nullish(),
  payment_portal_url: z.string().nullish(),
  supported_payment_methods: z.string().nullish(),
  bill_to_name: z.string().nullish(),
  bill_to_address: z.string().nullish(),
  bill_to_phone: z.string().nullish(),
  bill_to_email: z.string().nullish(),
  invoice_number: z.string().nullish(),
  amount: moneySchema,
  currency: z.string().nullish(),
  date_issued: z.string().nullish(),
  date_due: z.string().nullish(),
  line_items: z.array(lineItemSchema).nullish(),
});

const invoiceJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [],
  properties: {
    vendor_name: {
      type: ["string", "null"],
      description: "From / letterhead. Null if not printed. Do not invent.",
    },
    vendor_address: { type: ["string", "null"], description: "Vendor letterhead address. Null if not printed." },
    contact_name: { type: ["string", "null"], description: "Vendor contact. Null if not printed." },
    vendor_phone: { type: ["string", "null"], description: "Vendor phone. Null if not printed." },
    payment_portal_url: { type: ["string", "null"], description: "Pay-online URL. Null if not printed." },
    supported_payment_methods: {
      type: ["string", "null"],
      description: "Printed text such as Card, ACH. Null if not printed.",
    },
    bill_to_name: {
      type: ["string", "null"],
      description: "Bill To / Sold To name. Do not copy the vendor name.",
    },
    bill_to_address: { type: ["string", "null"], description: "Bill To address. Null if not printed." },
    bill_to_phone: { type: ["string", "null"], description: "Bill To phone. Not the vendor phone." },
    bill_to_email: { type: ["string", "null"], description: "Bill To email. Null if not printed." },
    invoice_number: { type: ["string", "null"], description: "Invoice number. Null if not printed." },
    amount: {
      type: ["number", "string", "null"],
      description: "Total due as a number or numeric string (for example 168.79 or \"$168.79\").",
    },
    currency: { type: ["string", "null"], description: "ISO code or null." },
    date_issued: { type: ["string", "null"], description: "YYYY-MM-DD or null." },
    date_due: { type: ["string", "null"], description: "YYYY-MM-DD or null." },
    line_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "quantity", "unit_price", "amount"],
        properties: {
          description: { type: ["string", "null"] },
          quantity: { type: ["number", "string", "null"] },
          unit_price: { type: ["number", "string", "null"] },
          amount: { type: ["number", "string", "null"] },
        },
      },
    },
  },
} as const;

function blankToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST the PDF as the body." }, 405);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Sign in. Send Authorization: Bearer <access token>." }, 401);
  }
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!apiKey) return json({ error: "Set OPENROUTER_API_KEY for the function." }, 500);
  if (!supabaseUrl || !supabaseAnon) {
    return json({ error: "SUPABASE_URL and SUPABASE_ANON_KEY are required." }, 500);
  }
  const pdf = new Uint8Array(await req.arrayBuffer());
  if (pdf.byteLength === 0) return json({ error: "The body was empty." }, 400);
  const propertyHeader = req.headers.get("x-property-id");
  const property_id = propertyHeader ? Number(propertyHeader) : null;
  if (propertyHeader && !Number.isInteger(property_id)) {
    return json({ error: "x-property-id must be an integer." }, 400);
  }
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return json({ error: "Invalid or expired access token." }, 401);
  }
  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  if (profileError) return json({ error: "Could not load profile.", details: profileError }, 500);
  if (!profile) {
    return json({ error: "No public.users row linked to this login (auth_user_id)." }, 403);
  }
  // this is where we send in the request for ai vision to extract the bill i
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Extract three groups: vendor (From / letterhead), billing (Bill To / Sold To), and this invoice (number, dates, totals, line items). Null if not printed, including names. Do not guess. Do not copy vendor into bill_to. Dates YYYY-MM-DD. Amounts numbers with no currency symbol. amount is the invoice grand total due, not only a line item.",
            },
            {
              type: "file",
              file: {
                filename: "invoice.pdf",
                file_data: `data:application/pdf;base64,${encodeBase64(pdf)}`,
              },
            },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "invoice", strict: true, schema: invoiceJsonSchema },
      },
      plugins: [{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }],
    }),
  });
  const openRouterBody: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    return json({ error: `OpenRouter ${response.status}`, details: openRouterBody }, 502);
  }
  const choice = z
    .object({
      choices: z
        .array(
          z.object({
            finish_reason: z.string().nullable().optional(),
            message: z.object({ content: z.string().nullable() }),
          }),
        )
        .min(1),
    })
    .safeParse(openRouterBody);
  if (!choice.success) {
    return json({ error: "Unexpected OpenRouter response.", details: openRouterBody }, 502);
  }
  const first = choice.data.choices[0];
  if (first.finish_reason === "length") return json({ error: "The model hit max_tokens." }, 502);
  if (!first.message.content) return json({ error: "OpenRouter returned an empty message." }, 502);
  let parsed: unknown;
  try {
    parsed = JSON.parse(first.message.content);
  } catch {
    return json({ error: "Model did not return JSON.", raw: first.message.content }, 502);
  }
  const invoice = invoiceSchema.safeParse(parsed);
  if (!invoice.success) {
    return json({ error: "JSON did not match the invoice schema.", raw: parsed }, 502);
  }
  const extracted = {
    ...invoice.data,
    vendor_name: blankToNull(invoice.data.vendor_name),
    vendor_address: blankToNull(invoice.data.vendor_address),
    contact_name: blankToNull(invoice.data.contact_name),
    vendor_phone: blankToNull(invoice.data.vendor_phone),
    payment_portal_url: blankToNull(invoice.data.payment_portal_url),
    supported_payment_methods: blankToNull(invoice.data.supported_payment_methods),
    bill_to_name: blankToNull(invoice.data.bill_to_name),
    bill_to_address: blankToNull(invoice.data.bill_to_address),
    bill_to_phone: blankToNull(invoice.data.bill_to_phone),
    bill_to_email: blankToNull(invoice.data.bill_to_email),
    invoice_number: blankToNull(invoice.data.invoice_number),
    currency: blankToNull(invoice.data.currency),
    date_issued: blankToNull(invoice.data.date_issued),
    date_due: blankToNull(invoice.data.date_due),
  };
  let vendor: Record<string, unknown> | null = null;
  if (extracted.vendor_name) {
    const { data: existing, error: findError } = await supabase
      .from("vendors")
      .select("*")
      .ilike("vendor_name", extracted.vendor_name)
      .maybeSingle();
    if (findError) return json({ error: "Vendor lookup failed.", details: findError, extracted }, 500);
    if (existing) {
      const patch: Record<string, string> = {};
      const fill = (column: string, value: string | null) => {
        if (value && existing[column] == null) patch[column] = value;
      };
      fill("vendor_address", extracted.vendor_address);
      fill("contact_name", extracted.contact_name);
      fill("vendor_phone", extracted.vendor_phone);
      fill("payment_portal_url", extracted.payment_portal_url);
      fill("supported_payment_methods", extracted.supported_payment_methods);
      if (Object.keys(patch).length > 0) {
        const { data: updated, error: updateError } = await supabase
          .from("vendors")
          .update(patch)
          .eq("vendor_id", existing.vendor_id)
          .select()
          .single();
        if (updateError) return json({ error: "Vendor update failed.", details: updateError, extracted }, 500);
        vendor = updated;
      } else {
        vendor = existing;
      }
    } else {
      const { data: created, error: insertError } = await supabase
        .from("vendors")
        .insert({
          vendor_name: extracted.vendor_name,
          vendor_address: extracted.vendor_address,
          contact_name: extracted.contact_name,
          vendor_phone: extracted.vendor_phone,
          payment_portal_url: extracted.payment_portal_url,
          supported_payment_methods: extracted.supported_payment_methods,
        })
        .select()
        .single();
      if (insertError) return json({ error: "Vendor insert failed.", details: insertError, extracted }, 500);
      vendor = created;
    }
  }
  const amount = extracted.amount ?? totalFromLineItems(extracted.line_items);
  if (amount == null) {
    return json({
      error: "amount is null; bills.amount is NOT NULL. No bill row written.",
      extracted,
      vendor,
    }, 422);
  }
  if (extracted.amount == null) {
    console.log(`Invoice amount missing; using line-item total ${amount}.`);
    extracted.amount = amount;
  }
  const billFields = {
    amount,
    invoice_number: extracted.invoice_number,
    date_issued: extracted.date_issued,
    date_due: extracted.date_due,
    vendor_id: vendor ? vendor.vendor_id : null,
    user_id: profile.id,
    property_id,
    status: "draft",
  };

  let { data: bill, error: billError } = await supabase
    .from("bills")
    .insert(billFields)
    .select()
    .single();

  if (billError?.code === "23505" && vendor && extracted.invoice_number) {
    const { data: existingBill, error: findBillError } = await supabase
      .from("bills")
      .select("*")
      .eq("vendor_id", vendor.vendor_id)
      .ilike("invoice_number", extracted.invoice_number)
      .maybeSingle();
    if (findBillError || !existingBill) {
      return json({ error: "Bill insert failed.", details: billError, extracted, vendor }, 409);
    }
    const { data: updatedBill, error: updateBillError } = await supabase
      .from("bills")
      .update({
        amount: billFields.amount,
        date_issued: billFields.date_issued,
        date_due: billFields.date_due,
        property_id: billFields.property_id,
      })
      .eq("bill_id", existingBill.bill_id)
      .select()
      .single();
    if (updateBillError) {
      return json({ error: "Bill update failed.", details: updateBillError, extracted, vendor }, 500);
    }
    bill = updatedBill;
    billError = null;
    console.log(
      `Bill already existed; updated bill_id=${bill.bill_id} amount=${bill.amount} invoice_number=${bill.invoice_number}`,
    );
  }

  if (billError || !bill) {
    return json({ error: "Bill insert failed.", details: billError, extracted, vendor }, 409);
  }

  console.log(
    `Bill insert succeeded. bill_id=${bill.bill_id} amount=${bill.amount} invoice_number=${bill.invoice_number} vendor_id=${bill.vendor_id}`,
  );
  return json({ extracted, vendor, bill });
});
