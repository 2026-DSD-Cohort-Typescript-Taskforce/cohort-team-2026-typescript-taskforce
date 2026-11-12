'use client';

// The Bills page's intake state, shared by both columns: which panel is open (upload,
// Enter Bill Details, or the fix form for one draft) and this session's notices. Notices
// live only in memory and are gone after a reload; Current issues for drafts come from the
// bills themselves. /bills?fix=<id> opens that draft's fix form when the page loads.

import { useSearchParams } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Notice } from '@/lib/extraction';

/** What the left column and the Current issues card show. */
export type Panel = { kind: 'upload' } | { kind: 'add' } | { kind: 'fix'; billId: number };

type IntakeValue = {
  panel: Panel;
  setPanel: (panel: Panel) => void;
  /** This session's duplicate, review, rejected and failed uploads. Gone after a reload. */
  notices: Notice[];
  addNotice: (notice: Omit<Notice, 'id'>) => void;
  dismissNotice: (id: string) => void;
};

const IntakeContext = createContext<IntakeValue | null>(null);

/**
 * /bills?fix=<id> (from the View Bill page) opens that draft's fix form. The page reads
 * it on load; on the page itself, rows call setPanel instead.
 */
export function IntakeProvider({ children }: { children: ReactNode }) {
  const fixId = Number(useSearchParams().get('fix'));
  const [panel, setPanel] = useState<Panel>(
    Number.isInteger(fixId) && fixId > 0 ? { kind: 'fix', billId: fixId } : { kind: 'upload' },
  );
  const [notices, setNotices] = useState<Notice[]>([]);

  const addNotice = useCallback((notice: Omit<Notice, 'id'>) => {
    setNotices((current) => [{ ...notice, id: crypto.randomUUID() }, ...current]);
  }, []);
  const dismissNotice = useCallback((id: string) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const value = useMemo(
    () => ({ panel, setPanel, notices, addNotice, dismissNotice }),
    [panel, notices, addNotice, dismissNotice],
  );
  return <IntakeContext value={value}>{children}</IntakeContext>;
}

export function useIntake(): IntakeValue {
  const value = useContext(IntakeContext);
  if (!value) throw new Error('useIntake() needs an <IntakeProvider> above it.');
  return value;
}
