import { BadRequestException, Injectable } from '@nestjs/common';
import {
  resolveMobileCandidateSpec,
  toSourceObservationInput,
  type MobileObservationEnvelope,
} from '@lazy-armor/plan-schema';
import { RealityPipelineService } from './reality-pipeline.service';

const SHA256 = /^[a-f0-9]{64}$/;
const ANDROID_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

/**
 * Single shared entry point for every mobile data source. It validates the
 * observation against the shared Mobile Candidate Registry, then routes it into
 * the generic Reality Pipeline. Mobile entry points never write Truth directly;
 * they only produce an Observation → Candidate.
 */
@Injectable()
export class MobileObservationService {
  constructor(private readonly pipeline: RealityPipelineService) {}

  async ingest(userId: string, envelope: MobileObservationEnvelope, providerKey: string, connectionId: string | null) {
    const spec = resolveMobileCandidateSpec(envelope.candidateKind);
    if (!spec) throw new BadRequestException(`Unsupported mobile candidate kind: ${envelope.candidateKind}`);
    if (envelope.parserId !== spec.parserId) throw new BadRequestException('Candidate kind is not registered with the supplied parser');
    if (envelope.resourceHint !== spec.resourceHint) throw new BadRequestException('Candidate kind is not registered with the supplied resource hint');
    if (!ANDROID_PACKAGE.test(envelope.packageName)) throw new BadRequestException('packageName must be an exact Android package');
    if (!SHA256.test(envelope.evidenceHash)) throw new BadRequestException('evidenceHash must be SHA-256');
    if (!envelope.sourceRef) throw new BadRequestException('sourceRef is required');
    return this.pipeline.ingest(userId, toSourceObservationInput(envelope, providerKey, connectionId));
  }
}
