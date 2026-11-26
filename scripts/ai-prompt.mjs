// 用扩展里同一份字段定义生成服务器用的提示词：server/src/prompt.js
// 改了 src/schema.js 的字段后重新部署服务器（npm run deploy 会先跑这个）。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = vm.createContext({});
for (const f of ['src/schema.js', 'src/ai.js']) vm.runInContext(readFileSync(join(root, f), 'utf8'), ctx, { filename: f });
const prompt = vm.runInContext('buildPrompt()', ctx);
const out = join(root, 'server/src/prompt.js');
writeFileSync(out, `// 自动生成（scripts/ai-prompt.mjs），不要手改\nexport default ${JSON.stringify(prompt)};\n`);
console.log(`写好了 ${out}（${prompt.length} 字）`);
