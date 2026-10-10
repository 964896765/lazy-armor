import { describe, expect, it } from 'vitest';
import { browserFormSchema, normalizePlanDefinition } from '../src/index';
const form = { url: 'https://forms.example.test/', submitUrl: 'https://forms.example.test/submit', lookupUrl: 'https://forms.example.test/lookup',
  fields: [{ selector: '#message', value: 'User confirmed value' }], submitSelector: '#submit', operationFieldSelector: '#request',
  resultSelector: '#result', operationResultSelector: '#operation', expectedText: 'Saved' };
const plan = { name: 'Scoped browser', domain: 'general', automationLevel: 'L2', sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }],
  triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }], conditions: [], actions: [{ actionType: 'publish',
    connectionId: '00000000-0000-4000-8000-000000000001', requiredCapability: 'BROWSER_SUBMIT_FORM', config: { visibility: 'private', browser: form }, stepOrder: 0 }] };
describe('Frozen browser form contract', () => {
  it('rejects cross-origin writes, broad selectors, duplicate fields and executable content', () => {
    for (const input of [{ ...form, submitUrl: 'https://other.example.test/submit' }, { ...form, submitSelector: 'button' },
      { ...form, fields: [...form.fields, form.fields[0]] }, { ...form, script: 'fetch(secret)' }]) expect(browserFormSchema.safeParse(input).success).toBe(false);
  });
  it('keeps the existing R3 publish risk and requires dedicated capability and exclusive scope', () => {
    expect(normalizePlanDefinition(plan).actions[0].riskLevel).toBe('R3');
    for (const action of [{ ...plan.actions[0], requiredCapability: 'WRITE_INTERNAL' }, { ...plan.actions[0], connectionId: undefined },
      { ...plan.actions[0], config: { ...plan.actions[0].config, visibility: 'public' } }]) expect(() => normalizePlanDefinition({ ...plan, actions: [action] })).toThrow();
  });
});
