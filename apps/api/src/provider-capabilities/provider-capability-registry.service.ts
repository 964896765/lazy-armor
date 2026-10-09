import { Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ProviderCapabilityRegistry, type ProviderCapabilityManifest, type VersionedProviderCapabilityManifest } from '@lazy-armor/connector-sdk';
import { providerCapabilityEvidence, providerCapabilityManifests } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { dingtalkManifest } from '../providers/dingtalk/dingtalk-manifest';
import { feishuManifest } from '../providers/feishu/feishu-manifest';
import { wecomManifest } from '../providers/wecom/wecom-manifest';
import { publicJsonManifest } from '../connectors/public-json.manifest';

@Injectable()
export class ProviderCapabilityRegistryService implements OnModuleInit {
  private readonly registry = new ProviderCapabilityRegistry();

  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

  async onModuleInit() {
    this.installRevision(publicJsonManifest);
    this.installRevision(feishuManifest);
    this.installRevision(dingtalkManifest);
    this.installRevision(wecomManifest);

    await this.sync();

    const active = await this.db
      .select()
      .from(providerCapabilityManifests)
      .where(eq(providerCapabilityManifests.status, 'ACTIVE'));

    for (const row of active) {
      this.installRevision(
        row.manifestJson as unknown as ProviderCapabilityManifest,
      );
    }
  }
  installRevision(manifest: ProviderCapabilityManifest) { return this.registry.register(manifest); }
  list() { return this.registry.list(); }
  get(providerKey: string) { const manifest = this.registry.get(providerKey); if (!manifest) throw new NotFoundException('Provider capability manifest not found'); return manifest; }

  async sync() {
    for (const manifest of this.registry.list()) await this.syncManifest(manifest);
  }

  private async syncManifest(manifest: VersionedProviderCapabilityManifest) {
    // Several deployed roles register the same immutable revision on startup.
    // Retry only rolled-back metadata races, then re-read and enforce its hash.
    for (let attempt = 0; ; attempt++) {
      try { return await this.persistManifest(manifest); }
      catch (error) {
        const code = databaseErrorCode(error);
        if (attempt >= 3 || !['ER_LOCK_DEADLOCK', 'ER_DUP_ENTRY'].includes(code ?? '')) throw error;
        await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
  }

  private async persistManifest(manifest: VersionedProviderCapabilityManifest) {
    const existingRevision = (await this.db
      .select({
        id: providerCapabilityManifests.id,
        revision: providerCapabilityManifests.revision,
        manifestHash: providerCapabilityManifests.manifestHash,
        status: providerCapabilityManifests.status,
      })
      .from(providerCapabilityManifests)
      .where(
        and(
          eq(providerCapabilityManifests.providerKey, manifest.providerKey),
          eq(providerCapabilityManifests.revision, manifest.revision),
        ),
      )
      .limit(1))[0];

    if (existingRevision) {
      if (existingRevision.manifestHash !== manifest.manifestHash) {
        throw new Error(
          `Provider manifest revision is immutable: ${manifest.providerKey}@${manifest.revision}`,
        );
      }

      if (existingRevision.status === 'ACTIVE') {
        return;
      }

      const activeRevision = (await this.db
        .select({
          id: providerCapabilityManifests.id,
          revision: providerCapabilityManifests.revision,
        })
        .from(providerCapabilityManifests)
        .where(
          and(
            eq(providerCapabilityManifests.providerKey, manifest.providerKey),
            eq(providerCapabilityManifests.status, 'ACTIVE'),
          ),
        )
        .limit(1))[0];

      if (activeRevision && activeRevision.revision > manifest.revision) {
        return;
      }

      const now = new Date();

      await this.db.transaction(async (tx) => {
        await tx
          .update(providerCapabilityManifests)
          .set({
            status: 'SUPERSEDED',
            supersededAt: now,
          })
          .where(
            and(
              eq(providerCapabilityManifests.providerKey, manifest.providerKey),
              eq(providerCapabilityManifests.status, 'ACTIVE'),
            ),
          );

        await tx
          .update(providerCapabilityManifests)
          .set({
            status: 'ACTIVE',
            supersededAt: null,
          })
          .where(eq(providerCapabilityManifests.id, existingRevision.id));
      });

      return;
    }
    const now = new Date();
    const manifestId = newId();
    await this.db.transaction(async (tx) => {
      await tx.update(providerCapabilityManifests).set({ status: 'SUPERSEDED', supersededAt: now })
        .where(and(eq(providerCapabilityManifests.providerKey, manifest.providerKey), eq(providerCapabilityManifests.status, 'ACTIVE')));
      await tx.insert(providerCapabilityManifests).values({
        id: manifestId,
        providerKey: manifest.providerKey,
        schemaVersion: manifest.schemaVersion,
        revision: manifest.revision,
        manifestHash: manifest.manifestHash,
        status: 'ACTIVE',
        manifestJson: manifest as unknown as Record<string, unknown>,
        supersededAt: null,
        createdAt: now,
      });
      for (const evidence of manifest.evidence) await tx.insert(providerCapabilityEvidence).values({
        id: newId(), manifestId, capabilityKey: null, evidenceKind: evidence.kind, reviewStatus: evidence.status,
        uri: evidence.uri ?? null, summary: evidence.summary, verifiedAt: evidence.verifiedAt ? new Date(evidence.verifiedAt) : null,
        lastCheckedAt: evidence.verifiedAt ? new Date(evidence.verifiedAt) : null, createdAt: now,
      });
      for (const capability of manifest.capabilities) for (const evidence of capability.evidence) await tx.insert(providerCapabilityEvidence).values({
        id: newId(), manifestId, capabilityKey: capability.key, evidenceKind: evidence.kind, reviewStatus: evidence.status,
        uri: evidence.uri ?? null, summary: evidence.summary, verifiedAt: evidence.verifiedAt ? new Date(evidence.verifiedAt) : null,
        lastCheckedAt: evidence.verifiedAt ? new Date(evidence.verifiedAt) : null, createdAt: now,
      });
    });
  }
}

function databaseErrorCode(error: unknown): string | undefined {
  for (let depth = 0; depth < 4 && error && typeof error === 'object'; depth++) {
    const current = error as { code?: string; cause?: unknown };
    if (current.code) return current.code;
    error = current.cause;
  }
  return undefined;
}
