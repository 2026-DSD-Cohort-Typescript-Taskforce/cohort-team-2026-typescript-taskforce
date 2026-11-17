import bank from '../test-fixtures/bank-account.json' with { type: 'json' };

export const demoBank = bank;
export const demoInvoice = {
  billId: 7,
  vendorId: 9,
  vendor: 'Northline Utilities',
  invoiceNumber: 'INV-7',
  amountMinor: 12500,
  currency: 'USD',
} as const;
export const demoTotal = '$125.00';
export const receiptStorageKey = 'taskforce-demo-receipt-v1';

export type DemoReceipt = {
  invoiceNumber: string;
  amountMinor: number;
  reference: string;
  paidAt: string;
};

export function validateDemoBank(routing: string, account: string): boolean {
  return routing === demoBank.routingNumber && account === demoBank.accountNumber;
}

export function createDemoReceipt(paidAt = new Date().toISOString()): DemoReceipt {
  return {
    invoiceNumber: demoInvoice.invoiceNumber,
    amountMinor: demoInvoice.amountMinor,
    reference: 'DEMO-INV-7-12500',
    paidAt,
  };
}

export function restoreDemoReceipt(raw: string | null): DemoReceipt | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const receipt = value as Record<string, unknown>;
    if (
      receipt.invoiceNumber !== demoInvoice.invoiceNumber ||
      receipt.amountMinor !== demoInvoice.amountMinor ||
      receipt.reference !== 'DEMO-INV-7-12500' ||
      typeof receipt.paidAt !== 'string' ||
      !Number.isFinite(Date.parse(receipt.paidAt))
    )
      return null;
    return createDemoReceipt(receipt.paidAt);
  } catch {
    return null;
  }
}
