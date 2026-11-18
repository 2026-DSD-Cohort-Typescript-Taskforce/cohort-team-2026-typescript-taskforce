import { createHash } from 'node:crypto';
import type { ReceiptArtifact } from './payment-contract';

type ReceiptSelectors = {
  receiptSelector: string;
  confirmationSelector: string;
  confirmationInvoiceSelector: string;
  confirmationTotalSelector: string;
  confirmationReferenceSelector: string;
};
type ReceiptPage = {
  evaluate<T, A>(fn: (args: A) => T, args: A): Promise<T>;
  screenshot(options: {
    type: 'png';
    clip: { x: number; y: number; width: number; height: number };
  }): Promise<Uint8Array>;
};

/** Screenshot a sanitized copy of the receipt, retaining ONLY verified payment fields. */
export async function captureReceipt(
  page: ReceiptPage,
  selectors: ReceiptSelectors,
  expected: { invoice: string; cents: number },
  renderPage: () => Promise<ReceiptPage & { close(): Promise<void> }>,
): Promise<ReceiptArtifact> {
  const id = 'dc112-private-receipt-capture';
  let isolated: (ReceiptPage & { close(): Promise<void> }) | undefined;
  try {
    const capture = await page.evaluate(
      ({ selectors: p, expected, id }) => {
        if (document.getElementById(id)) throw new Error('Capture container already exists');
        const roots = document.querySelectorAll<HTMLElement>(p.receiptSelector);
        if (roots.length !== 1 || !roots[0].getClientRects().length)
          throw new Error('Receipt unavailable');
        const root = roots[0];
        const fields: HTMLElement[] = [];
        for (const selector of [
          p.confirmationSelector,
          p.confirmationInvoiceSelector,
          p.confirmationTotalSelector,
          p.confirmationReferenceSelector,
        ]) {
          const nodes = document.querySelectorAll<HTMLElement>(selector);
          if (
            nodes.length !== 1 ||
            !nodes[0].getClientRects().length ||
            nodes[0] === root ||
            !root.contains(nodes[0])
          )
            throw new Error('Receipt field unavailable');
          fields.push(nodes[0]);
        }
        for (const a of fields)
          for (const b of fields)
            if (a !== b && a.contains(b)) throw new Error('Overlapping receipt fields');
        const match = /^(?:USD\s*|\$\s*)?(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/.exec(
          fields[2].innerText.trim(),
        );
        const cents = match
          ? BigInt(match[1].replaceAll(',', '')) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))
          : -1n;
        const reference = fields[3].innerText.trim();
        if (
          fields[1].innerText.trim() !== expected.invoice ||
          cents !== BigInt(expected.cents) ||
          !reference ||
          reference.length > 255
        )
          throw new Error('Receipt changed');
        const clone = root.cloneNode(true) as HTMLElement;
        const safe: HTMLElement[] = [];
        for (const selector of [
          p.confirmationSelector,
          p.confirmationInvoiceSelector,
          p.confirmationTotalSelector,
          p.confirmationReferenceSelector,
        ]) {
          const found = clone.querySelectorAll<HTMLElement>(selector);
          if (found.length !== 1) throw new Error('Receipt selector cannot be isolated');
          safe.push(found[0]);
        }
        // Replace all permitted text with the verified snapshot, then remove everything else.
        const text = [
          'Payment confirmed',
          'Invoice: ' + expected.invoice,
          'Amount: $' + (expected.cents / 100).toFixed(2),
          'Reference: ' + reference,
        ];
        for (let i = 0; i < safe.length; i++) safe[i].textContent = text[i];
        const elements = [clone, ...clone.querySelectorAll<HTMLElement>('*')];
        for (let i = elements.length - 1; i >= 0; i--) {
          const element = elements[i];
          let retain = element === clone;
          for (const field of safe) if (element === field || element.contains(field)) retain = true;
          if (!retain) {
            element.remove();
            continue;
          }
          for (const attr of [...element.attributes]) element.removeAttribute(attr.name);
          element.style.cssText =
            'all:initial;display:block;color:#111;background:#fff;font:16px Arial,sans-serif;line-height:1.6;overflow-wrap:anywhere;';
        }
        const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          let retain = false;
          for (const field of safe) if (field.contains(node)) retain = true;
          if (!retain) node.textContent = '';
        }
        clone.id = id;
        clone.style.cssText +=
          'position:fixed;left:0;top:0;z-index:2147483647;box-sizing:border-box;width:640px;max-width:100vw;padding:24px;';
        const style = document.createElement('style');
        style.textContent =
          '#' +
          id +
          '::before,#' +
          id +
          '::after,#' +
          id +
          ' *::before,#' +
          id +
          ' *::after{content:none!important;background-image:none!important}';
        clone.append(style);
        return { reference, html: clone.outerHTML };
      },
      { selectors, expected, id },
    );
    // Render in a blank tab: portal scripts, styles, dialogs and compositor layers
    // cannot change the sanitized snapshot between validation and screenshot.
    isolated = await renderPage();
    const clip = await isolated.evaluate(
      ({ html, id }) => {
        document.body.innerHTML = html;
        const receipt = document.getElementById(id)!;
        const rect = receipt.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1 || rect.width > 2000 || rect.height > 2000)
          throw new Error('Receipt dimensions invalid');
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      },
      { html: capture.html, id },
    );
    const bytes = await isolated.screenshot({ type: 'png', clip });
    if (bytes.length > 2 * 1024 * 1024) throw new Error('Receipt too large');
    return {
      reference: capture.reference,
      pngBase64: Buffer.from(bytes).toString('base64'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } finally {
    await isolated?.close().catch(() => {});
  }
}
