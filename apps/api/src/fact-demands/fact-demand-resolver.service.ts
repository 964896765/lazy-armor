import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  deviceAppConnections,
  deviceHeartbeats,
  trustedDevices,
  truthProvenance,
  truthRecords,
  truthRecordVersions,
} from '@lazy-armor/database';
import {
  buildFactDemandProjections,
  factDemandRequestForScenario,
  type FactTruthEvidence,
  type RealityLevel,
  type SourceCandidateEvidence,
} from '@lazy-armor/plan-schema';
import { deviceAppCatalogMetadata } from '@lazy-armor/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { ZodError } from 'zod';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { ReadinessEvidenceService } from '../runtime-catalog/readiness-evidence.service';
import type { ResolveFactDemandsDto } from './dto';

@Injectable()
export class FactDemandResolverService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly readiness: ReadinessEvidenceService,
  ) {}

  async resolve(userId: string, raw: ResolveFactDemandsDto) {
    try {
      const { request, contract } = factDemandRequestForScenario(raw);
      const [providerCandidates, deviceCandidates, truths] = await Promise.all([
        this.providerCandidates(userId, contract.factDemands.flatMap((demand) => demand.acceptedSourceCapabilities)),
        this.deviceCandidates(userId, contract.factDemands.flatMap((demand) => demand.acceptedSourceCapabilities)),
        this.truthEvidence(userId, request.subject.subjectKey),
      ]);
      const evaluatedAt = new Date().toISOString();
      return {
        scenario: contract.scenario,
        contractHash: contract.definitionHash,
        goal: request.goal,
        subject: request.subject,
        demands: buildFactDemandProjections({
          request,
          contract,
          sources: [...providerCandidates, ...deviceCandidates],
          truths,
          evaluatedAt,
        }),
        evaluatedAt,
      };
    } catch (error) {
      if (error instanceof ZodError) throw new BadRequestException({ message: 'Invalid FactDemand request', issues: error.issues });
      if (error instanceof Error && /Scenario Contract|Goal intent|ResourceSubject|immutable/.test(error.message)) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private async providerCandidates(userId: string, allowedCapabilities: readonly string[]): Promise<SourceCandidateEvidence[]> {
    const allowed = new Set(allowedCapabilities);
    const candidates = await this.readiness.projectCapabilityCandidates(userId);
    return candidates.filter((candidate) => allowed.has(candidate.capabilityKey)).map((candidate) => ({
      sourceId: `connection:${candidate.connectionId}:${candidate.capabilityKey}`,
      providerKey: candidate.providerKey,
      connectionId: candidate.connectionId,
      sourceMode: candidate.sourceModes[0] ?? 'OFFICIAL_API',
      capabilityKey: candidate.capabilityKey,
      discovered: candidate.dimensions.declared,
      ownedByUser: true,
      implemented: candidate.dimensions.implemented,
      authorized: candidate.dimensions.authorized,
      deviceOnline: true,
      healthy: candidate.dimensions.healthy,
      contractCompatible: true,
      estimatedLatencyMs: null,
      costClass: 'UNKNOWN',
      evidenceRefs: [`connection:${candidate.connectionId}`, `provider:${candidate.providerKey}`, `capability:${candidate.capabilityKey}`],
      reasonCodes: candidate.reasons,
    }));
  }

  private async deviceCandidates(userId: string, allowedCapabilities: readonly string[]): Promise<SourceCandidateEvidence[]> {
    const rows = await this.db.select({
      id: deviceAppConnections.id,
      packageName: deviceAppConnections.packageName,
      enabled: deviceAppConnections.enabled,
      launchable: deviceAppConnections.launchable,
      modes: deviceAppConnections.modesJson,
      trustedDeviceId: trustedDevices.id,
      deviceStatus: trustedDevices.status,
      revokedAt: trustedDevices.revokedAt,
      onlineState: deviceHeartbeats.onlineState,
      lastHeartbeatAt: deviceHeartbeats.lastHeartbeatAt,
    }).from(deviceAppConnections)
      .innerJoin(trustedDevices, and(eq(deviceAppConnections.trustedDeviceId, trustedDevices.id), eq(trustedDevices.userId, userId)))
      .leftJoin(deviceHeartbeats, and(eq(deviceHeartbeats.trustedDeviceId, trustedDevices.id), eq(deviceHeartbeats.userId, userId)))
      .where(and(eq(deviceAppConnections.userId, userId), isNull(trustedDevices.revokedAt)));
    const now = Date.now();
    const allowed = new Set(allowedCapabilities);
    return rows.map((row) => {
      const metadata = deviceAppCatalogMetadata(row.packageName);
      const capabilityKey = metadata.actionCapabilities.find((key) => allowed.has(key)) ?? null;
      const implemented = row.launchable === 1 && metadata.notificationReadable;
      const authorized = row.enabled === 1 && row.modes.includes('notification_read');
      const deviceOnline = row.onlineState === 'online' && Boolean(row.lastHeartbeatAt)
        && now - (row.lastHeartbeatAt?.getTime() ?? 0) <= 30_000;
      return {
        sourceId: `device-app:${row.id}`,
        providerKey: row.packageName,
        connectionId: null,
        sourceMode: 'NOTIFICATION',
        capabilityKey,
        discovered: true,
        ownedByUser: true,
        implemented,
        authorized,
        deviceOnline,
        healthy: row.deviceStatus === 'active',
        contractCompatible: capabilityKey !== null,
        estimatedLatencyMs: 5_000,
        costClass: 'FREE' as const,
        evidenceRefs: [`trusted-device:${row.trustedDeviceId}`, `device-app:${row.id}`, `package:${row.packageName}`],
        reasonCodes: [
          ...(!implemented ? ['DEVICE_SOURCE_NOT_IMPLEMENTED'] : []),
          ...(!authorized ? ['DEVICE_SOURCE_NOT_AUTHORIZED'] : []),
          ...(!deviceOnline ? ['DEVICE_OFFLINE'] : []),
        ],
      };
    });
  }

  private async truthEvidence(userId: string, subjectKey: string): Promise<FactTruthEvidence[]> {
    const rows = await this.db.select({
      truthRecordId: truthRecords.id,
      status: truthRecords.status,
      subjectKey: truthRecords.subjectKey,
      truthVersionId: truthRecordVersions.id,
      value: truthRecordVersions.valueJson,
      valueHash: truthRecordVersions.valueHash,
      createdAt: truthRecordVersions.createdAt,
      providerKey: truthProvenance.providerKey,
      sourceMode: truthProvenance.sourceMode,
      observedAt: truthProvenance.observedAt,
    }).from(truthRecords)
      .innerJoin(truthRecordVersions, eq(truthRecords.currentVersionId, truthRecordVersions.id))
      .leftJoin(truthProvenance, eq(truthProvenance.truthRecordVersionId, truthRecordVersions.id))
      .where(and(eq(truthRecords.userId, userId), eq(truthRecords.subjectKey, subjectKey), isNull(truthRecords.revokedAt)));
    return rows.flatMap((row) => {
      const factKey = typeof row.value.factKey === 'string' ? row.value.factKey : null;
      if (!factKey) return [];
      const reality = isRealityLevel(row.value.realityLevel) ? row.value.realityLevel : 'CLAIMED';
      return [{
        truthRecordId: row.truthRecordId,
        truthVersionId: row.truthVersionId,
        factKey,
        subjectKey: row.subjectKey,
        sourceProviderKey: row.providerKey ?? 'unknown',
        sourceMode: row.sourceMode ?? 'INTERNAL',
        valueHash: row.valueHash,
        realityLevel: reality,
        verified: row.status === 'verified',
        observedAt: (row.observedAt ?? row.createdAt).toISOString(),
        createdAt: row.createdAt.toISOString(),
        conflict: row.status === 'conflict',
      } satisfies FactTruthEvidence];
    });
  }
}

function isRealityLevel(value: unknown): value is RealityLevel {
  return value === 'CLAIMED' || value === 'OBSERVED' || value === 'CORROBORATED' || value === 'VERIFIED';
}
