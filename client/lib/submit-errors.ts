// Turns a Supabase error from the /api/bills route handlers into the reply the browser
// gets, in Express's { error, code } shape. Raw Postgres and PostgREST text never reaches
// the browser. No imports, so `npm test` (node --test) can load it on its own.

/** The fields of a supabase-js PostgrestError that the mapping reads. */
export type SupabaseError = {
  code?: string;
  message?: string;
  details?: string | null;
};

export type ErrorResponse = {
  status: number;
  body: { error: string; code?: string; fields?: string[]; status?: string };
};

// Express's wording (server/src/middleware/requireAuth.ts).
export const SIGNED_OUT: ErrorResponse = { status: 401, body: { error: "You are not signed in." } };

export const BILL_NOT_FOUND: ErrorResponse = {
  status: 404,
  body: { error: "Bill not found.", code: "not_found" },
};

export const SUBMIT_FAILED = "Couldn't submit the bill. Try again.";

// PostgREST answers an invalid (PGRST301) or expired (PGRST303) JWT with a 401, as it does
// a request with no JWT when anonymous access is off (PGRST302).
const SESSION_ERROR_CODES = new Set(["PGRST301", "PGRST302", "PGRST303"]);

/**
 * Maps the error to a reply. The PTxyz codes come from submit_bill()
 * (supabase/migrations/20261102185559_bills_submit_bill_and_draft_only_policies.sql).
 * Anything else is a 500 with `fallback` as its message.
 */
export function toErrorResponse(error: SupabaseError, fallback = SUBMIT_FAILED): ErrorResponse {
  if (error.code && SESSION_ERROR_CODES.has(error.code)) return SIGNED_OUT;

  switch (error.code) {
    case "PT400":
      return {
        status: 400,
        body: {
          error: "This bill is missing required details.",
          code: "incomplete_bill",
          fields: parseFields(error.details),
        },
      };
    case "PT403":
      return { status: 403, body: { error: "Only billing operators can submit bills.", code: "forbidden" } };
    case "PT404":
      return BILL_NOT_FOUND;
    case "PT409":
      return {
        status: 409,
        body: {
          error: "Only draft bills can be submitted.",
          code: "not_draft",
          ...(error.details ? { status: error.details } : {}),
        },
      };
    default:
      return { status: 500, body: { error: fallback } };
  }
}

// submit_bill() and decide_bill() send the invalid fields as a JSON array of names in a string,
// e.g. '["date_due"]'.
export function parseFields(details: string | null | undefined): string[] {
  try {
    const fields: unknown = JSON.parse(details ?? "");
    if (Array.isArray(fields) && fields.every((field) => typeof field === "string")) return fields;
  } catch {}
  return [];
}
