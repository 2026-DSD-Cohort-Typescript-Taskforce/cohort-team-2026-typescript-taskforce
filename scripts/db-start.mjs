import { execSync } from "node:child_process";

function succeeds(command) {
  try {
    execSync(command, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (!succeeds("supabase --version")) {
  console.warn("[db] Supabase CLI not found. Run `npm install` at the repo root. Skipping local Supabase.");
  process.exit(0);
}

if (!succeeds("docker info")) {
  console.warn("[db] Docker is not running. Skipping local Supabase.");
  process.exit(0);
}

execSync("supabase start", { stdio: "inherit" });