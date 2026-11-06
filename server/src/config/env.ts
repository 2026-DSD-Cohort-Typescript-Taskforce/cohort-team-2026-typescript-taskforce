import { z } from "zod";

// Every variable the server reads, except NODE_ENV (see config/cookies.ts).
// Names are documented in server/.env.example.
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(5000),
  CLIENT_URL: z.url().default("http://localhost:3000"),
  SUPABASE_URL: z.url(),
  // Publishable (anon) key only: requests run as the signed-in user, so RLS applies.
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const names = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
  throw new Error(`Missing or invalid environment variables: ${names}. See server/.env.example.`);
}

export const env = parsed.data;
