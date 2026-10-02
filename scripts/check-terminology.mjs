import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const roots = ['apps/mobile', 'apps/api/src', 'docs/current'];
const files = execFileSync('git', ['ls-files', '--', ...roots], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => !file.includes('/search-ai.') && !file.includes('/scenarios.') && !file.includes('/todo.'));

const forbidden = [
  ['任务中心', '用户工作单元统一称为“计划”'],
  ['场景中心', '模板目录统一称为“计划模板”'],
  ['问一问AI', '入口统一称为“问一问”'],
  ['查询助手', '聊天不暴露内部意图模式'],
  ['执行助手', '聊天不暴露内部意图模式'],
  ['规划助手', '聊天不暴露内部意图模式'],
  ['/search-ai', '新路由使用 /chat'],
];

const violations = [];
for (const file of files) {
  if (!/\.(?:ts|tsx|js|mjs|md)$/.test(file)) continue;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    for (const [term, guidance] of forbidden) {
      if (lines[index].includes(term)) violations.push(`${file}:${index + 1}: ${term} (${guidance})`);
    }
  }
}

if (violations.length) {
  console.error(`Terminology gate failed with ${violations.length} violation(s):\n${violations.join('\n')}`);
  process.exit(1);
}
console.log(`Terminology gate passed: ${files.length} current files checked.`);
