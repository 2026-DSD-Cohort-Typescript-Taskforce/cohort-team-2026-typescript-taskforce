/**
 * extract-invoices
 *
 * POST { path, replaceBillId? } with Authorization: Bearer <user access token>.
 * path is the caller's upload: bill-documents/pending/<user_id>/<sha256>.pdf.
 *
 * Reads the PDF, asks the model for the bill's details, and saves a bill as the caller
 * (RLS applies): submitted when every detail is there, otherwise a draft with whatever
 * was read. Every reply is { outcome, message, bill? }.
 *
 * Along the way it matches or adds the vendor and the property (Bill To), stores what the
 * vendor accepts (Card, ACH) on the vendor, and picks the company's default payment method
 * for an accepted type. Duplicates are checked by the PDF's SHA-256 and by vendor plus
 * invoice number. The PDF is moved from pending/ to bills/<sha256>.pdf before the bill is
 * saved, and pdf_path points at it.
 */
import { encodeBase64 } from "jsr:@std/encoding/base64";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@4.6.7";

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
  portal_username: z.string().nullish(),
  portal_password: z.string().nullish(),
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
      description:
        "How the vendor takes payment, as printed near the pay-online link, for example 'Demo card or one-time ACH'. Null if not printed.",
    },
    portal_username: { type: ["string", "null"], description: "Pay-online login username. Null if not printed." },
    portal_password: { type: ["string", "null"], description: "Pay-online login password. Null if not printed." },
    bill_to_name: {
      type: ["string", "null"],
      description:
        "The customer billed: the name under Bill To, Billed To, Prepared for, Customer, Customer / Business Name, Customer / Location or Your Account. Never the vendor.",
    },
    bill_to_address: { type: ["string", "null"], description: "Bill To address. Null if not printed." },
    bill_to_phone: { type: ["string", "null"], description: "Bill To phone. Not the vendor phone." },
    bill_to_email: { type: ["string", "null"], description: "Bill To email. Null if not printed." },
    invoice_number: {
      type: ["string", "null"],
      description:
        "The bill's own number: Invoice, Invoice Reference, Statement, Statement ID, Document, Bill Reference or Bill / Record Number (for example BILL-1001). Not the account or customer number.",
    },
    amount: {
      type: ["number", "string", "null"],
      description:
        "The amount still to pay: Total Amount Due, Amount Due, Balance Due, Net Amount Payable, Net to Remit, Net Payable, Balance to Remit, Balance Outstanding, Outstanding Balance, Still to Pay or Please Pay.",
    },
    currency: { type: ["string", "null"], description: "ISO code or null." },
    date_issued: { type: ["string", "null"], description: "YYYY-MM-DD or null." },
    date_due: {
      type: ["string", "null"],
      description:
        "Due date as YYYY-MM-DD, from Due, Due Date, Pay by, Payable by, Payment Deadline, Payment requested by or Please pay by. Convert written dates such as October 16, 2026.",
    },
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

const BUCKET = "bill-documents";
// The bill is already on its way to payment, so its original PDF is kept.
const IN_FLIGHT = new Set([
  "pending_approval",
  "pending_payment",
  "processing",
  "approval_denied",
  "payment_failed",
]);
const REQUIRED: Record<string, string> = {
  vendor_id: "vendor",
  property_id: "property",
  payment_id: "payment type",
  invoice_number: "invoice number",
  amount: "amount",
  date_due: "due date",
};

type Outcome =
  | "submitted"
  | "draft"
  | "duplicate"
  | "confirm_replace"
  | "needs_review"
  | "rejected"
  | "failed";
type Extracted = z.infer<typeof invoiceSchema>;
// No generated database types yet.
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

function reply(
  outcome: Outcome,
  message: string,
  extra: Record<string, unknown> = {},
  status = 200,
): Response {
  return new Response(JSON.stringify({ outcome, message, ...extra }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function list(words: string[]): string {
  return words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

// ilike treats % and _ as wildcards.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function withoutNulls(row: Row): Row {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value != null));
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The model's reading of the PDF, or null when it couldn't read it. */
async function readInvoice(pdf: Uint8Array, apiKey: string): Promise<Extracted | null> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
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
                "Extract three groups: vendor (From / letterhead, including any pay-online URL, username and password printed on the bill), billing (Bill To / Sold To), and this invoice (number, dates, totals, line items). Null if not printed, including names. Do not guess. Do not copy vendor into bill_to. Dates YYYY-MM-DD. Amounts numbers with no currency symbol. amount is the invoice grand total due, not only a line item.",
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
  }).catch((error) => {
    console.error("OpenRouter request failed:", error);
    return null;
  });
  if (!response) return null;
  if (!response.ok) {
    console.error("OpenRouter answered", response.status, await response.text().catch(() => ""));
    return null;
  }

  const body: unknown = await response.json().catch(() => null);
  const choice = z
    .object({
      choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
    })
    .safeParse(body);
  const content = choice.success ? choice.data.choices[0].message.content : null;
  if (!content) {
    console.error("OpenRouter returned no content:", body);
    return null;
  }

  try {
    const invoice = invoiceSchema.safeParse(JSON.parse(content));
    if (!invoice.success) {
      console.error("The reply did not match the invoice schema:", content);
      return null;
    }
    const cleaned: Row = { ...invoice.data };
    for (const [key, value] of Object.entries(cleaned)) {
      if (typeof value === "string") cleaned[key] = blankToNull(value);
    }
    return cleaned as Extracted;
  } catch {
    console.error("The model did not return JSON:", content);
    return null;
  }
}

/** Matches the vendor by name and fills its empty columns, or adds it. null when it can't. */
async function findOrCreateVendor(supabase: SupabaseClient, x: Extracted): Promise<Row | null> {
  if (!x.vendor_name) return null;
  const details: Row = {
    address: x.vendor_address,
    contact_name: x.contact_name,
    phone: x.vendor_phone,
    payment_portal_url: x.payment_portal_url,
    supported_payment_methods: normalizeMethods(x.supported_payment_methods),
    portal_username: x.portal_username,
    portal_password: x.portal_password,
  };

  const { data: existing } = await supabase
    .from("vendors")
    .select("*")
    .ilike("name", escapeLike(x.vendor_name))
    .limit(1)
    .maybeSingle();
  if (existing) {
    // The vendor's latest bill says what it accepts now; other columns are only filled in.
    const patch = Object.fromEntries(
      Object.entries(details).filter(
        ([column, value]) =>
          value != null &&
          value !== existing[column] &&
          (existing[column] == null || column === "supported_payment_methods"),
      ),
    );
    if (Object.keys(patch).length === 0) return existing;
    const { data } = await supabase
      .from("vendors")
      .update(patch)
      .eq("vendor_id", existing.vendor_id)
      .select()
      .single();
    return data ?? existing;
  }

  // vendors.payment_portal_url and supported_payment_methods can't be empty.
  if (!x.payment_portal_url || !details.supported_payment_methods) return null;
  const { data, error } = await supabase
    .from("vendors")
    .insert({ name: x.vendor_name, ...withoutNulls(details) })
    .select()
    .single();
  if (error) console.error("Vendor insert failed:", error);
  return data;
}

/** Matches the Bill To by name, or adds it as a property. */
async function findOrCreateProperty(supabase: SupabaseClient, x: Extracted): Promise<Row | null> {
  if (!x.bill_to_name) return null;
  const { data: existing } = await supabase
    .from("properties")
    .select("*")
    .ilike("name", escapeLike(x.bill_to_name))
    .limit(1)
    .maybeSingle();
  if (existing) return existing;
  const { data, error } = await supabase
    .from("properties")
    .insert(
      withoutNulls({
        name: x.bill_to_name,
        address: x.bill_to_address,
        phone: x.bill_to_phone,
        email: x.bill_to_email,
      }),
    )
    .select()
    .single();
  if (error) console.error("Property insert failed:", error);
  return data;
}

// When a vendor accepts both, pay by bank transfer first: no card fees.
const PAYMENT_ORDER = ["bank", "card"] as const;

/** card and/or bank, from printed text such as "Card, ACH" or "Demo card or one-time ACH". */
function acceptedTypes(supported: string | null | undefined): Set<string> {
  const types = new Set<string>();
  if (!supported) return types;
  if (/card|credit|debit|visa|mastercard|amex/i.test(supported)) types.add("card");
  if (/\bach\b|bank|eft|transfer|e-?check/i.test(supported)) types.add("bank");
  return types;
}

/** "Card, ACH" for the vendor row, however the bill words it. null when it names neither. */
function normalizeMethods(supported: string | null | undefined): string | null {
  const types = acceptedTypes(supported);
  const words = [types.has("card") && "Card", types.has("bank") && "ACH"].filter(Boolean);
  return words.length > 0 ? words.join(", ") : null;
}

/** The company's default payment method for the first accepted type in PAYMENT_ORDER. */
async function defaultPaymentId(supabase: SupabaseClient, supported: string | null): Promise<number | null> {
  const types = acceptedTypes(supported);
  if (types.size === 0) return null;
  const { data } = await supabase
    .from("payment_methods")
    .select("payment_id, payment_type")
    .eq("is_default", true);
  for (const type of PAYMENT_ORDER) {
    const method = types.has(type) && (data ?? []).find((row) => row.payment_type === type);
    if (method) return method.payment_id;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply("failed", "POST { path }.", {}, 405);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return reply("failed", "Sign in again.", {}, 401);

  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!apiKey || !supabaseUrl || !supabaseAnon) {
    console.error("Set OPENROUTER_API_KEY, SUPABASE_URL and SUPABASE_ANON_KEY.");
    return reply("failed", "The bill reader isn't set up.", {}, 500);
  }

  const body = (await req.json().catch(() => null)) as { path?: unknown; replaceBillId?: unknown } | null;
  const path = typeof body?.path === "string" ? body.path : "";
  const replaceBillId = Number.isInteger(body?.replaceBillId) ? (body?.replaceBillId as number) : null;

  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return reply("failed", "Sign in again.", {}, 401);
  const { data: profile } = await supabase
    .from("users")
    .select("user_id")
    .eq("auth_user_id", auth.user.id)
    .maybeSingle();
  if (!profile) return reply("failed", "No app profile is linked to this login.", {}, 403);

  const match = new RegExp(`^pending/${profile.user_id}/([0-9a-f]{64})\\.pdf$`).exec(path);
  if (!match) return reply("failed", "Upload the PDF again.", {}, 400);

  const { data: file, error: downloadError } = await supabase.storage.from(BUCKET).download(path);
  if (downloadError || !file) {
    return reply("failed", "Couldn't find the uploaded PDF. Upload it again.", {}, 404);
  }
  const pdf = new Uint8Array(await file.arrayBuffer());
  const sha256 = await sha256Hex(pdf);
  if (sha256 !== match[1]) return reply("failed", "The uploaded PDF changed. Upload it again.", {}, 400);

  const { data: sameFile } = await supabase
    .from("bills")
    .select("bill_id, status")
    .eq("pdf_sha256", sha256)
    .maybeSingle();
  if (sameFile) return reply("duplicate", "This PDF was already uploaded.", { bill: sameFile });

  const extracted = await readInvoice(pdf, apiKey);
  const vendor = extracted ? await findOrCreateVendor(supabase, extracted) : null;
  const property = extracted ? await findOrCreateProperty(supabase, extracted) : null;
  const fields: Row = {
    vendor_id: vendor?.vendor_id ?? null,
    property_id: property?.property_id ?? null,
    payment_id: await defaultPaymentId(
      supabase,
      normalizeMethods(extracted?.supported_payment_methods) ?? vendor?.supported_payment_methods ?? null,
    ),
    invoice_number: extracted?.invoice_number ?? null,
    amount: extracted ? (extracted.amount ?? totalFromLineItems(extracted.line_items)) : null,
    date_issued: extracted?.date_issued ?? null,
    date_due: extracted?.date_due ?? null,
  };

  // Duplicate rules for a different PDF of the same vendor and invoice number.
  let replacing: number | null = null;
  if (fields.vendor_id && fields.invoice_number) {
    const { data: same } = await supabase
      .from("bills")
      .select("bill_id, status")
      .eq("vendor_id", fields.vendor_id)
      .ilike("invoice_number", escapeLike(fields.invoice_number))
      .maybeSingle();
    if (same?.status === "payment_success") {
      return reply("rejected", "This invoice was already paid. Nothing was saved.", { bill: same });
    }
    if (same && IN_FLIGHT.has(same.status)) {
      return reply("needs_review", "This invoice is already in progress, so its original PDF was kept.", {
        bill: same,
      });
    }
    if (same && same.bill_id !== replaceBillId) {
      return reply("confirm_replace", "A draft for this invoice already exists. Replace its PDF?", {
        bill: same,
      });
    }
    if (same) replacing = same.bill_id;
  }

const pdfPath = `bills/${sha256}.pdf`;
const { error: moveError } = await supabase.storage.from(BUCKET).move(path, pdfPath);
// Same name means the same bytes: a file left by an earlier attempt is this PDF.
const alreadyFiled = (moveError as { code?: string } | null)?.code === "KeyAlreadyExists";
if (moveError && !alreadyFiled) {
  console.error("Filing the PDF failed:", moveError);
  return reply("failed", "Couldn't file the PDF. Try again.", {}, 500);
}

  const row = { ...fields, pdf_path: pdfPath, pdf_sha256: sha256 };
  const saved = replacing
    ? await supabase
      .from("bills")
      .update({ ...withoutNulls(row), updated_at: new Date().toISOString() })
      .eq("bill_id", replacing)
      .select()
      .single()
    : await supabase
      .from("bills")
      .insert({ ...row, user_id: profile.user_id, status: "draft" })
      .select()
      .single();
  if (saved.error || !saved.data) {
    console.error("Saving the bill failed:", saved.error);
    return reply("failed", "Couldn't save the bill. Try again.", {}, 500);
  }
  const bill = saved.data;

  const missing = Object.entries(REQUIRED)
    .filter(([field]) => bill[field] == null || (field === "amount" && Number(bill.amount) <= 0))
    .map(([, label]) => label);
  if (missing.length > 0) {
    const message = extracted
      ? `Saved as a draft. Missing ${list(missing)}.`
      : "We couldn't read this PDF. It was saved as a draft to fill in by hand.";
    return reply("draft", message, { bill });
  }

  const { data: submitted, error: submitError } = await supabase.rpc("submit_bill", {
    p_bill_id: bill.bill_id,
  });
  if (submitError) {
    return reply("draft", `Saved as a draft. It couldn't be submitted: ${submitError.message}.`, { bill });
  }
  return reply("submitted", "Bill submitted for payment.", { bill: submitted });
});
