// Local only: gives every unlinked profile in public.users a synthetic Supabase Auth
// login, so you can sign in against `supabase start`. Uses the secret key, which
// bypasses RLS, so it refuses any SUPABASE_URL that is not on this machine.
//
//   SUPABASE_URL=http://127.0.0.1:54321 \
//   SUPABASE_SECRET_KEY=<Secret key from `supabase status`> \
//   SEED_USER_PASSWORD=<any local password> \
//   npm run seed:local-users
//
// Every seeded login gets SEED_USER_PASSWORD. Rerunning is safe: existing logins are
// reused and already-linked profiles are skipped.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SECRET_KEY, SEED_USER_PASSWORD } = process.env;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !SEED_USER_PASSWORD) {
  throw new Error("Set SUPABASE_URL, SUPABASE_SECRET_KEY and SEED_USER_PASSWORD.");
}

const { hostname } = new URL(SUPABASE_URL);
if (!["127.0.0.1", "localhost", "[::1]"].includes(hostname)) {
  throw new Error(`Refusing to seed ${hostname}: this script is for a local Supabase only.`);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: profiles, error } = await supabase
    .from("users")
    .select("id, user_email")
    .is("auth_user_id", null)
    .not("user_email", "is", null)
    .order("id");
  if (error) throw error;

  const { data: logins, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;
  const loginIdByEmail = new Map(logins.users.map((login) => [login.email, login.id]));

  for (const profile of profiles) {
    const email = profile.user_email.toLowerCase();
    let authUserId = loginIdByEmail.get(email);
    if (!authUserId) {
      const { data, error: createError } = await supabase.auth.admin.createUser({
        email,
        password: SEED_USER_PASSWORD,
        email_confirm: true,
      });
      if (createError) throw createError;
      authUserId = data.user.id;
    }

    const { error: linkError } = await supabase
      .from("users")
      .update({ auth_user_id: authUserId })
      .eq("id", profile.id);
    if (linkError) throw linkError;
    console.log(`Linked ${email} to users.id ${profile.id}`);
  }

  console.log(`${profiles.length} profile(s) linked.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
