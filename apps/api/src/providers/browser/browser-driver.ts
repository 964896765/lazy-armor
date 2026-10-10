import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { chromium, type Page } from 'playwright-core';
import { ProviderRuntimeError } from '@lazy-armor/connector-sdk';
import { browserReadSchema, browserFormSchema, type BrowserForm } from '@lazy-armor/plan-schema';
import { resolvePublicHost } from '../../common/public-host';

export interface BrowserDriverOptions { executablePath: string; allowedOrigins: string[]; allowLoopbackTest?: boolean }

/** A per-call browser context behind the original Provider bridge. No personal profile/CDP attachment. */
export class BrowserDriver {
  constructor(private readonly options: BrowserDriverOptions) {}
  async health(endpoint: string) {
    return this.withPage(endpoint, endpoint, async page => { await page.goto(endpoint, { waitUntil: 'domcontentloaded' }); return new Date().toISOString(); });
  }
  async read(raw: unknown, endpoint: string) {
    const parsed = browserReadSchema.safeParse(raw);
    if (!parsed.success) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    return this.withPage(parsed.data.url, endpoint, async page => {
      await page.goto(parsed.data.url, { waitUntil: 'domcontentloaded' });
      const fields = [];
      for (const id of parsed.data.selectors) fields.push({ selector: id, text: await this.text(page, id) });
      return { fields, observedAt: new Date().toISOString(), sourceUrl: page.url(), verification: 'OBSERVATION_ONLY' };
    });
  }
  async form(raw: unknown, endpoint: string, operationId: string, assertCurrent: () => Promise<void>, lookupOnly = false) {
    const parsed = browserFormSchema.safeParse(raw);
    if (!parsed.success || !/^[a-f0-9]{64}$/.test(operationId)) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    const input = parsed.data;
    return this.withPage(input.url, endpoint, async (page, arm) => {
      if (lookupOnly) {
        const url = new URL(input.lookupUrl); url.searchParams.set('operationId', operationId);
        await page.goto(url.href, { waitUntil: 'domcontentloaded' });
        return this.receipt(page, input, operationId);
      }
      await page.goto(input.url, { waitUntil: 'domcontentloaded' });
      const form = await page.locator(input.submitSelector).evaluate((node, expected) => {
        const button = node as HTMLButtonElement;
        const form = button.form;
        if (!form || button.disabled || button.tagName !== 'BUTTON' || button.type !== 'submit' || form.method.toLowerCase() !== 'post' ||
            (form.target && form.target !== '_self') || form.action !== expected.submitUrl || form.enctype !== 'application/x-www-form-urlencoded' ||
            (button.hasAttribute('formaction') && button.formAction !== form.action) ||
            (button.formMethod && button.formMethod.toLowerCase() !== 'post') || (button.formTarget && button.formTarget !== '_self')) return null;
        const allowed = new Set([...expected.fields.map(field => field.selector), expected.operationFieldSelector]);
        const controls = Array.from(form.elements) as HTMLInputElement[];
        if (controls.some(control => control.name && !control.disabled && !allowed.has('#' + control.id))) return null;
        const names: string[] = [];
        for (const id of allowed) {
          const node = document.querySelector(id) as HTMLInputElement | null;
          if (!node || node.form !== form || !node.name || node.disabled || node.readOnly ||
              !['INPUT', 'TEXTAREA'].includes(node.tagName) || (node.tagName === 'INPUT' &&
              !['text', 'email', 'number', ...(id === expected.operationFieldSelector ? ['hidden'] : [])].includes(node.type))) return null;
          names.push(node.name);
        }
        return new Set(names).size === names.length ? names : null;
      }, input);
      if (!form) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
      const values = new URLSearchParams();
      for (const [index, field] of input.fields.entries()) {
        const control = page.locator(field.selector);
        if (await control.count() !== 1) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
        await control.fill(field.value); values.set(form[index], field.value);
      }
      const operationField = page.locator(input.operationFieldSelector);
      if (await operationField.count() !== 1 || await page.locator(input.submitSelector).count() !== 1) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
      await operationField.evaluate((node, value) => { (node as HTMLInputElement).value = value; }, operationId);
      values.set(form.at(-1)!, operationId);
      await assertCurrent(); // Recheck original permission/approval after observing untrusted DOM, before mutation.
      arm(input.submitUrl, values);
      try {
        const [response] = await Promise.all([
          page.waitForResponse(response => response.url() === input.submitUrl && response.request().method() === 'POST' && response.request().isNavigationRequest()),
          page.waitForURL(url => url.href === input.submitUrl, { waitUntil: 'domcontentloaded' }), page.locator(input.submitSelector).click(),
        ]);
        if (response.status() !== 200) throw new Error('Uncertain form response');
        return await this.receipt(page, input, operationId);
      } catch { throw new ProviderRuntimeError('OUTCOME_UNKNOWN', 'AFTER_DISPATCH'); }
    });
  }
  private async receipt(page: Page, input: BrowserForm, operationId: string) {
    const text = await this.text(page, input.resultSelector), marker = await this.text(page, input.operationResultSelector);
    return { verificationEvidence: { matched: text === input.expectedText && marker === operationId, operationId: marker },
      observedAt: new Date().toISOString(), sourceUrl: page.url() };
  }
  private async text(page: Page, id: string) {
    const node = page.locator(id);
    if (await node.count() !== 1 || !(await node.isVisible()) || await node.evaluate(node =>
      node.matches('input,textarea,[contenteditable="true"]') || Boolean(node.closest('[data-sensitive="true"]'))))
      throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    const text = (await node.innerText()).trim();
    if (text.length > 2000) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    return text;
  }
  private async withPage<T>(raw: string, endpoint: string, run: (page: Page, arm: (url: string, fields: URLSearchParams) => void) => Promise<T>) {
    const url = new URL(raw), source = new URL(endpoint);
    const test = this.options.allowLoopbackTest === true && process.env.NODE_ENV === 'test' && url.hostname === '127.0.0.1';
    if (source.username || source.password || url.username || url.password || source.origin !== url.origin || !this.options.allowedOrigins.includes(url.origin) ||
        (!test && (url.protocol !== 'https:' || (url.port && url.port !== '443') || isIP(url.hostname)))) throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH');
    let addresses: Array<{address:string;family:number}>;
    try { addresses = test ? [{ address: '127.0.0.1', family: 4 }] : await resolvePublicHost(url.hostname); }
    catch { throw new ProviderRuntimeError('PERMISSION_DENIED', 'BEFORE_DISPATCH'); }
    const browser = await chromium.launch({ executablePath: this.options.executablePath, headless: true,
      args: ['--disable-quic', '--no-proxy-server', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        `--host-resolver-rules=MAP ${url.hostname} ${addresses[0].address}, EXCLUDE localhost`] });
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
      const page = await context.newPage(); page.setDefaultTimeout(5000); page.setDefaultNavigationTimeout(8000);
      deadline = setTimeout(() => { void browser.close(); }, 20000);
      let armed: { url: string; fields: URLSearchParams } | undefined;
      await context.route('**/*', async route => {
        const request = route.request(), target = new URL(request.url());
        if (target.origin !== url.origin || !['http:', 'https:'].includes(target.protocol)) { await route.abort(); return; }
        if (['GET', 'HEAD'].includes(request.method())) { await route.continue(); return; }
        if (!armed || request.method() !== 'POST' || target.href !== armed.url || !request.isNavigationRequest() ||
            request.frame() !== page.mainFrame() || !/application\/x-www-form-urlencoded/i.test(request.headers()['content-type'] ?? '')) { await route.abort(); return; }
        const body = new URLSearchParams(request.postData() ?? ''), expected = armed.fields;
        if ([...body].length !== [...expected].length || [...expected].some(([key, value]) => body.getAll(key).length !== 1 || body.get(key) !== value)) { await route.abort(); return; }
        // Chromium may automatically retry a navigation POST after a dropped response.
        // Consume the frozen dispatch once through a pinned, non-retrying transport and
        // fulfill the browser request; a browser retry cannot send the mutation again.
        armed = undefined;
        try {
          const response = await this.submitOnce(target, request.postData()!, addresses[0], test);
          await route.fulfill({ status: response.status, body: response.body, contentType: response.contentType });
        } catch { await route.abort('failed'); }
      });
      await context.routeWebSocket('**/*', socket => socket.close());
      page.on('dialog', dialog => { void dialog.dismiss(); });
      context.on('page', next => { if (next !== page) void next.close(); });
      return await run(page, (url, fields) => { armed = { url, fields }; });
    } finally { if (deadline) clearTimeout(deadline); await browser.close(); }
  }
  private submitOnce(url: URL, body: string, pinned: { address: string; family: number }, test: boolean) {
    return new Promise<{ status: number; body: Buffer; contentType: string }>((resolve, reject) => {
      const transport = test ? httpRequest : httpsRequest;
      const req = transport(url, { method: 'POST', agent: false, family: pinned.family,
        lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body), 'accept-encoding': 'identity' } }, response => {
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 256000) response.destroy(new Error('BROWSER_RESPONSE_TOO_LARGE')); else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => resolve({ status: response.statusCode ?? 500, body: Buffer.concat(chunks), contentType: response.headers['content-type'] ?? 'text/plain' }));
      });
      const deadline = setTimeout(() => req.destroy(new Error('BROWSER_SUBMIT_TIMEOUT')), 8000);
      req.on('close', () => clearTimeout(deadline)); req.on('error', reject); req.end(body);
    });
  }
}
