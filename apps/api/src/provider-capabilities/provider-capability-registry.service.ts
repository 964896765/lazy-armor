import { Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ProviderCapabilityRegistry, type VersionedProviderCapabilityManifest } from '@lazy-armor/connector-sdk';
import { providerCapabilityEvidence, providerCapabilityManifests } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';

@Injectable()
export class ProviderCapabilityRegistryService implements OnModuleInit {
  private readonly registry = new ProviderCapabilityRegistry();

  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

  async onModuleInit() { await this.sync(); }
  list() { return this.registry.list(); }
  get(providerKey: string) { const manifest = this.registry.get(providerKey); if (!manifest) throw new NotFoundException('Provider capability manifest not found'); return manifest; }

  async sync() {
    for (const manifest of this.registry.list()) await this.syncManifest(manifest);
  }

  private async syncManifest(manifest: VersionedProviderCapabilityManifest) {
    const existingRevision = (await this.db.select({ id: providerCapabilityManifests.id, manifestHash: providerCapabilityManifests.manifestHash })
      .from(providerCapabilityManifests)
      .where(and(eq(providerCapabilityManifests.providerKey, manifest.providerKey), eq(providerCapabilityManifests.revision, manifest.revision)))
      .limit(1))[0];
    if (existingRevision) {
      if (existingRevision.manifestHash !== manifest.manifestHash) throw new Error(`Provider manifest revision is immutable: ${manifest.providerKey}@${manifest.revision}`);
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
