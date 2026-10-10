import { z } from 'zod';
const selector = z.string().regex(/^#[A-Za-z][A-Za-z0-9_-]{0,79}$/);
const pageUrl = z.string().url().max(2000).refine(value => { const url = new URL(value); return !url.username && !url.password && !url.hash; });
export const browserReadSchema = z.object({ url: pageUrl, selectors: z.array(selector).min(1).max(8) }).strict();
export const browserFormSchema = z.object({ url: pageUrl, submitUrl: pageUrl, lookupUrl: pageUrl,
  fields: z.array(z.object({ selector, value: z.string().max(1000) }).strict()).min(1).max(8),
  submitSelector: selector, operationFieldSelector: selector, resultSelector: selector, operationResultSelector: selector,
  expectedText: z.string().min(1).max(2000) }).strict().superRefine((value, ctx) => {
    const all = [...value.fields.map(field => field.selector), value.submitSelector, value.operationFieldSelector, value.resultSelector, value.operationResultSelector];
    if (new Set(all).size !== all.length || [value.submitUrl, value.lookupUrl].some(url => new URL(url).origin !== new URL(value.url).origin))
      ctx.addIssue({ code: 'custom', message: 'Selectors must be distinct and URLs must share one origin' });
  });
export type BrowserForm = z.infer<typeof browserFormSchema>;
