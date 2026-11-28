# AI 整理简历：充值、部署和看数据

用户先在「文档」里上传简历 PDF（只存在浏览器里），再到「我的资料 → 导入简历」选一份点「用 AI 整理」，扩展才把它发到我们的服务器（`server/`，一个 Cloudflare Worker），服务器拿你的 Claude API Key 调 Claude Haiku 5.5，把简历整理成「我的资料」的内容。API Key 只放在服务器上，不放进扩展：扩展包谁都能解开，Key 放进去就等于公开了。

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

这一步会同时改 `src/ai-config.js` 和 `manifest.json` 的联网白名单。然后在 `chrome://extensions` 里刷新扩展：到「文档」上传一份简历，再到「我的资料 → 导入简历」点「用 AI 整理」试试。

上架拿到扩展 ID 后，在 `wrangler.toml` 里把 `ALLOWED_ORIGINS` 设成 `chrome-extension://<扩展 ID>`，再 `npm run deploy`，别的网页就调不了这个服务器了。

免费版的 Worker 每次请求只有 10 毫秒 CPU 时间，简历一般几百 KB 没问题；如果经常看到大 PDF 失败，升级到 $5/月的付费版即可。

## 3. 看数据

所有统计都在 D1 数据库里，用 SQL 查（在 `server/` 目录下运行）：

第一次打开落在哪一页：

```bash
npx wrangler d1 execute toujianli --remote --command "SELECT json_extract(props,'$.view') AS view, COUNT(*) AS n FROM events WHERE event='first_open' GROUP BY view"
```

第一次打开后先做了什么（直接上传 PDF / 去我的资料 / 用自带 AI 整理 / 复制提示词 / 粘贴导入）：

```bash
npx wrangler d1 execute toujianli --remote --command "SELECT json_extract(props,'$.action') AS action, COUNT(*) AS n FROM events WHERE event='first_action' GROUP BY action ORDER BY n DESC"
```

新手指引看到第几步、看完还是跳过：

```bash
npx wrangler d1 execute toujianli --remote --command "SELECT props, COUNT(*) AS n FROM events WHERE event='tour' AND (props LIKE '%done%' OR props LIKE '%skip%') GROUP BY props"
```

AI 整理的次数、成功率和花了多少 token：

```bash
npx wrangler d1 execute toujianli --remote --command "SELECT date(at/1000,'unixepoch') AS day, COUNT(*) AS n, SUM(ok) AS ok, SUM(in_tokens) AS input, SUM(out_tokens) AS output FROM parses GROUP BY day ORDER BY day DESC LIMIT 14"
```

扩展会发的事件：`first_open`（第一次打开，落在哪页）、`first_action`（第一个操作）、`nav`（切换页面）、`doc_upload`、`doc_limit`（超过 8 份被拦下）、`ai_parse`（用自带 AI 整理，成功没有）、`prompt_copy`、`paste_import`、`tour`（新手指引）。都不含资料、简历内容和网址；用户可以在「我的资料 → 隐私」里关掉。

## 改了字段之后

提示词从 `src/schema.js` 的字段定义生成，扩展的「复制提示词」和服务器用同一份。改了字段后重新 `npm run deploy`（它会先运行 `scripts/ai-prompt.mjs` 重新生成 `server/src/prompt.js`）。

## 岗位数据：让所有用户拿到同一份最新数据

扩展里的「岗位」不打包在扩展里，而是每天由 GitHub Actions 抓一次、发布到仓库的 `jobs-data` 分支，服务器的 `GET /v1/jobs/index.json`、`/v1/jobs/c/<公司>.json` 转发这份数据并在边缘缓存 30 分钟。现在远端还没有 `jobs-data` 分支，所以大家看到的还是你本机 11 月 24 日抓的那份。要让它每天自动更新：

1. 把 `.github/workflows/jobs-data.yml` 放到 **main** 分支（GitHub 只按默认分支上的文件跑定时任务），推送。
2. 在 GitHub 仓库的 Actions 页面手动运行一次「岗位数据」，确认生成了 `jobs-data` 分支。
3. 服务器的 `JOBS_REPO`（wrangler.toml）指向这个仓库；重新部署服务器后，扩展会先从服务器下载，连不上再直接找 GitHub。

## 反馈

扩展右下角的「反馈」发到 `POST /v1/feedback`，存在 D1 的 `feedback` 表（同一网络每天最多 20 条）。部署后先跑一次 `npm run db:init` 建表。查看：

```bash
npx wrangler d1 execute toujianli --remote --command "SELECT datetime(at/1000,'unixepoch','+8 hours') AS 时间, page, text, contact FROM feedback ORDER BY at DESC LIMIT 50"
```

## 域名

`*.workers.dev` 在中国大陆基本打不开，岗位数据、AI 整理、反馈都会失败。买一个自己的域名（比如 `xxx.com`），在 Cloudflare 里给 Worker 绑上 `api.xxx.com`，再运行 `node scripts/ai-endpoint.mjs https://api.xxx.com`。服务器放在 Cloudflare（境外）不需要备案；国内访问 Cloudflare 自定义域名一般能用，但速度不稳定。
