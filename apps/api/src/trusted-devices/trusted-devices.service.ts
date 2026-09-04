import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, verify } from 'node:crypto';
import { deviceAppConnections, trustedDeviceChallenges, trustedDevices } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import type { CreateTrustedDeviceChallengeDto, VerifyTrustedDeviceChallengeDto } from './dto';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const TRUST_LEVEL = 'key_proven';

@Injectable()
export class TrustedDevicesService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly audit: AuditService) {}

  async list(userId: string) {
    const rows = await this.db.select().from(trustedDevices).where(eq(trustedDevices.userId, userId)).orderBy(desc(trustedDevices.updatedAt));
    return rows.map((row) => this.toResponse(row));
  }

  async issueChallenge(userId: string, input: CreateTrustedDeviceChallengeDto) {
    const suppliedFingerprint = sha256Base64(input.publicKeySpki);
    if (suppliedFingerprint !== input.publicKeyFingerprint) throw new ForbiddenException('Device public key fingerprint mismatch');
    const now = new Date();
    const id = newId();
    const nonce = randomBytes(32).toString('hex');
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
    await this.db.insert(trustedDeviceChallenges).values({
      id, userId, deviceId: input.deviceId.trim(), keyId: input.keyId.trim(), publicKeySpki: input.publicKeySpki,
      publicKeyFingerprint: input.publicKeyFingerprint, nonce, expiresAt, consumedAt: null, createdAt: now,
    });
    await this.audit.append({
      actorType: 'user', actorUserId: userId, action: 'TRUSTED_DEVICE_CHALLENGE_ISSUED', resourceType: 'trusted_device_challenge', resourceId: id,
      userId, correlationId: id, changeSummary: 'Issued a short-lived device key proof challenge', source: 'api', result: 'success',
    });
    return { challengeId: id, nonce, expiresAt: expiresAt.toISOString(), payload: challengePayload(id, nonce, expiresAt, input.publicKeyFingerprint) };
  }

  async verifyChallenge(userId: string, id: string, input: VerifyTrustedDeviceChallengeDto) {
    const now = new Date();
    const rows = await this.db.select().from(trustedDeviceChallenges)
      .where(and(eq(trustedDeviceChallenges.id, id), eq(trustedDeviceChallenges.userId, userId), isNull(trustedDeviceChallenges.consumedAt), gt(trustedDeviceChallenges.expiresAt, now))).limit(1);
    const challenge = rows[0];
    if (!challenge) throw new ConflictException('Trusted device challenge is missing, expired, or already used');
    const valid = verify('sha256', Buffer.from(challengePayload(challenge.id, challenge.nonce, challenge.expiresAt, challenge.publicKeyFingerprint), 'utf8'), {
      key: Buffer.from(challenge.publicKeySpki, 'base64'), format: 'der', type: 'spki', dsaEncoding: 'der',
    }, Buffer.from(input.signature, 'base64'));
    if (!valid) {
      await this.audit.append({ actorType: 'user', actorUserId: userId, action: 'TRUSTED_DEVICE_PROOF_REJECTED', resourceType: 'trusted_device_challenge', resourceId: id, userId, correlationId: id, reasonCode: 'INVALID_SIGNATURE', changeSummary: 'Rejected an invalid device key proof', source: 'api', result: 'blocked' });
      throw new ForbiddenException('Device key proof is invalid');
    }

    await this.db.update(trustedDeviceChallenges).set({ consumedAt: now }).where(eq(trustedDeviceChallenges.id, id));
    const existing = (await this.db.select().from(trustedDevices).where(and(eq(trustedDevices.userId, userId), eq(trustedDevices.deviceId, challenge.deviceId))).limit(1))[0];
    let trustedDeviceId: string;
    if (existing) {
      if (existing.status === 'active' && existing.publicKeyFingerprint !== challenge.publicKeyFingerprint) {
        throw new ConflictException('A different active key already controls this device identity; revoke it before enrolling a replacement key');
      }
      trustedDeviceId = existing.id;
      await this.db.update(trustedDevices).set({
        keyId: challenge.keyId, publicKeySpki: challenge.publicKeySpki, publicKeyFingerprint: challenge.publicKeyFingerprint,
        trustLevel: TRUST_LEVEL, status: 'active', lastProvedAt: now, revokedAt: null, updatedAt: now,
      }).where(eq(trustedDevices.id, trustedDeviceId));
    } else {
      trustedDeviceId = newId();
      await this.db.insert(trustedDevices).values({
        id: trustedDeviceId, userId, deviceId: challenge.deviceId, keyId: challenge.keyId, publicKeySpki: challenge.publicKeySpki,
        publicKeyFingerprint: challenge.publicKeyFingerprint, trustLevel: TRUST_LEVEL, status: 'active', lastProvedAt: now, revokedAt: null, createdAt: now, updatedAt: now,
      });
    }
    await this.audit.append({
      actorType: 'user', actorUserId: userId, action: 'TRUSTED_DEVICE_PROOF_VERIFIED', resourceType: 'trusted_device', resourceId: trustedDeviceId,
      userId, correlationId: id, changeSummary: 'Verified a device-owned signing key and activated trusted device access', source: 'api', result: 'success',
    });
    return this.get(userId, trustedDeviceId);
  }

  async revoke(userId: string, id: string) {
    const current = await this.getRow(userId, id);
    if (current.status === 'revoked') return this.toResponse(current);
    const now = new Date();
    await this.db.update(trustedDevices).set({ status: 'revoked', revokedAt: now, updatedAt: now }).where(and(eq(trustedDevices.id, id), eq(trustedDevices.userId, userId)));
    await this.db.update(deviceAppConnections).set({ enabled: 0, modesJson: ['open_app'], updatedAt: now })
      .where(and(eq(deviceAppConnections.userId, userId), eq(deviceAppConnections.trustedDeviceId, id)));
    await this.audit.append({
      actorType: 'user', actorUserId: userId, action: 'TRUSTED_DEVICE_REVOKED', resourceType: 'trusted_device', resourceId: id,
      userId, correlationId: id, changeSummary: 'Revoked trusted device proof and disabled bound device app connections', source: 'api', result: 'success',
    });
    return this.get(userId, id);
  }

  async assertActive(userId: string, trustedDeviceId: string, deviceId: string) {
    const row = await this.getRow(userId, trustedDeviceId);
    if (row.status !== 'active' || row.trustLevel !== TRUST_LEVEL || row.deviceId !== deviceId) throw new ForbiddenException('Device is not currently trusted for this connection');
    return row;
  }

  private async get(userId: string, id: string) { return this.toResponse(await this.getRow(userId, id)); }

  private async getRow(userId: string, id: string) {
    const rows = await this.db.select().from(trustedDevices).where(and(eq(trustedDevices.id, id), eq(trustedDevices.userId, userId))).limit(1);
    if (!rows[0]) throw new NotFoundException('Trusted device not found');
    return rows[0];
  }

  private toResponse(row: typeof trustedDevices.$inferSelect) {
    return { id: row.id, deviceId: row.deviceId, keyId: row.keyId, publicKeyFingerprint: row.publicKeyFingerprint, trustLevel: row.trustLevel, status: row.status, lastProvedAt: row.lastProvedAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString() };
  }
}

function challengePayload(challengeId: string, nonce: string, expiresAt: Date, fingerprint: string) {
  return `lazy-armor-device-proof-v1|${challengeId}|${nonce}|${expiresAt.toISOString()}|${fingerprint}`;
}

function sha256Base64(value: string) {
  return createHash('sha256').update(Buffer.from(value, 'base64')).digest('hex');
}
