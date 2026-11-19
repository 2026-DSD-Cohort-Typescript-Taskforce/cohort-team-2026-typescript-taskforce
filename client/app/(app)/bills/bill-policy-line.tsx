'use client';

// What the vendor's policy decides about a bill (GET /api/bills/[id]/policy), as a line on
// the bill page and the approval review. Shows nothing while loading, when no policy
// applies, or when the lookup fails: the screens don't depend on it.

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import { decisionLabel, parsePolicyDecision, type PolicyDecision } from '@/lib/bill-policy';

export function BillPolicyLine({ billId }: { billId: number }) {
  // Tagged with its bill, so a decision for another bill is never shown.
  const [loaded, setLoaded] = useState<{ billId: number; policy: PolicyDecision } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await apiFetch(`/api/bills/${billId}/policy`);
        if (!res?.ok) return;
        const body = await res.json().catch(() => null);
        const policy = parsePolicyDecision(body?.decision);
        if (active && policy) setLoaded({ billId, policy });
      } catch {}
    })();
    return () => {
      active = false;
    };
  }, [billId]);

  const policy = loaded?.billId === billId ? loaded.policy : null;
  const label = policy && decisionLabel(policy);
  if (!policy || !label) return null;

  return (
    <div className="mt-6 flex flex-col gap-1 border-t border-subtle pt-4 text-body">
      <p className="text-body-sm text-secondary">Vendor policy</p>
      <p className="font-medium">
        {label}
        {policy.version !== null && (
          <span className="font-normal text-secondary"> · version {policy.version}</span>
        )}
      </p>
      {policy.interpretation && <p className="text-secondary">{policy.interpretation}</p>}
    </div>
  );
}
