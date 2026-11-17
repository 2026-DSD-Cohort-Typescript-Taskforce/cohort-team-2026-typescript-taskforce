# Bill MCP gateway

Covers: supabase/config.toml

Last changed by AI: 2026-11-17 · run c56670da-bb97-4711-bbcd-3f6a3303077b · files: supabase/config.toml

## Current view

bill-mcp checks the shared secret BILL_MCP_TOKEN. agent-bills sends that secret in Authorization and the signed-in user's JWT in x-user-authorization. Local Kong defaults verify_jwt to true, so a secret that is not a JWT stops at the gateway with UNAUTHORIZED_INVALID_JWT_FORMAT and the function never runs. supabase/config.toml sets [functions.bill-mcp] verify_jwt = false. agent-bills has no verify_jwt override, so the user JWT is still required there. bill-mcp still returns 401 when the secret does not match. Kong reads this setting when Supabase starts. The toml test checks the setting and does not call Kong.

## Lessons

- 2026-11-17 · run c56670da: Kong's default JWT check rejected BILL_MCP_TOKEN before bill-mcp ran, and the model described that gateway 401 as an invalid authorization token.

## History

### 2026-11-17 · run c56670da-bb97-4711-bbcd-3f6a3303077b · Let bill-mcp accept its shared secret at the local gateway while agent-bills still requires the use…
**Changed:** bill-mcp no longer requires a user JWT at the local gateway. agent-bills still does. The toml guard was added after the config edit was already in the run snapshot, so red proof has no source delta. Project typecheck and format were already failing outside this change.
**Learned:** The gateway contract is recorded: bill-mcp uses the shared secret, and agent-bills keeps the user JWT check.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run c56670da-bb97-4711-bbcd-3f6a3303077b command receipts separately. Local receipts may not travel with source.
**Files:** supabase/config.toml@sha256:4575802bae9e9dc23a2f67820ccf30228bae44b54d37f2177cb6d4f3372b9e78
