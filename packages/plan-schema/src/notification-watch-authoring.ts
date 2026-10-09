import { z } from 'zod';
import { compileScenarioPlan } from './scenario-plan-compiler';
import { normalizePlanDefinition } from './index';
import { catalogHash, scenarioByKey } from './runtime-catalog';

/** A confirmed source scope, never a fabricated shipment identity or permission. */
export const notificationWatchAuthoringSchema = z.object({
  recipeKey: z.literal('notification.shipment-watch.v1'),
  sourcePackage: z.literal('com.jingdong.app.mall'),
  connectionId: z.string().uuid(),
  trustedDeviceId: z.string().uuid(),
  lookbackHours: z.number().int().min(1).max(168),
  notificationPolicy: z.literal('EXCEPTION_ONLY'),
}).strict();
export type NotificationWatchAuthoring = z.infer<typeof notificationWatchAuthoringSchema>;
export const NOTIFICATION_WATCH_RECIPE = Object.freeze({ key: 'notification.shipment-watch.v1', scenarioKey: 'daily_life.delivery', scenarioRevision: 2, strategy: 'SILENT_FOLLOW_UP' as const, goalIntent: 'NOTIFY_ON_DELIVERY_EXCEPTION', requiredCapabilities: ['app.notification.read'] });

export function compileNotificationWatchAuthoring(scenarioKey: string | null, input: unknown, name: string) {
  const recipe = NOTIFICATION_WATCH_RECIPE, scenario = scenarioKey ? scenarioByKey(scenarioKey) : null;
  if (!scenario || scenario.key !== recipe.scenarioKey || scenario.revision !== recipe.scenarioRevision) throw new Error('Notification watch requires its registered Recipe');
  const parameters = notificationWatchAuthoringSchema.parse(input);
  const base = compileScenarioPlan({ scenarioKey: recipe.scenarioKey, scenarioRevision: recipe.scenarioRevision, strategy: recipe.strategy, name: name.length > 120 ? '京东物流异常提醒' : name, mode: 'DRAFT' });
  const definition = normalizePlanDefinition({ ...base.definitionInput,
    description: '每5分钟检查已授权的京东通知线索；核实为物流异常后提供站内提醒。',
    automationLevel: 'L1', approvalPolicy: { type: 'never' },
    // Existing executor uses this local context adapter after server-side Truth
    // hydration. The frozen source contract, not this legacy slot, owns reads.
    sources: [{ sourceType: 'manual', config: {}, sortOrder: 0 }],
    conditions: [],
    actions: [
      { actionType: 'summarize', config: { domain: 'logistics', notifyOnDelivered: false, notifyOnException: true }, stepOrder: 0 },
      { actionType: 'notify', config: { channel: 'in_app', priority: 'P1', eventType: 'logistics_exception', templateKey: recipe.key }, stepOrder: 1 },
      { actionType: 'record', config: { recordType: recipe.key }, stepOrder: 2 },
    ],
  });
  const { runtimeHash: _oldHash, ...runtimeBase } = base.runtime;
  const runtimeContent = { ...runtimeBase, attentionPolicy: 'ON_EXCEPTION' as const,
    conditionAst: { kind: 'PREDICATE' as const, operator: 'EQ' as const, factKey: 'shipment.status', comparisonValue: 'exception' },
    dependencies: [{ factKey: 'shipment.status', resourceType: 'shipment', field: 'status', scope: 'RESOURCE_WIDE' as const, subjectKey: null }],
  };
  const runtime = { ...runtimeContent, runtimeHash: catalogHash(runtimeContent) };
  return { parameters, definition, runtime, scenarioKey: recipe.scenarioKey, scenarioRevision: recipe.scenarioRevision, strategy: recipe.strategy,
    requiredFacts: ['shipment.status'], requiredCapabilities: [...recipe.requiredCapabilities],
    goal: { intent: recipe.goalIntent, description: name.slice(0, 500), constraints: { recipeKey: recipe.key, notificationWatchJson: JSON.stringify(parameters) } },
    // This subject represents the selected observation scope, not a parcel.
    subject: { resourceType: 'shipment', subjectKey: 'notification-source:' + parameters.connectionId, displayName: '京东通知线索' },
  };
}
