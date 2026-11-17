import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { HttpError } from '../middleware/errorHandler';
import type { ExecuteRequest, ObserveRequest } from './payment-contract';
import type { PortalBrowser, PortalSession } from './worker';
import { guardNavigation } from './navigation-guard';
import { assertPaymentMatch } from './worker-input';

const selector = z.string().min(1);
const profileSchema = z.strictObject({
  portalUrl: z.url(),
  vendorId: z.number().int().positive(),
  amountUnit: z.enum(['dollars', 'cents']),
  invoiceSelector: selector,
  totalSelector: selector,
  paySelector: selector,
  confirmationSelector: selector,
  confirmationInvoiceSelector: selector,
  confirmationTotalSelector: selector,
  confirmationReferenceSelector: selector,
  confirmationUrl: z.url().optional(),
});
export type PortalProfile = z.infer<typeof profileSchema>;

/** Selectors are trusted operator configuration, never accepted in HTTP requests. */
export class StagehandBrowser implements PortalBrowser {
  constructor(private readonly profilesFile: string | undefined) {}

  private async profiles(): Promise<PortalProfile[]> {
    if (!this.profilesFile)
      throw new HttpError(503, 'Portal execution is not configured.', 'portal_error');
    try {
      return z.array(profileSchema).parse(JSON.parse(await readFile(this.profilesFile, 'utf8')));
    } catch {
      throw new HttpError(503, 'Portal configuration is invalid.', 'portal_error');
    }
  }

  private async profile(input: ObserveRequest) {
    const profile = (await this.profiles()).find((p) => p.portalUrl === input.portalUrl);
    if (!profile)
      throw new HttpError(422, 'Portal is not configured for execution.', 'invalid_request');
    return profile;
  }

  async prepareExecution(input: ExecuteRequest) {
    const profile = await this.profile(input);
    if (profile.vendorId !== input.vendorId)
      throw new HttpError(422, 'Portal vendor does not match.', 'payment_mismatch');
    return { unit: profile.amountUnit, open: () => this.open(input, 'execute', profile) };
  }

  async open(
    input: ObserveRequest,
    mode: 'observe' | 'execute',
    pinnedProfile?: PortalProfile,
  ): Promise<PortalSession> {
    const profile = mode === 'execute' ? pinnedProfile : undefined;
    if (mode === 'execute' && !profile)
      throw new HttpError(503, 'Execution profile was not validated.', 'portal_error');
    const { localBrowser, Stagehand } = await import('@browserbasehq/stagehand');
    // New temporary Chrome profile per request. No shared login/session state.
    const browser = await localBrowser.launch({ headless: true });
    let guard: Awaited<ReturnType<typeof guardNavigation>> | undefined;
    let stagehand: Awaited<ReturnType<typeof Stagehand.create>> | undefined;
    try {
      stagehand = await Stagehand.create({
        browser,
        model: {
          // Payment controls come from trusted portal profiles; no model actions.
          generate: async () => {
            throw new Error('Model-driven payment actions are disabled.');
          },
        },
      });
      if (!browser.cdpUrl) throw new Error('Browser has no local CDP endpoint');
      guard = await guardNavigation(
        browser.cdpUrl,
        [input.portalUrl, ...(profile?.confirmationUrl ? [profile.confirmationUrl] : [])],
        mode === 'observe',
      );
      const [page] = await browser.context.pages();
      if (!page) throw new Error('Browser page unavailable');
      const response = await page.goto(input.portalUrl, { timeout: 30000 });
      guard.check();
      if (!response || response.status() >= 400) throw new Error('Portal failed to load');

      const read = async (invoiceSelector: string, totalSelector: string) => {
        const result = await page.evaluate(
          ({ invoiceSelector, totalSelector }) => {
            const invoices = document.querySelectorAll<HTMLElement>(invoiceSelector);
            const totals = document.querySelectorAll<HTMLElement>(totalSelector);
            if (
              [invoices, totals].some(
                (nodes) => nodes.length !== 1 || !nodes[0].getClientRects().length,
              )
            ) {
              throw new Error('Missing or ambiguous payment detail');
            }
            return { invoice: invoices[0].innerText.trim(), total: totals[0].innerText.trim() };
          },
          { invoiceSelector, totalSelector },
        );
        guard!.check();
        return result;
      };
      const executionProfile = () => {
        if (!profile) throw new Error('Observation session cannot execute');
        return profile;
      };
      return {
        async text() {
          const pageText = await page.evaluate(() => document.body.innerText);
          guard!.check();
          return pageText;
        },
        async review() {
          const p = executionProfile();
          const alreadyConfirmed = await page.evaluate(
            (selector) => Boolean(document.querySelector(selector)),
            p.confirmationSelector,
          );
          if (alreadyConfirmed)
            throw new HttpError(409, 'Portal already shows confirmation.', 'payment_mismatch');
          return read(p.invoiceSelector, p.totalSelector);
        },
        async submit(expected) {
          const p = executionProfile();
          assertPaymentMatch(await read(p.invoiceSelector, p.totalSelector), expected);
          guard!.check();
          // Recheck and click in one browser task, so no navigation/model step can intervene.
          await page.evaluate(
            ({ p, expected }) => {
              const invoices = document.querySelectorAll<HTMLElement>(p.invoiceSelector);
              const totals = document.querySelectorAll<HTMLElement>(p.totalSelector);
              const buttons = document.querySelectorAll<HTMLElement>(p.paySelector);
              if (
                [invoices, totals, buttons].some(
                  (nodes) => nodes.length !== 1 || !nodes[0].getClientRects().length,
                )
              ) {
                throw new Error('Ambiguous portal control');
              }
              const invoice = invoices[0].innerText.trim();
              const total = totals[0].innerText.trim();
              const match = /^(?:USD\s*|\$\s*)?(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/.exec(
                total,
              );
              const cents = match
                ? BigInt(match[1].replaceAll(',', '')) * 100n +
                  BigInt((match[2] ?? '').padEnd(2, '0'))
                : -1n;
              if (
                invoice !== expected.invoice ||
                cents !== BigInt(expected.cents) ||
                document.querySelector(p.confirmationSelector)
              ) {
                throw new Error('Payment details changed');
              }
              const button = buttons[0];
              if (button.matches(':disabled, [aria-disabled="true"]'))
                throw new Error('Payment button disabled');
              button.click();
            },
            { p, expected },
          );
          guard!.check();
        },
        async confirm(expected) {
          const p = executionProfile();
          await page.waitForFunction(
            ({ p, expected }) => {
              const markers = document.querySelectorAll<HTMLElement>(p.confirmationSelector);
              const invoices = document.querySelectorAll<HTMLElement>(
                p.confirmationInvoiceSelector,
              );
              const totals = document.querySelectorAll<HTMLElement>(p.confirmationTotalSelector);
              const references = document.querySelectorAll<HTMLElement>(
                p.confirmationReferenceSelector,
              );
              if (
                [markers, invoices, totals, references].some(
                  (nodes) => nodes.length !== 1 || !nodes[0].getClientRects().length,
                )
              )
                return false;
              const match = /^(?:USD\s*|\$\s*)?(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/.exec(
                totals[0].innerText.trim(),
              );
              const cents = match
                ? BigInt(match[1].replaceAll(',', '')) * 100n +
                  BigInt((match[2] ?? '').padEnd(2, '0'))
                : -1n;
              return (
                invoices[0].innerText.trim() === expected.invoice &&
                cents === BigInt(expected.cents) &&
                references[0].innerText.trim().length > 0
              );
            },
            { p, expected },
            { timeout: 15000 },
          );
          guard!.check();
        },
        async close() {
          try {
            await stagehand!.close();
          } finally {
            try {
              await browser.close();
            } finally {
              guard!.close();
            }
          }
        },
      };
    } catch (error) {
      await stagehand?.close().catch(() => {});
      await browser.close().catch(() => {});
      guard?.close();
      if (error instanceof HttpError) throw error;
      const failure = new HttpError(
        502,
        'Portal browser could not complete the request.',
        'portal_error',
      );
      failure.cause = error;
      throw failure;
    }
  }
}
