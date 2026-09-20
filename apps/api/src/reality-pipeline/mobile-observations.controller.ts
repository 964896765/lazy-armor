import { BadRequestException, Body, Controller, ForbiddenException, Headers, Post } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import { mobileCandidateKindForParser, resolveMobileCandidateSpec, type JsonValue, type MobileObservationEnvelope } from '@lazy-armor/plan-schema';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { TrustedDevicesService, type TrustedDeviceRequestEnvelope } from '../trusted-devices/trusted-devices.service';
import { CreateMobileObservationDto } from './mobile-observation.dto';
import { MobileObservationService } from './mobile-observation.service';

/**
 * Unified device-side reality entry point. Notification, Share and AppReadSession
 * all submit the same envelope here; it validates the trusted device + evidence,
 * then routes into the single RealityPipeline (Observation → Candidate → Truth).
 * It never returns Truth directly and never writes Truth without a candidate.
 */
@Controller('mobile-observations')
export class MobileObservationsController {
  constructor(
    private readonly mobileObservation: MobileObservationService,
    private readonly trustedDevices: TrustedDevicesService,
  ) {}

  @Post()
  async ingest(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateMobileObservationDto, @Headers() headers: IncomingHttpHeaders) {
    const signedDevice = await this.trustedDevices.assertSignedRequest(user.id, deviceEnvelope(headers), 'POST', '/mobile-observations', input);
    if (input.deviceId !== signedDevice.deviceId) {
      throw new ForbiddenException('Observation deviceId does not match the signed trusted device');
    }
    const result = await this.mobileObservation.ingest(user.id, toEnvelope(input, signedDevice.trustedDeviceId), input.packageName, null);
    return {
      observationId: result.observationId,
      candidateStatus: result.candidates[0]?.status ?? 'NONE',
      truthStatus: 'NONE',
    };
  }
}

function toEnvelope(input: CreateMobileObservationDto, trustedDeviceId: string): MobileObservationEnvelope {
  const candidateKind = mobileCandidateKindForParser(input.parserKey);
  if (!candidateKind) throw new BadRequestException(`Unknown parser key: ${input.parserKey}`);
  const spec = resolveMobileCandidateSpec(candidateKind);
  if (!spec) throw new BadRequestException(`Unsupported mobile candidate kind: ${candidateKind}`);
  return {
    sourceType: input.sourceMode,
    packageName: input.packageName,
    candidateKind,
    parserId: spec.parserId,
    resourceHint: spec.resourceHint,
    observedAt: input.observedAt,
    evidenceHash: input.evidenceHash,
    sourceRef: input.eventId,
    deviceId: trustedDeviceId,
    payload: input.payload as Record<string, JsonValue>,
  };
}

function deviceEnvelope(headers: IncomingHttpHeaders): TrustedDeviceRequestEnvelope {
  return {
    sessionId: header(headers, 'x-device-session'),
    requestId: header(headers, 'x-device-request-id'),
    signedAt: header(headers, 'x-device-signed-at'),
    payloadHash: header(headers, 'x-device-payload-hash'),
    signature: header(headers, 'x-device-signature'),
  };
}

function header(headers: IncomingHttpHeaders, name: string) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}
