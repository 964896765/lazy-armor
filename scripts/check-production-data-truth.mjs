import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const runtimeRoots = ['apps/mobile/app', 'apps/mobile/src'];
const extensions = new Set(['.ts', '.tsx']);
const excludedSegments = new Set(['__tests__', 'test', 'tests']);
const forbiddenPatterns = [
  { name: 'runtime mock or fixture import', pattern: /(?:import|require)\s*(?:\([^)]*)?['"][^'"]*(?:mock|fixture)[^'"]*['"]/i },
  { name: 'fixture or mock fallback return', pattern: /\b(?:return|set\w+\()\s*(?:mock|fixture|demo)(?:Data|Result|Response|Items|Plans|Records)\b/i },
  { name: 'static monetary example', pattern: /[¥￥]\s*\d+(?:\.\d+)?/ },
  { name: 'static vehicle mileage example', pattern: /\b\d+(?:\.\d+)?\s*(?:km|公里)\b/i },
  { name: 'static home temperature example', pattern: /\b\d+(?:\.\d+)?\s*(?:°C|℃)\b/i },
  { name: 'unverified realtime status', pattern: /实时在线|空气良好/ },
];

async function filesUnder(relative) {
  const absolute = resolve(root, relative);
  const found = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || excludedSegments.has(entry.name)) continue;
      const location = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(location);
      else if (extensions.has(entry.name.slice(entry.name.lastIndexOf('.')))
        && !entry.name.includes('.spec.') && !entry.name.includes('.test.')) found.push(location);
    }
  }
  await visit(absolute);
  return found;
}

const violations = [];
for (const runtimeRoot of runtimeRoots) {
  for (const file of await filesUnder(runtimeRoot)) {
    const content = await readFile(file, 'utf8');
    for (const { name, pattern } of forbiddenPatterns) {
      const match = content.match(pattern);
      if (match) violations.push({ file: file.slice(root.length + 1), rule: name, match: match[0] });
    }
  }
}

if (violations.length > 0) {
  console.error('Production data-truth gate failed. Runtime mobile UI must render only Device/Provider/API/user-input data; fixtures are test/demo-only.');
  for (const violation of violations) console.error(`- ${violation.file}: ${violation.rule} (${JSON.stringify(violation.match)})`);
  process.exit(1);
}
console.log('Production data-truth gate passed: mobile runtime files contain no prohibited fixture fallback or static example telemetry.');
