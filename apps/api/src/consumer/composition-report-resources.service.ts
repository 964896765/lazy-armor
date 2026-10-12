import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { compositionReadBindingsSchema, compositionResourceOptionsSchema, reportReadCapabilitySchema,
  type CompositionReadBinding, type CompositionResourceSelection, type CompositionPreview } from '@lazy-armor/plan-schema';
import { CompositionPreviewService } from './composition-preview.service';
import { GoalResourceMatchService } from './goal-resource-match.service';
import { ConnectionsService } from '../connections/connections.service';
import type { InjectedDatabase } from '../common/database.module';

type Transaction = Parameters<Parameters<InjectedDatabase['transaction']>[0]>[0];

/** Pins already granted public reads. It cannot grant consent, switch sources or bind side effects. */
@Injectable()
export class CompositionReportResourcesService {
  constructor(private readonly preview: CompositionPreviewService, private readonly resources: GoalResourceMatchService,
    private readonly connections: ConnectionsService) {}

  async options(userId: string, conversationId: string) {
    const options = await this.preview.options(userId, conversationId);
    if (options.goal?.outcomeKind !== 'REPORT') throw new BadRequestException('COMPOSITION_REPORT_ADAPTER_UNSUPPORTED');
    const matched = await this.resources.forMethods(userId, conversationId, options.conversationVersion);
    return compositionResourceOptionsSchema.parse({ conversationId, conversationVersion: options.conversationVersion, executionAuthorized: false,
      requirements: matched.methods.flatMap(method => method.requirements.map(requirement => {
        const key = reportReadCapabilitySchema.safeParse(requirement.key);
        if (!key.success) throw new BadRequestException('COMPOSITION_REPORT_ADAPTER_UNSUPPORTED');
        return { methodId: method.ref.entryId, capabilityKey: key.data, candidates: requirement.resources.filter(resource =>
          resource.state === 'READY' && resource.operation === 'read' && resource.resourceId.startsWith('connection:'))
          .map(resource => ({ connectionId: resource.resourceId.slice(11), name: resource.name })).slice(0, 20) };
      })) });
  }

  async bind(userId: string, graph: CompositionPreview, selections: CompositionResourceSelection[]): Promise<CompositionReadBinding[]> {
    const requirements = graph.nodes.filter(node => node.kind === 'RESOURCE_REQUIREMENT');
    if (selections.some(selection => !requirements.some(node => node.methodId === selection.methodId && node.capability === selection.capabilityKey)))
      throw new BadRequestException('COMPOSITION_RESOURCE_SELECTION_INVALID');
    const chosen = requirements.map(node => {
      const capability = reportReadCapabilitySchema.safeParse(node.capability);
      if (!capability.success) throw new BadRequestException('COMPOSITION_REPORT_ADAPTER_UNSUPPORTED');
      const candidates = node.candidateIds.filter(id => id.startsWith('connection:')).map(id => id.slice(11));
      const explicit = selections.find(selection => selection.methodId === node.methodId && selection.capabilityKey === capability.data);
      if (!explicit && candidates.length !== 1) throw new ConflictException('COMPOSITION_RESOURCE_SELECTION_REQUIRED');
      const connectionId = explicit?.connectionId ?? candidates[0];
      if (!candidates.includes(connectionId)) throw new ConflictException('COMPOSITION_RESOURCE_SELECTION_UNAVAILABLE');
      return { methodId: node.methodId, capabilityKey: capability.data, connectionId };
    });
    if (new Set(chosen.map(binding => binding.connectionId)).size > 3) throw new BadRequestException('COMPOSITION_REPORT_SOURCE_LIMIT');
    const authorities = new Map<string, { authorityHash: string; observedAt: string }>();
    for (const binding of chosen) {
      const key = `${binding.connectionId}:${binding.capabilityKey}`;
      if (authorities.has(key)) continue;
      try {
        const source = await this.connections.captureConsumerReadAuthority(userId, binding.connectionId, binding.capabilityKey);
        authorities.set(key, { authorityHash: source.authorityHash, observedAt: new Date().toISOString() });
      } catch { throw new ConflictException('COMPOSITION_RESOURCE_AUTHORITY_CHANGED'); }
    }
    return compositionReadBindingsSchema.parse(chosen.map(binding => ({ ...binding, ...authorities.get(`${binding.connectionId}:${binding.capabilityKey}`)! })));
  }

  async assertCurrent(userId: string, bindings: CompositionReadBinding[], transaction?: Transaction) {
    // All reports lock shared connections in the same order, regardless of method topology.
    const sources = [...new Map(bindings.map(binding => [`${binding.connectionId}:${binding.capabilityKey}`, binding])).values()]
      .sort((a, b) => `${a.connectionId}:${a.capabilityKey}`.localeCompare(`${b.connectionId}:${b.capabilityKey}`));
    for (const binding of sources) {
      try { await this.connections.assertConsumerReadAuthority({ userId, ...binding }, transaction); }
      catch { throw new ConflictException('COMPOSITION_RESOURCE_AUTHORITY_CHANGED'); }
    }
  }
}
