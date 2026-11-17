'use client';

import { useEffect, useRef, useState } from 'react';
import { ErrorAlert, primaryButton, secondaryButton, Spinner } from '../../ui';
import {
  createDemoReceipt,
  demoBank,
  demoInvoice,
  demoTotal,
  receiptStorageKey,
  restoreDemoReceipt,
  validateDemoBank,
  type DemoReceipt,
} from '../../../lib/demo-payment';

export default function DemoCheckout() {
  const [ready, setReady] = useState(false);
  const [receipt, setReceipt] = useState<DemoReceipt | null>(null);
  const [routing, setRouting] = useState(demoBank.routingNumber);
  const [account, setAccount] = useState(demoBank.accountNumber);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [storageWarning, setStorageWarning] = useState('');
  const submitting = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        setReceipt(restoreDemoReceipt(sessionStorage.getItem(receiptStorageKey)));
      } catch {
        setStorageWarning('Receipt recovery is unavailable in this browser.');
      }
      setReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  async function pay(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || submitting.current || receipt) return;
    if (!validateDemoBank(routing, account)) {
      setError('Use the supplied demo bank details. Other account details are not accepted.');
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError('');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const next = createDemoReceipt();
    try {
      sessionStorage.setItem(receiptStorageKey, JSON.stringify(next));
    } catch {
      setStorageWarning('This receipt will not be recovered after a refresh.');
    }
    setReceipt(next);
    setBusy(false);
    requestAnimationFrame(() => heading.current?.focus());
  }

  function reset() {
    try {
      sessionStorage.removeItem(receiptStorageKey);
    } catch {
      /* Storage is optional. */
    }
    submitting.current = false;
    setReceipt(null);
    setRouting(demoBank.routingNumber);
    setAccount(demoBank.accountNumber);
    setError('');
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-10 sm:py-14">
        <header className="mb-10 flex flex-wrap items-center justify-between gap-4 border-b border-subtle pb-6">
          <p className="text-lg font-semibold tracking-tight">
            Northline <span className="font-normal text-secondary">/ Utilities</span>
          </p>
          <span className="rounded-full border border-strong px-3 py-1 text-sm text-primary">
            Demo payment portal
          </span>
        </header>
        <p className="mb-6 text-sm text-secondary">
          Simulation only. No real money moves. Use only the supplied test account.
        </p>
        <div className="grid gap-10 md:grid-cols-[0.85fr_1.15fr] md:gap-16">
          <aside
            aria-label="Invoice summary"
            className="border-b border-subtle pb-8 md:border-r md:border-b-0 md:pr-12"
          >
            <p className="mb-3 text-sm text-secondary">Total due</p>
            <p id="payment-total" className="font-mono text-5xl tracking-tight">
              {demoTotal}
            </p>
            <dl className="mt-8 space-y-5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-secondary">Invoice</dt>
                <dd id="invoice-number" className="font-mono">
                  {demoInvoice.invoiceNumber}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-secondary">Billed to</dt>
                <dd>Taskforce Demo</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-secondary">Service</dt>
                <dd>Demo utility service</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-subtle pt-5">
                <dt className="text-secondary">Processing fee</dt>
                <dd className="font-mono">$0.00</dd>
              </div>
            </dl>
          </aside>
          <section aria-label={receipt ? 'Payment receipt' : 'Payment details'}>
            {receipt ? (
              <div>
                <p id="payment-success" role="status" className="mb-4 font-semibold text-primary">
                  Demo payment confirmed
                </p>
                <h1
                  ref={heading}
                  tabIndex={-1}
                  className="text-3xl font-semibold tracking-tight outline-none"
                >
                  You’re all set.
                </h1>
                <p className="mt-3 text-secondary">
                  Your simulated payment to {demoInvoice.vendor} is complete.
                </p>
                <dl className="my-8 space-y-5 rounded-input border border-subtle bg-surface p-5 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-secondary">Amount paid</dt>
                    <dd id="receipt-total" className="font-mono">
                      {demoTotal}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-secondary">Invoice</dt>
                    <dd id="receipt-invoice" className="font-mono">
                      {receipt.invoiceNumber}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-secondary">Confirmation reference</dt>
                    <dd id="transaction-reference" className="mt-2 font-mono break-all">
                      {receipt.reference}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-secondary">Confirmed at</dt>
                    <dd className="mt-2">{new Date(receipt.paidAt).toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt className="text-secondary">Payment method</dt>
                    <dd className="mt-2">Demo Bank ···· 6789</dd>
                  </div>
                </dl>
                <p className="mb-6 text-sm text-secondary">
                  This is a demo receipt. No bill or bank account has been charged.
                </p>
                <button type="button" onClick={reset} className={secondaryButton}>
                  Start a new demo
                </button>
              </div>
            ) : (
              <form onSubmit={pay} aria-busy={busy}>
                <h1 className="text-3xl font-semibold tracking-tight">Review your payment</h1>
                <p className="mt-3 text-secondary">
                  Pay this sample invoice using the test account below.
                </p>
                <fieldset disabled={busy || !ready} className="mt-8 space-y-5">
                  <legend className="mb-4 font-semibold">Demo bank account</legend>
                  <p className="text-sm text-secondary">
                    {demoBank.accountHolder} · {demoBank.bankName}
                  </p>
                  <div>
                    <label htmlFor="routing-number" className="mb-2 block text-sm">
                      Routing number
                    </label>
                    <input
                      id="routing-number"
                      value={routing}
                      onChange={(e) => setRouting(e.target.value)}
                      inputMode="numeric"
                      autoComplete="off"
                      required
                      aria-describedby="bank-help"
                      className="h-12 w-full rounded-input border border-strong bg-surface px-4 font-mono focus-visible:outline-2 focus-visible:outline-primary"
                    />
                  </div>
                  <div>
                    <label htmlFor="account-number" className="mb-2 block text-sm">
                      Account number
                    </label>
                    <input
                      id="account-number"
                      value={account}
                      onChange={(e) => setAccount(e.target.value)}
                      inputMode="numeric"
                      autoComplete="off"
                      required
                      aria-describedby="bank-help"
                      className="h-12 w-full rounded-input border border-strong bg-surface px-4 font-mono focus-visible:outline-2 focus-visible:outline-primary"
                    />
                  </div>
                  <p id="bank-help" className="text-sm text-secondary">
                    Synthetic fixtures, prefilled for testing. Do not enter real banking
                    information.
                  </p>
                  <ErrorAlert message={error} />
                  <button
                    id="pay-button"
                    type="submit"
                    disabled={busy || !ready}
                    data-pending={busy ? '' : undefined}
                    className={`${primaryButton} w-full`}
                  >
                    {busy ? (
                      <>
                        <Spinner />
                        Simulating payment…
                      </>
                    ) : (
                      `Pay ${demoTotal}`
                    )}
                  </button>
                </fieldset>
                <p className="mt-4 text-center text-sm text-secondary">
                  USD · One simulated payment · No charge
                </p>
              </form>
            )}
            {storageWarning && (
              <p role="status" className="mt-5 text-sm text-secondary">
                {storageWarning}
              </p>
            )}
          </section>
        </div>
        <footer className="mt-12 border-t border-subtle pt-5 text-sm text-secondary">
          Taskforce sandbox · Sample invoice and account data
        </footer>
      </div>
    </main>
  );
}
