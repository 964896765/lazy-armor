import { createHash } from 'node:crypto';

/**
 * R7 Portable Skill contract.
 *
 * A Portable Skill is only a versioned SKILL.md guidance package. It never
 * replaces Scenario/Strategy/Template/Plan/Capability and never stores runtime
 * state (tokens, truth, connection or execution status). Its frontmatter
 * declarations are metadata + guidance — final permission is always decided by
 * the existing Capability/Risk/Execution chain, never by the SKILL.md itself.
 */

export type SkillAudience = 'DEVELOPER' | 'RUNTIME_AGENT';

export interface SkillDescriptor {
  schemaVersion: '1';
  name: string;
  version: string;
  description: string;
  purpose: string;
  inputs: string[];
  preconditions: string[];
  allowedContext: string[];
  allowedCapabilities: string[];
  allowedTools: string[];
  forbiddenActions: string[];
  outputContract: string;
  failureModes: string[];
  skillAudience: SkillAudience;
  bodyMarkdown: string;
  contentHash: string;
}

export const FORBIDDEN_AGENT_ACTIONS: readonly string[] = [
  'EXECUTE', 'APPROVE', 'PAY', 'DELETE', 'PUBLISH', 'TRANSFER_MONEY',
  'execute_now', 'approve_execution', 'pay', 'transfer', 'delete_resource',
  'send_arbitrary_message', 'publish', 'get_credentials', 'get_secret', 'get_token',
  'get_raw_password', 'get_raw_cookie', 'get_raw_private_evidence', 'get_raw_screenshot',
];

function normalizeList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function splitFrontmatter(markdown: string): { frontmatter: Record<string, string>; body: string } | null {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) return null;
  const raw = lines.slice(1, end);
  const frontmatter: Record<string, string> = {};
  let currentKey: string | null = null;
  let listItems: string[] = [];
  const flush = () => {
    if (currentKey) frontmatter[currentKey] = listItems.join(',');
    currentKey = null;
    listItems = [];
  };
  for (const line of raw) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (match) {
      flush();
      currentKey = match[1];
      const value = match[2].trim();
      if (value.startsWith('[') && value.endsWith(']')) {
        frontmatter[currentKey] = value.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean).join(',');
        currentKey = null;
      } else if (value) {
        frontmatter[currentKey] = value;
        currentKey = null;
      }
      continue;
    }
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && currentKey) {
      listItems.push(item[1].trim());
      continue;
    }
    if (!line.trim()) continue;
    if (currentKey) listItems.push(line.trim());
  }
  flush();
  return { frontmatter, body: lines.slice(end + 1).join('\n').trim() };
}

function requireKey(frontmatter: Record<string, string>, key: string, errors: string[]): string {
  const value = (frontmatter[key] ?? '').trim();
  if (!value) errors.push(`SKILL.md frontmatter requires "${key}"`);
  return value;
}

export function parseSkillMarkdown(markdown: string): { descriptor?: SkillDescriptor; errors: string[] } {
  const errors: string[] = [];
  const parsed = splitFrontmatter(markdown);
  if (!parsed) {
    return { errors: ['SKILL.md must start with a YAML frontmatter block delimited by ---'] };
  }
  const frontmatter = parsed.frontmatter;
  const name = requireKey(frontmatter, 'name', errors);
  const version = requireKey(frontmatter, 'version', errors);
  const description = requireKey(frontmatter, 'description', errors);
  const purpose = requireKey(frontmatter, 'purpose', errors);
  const outputContract = requireKey(frontmatter, 'output_contract', errors);
  if (!/^[A-Z][A-Z0-9_]{1,79}$/.test(name)) errors.push('name must match ^[A-Z][A-Z0-9_]{1,79}$');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) errors.push('version must be semver');
  const allowedContext = normalizeList(frontmatter.allowed_context ?? '');
  const allowedCapabilities = normalizeList(frontmatter.allowed_capabilities ?? '');
  const allowedTools = normalizeList(frontmatter.allowed_tools ?? '');
  const forbiddenActions = normalizeList(frontmatter.forbidden_actions ?? '');
  for (const action of forbiddenActions) {
    if (FORBIDDEN_AGENT_ACTIONS.includes(action)) continue;
    // Unknown forbidden actions are still accepted but never silently dropped.
  }
  const audience = frontmatter.skill_audience?.trim() as SkillAudience | undefined;
  if (audience && !['DEVELOPER', 'RUNTIME_AGENT'].includes(audience)) errors.push('skill_audience must be DEVELOPER or RUNTIME_AGENT');

  if (errors.length) return { errors };

  const descriptor: SkillDescriptor = {
    schemaVersion: '1',
    name,
    version,
    description,
    purpose,
    inputs: normalizeList(frontmatter.inputs ?? ''),
    preconditions: normalizeList(frontmatter.preconditions ?? ''),
    allowedContext,
    allowedCapabilities,
    allowedTools,
    forbiddenActions,
    outputContract,
    failureModes: normalizeList(frontmatter.failure_modes ?? ''),
    skillAudience: audience ?? 'RUNTIME_AGENT',
    bodyMarkdown: parsed.body,
    contentHash: createHash('sha256').update(`${frontmatter.name}@${frontmatter.version}\n${parsed.body}`).digest('hex'),
  };
  return { descriptor, errors: [] };
}

/**
 * A SKILL.md declaration is never final permission. This validates a skill's
 * declared references against the trusted allowlists actually available to the
 * runtime. Unknown or forbidden references fail closed.
 */
export function assertSkillReferencesAllowed(
  descriptor: SkillDescriptor,
  allowedCapabilities: ReadonlySet<string>,
  allowedTools: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  for (const capability of descriptor.allowedCapabilities) {
    if (!allowedCapabilities.has(capability)) errors.push(`Skill ${descriptor.name} references unknown capability ${capability}`);
  }
  for (const tool of descriptor.allowedTools) {
    if (!allowedTools.has(tool)) errors.push(`Skill ${descriptor.name} references forbidden/unknown tool ${tool}`);
  }
  for (const action of descriptor.forbiddenActions) {
    if (FORBIDDEN_AGENT_ACTIONS.includes(action)) continue;
    // Anything the platform itself would never let an agent do is rejected.
    errors.push(`Skill ${descriptor.name} declares unsupported forbidden action ${action}`);
  }
  return errors;
}
