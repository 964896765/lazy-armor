import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { request } from 'node:https';
import { canonicalStringify, skillRepositoryImportSchema } from '@lazy-armor/plan-schema';
import { publicJsonUrl } from '../connectors/public-json.connector';
import { resolvePublicHost } from '../common/public-host';
import { SkillRepositoriesService } from './skill-repositories.service';

export function skillSourceUrl(raw: string) {
  let url: URL;
  try { url = publicJsonUrl(raw); } catch { throw new BadRequestException('Use a public HTTPS method package URL'); }
  const github = ['github.com', 'raw.githubusercontent.com'].includes(url.hostname);
  if (!github) return { fetchUrl: url, sourceUrl: url.href, sourceType: 'COMMUNITY' as const };
  const parts = url.pathname.split('/').filter(Boolean);
  if (url.hostname === 'github.com') {
    if (parts[2] !== 'blob') throw new BadRequestException('Use a versioned GitHub JSON file URL');
    parts.splice(2, 1);
  }
  if (parts.length < 4 || !/^[\w.-]+$/.test(parts[0]) || !/^[\w.-]+$/.test(parts[1]) ||
      !/^[a-f0-9]{40}$/i.test(parts[2]) || parts.slice(3).some(part => !/^[\w.-]+$/.test(part)) ||
      !parts.at(-1)!.endsWith('.json')) throw new BadRequestException('GitHub imports require an exact commit and JSON file');
  return { fetchUrl: new URL('https://raw.githubusercontent.com/' + parts.join('/')),
    sourceUrl: `https://github.com/${parts[0]}/${parts[1]}/blob/${parts.slice(2).join('/')}`, sourceType: 'GITHUB' as const };
}

/** Public HTTPS only, checked DNS pinned to the TLS request; no redirects or cookies. */
@Injectable()
export class SkillPackageFetcher {
  async fetch(url: URL): Promise<unknown> {
    const addresses = await resolvePublicHost(url.hostname);
    const pinned = addresses[0];
    return new Promise((resolve, reject) => {
      const req = request(url, { method: 'GET', agent: false, family: pinned.family,
        lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
        headers: { accept: 'application/json', 'accept-encoding': 'identity' } }, response => {
        if (response.statusCode !== 200 || !/^(application\/json|text\/plain)(;|$)/i.test(response.headers['content-type'] ?? '')) {
          response.destroy(); reject(new BadRequestException('Source must return a JSON package directly')); return;
        }
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 120000) { response.destroy(); reject(new BadRequestException('Method package exceeds 120 KB')); }
          else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch { reject(new BadRequestException('Invalid JSON package')); } });
      });
      const deadline = setTimeout(() => req.destroy(new Error('SOURCE_TIMEOUT')), 8000);
      req.on('close', () => clearTimeout(deadline)); req.on('error', reject); req.end();
    });
  }
}

@Injectable()
export class SkillSourceService {
  constructor(private readonly fetcher: SkillPackageFetcher, private readonly repositories: SkillRepositoriesService) {}
  async preview(raw: string) {
    const source = skillSourceUrl(raw);
    let value: unknown;
    try { value = await this.fetcher.fetch(source.fetchUrl); }
    catch (error) { if (error instanceof BadRequestException) throw error; throw new BadRequestException('Method source could not be read'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Invalid method package');
    // The remote file cannot select its import identity or pretend to be official.
    const { requestId: _request, sourceType: _source, sourceUrl: _url, ...content } = value as Record<string, unknown>;
    const parsed = skillRepositoryImportSchema.safeParse({ ...content, requestId: 'source-preview', sourceType: source.sourceType, sourceUrl: source.sourceUrl });
    if (!parsed.success || Buffer.byteLength(JSON.stringify(value), 'utf8') > 120000) throw new BadRequestException('Invalid or oversized method package');
    const { requestId: _id, ...pack } = parsed.data;
    const contentHash = createHash('sha256').update(canonicalStringify(pack)).digest('hex');
    return { package: pack, contentHash, sourceUrl: source.sourceUrl, executionAuthorized: false as const };
  }
  async import(userId: string, input: { url: string; requestId: string; contentHash: string }) {
    const preview = await this.preview(input.url);
    if (preview.contentHash !== input.contentHash) throw new ConflictException('SKILL_SOURCE_CHANGED');
    return this.repositories.import(userId, { ...preview.package, requestId: input.requestId });
  }
}
