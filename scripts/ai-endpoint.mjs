// 填写云端服务器地址：node scripts/ai-endpoint.mjs https://toujianli-ai.xxx.workers.dev
// 会改两处：src/ai-config.js 里的 AI_ENDPOINT，和 manifest.json 的联网白名单（connect-src）。
// 不带参数运行就清空地址、从白名单里去掉，扩展回到不联网（「在线更新岗位」除外）。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv[2] || '';
let origin = '';
if (arg) {
  const u = new URL(arg);
  if (u.protocol !== 'https:') throw new Error('地址必须是 https://');
  origin = u.origin;
}

const cfgPath = join(root, 'src/ai-config.js');
const cfg = readFileSync(cfgPath, 'utf8');
const old = (cfg.match(/const AI_ENDPOINT = '([^']*)';/) || [])[1] || '';
writeFileSync(cfgPath, cfg.replace(/const AI_ENDPOINT = '[^']*';/, `const AI_ENDPOINT = '${origin}';`));

const manPath = join(root, 'manifest.json');
const man = JSON.parse(readFileSync(manPath, 'utf8'));
const parts = man.content_security_policy.extension_pages.split(';').map((s) => s.trim());
const i = parts.findIndex((p) => p.startsWith('connect-src'));
// 去掉以前填过的服务器地址；别的地址（岗位数据、各家 AI 接口）保留
const keep = parts[i].split(/\s+/).slice(1).filter((s) => !old || s.replace(/\/$/, '') !== old);
parts[i] = ['connect-src', ...keep, ...(origin ? [origin] : [])].join(' ');
man.content_security_policy.extension_pages = parts.join('; ');
writeFileSync(manPath, JSON.stringify(man, null, 2) + '\n');
console.log(origin ? `已填上 ${origin}` : '已清空服务器地址');
console.log(parts[i]);
