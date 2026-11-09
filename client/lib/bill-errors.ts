// Replies for POST and PATCH /api/bills (DC-71): a request body that fails validateBill(),
// and the database errors a bill write can raise. Anything else goes to toErrorResponse(),
// so session errors are still a 401 and the rest a 500 without the database's text.
// Only imports with a .ts extension, so `npm test` (node --test) can load it.

import { toErrorResponse, type ErrorResponse, type SupabaseError } from "./submit-errors.ts";

export const SAVE_FAILED = "Couldn't save the bill. Try again.";

// Express's wording (server/src/controllers/auth.controller.ts).
export const NO_PROFILE: ErrorResponse = {
  status: 403,
  body: { error: "No app profile is linked to this login. Ask an admin to set one up.", code: "profile_not_found" },
};

/** A 400 naming the fields that failed; the form shows its own message for each. */
export function invalidBill(fields: string[] = []): ErrorResponse {
  return { status: 400, body: { error: "Some of the bill's details aren't valid.", code: "invalid_bill", fields } };
}

/** PATCH on a bill that left draft (RLS lets only drafts change), with its status now. */
export function notDraft(status: string): ErrorResponse {
  return { status: 409, body: { error: "Only draft bills can be edited.", code: "not_draft", status } };
}

// Values the database refused: bad text for a number or date, a number or text too large,
// or a check constraint.
const INVALID_VALUE_CODES = new Set(["22P02", "22003", "22007", "22008", "22001", "23514"]);

export function toWriteErrorResponse(error: SupabaseError, fallback = SAVE_FAILED): ErrorResponse {
  switch (error.code) {
    // bills_vendor_id_invoice_number_key: one invoice number per vendor, ignoring case.
    case "23505":
      return {
        status: 409,
        body: {
          error: "That invoice number already exists for this vendor.",
          code: "duplicate_invoice",
          fields: ["invoice_number"],
        },
      };
    // A vendor, property or payment method id that doesn't exist. RLS on bills keeps the
    // key out of the details, so the field comes from the constraint's name, e.g.
    // 'insert or update on table "bills" violates foreign key constraint "bills_vendor_id_fkey"'.
    case "23503": {
      const field = /"bills_(vendor_id|property_id|payment_id)_fkey"/.exec(error.message ?? "")?.[1];
      return invalidBill(field ? [field] : []);
    }
  }
  if (error.code && INVALID_VALUE_CODES.has(error.code)) return invalidBill();
  return toErrorResponse(error, fallback);
}
