// 投简历神器的云端服务（Cloudflare Worker）：
//   POST /v1/parse  用户在「我的资料」里点「用 AI 整理」后，把简历 PDF 交给 Claude 整理成资料的 JSON
//   POST /v1/event  匿名使用统计（只有事件名和几个计数，不含任何资料）
// 简历和整理结果都不落盘、不写日志；数据库里只记次数（用来限额）和匿名事件。
import Anthropic from '@anthropic-ai/sdk';
import PROMPT from './prompt.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
const fail = (status, error, message) => json({ error, message }, status);

const INSTALL_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_PDF_B64 = 2_800_000; // 约 2 MB 的 PDF；简历一般几百 KB
const DAY = 86_400_000;
// 扩展会发的事件；别的一律丢掉
const EVENTS = new Set([
  'first_open', 'first_action', 'nav', 'doc_upload', 'doc_limit', 'ai_parse', 'prompt_copy', 'paste_import', 'tour',
]);

const num = (v, d) => (Number.isFinite(+v) && +v > 0 ? +v : d);

async function ipKey(req, env) {
  // 只存「当天 + 密钥」加盐后的哈希，用来限额，认不出是谁
  const ip = req.headers.get('CF-Connecting-IP') || '';
  const day = new Date().toISOString().slice(0, 10);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.IP_SALT || ''}|${day}|${ip}`));
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function originOk(req, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowed.length) return true;
  return allowed.includes(req.headers.get('Origin') || '');
}

async function parse(req, env) {
  let body;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'bad_request', '请求格式不对');
  }
  const { install, pdf } = body || {};
  if (!INSTALL_RE.test(install || '')) return fail(400, 'bad_request', '请求格式不对');
  if (typeof pdf !== 'string' || !pdf.startsWith('JVBER')) return fail(400, 'not_pdf', '只能整理 PDF 格式的简历');
  if (pdf.length > MAX_PDF_B64) return fail(413, 'too_big', '这份 PDF 太大了（超过 2 MB），压缩一下再试');

  const now = Date.now();
  const ip = await ipKey(req, env);
  const since = now - DAY;
  // 没花到 token 的失败（接口报错、PDF 读不出）不算次数
  const used = "(err IS NULL OR err IN ('refusal', 'max_tokens'))";
  const c = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM parses WHERE install = ?1 AND at > ?3 AND ${used}) AS mine, (SELECT COUNT(*) FROM parses WHERE ip = ?2 AND at > ?3 AND ${used}) AS ip, (SELECT COUNT(*) FROM parses WHERE at > ?3 AND ${used}) AS total`
  ).bind(install, ip, since).first();
  if (c.mine >= num(env.PER_INSTALL_DAY, 8) || c.ip >= num(env.PER_IP_DAY, 20)) {
    return fail(429, 'quota_user', '今天的 AI 整理次数用完了，明天再试；也可以用「用你自己的 AI」的方式：复制提示词，自己整理后粘贴导入。');
  }
  if (c.total >= num(env.DAILY_LIMIT, 500)) {
    return fail(503, 'quota_all', '今天大家的 AI 整理额度用完了，明天再试；也可以用「用你自己的 AI」的方式：复制提示词，自己整理后粘贴导入。');
  }
  const row = await env.DB.prepare('INSERT INTO parses (at, install, ip) VALUES (?1, ?2, ?3) RETURNING id').bind(now, install, ip).first();
  const done = (fields) =>
    env.DB.prepare('UPDATE parses SET ok = ?2, ms = ?3, in_tokens = ?4, out_tokens = ?5, err = ?6 WHERE id = ?1')
      .bind(row.id, fields.ok ? 1 : 0, Date.now() - now, fields.inTokens || 0, fields.outTokens || 0, fields.err || null)
      .run();

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
  try {
    const msg = await client.messages.create({
      model: env.MODEL || 'claude-haiku-5-5',
      max_tokens: 8000,
      output_config: { effort: 'low' },
      // 提示词每次都一样：缓存起来，重复的部分按缓存价计费
      system: [{ type: 'text', text: PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } },
            { type: 'text', text: '这是我的简历，请按上面的说明整理。' },
          ],
        },
      ],
    });
    const usage = { inTokens: (msg.usage.input_tokens || 0) + (msg.usage.cache_read_input_tokens || 0) + (msg.usage.cache_creation_input_tokens || 0), outTokens: msg.usage.output_tokens };
    if (msg.stop_reason === 'refusal') {
      await done({ ...usage, err: 'refusal' });
      return fail(422, 'refused', 'AI 没能处理这份文件，换一份 PDF 或用「我的资料」里的复制粘贴方式');
    }
    if (msg.stop_reason === 'max_tokens') {
      await done({ ...usage, err: 'max_tokens' });
      return fail(422, 'too_long', '简历内容太长，没能整理完，换用「我的资料」里的复制粘贴方式');
    }
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    await done({ ok: true, ...usage });
    return json({ text });
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status : 0;
    await done({ err: `api_${status || 'net'}` });
    if (status === 429 || status === 529 || status >= 500) return fail(503, 'busy', 'AI 服务现在很忙，过一会儿再试');
    if (status === 400) return fail(422, 'unreadable', '这份 PDF 读不出来（可能加密了或者是扫描图片），换一份再试');
    return fail(502, 'error', 'AI 整理失败了，过一会儿再试');
  }
}

async function event(req, env) {
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 204, headers: CORS });
  }
  const { install, event: name, props, v } = body || {};
  if (!INSTALL_RE.test(install || '') || !EVENTS.has(name)) return new Response(null, { status: 204, headers: CORS });
  const p = JSON.stringify(props && typeof props === 'object' ? props : {});
  if (p.length > 400) return new Response(null, { status: 204, headers: CORS });
  await env.DB.prepare('INSERT INTO events (at, install, event, props, v) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(Date.now(), install, name, p, String(v || '').slice(0, 16))
    .run();
  return new Response(null, { status: 204, headers: CORS });
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const { pathname } = new URL(req.url);
    if (req.method === 'GET' && pathname === '/') return json({ ok: true });
    if (req.method !== 'POST') return fail(405, 'method', '只接受 POST');
    if (!originOk(req, env)) return fail(403, 'origin', '来源不对');
    if (pathname === '/v1/parse') return parse(req, env);
    if (pathname === '/v1/event') return event(req, env);
    return fail(404, 'not_found', '没有这个地址');
  },
};
