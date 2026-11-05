/**
 * This function extracts invoice fields from a PDF using OpenRouter and the Nemotron model.
 */
import { encodeBase64 } from "jsr:@std/encoding/base64";
import { z } from "npm:zod@4.6.7";
/**
 * this is the model that is used to extract invoice fields from a PDF. 
 * The line items are extracted as an array of objects, each containing a description, quantity, 
 * unit price,and amount.*/ 
const MODEL = "nvidia/nemotron-3.5-super-vl:free";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
/**
 * this is the schema that is used to validate the extracted invoice fields. 
 * It is a zod schema that defines the expected structure of the invoice object. 
 * The invoice object contains the following fields: 
 * The nullable aspects allow for the fact that some fields may not be printed on the invoice.
 */

/**
 * This is the schema that is used to validate the extracted invoice fields.
 */
const lineItemSchema = z.object({
  description: z.string().nullable(),
  quantity: z.number().nullable(),
  unit_price: z.number().nullable(),
  amount: z.number().nullable(),
});
/**
 *  This is the schema that is used 
 *  to validate the extracted invoice fields.
 */ 
const invoiceSchema = z.object({
  vendor_name: z.string().nullable(),
  invoice_number: z.string().nullable(),
  amount: z.number().nullable(),
  currency: z.string().nullable(),
  date_issued: z.string().nullable(),
  date_due: z.string().nullable(),
  line_items: z.array(lineItemSchema),
});
/**
 *   This is the JSON schema that is used 
 *   to validate the extracted invoice fields
 */
const invoiceJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "vendor_name",
    "invoice_number",
    "amount",
    "currency",
    "date_issued",
    "date_due",
    "line_items",
  ],
  properties: {
    vendor_name: { type: ["string", "null"], description: "Vendor name printed on the invoice." },
    invoice_number: { type: ["string", "null"], description: "Invoice number. Null when it is not printed." },
    amount: { type: ["number", "null"], description: "Total due, as a number with no currency symbol." },
    currency: { type: ["string", "null"], description: "ISO currency code when printed, otherwise null." },
    date_issued: { type: ["string", "null"], description: "Issue date as YYYY-MM-DD, or null." },
    date_due: { type: ["string", "null"], description: "Due date as YYYY-MM-DD, or null." },
    line_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "quantity", "unit_price", "amount"],
        properties: {
          description: { type: ["string", "null"] },
          quantity: { type: ["number", "null"] },
          unit_price: { type: ["number", "null"], description: "Unit price as a number, no currency symbol." },
          amount: { type: ["number", "null"], description: "Line total as a number, no currency symbol." },
        },
      },
    },
  },
} as const;
/**
 * 
 * This function returns a 
 * JSON response with the given body and status code
 */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
//this is the main function that handles the request and response
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST the PDF as the body." }, 405);

  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) return json({ error: "Set OPENROUTER_API_KEY for the function." }, 500);

  const pdf = new Uint8Array(await req.arrayBuffer());
  if (pdf.byteLength === 0) return json({ error: "The body was empty." }, 400);

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
              text: "Extract the invoice fields from this PDF. Use null for any field that is not printed. Do not guess. Dates must be YYYY-MM-DD. Amounts must be numbers with no currency symbol.",
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
      /**  
       *   
       */
      plugins: [{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }],
    }),
  });
  /**
   *  this is the response from OpenRouter, 
      which should contain the extracted invoice fields in JSON format 
  */
   
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) return json({ error: `OpenRouter ${response.status}`, details: body }, 502);

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
    .safeParse(body);
  if (!choice.success) return json({ error: "Unexpected OpenRouter response.", details: body }, 502);

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
  if (!invoice.success) return json({ error: "JSON did not match the invoice schema.", raw: parsed }, 502);
  return json(invoice.data);
});
