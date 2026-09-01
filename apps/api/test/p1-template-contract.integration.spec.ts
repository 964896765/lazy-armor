import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { ApprovalPolicyDefinition, PlanDefinitionInput } from '@lazy-armor/plan-schema';
import request from 'supertest';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  resolvePlanTemplateManifest,
  type PlanTemplateManifest,
} from '../src/templates/template-registry';

interface Session {
  token: string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const NEVER_APPROVAL: ApprovalPolicyDefinition = { type: 'never', config: {} };
const R3_APPROVAL: ApprovalPolicyDefinition = { type: 'above_risk_level', config: { riskLevel: 'R3' } };

describe.sequential('P1 template contract integration', { timeout: 60000 }, () => {
  let app: INestApplication;
  let user: Session;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??= 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor_test';
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
    process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-longer-than-thirty-two-characters';
    process.env.CREDENTIAL_MASTER_KEY ??= Buffer.alloc(32, 12).toString('base64');
    process.env.CREDENTIAL_STORE_PATH ??= `.data/test-template-contract-${unique}`;
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    user = await register(`template-contract-${unique}@example.com`, '模板契约用户');
  });

  afterAll(async () => {
    await app?.close();
  });

  async function register(email: string, displayName: string): Promise<Session> {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'correct-horse-battery-staple', displayName })
      .expect(201);
    return { token: response.body.accessToken as string };
  }

  it('rejects a low-risk template that emits an R4 action', () => {
    expect(() => resolvePlanTemplateManifest(fakeTemplate({
      key: 'test-low-risk-r4',
      riskConstraint: { maxRiskLevel: 'R1', allowExternalSideEffect: true, allowedActionTypes: ['create_order'] },
      approvalPolicy: R3_APPROVAL,
      buildDefinition: () => definition({
        actions: [{ actionType: 'create_order', config: { currency: 'CNY' }, stepOrder: 0 }],
      }),
    }))).toThrow(/above max risk/i);
  });

  it('rejects templates that forbid external side effects but emit publish', () => {
    expect(() => resolvePlanTemplateManifest(fakeTemplate({
      key: 'test-no-side-effect-publish',
      riskConstraint: { maxRiskLevel: 'R3', allowExternalSideEffect: false, allowedActionTypes: ['publish'] },
      approvalPolicy: R3_APPROVAL,
      buildDefinition: () => definition({
        actions: [{ actionType: 'publish', config: { visibility: 'public' }, stepOrder: 0 }],
      }),
    }))).toThrow(/external side-effect/i);
  });

  it('rejects approval policies below the R3 system floor for publish actions', () => {
    expect(() => resolvePlanTemplateManifest(fakeTemplate({
      key: 'test-publish-never-approval',
      riskConstraint: { maxRiskLevel: 'R3', allowExternalSideEffect: true, allowedActionTypes: ['publish'] },
      approvalPolicy: NEVER_APPROVAL,
      buildDefinition: () => definition({
        actions: [{ actionType: 'publish', config: { visibility: 'public' }, stepOrder: 0 }],
      }),
    }))).toThrow(/below the system safety floor/i);
  });

  it('does not let client config lower action risk fields during template install', async () => {
    await request(app.getHttpServer())
      .post('/api/templates/monthly-bill-summary/install')
      .set(auth(user.token))
      .send({ config: { summaryDay: 3, riskLevel: 'R0' } })
      .expect(400);
  });

  it('keeps publish approval under server control even if client config asks to disable it', () => {
    const resolved = resolvePlanTemplateManifest(fakeTemplate({
      key: 'test-client-cannot-disable-publish-approval',
      configSchema: z.object({ requireApprovalBeforePublish: z.boolean().default(true) }).strict(),
      approvalPolicy: R3_APPROVAL,
      riskConstraint: { maxRiskLevel: 'R3', allowExternalSideEffect: true, allowedActionTypes: ['publish'] },
      buildDefinition: (config) => ({
        ...definition({
          actions: [{ actionType: 'publish', config: { visibility: 'public' }, stepOrder: 0 }],
        }),
        approvalPolicy: (config.requireApprovalBeforePublish === false ? NEVER_APPROVAL : R3_APPROVAL),
      }),
    }), { requireApprovalBeforePublish: false });

    expect(resolved.definition.approvalPolicy).toEqual(R3_APPROVAL);
  });
});

function fakeTemplate(overrides: Partial<PlanTemplateManifest>): PlanTemplateManifest {
  return {
    key: overrides.key ?? 'fake-template',
    templateVersion: '1',
    domain: 'general',
    group: '我的事情',
    name: 'Fake',
    description: 'Fake',
    icon: 'Fake',
    status: 'draft',
    automationLevel: 'L1',
    requiredConnectors: [],
    approvalPolicy: overrides.approvalPolicy ?? NEVER_APPROVAL,
    riskConstraint: overrides.riskConstraint ?? { maxRiskLevel: 'R1', allowExternalSideEffect: false, allowedActionTypes: ['summarize'] },
    notificationPolicy: overrides.notificationPolicy ?? {
      defaultMode: 'silent',
      allowedModes: ['silent', 'summary', 'important'],
      silentOnSuccess: true,
      notifyOnFailure: true,
      notifyOnNeedsAction: true,
    },
    details: overrides.details ?? {
      doesWhat: 'Fake',
      runsWhen: 'Fake',
      dataNeeded: 'Fake',
      remindsWhen: 'Fake',
      connectionSummary: 'Fake',
      riskSummary: 'Fake',
    },
    configFields: overrides.configFields ?? [],
    configSchema: overrides.configSchema ?? z.object({}).strict(),
    buildDefinition: overrides.buildDefinition ?? (() => definition()),
  };
}

function definition(overrides?: Partial<PlanDefinitionInput>): PlanDefinitionInput {
  return {
    name: 'Fake Plan',
    description: 'Fake Plan',
    domain: 'general',
    automationLevel: 'L1',
    sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }],
    triggers: [{ triggerType: 'manual', config: {}, sortOrder: 0 }],
    conditions: [],
    actions: [{ actionType: 'summarize', config: { format: 'short' }, stepOrder: 0 }],
    ...overrides,
  };
}
