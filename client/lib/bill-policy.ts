// What a vendor policy decided about a bill (evaluate_bill_policy(), DC-92) and the words
// the app uses for it. No imports, so `npm test` (node --test) can load it on its own.

export type Decision = 'none' | 'allow' | 'require_approval' | 'block';

export type PolicyDecision = {
  decision: Decision;
  policy_id: number | null;
  version_id: number | null;
  version: number | null;
  rule_index: number | null;
  policy_name: string | null;
  interpretation: string | null;
};

const DECISIONS = ['none', 'allow', 'require_approval', 'block'];
const INT_KEYS = ['policy_id', 'version_id', 'version', 'rule_index'] as const;
const TEXT_KEYS = ['policy_name', 'interpretation'] as const;

/**
 * Reads evaluate_bill_policy()'s JSON, as an object (RPC data) or a string (a PostgREST
 * error's details). Null when it isn't a decision with the right types.
 */
export function parsePolicyDecision(raw: unknown): PolicyDecision | null {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.decision !== 'string' || !DECISIONS.includes(row.decision)) return null;
  for (const key of INT_KEYS) {
    if (row[key] !== null && !Number.isInteger(row[key])) return null;
  }
  for (const key of TEXT_KEYS) {
    if (row[key] !== null && typeof row[key] !== 'string') return null;
  }
  return {
    decision: row.decision as Decision,
    policy_id: row.policy_id as number | null,
    version_id: row.version_id as number | null,
    version: row.version as number | null,
    rule_index: row.rule_index as number | null,
    policy_name: row.policy_name as string | null,
    interpretation: row.interpretation as string | null,
  };
}

// "the Acme policy", or "this vendor's policy" when the name is missing.
function policyPhrase(d: PolicyDecision): string {
  return d.policy_name ? `the ${d.policy_name} policy` : "this vendor's policy";
}

export function blockedMessage(d: PolicyDecision): string {
  return `Blocked by ${policyPhrase(d)}${d.interpretation ? `: ${d.interpretation}` : '.'}`;
}

export function forcedApprovalMessage(d: PolicyDecision): string {
  return `Bill sent for approval: ${policyPhrase(d)} needs approval.`;
}

export function sentBackMessage(d: PolicyDecision): string {
  return `Sent for approval: ${policyPhrase(d)} needs approval from someone other than the submitter.`;
}

/** The line for the bill page and review dialog; null when no policy is involved. */
export function decisionLabel(d: PolicyDecision): string | null {
  if (d.policy_id === null) return null;
  switch (d.decision) {
    case 'block':
      return 'Blocks this bill';
    case 'require_approval':
      return 'Needs approval';
    case 'allow':
      return 'Allows this bill';
    case 'none':
      return 'No rule applies';
  }
}
