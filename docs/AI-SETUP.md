# AI 整理简历：充值、部署和看数据

用户在「文档」里上传简历 PDF，同意后扩展把它发到我们的服务器（`server/`，一个 Cloudflare Worker），服务器拿你的 Claude API Key 调 Claude Haiku 5.5，把简历整理成「我的资料」的内容。API Key 只放在服务器上，不放进扩展：扩展包谁都能解开，Key 放进去就等于公开了。

没部署之前（`src/ai-config.js` 里 `AI_ENDPOINT` 是空的），扩展不会显示 AI 整理，也不发任何统计，和以前一样。

## 1. 找到你的 Claude 额度，拿 API Key

先分清是哪一种 $100：

- **API 额度**（在 Claude Console 里）：打开 <https://platform.claude.com>（以前叫 console.anthropic.com），用同一个账号登录 → **Settings → Billing**，能看到 Credit balance（余额）和赠送额度的到期时间。这个钱可以给本项目用。
- **Claude Max 订阅**（claude.ai 上每月 $100 的那种）：这是聊天订阅，**不能**用来调 API。要用 API，得在 Console 的 Billing 里另外充值（最少 $5 起）。

有 API 余额后：

1. Console → **Settings → API keys → Create key**，名字写 `toujianli`，复制生成的 `sk-ant-...`（只显示一次）。
2. 建议在 **Settings → Limits** 设一个每月花费上限（比如 $20），防止意外。

### 大概花多少钱

用的是最便宜的 Claude Haiku 5.5：输入 $0.10、输出 $0.50 / 百万 token。一份 1–2 页的简历，PDF 和提示词合计约 1 万 token 输入、2–3 千 token 输出，**一次约 $0.002–0.003**，$100 大约够整理 3–5 万次。服务器还有三道限额（在 `server/wrangler.toml` 里改）：

| 限额 | 默认 | 作用 |
| --- | --- | --- |
| `PER_INSTALL_DAY` | 8 | 每个安装每天最多整理 8 次 |
| `PER_IP_DAY` | 20 | 同一网络每天最多 20 次（防止有人刷） |
| `DAILY_LIMIT` | 500 | 所有人每天合计最多 500 次，封顶大约 $1.5/天 |

扩展这边，「文档」里最多存 8 份简历（`src/ai-config.js` 的 `DOC_LIMIT`），超过会提醒先删掉旧的。

## 2. 部署服务器（Cloudflare，免费）

需要一个 Cloudflare 账号（免费注册）。在终端里：

```bash
cd server
npm install
npx wrangler login
```

```bash
npx wrangler d1 create toujianli
```

把它输出的 `database_id` 填进 `server/wrangler.toml` 里 `REPLACE_WITH_DATABASE_ID` 的位置，然后：

```bash
npm run db:init
```

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

（粘贴上一步的 `sk-ant-...`）

```bash
npx wrangler secret put IP_SALT
```

（随便输一长串随机字符）

```bash
npm run deploy
```

部署完会打印一个地址，像 `https://toujianli-ai.<你的名字>.workers.dev`。回到仓库根目录，把它填进扩展：

```bash
node scripts/ai-endpoint.mjs https://toujianli-ai.<你的名字>.workers.dev
```

这一步会同时改 `src/ai-config.js` 和 `manifest.json` 的联网白名单。然后在 `chrome://extensions` 里刷新扩展，到「文档」上传一份简历试试。

上架拿到扩展 ID 后，在 `wrangler.toml` 里把 `ALLOWED_ORIGINS` 设成 `chrome-extension://<扩展 ID>`，再 `npm run deploy`，别的网页就调不了这个服务器了。

免费版的 Worker 每次请求只有 10 毫秒 CPU 时间，简历一般几百 KB 没问题；如果经常看到大 PDF 失败，升级到 $5/月的付费版即可。

## 3. 看数据

所有统计都在 D1 数据库里，用 SQL 查（在 `server/` 目录下运行）：

第一次打开落在哪一页：

```bash
npx wrangler d1 execute toujianli --remote --command "SELECT json_extract(props,'$.view') AS view, COUNT(*) AS n FROM events WHERE event='first_open' GROUP BY view"
```

第一次打开后先做了什么（直接上传 PDF / 去我的资料 / 复制提示词 / 粘贴导入）：

```bash
npx wrangler d1 execute toujianli --remote --command "SELECT json_extract(props,'$.action') AS action, COUNT(*) AS n FROM events WHERE event='first_action' GROUP BY action ORDER BY n DESC"
```

上传后选了 AI 整理还是只保存文件：

```bash
npx wrangler d1 execute toujianli --remote --command "SELECT json_extract(props,'$.choice') AS choice, COUNT(*) AS n FROM events WHERE event='ai_consent' GROUP BY choice"
```

AI 整理的次数、成功率和花了多少 token：

```bash
npx wrangler d1 execute toujianli --remote --command "SELECT date(at/1000,'unixepoch') AS day, COUNT(*) AS n, SUM(ok) AS ok, SUM(in_tokens) AS input, SUM(out_tokens) AS output FROM parses GROUP BY day ORDER BY day DESC LIMIT 14"
```

扩展会发的事件：`first_open`（第一次打开，落在哪页）、`first_action`（第一个操作）、`nav`（切换页面）、`doc_upload`、`doc_limit`（超过 8 份被拦下）、`ai_offer`、`ai_consent`、`ai_parse`、`prompt_copy`、`paste_import`。都不含资料、简历内容和网址；用户可以在「我的资料 → 隐私」里关掉。

## 改了字段之后

提示词从 `src/schema.js` 的字段定义生成，扩展的「复制提示词」和服务器用同一份。改了字段后重新 `npm run deploy`（它会先运行 `scripts/ai-prompt.mjs` 重新生成 `server/src/prompt.js`）。
