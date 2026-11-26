// 云端服务器地址：server/ 部署到 Cloudflare 后用 node scripts/ai-endpoint.mjs <地址> 填上（会同时改 manifest 的联网白名单）。
// 空着时：「文档」里不出现 AI 整理，也不发任何统计，扩展和以前一样不联网。
const AI_ENDPOINT = '';
// 「文档」里最多存几份简历
const DOC_LIMIT = 8;
