"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { loadBills } from "@/lib/bill-api";
import type { Bill } from "@/lib/bill-view";

type BillsContextValue = {
  /** null until the first load succeeds. */
  bills: Bill[] | null;
  /** The last load's error, or "". A failed refresh keeps the bills already shown. */
  error: string;
  loading: boolean;
  /** Loads the bills again, e.g. after a bill is saved or submitted. */
  refresh: () => void;
};

const BillsContext = createContext<BillsContextValue | null>(null);

/**
 * Loads the bills the user can see and shares them, so anything under it (the list, the
 * bill form) can refresh the list after a change. No polling or realtime.
 */
export function BillsProvider({ children }: { children: ReactNode }) {
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // Only the newest load's answer is shown, if refreshes overlap.
  const latest = useRef(0);

  const load = useCallback(() => {
    const request = ++latest.current;
    loadBills().then((result) => {
      // null: apiFetch is sending the user to /login.
      if (!result || request !== latest.current) return;
      if (result.ok) {
        setBills(result.data);
        setError("");
      } else {
        setError(result.error);
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(() => {
    setLoading(true);
    load();
  }, [load]);

  const value = useMemo(() => ({ bills, error, loading, refresh }), [bills, error, loading, refresh]);
  return <BillsContext value={value}>{children}</BillsContext>;
}

export function useBills(): BillsContextValue {
  const value = useContext(BillsContext);
  if (!value) throw new Error("useBills() needs a <BillsProvider> above it.");
  return value;
}

/** The list's refresh(), or a no-op where no list is shown. */
export function useBillsRefresh(): () => void {
  return useContext(BillsContext)?.refresh ?? noop;
}

function noop() {}
