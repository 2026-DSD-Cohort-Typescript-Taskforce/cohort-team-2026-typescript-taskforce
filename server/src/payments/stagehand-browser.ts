import { captureReceipt } from './capture-receipt';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { HttpError } from '../middleware/errorHandler';
import type { ExecuteRequest, ObserveRequest } from './payment-contract';
import type { PortalBrowser, PortalSession } from './worker';
import { guardNavigation } from './navigation-guard';
import { assertPaymentMatch } from './worker-input';
const selector = z.string().min(1);
const stepSchema = z.union([
  z.strictObject({ action: z.enum(['click', 'login', 'check', 'wait']), selector }),
  // Native <select> dropdowns. Custom/<details> menus are just `click` steps on their toggle.
  z.strictObject({ action: z.literal('select'), selector, value: z.string() }),
]);
const profileSchema = z
  .strictObject({
    portalUrl: z.url().optional(),
    vendorId: z.number().int().positive().optional(),
    capture: z.array(stepSchema).max(8).optional(),
    pay: z.array(stepSchema).max(8).optional(),
    amountUnit: z.enum(['dollars', 'cents']),
    invoiceSelector: selector,
    totalSelector: selector,
    paySelector: selector,
    confirmationSelector: selector,
    confirmationInvoiceSelector: selector,
    confirmationTotalSelector: selector,
    confirmationReferenceSelector: selector,
    confirmationUrl: z.url().optional(),
    receiptSelector: selector.optional(),
  })
  .superRefine((profile, ctx) => {
    if (profile.portalUrl !== undefined && profile.vendorId === undefined) {
      ctx.addIssue({ code: 'custom', message: 'vendor required', path: ['vendorId'] });
    }
  });
export type PortalProfile = z.infer<typeof profileSchema>;
export type CaptureStep = z.infer<typeof stepSchema>;

/** Observation is limited to an exact operator-configured portal URL. */
export function selectObserveProfile(profiles: PortalProfile[], portalUrl: string) {
  return profiles.find((profile) => profile.portalUrl === portalUrl);
}

/** Profile-owned steps that prepare a portal without performing the final payment click. */
export function preparationSteps(profile: PortalProfile, mode: 'observe' | 'execute') {
  return [...(profile.capture ?? []), ...(mode === 'execute' ? (profile.pay ?? []) : [])];
}

export function parsePortalProfiles(text: string) {
  return z.array(profileSchema).parse(JSON.parse(text));
}

type CapturePage = {
  evaluate: (
    pageFunction: (step: CaptureStep) => 'missing' | 'ready',
    step: CaptureStep,
  ) => Promise<'missing' | 'ready'>;
};

/** Clicks, login, and waits from the operator profile. The page text supplies the printed login. */
export async function runCapture(page: CapturePage, steps: CaptureStep[]) {
  for (const step of steps) {
    const started = Date.now();
    let outcome: 'missing' | 'ready' = 'missing';
    while (Date.now() - started < 10000) {
      outcome = await page.evaluate((step) => {
        const { selector, action } = step;
        const node = document.querySelector(selector);
        if (!(node instanceof HTMLElement) || node.getClientRects().length === 0) return 'missing';
        if (action === 'wait') return 'ready';
        if (step.action === 'select') {
          if (!(node instanceof HTMLSelectElement)) return 'missing';
          if (![...node.options].some((option) => option.value === step.value)) return 'missing';
          node.value = step.value;
          // Portals swap fieldsets/accounts on change, so fire the events a real pick would.
          node.dispatchEvent(new Event('input', { bubbles: true }));
          node.dispatchEvent(new Event('change', { bubbles: true }));
          return 'ready';
        }
        if (action === 'login') {
          if (!(node instanceof HTMLFormElement)) return 'missing';
          const text = document.body.innerText;
          const email = text.match(/Email:\s*(\S+)/)?.[1];
          const password = text.match(/Password:\s*(\S+)/)?.[1];
          const emailInput = node.querySelector<HTMLInputElement>('input[name="email"]');
          const passwordInput = node.querySelector<HTMLInputElement>('input[name="password"]');
          if (!email || !password || !emailInput || !passwordInput) return 'missing';
          emailInput.value = email;
          passwordInput.value = password;
          node.requestSubmit();
          return 'ready';
        }
        if (action === 'check' && node instanceof HTMLInputElement && !node.checked) node.click();
        if (action === 'click') node.click();
        return 'ready';
      }, step);
      if (outcome === 'ready') break;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    if (outcome !== 'ready') throw new Error('Portal step missed its control');
  }
}

export type StagehandBrowserOptions = {
  profilesJson?: string;
  provider?: 'local' | 'browserbase';
  browserbaseApiKey?: string;
};

/** Selectors are trusted operator configuration, never accepted in HTTP requests. */
export class StagehandBrowser implements PortalBrowser {
  constructor(
    private readonly profilesFile: string | undefined,
    private readonly options: StagehandBrowserOptions = {},
  ) {}

  private async profiles(): Promise<PortalProfile[]> {
    if (!this.options.profilesJson && !this.profilesFile)
      throw new HttpError(503, 'Portal execution is not configured.', 'portal_error');
    try {
      const source = this.options.profilesJson ?? (await readFile(this.profilesFile!, 'utf8'));
      return parsePortalProfiles(source);
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
    const profile =
      mode === 'execute'
        ? pinnedProfile
        : selectObserveProfile(await this.profiles(), input.portalUrl);
    if (mode === 'observe' && !profile)
      throw new HttpError(422, 'Portal is not configured for execution.', 'invalid_request');
    if (!profile) throw new HttpError(503, 'Execution profile was not validated.', 'portal_error');
    const provider = this.options.provider ?? 'local';
    const stagehandModule = await import('@browserbasehq/stagehand');
    if (provider === 'browserbase' && !this.options.browserbaseApiKey) {
      throw new HttpError(503, 'Browserbase is not configured.', 'portal_error');
    }
    const allowedUrls = [
      input.portalUrl,
      ...(mode === 'execute' && profile.confirmationUrl ? [profile.confirmationUrl] : []),
    ];
    // New temporary browser per request. No shared login/session state.
    const launched = await (async () => {
      if (provider === 'local') {
        const browser = await stagehandModule.localBrowser.launch({
          headless: process.env.STAGEHAND_DEBUG !== 'true' || process.env.NODE_ENV === 'production',
        });
        return { browser, guardCdpUrl: browser.cdpUrl, cleanupProvider: async () => undefined };
      }

      // Browserbase's native Stagehand handle intentionally hides its CDP URL. Create the
      // session directly, restrict main-frame navigation at the provider, then attach through
      // the returned CDP endpoint so our stricter exact-URL/request-method guard also applies.
      const { default: Browserbase, toFile } = await import('@browserbasehq/sdk');
      const client = new Browserbase({ apiKey: this.options.browserbaseApiKey! });
      const extension = await client.extensions.create({
        file: await toFile(await stagehandModule.getExtensionArchive(), 'stagehand-extension.zip'),
      });
      let session: Awaited<ReturnType<typeof client.sessions.create>>;
      try {
        session = await client.sessions.create({
          api_timeout: 120,
          extensionId: extension.id,
          browserSettings: {
            allowedDomains: [...new Set(allowedUrls.map((url) => new URL(url).hostname))],
          },
        });
      } catch (error) {
        await client.extensions.delete(extension.id).catch(() => undefined);
        throw error;
      }
      try {
        const browser = await stagehandModule.browserbase.connect({
          apiKey: this.options.browserbaseApiKey!,
          sessionId: session.id,
        });
        return {
          browser,
          guardCdpUrl: session.connectUrl,
          cleanupProvider: () => client.extensions.delete(extension.id),
        };
      } catch (error) {
        await client.sessions
          .update(session.id, { status: 'REQUEST_RELEASE' })
          .catch(() => undefined);
        await client.extensions.delete(extension.id).catch(() => undefined);
        throw error;
      }
    })();
    const { browser, guardCdpUrl, cleanupProvider } = launched;
    const { Stagehand } = stagehandModule;
    let guard: Awaited<ReturnType<typeof guardNavigation>> | undefined;
    let stagehand: Awaited<ReturnType<typeof Stagehand.create>> | undefined;
    try {
      // Stagehand v4 must attach before browser.context is available, even though
      // payment actions below deliberately use deterministic browser APIs.
      stagehand = await Stagehand.create({
        browser,
        model: {
          // Payment controls come from trusted portal profiles; no model actions.
          generate: async () => {
            throw new Error('Model-driven payment actions are disabled.');
          },
        },
      });
      if (!guardCdpUrl) throw new Error('Browser CDP endpoint is unavailable');
      guard = await guardNavigation(guardCdpUrl, allowedUrls, mode === 'observe');
      const [page] = await browser.context.pages();
      if (!page) throw new Error('Browser page unavailable');
      const response = await page.goto(input.portalUrl, { timeout: 30000 });
      guard.check();
      if (!response || response.status() >= 400) throw new Error('Portal failed to load');
      const steps = preparationSteps(profile, mode);
      if (steps.length) {
        await runCapture(page, steps);
        guard.check();
      }

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
          // Hydrated checkouts may restore state before enabling payment. Wait before
          // BrowserWorker persists submission intent; submit still rechecks atomically.
          await page.waitForFunction(
            (selector) => {
              const buttons = document.querySelectorAll<HTMLElement>(selector);
              return (
                buttons.length === 1 &&
                buttons[0].getClientRects().length > 0 &&
                !buttons[0].matches(':disabled, [aria-disabled="true"]')
              );
            },
            p.paySelector,
            { timeout: 15000 },
          );
          guard!.check();
          return read(p.invoiceSelector, p.totalSelector);
        },
        async submit(expected, markSubmitting) {
          const p = executionProfile();
          assertPaymentMatch(await read(p.invoiceSelector, p.totalSelector), expected);
          guard!.check();
          const controlReady = await page.evaluate(
            ({ paySelector, confirmationSelector }) => {
              const buttons = document.querySelectorAll<HTMLElement>(paySelector);
              return (
                !document.querySelector(confirmationSelector) &&
                buttons.length === 1 &&
                buttons[0].getClientRects().length > 0 &&
                !buttons[0].matches(':disabled, [aria-disabled="true"]')
              );
            },
            { paySelector: p.paySelector, confirmationSelector: p.confirmationSelector },
          );
          if (!controlReady)
            throw new HttpError(422, 'Payment control changed.', 'payment_mismatch');
          guard!.check();
          await markSubmitting();
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
        },
        async captureReceipt(expected) {
          const p = executionProfile();
          if (!p.receiptSelector) return undefined;
          guard!.check();
          const artifact = await captureReceipt(
            page,
            { ...p, receiptSelector: p.receiptSelector },
            expected,
            () => browser.context.newPage(),
          );
          guard!.check();
          return artifact;
        },
        async close() {
          try {
            await stagehand!.close();
          } finally {
            try {
              await browser.close();
            } finally {
              try {
                await cleanupProvider();
              } finally {
                guard?.close();
              }
            }
          }
        },
      };
    } catch (error) {
      await stagehand?.close().catch(() => {});
      await browser.close().catch(() => {});
      await cleanupProvider().catch(() => {});
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
