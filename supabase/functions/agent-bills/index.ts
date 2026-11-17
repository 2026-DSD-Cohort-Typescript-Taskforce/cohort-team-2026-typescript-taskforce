import { createClient } from "npm:@supabase/supabase-js@2";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "openai/gpt-4.1-mini";
const ALLOWED = ["get_bill", "list_vendors", "observe_portal", "execute_approved_payment"];
const TOOLS = ALLOWED.map((name) => ({
  type: "function",
  function: { name, parameters: { type: "object", additionalProperties: true } },
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function signedInUser(authHeader: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnon) return json({ error: "Agent isn't set up." }, 500);
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return json({ error: "Sign in again." }, 401);
  const { data: profile } = await supabase.from("users").select("user_id").eq("auth_user_id", auth.user.id).maybeSingle();
  if (!profile) return json({ error: "No app profile is linked to this login." }, 403);
  return profile;
}

async function openRouter(apiKey: string, messages: unknown[]) {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, tools: TOOLS }),
  });
  if (!response.ok) return null;
  return response.json();
}

async function callMcp(mcpUrl: string, mcpToken: string, userAuth: string, call: { id: string; function: { name: string; arguments: string } }) {
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${mcpToken}`, "Content-Type": "application/json", "x-user-authorization": userAuth },
    body: JSON.stringify({ method: "tools/call", params: { name: call.function.name, arguments: JSON.parse(call.function.arguments || "{}") } }),
  });
  return await response.text();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST { task }." }, 405);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Sign in again." }, 401);
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  const mcpUrl = Deno.env.get("BILL_MCP_URL");
  const mcpToken = Deno.env.get("BILL_MCP_TOKEN");
  if (!apiKey || !mcpUrl || !mcpToken) return json({ error: "Agent isn't set up." }, 500);
  const user = await signedInUser(authHeader);
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => null);
  const task = body && typeof body.task === "string" ? body.task : "";
  if (!task) return json({ error: "Send { task }." }, 400);
  const messages: unknown[] = [{ role: "user", content: task }];
  for (let round = 0; round < 4; round++) {
    const completion = await openRouter(apiKey, messages);
    const message = completion?.choices?.[0]?.message;
    const calls = message?.tool_calls ?? [];
    if (!message || calls.length === 0) return json({ reply: message?.content ?? "" });
    messages.push(message);
    for (const call of calls) {
      const content = ALLOWED.includes(call.function.name)
        ? await callMcp(mcpUrl, mcpToken, authHeader, call)
        : JSON.stringify({ error: "tool not allowed" });
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }
  return json({ error: "The agent stopped after 4 rounds." }, 502);
});