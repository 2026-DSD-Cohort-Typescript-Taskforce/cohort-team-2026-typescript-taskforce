import { useEffect, useReducer, useRef, useState } from "react";
import { createDraftBill, loadUserRole, submitBill, updateDraftBill } from "@/lib/bill-api";
import { MESSAGES, checkSubmittable, initialSubmission, submissionReducer } from "@/lib/bill-submission";
import { validateBill, type BillInput, type BillValues } from "@/lib/bill-validation";
import type { Bill } from "@/lib/bill-view";
import { useBillsRefresh } from "./bills-provider";

/**
 * Saving and submitting a bill from the bill form (DC-71, DC-76). The form passes its
 * values as they are (strings from its inputs); each action checks them with
 * validateBill() first and refreshes the bills list after a change. Pass `bill` to work
 * on an existing draft. The server checks everything again, including the role.
 *
 * Render <SubmissionStatus state={…} message={…} /> next to the form's buttons.
 */
export function useBillSubmission({ bill = null }: { bill?: Bill | null } = {}) {
  const [submission, dispatch] = useReducer(submissionReducer, bill, initialSubmission);
  const [role, setRole] = useState<string | null>(null);
  const refresh = useBillsRefresh();
  // Read by the actions after each await: the bill saved last, and whether one is running.
  const savedBill = useRef(bill);
  const running = useRef(false);

  useEffect(() => {
    let active = true;
    loadUserRole().then((result) => {
      if (active && result?.ok) setRole(result.data);
    });
    return () => {
      active = false;
    };
  }, []);

  /** The values as BillInput, or null after showing what to fix. */
  function check(values: BillValues): BillInput | null {
    const result = validateBill(values);
    if (result.errors) dispatch({ type: "invalid", fieldErrors: result.errors, message: MESSAGES.invalid });
    return result.input ?? null;
  }

  /**
   * Saves the values as a new draft, or as changes to `billId` (by default the draft saved
   * before, so saving or submitting again never adds a second bill).
   */
  async function save(input: BillInput, billId = savedBill.current?.bill_id): Promise<Bill | null> {
    const step = billId ? "update" : "create";
    const result = billId ? await updateDraftBill(billId, input) : await createDraftBill(input);
    // null: apiFetch is sending the user to /login.
    if (!result) return null;
    if (!result.ok) {
      dispatch({ type: "failed", step, failure: result });
      return null;
    }
    savedBill.current = result.data;
    dispatch({ type: "stored", bill: result.data });
    refresh();
    return result.data;
  }

  async function run(action: "save" | "submit", task: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    dispatch({ type: "start", action });
    try {
      await task();
    } finally {
      running.current = false;
    }
  }

  /** Saves the values as a draft. Only an amount is needed. */
  async function saveDraft(values: BillValues) {
    if (running.current) return;
    const input = check(values);
    if (!input) return;
    await run("save", async () => {
      const step = savedBill.current ? "update" : "create";
      if (await save(input)) dispatch({ type: "saved", step });
    });
  }

  /** Saves the values, then submits the bill for payment with no approval step. */
  async function submit(values: BillValues) {
    if (running.current) return;
    const input = check(values);
    if (!input) return;
    const missing = checkSubmittable(input);
    if (missing) return dispatch(missing);

    await run("submit", async () => {
      const saved = await save(input);
      if (!saved) return;
      const result = await submitBill(saved.bill_id);
      if (!result) return;
      if (!result.ok) return dispatch({ type: "failed", step: "submit", failure: result });
      dispatch({ type: "submitted", status: result.data });
      refresh();
    });
  }

  /** Saves the values as changes to the draft `billId`. */
  async function update(billId: number, values: BillValues): Promise<Bill | null> {
    if (running.current) return null;
    const input = check(values);
    if (!input) return null;
    let updated: Bill | null = null;
    await run("save", async () => {
      updated = await save(input, billId);
      if (updated) dispatch({ type: "saved", step: "update" });
    });
    return updated;
  }

  /** Back to idle, e.g. for "Add another". */
  function reset() {
    savedBill.current = bill;
    dispatch({ type: "reset", bill });
  }

  return {
    ...submission,
    busy: submission.state === "saving" || submission.state === "submitting",
    /** Whether to offer submit: only billing operators can (submit_bill() answers 403 otherwise). */
    canSubmit: role === "billing_operator",
    saveDraft,
    submit,
    update,
    reset,
  };
}
