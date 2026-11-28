// Autopilot 用的 AI：用户自己选一家、填自己的 API Key（只存在这个浏览器里），或者用自己的 Claude 订阅（通过 Claude Code）。
// 只在 Autopilot 匹配岗位、回答表单里的开放问题时才会调用。
(() => {
  const PROVIDERS = {
    deepseek: { name: 'DeepSeek', kind: 'openai', url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys' },
    qwen: { name: '阿里千问', kind: 'openai', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-plus', keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1' },
    openai: { name: 'ChatGPT（OpenAI）', kind: 'openai', url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-5-mini', keyUrl: 'https://platform.openai.com/api-keys' },
    claude: { name: 'Claude（API）', kind: 'anthropic', url: 'https://api.anthropic.com/v1/messages', model: 'claude-haiku-5-5', keyUrl: 'https://platform.claude.com/settings/keys' },
    claudecode: { name: 'Claude 订阅（Claude Code）', kind: 'bridge', url: 'http://127.0.0.1:47321', model: '' },
  };

  async function config() {
    const { llm = {} } = await chrome.storage.local.get('llm');
    return { provider: llm.provider || '', keys: llm.keys || {}, models: llm.models || {} };
  }
  async function save(patch) {
    const cur = await config();
    await chrome.storage.local.set({ llm: { ...cur, ...patch } });
  }
  async function ready() {
    const c = await config();
    const p = PROVIDERS[c.provider];
    if (!p) return false;
    return p.kind === 'bridge' ? true : !!c.keys[c.provider];
  }

  const timeout = (ms) => {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), ms);
    return ctl.signal;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 从回复里取出 JSON（有的模型会包在 ``` 里）
  function parseJSON(text) {
    const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    try {
      return JSON.parse(t);
    } catch {
      const m = t.match(/[[{][\s\S]*[\]}]/);
      if (m) return JSON.parse(m[0]);
      throw new Error('AI 返回的内容不是 JSON');
    }
  }

  async function viaBridge(p, system, user, json) {
    const base = p.url;
    let ping;
    try {
      ping = await (await fetch(base + '/ping', { signal: timeout(3000) })).json();
    } catch {
      throw new Error('连不上 Claude Code。先在终端里打开 Claude Code，运行 /autopilot，再回来重试。');
    }
    if (!ping.agent) throw new Error('Claude Code 已连接，但没在等任务。在 Claude Code 里运行 /autopilot。');
    const { id } = await (await fetch(base + '/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system, user, json }) })).json();
    for (const started = Date.now(); Date.now() - started < 5 * 60_000; ) {
      const r = await (await fetch(base + '/result?id=' + encodeURIComponent(id))).json();
      if (r.done) return r.text;
      if (r.error) throw new Error('Claude Code 那边把这个任务弄丢了，重试一下。');
      await sleep(300);
    }
    throw new Error('Claude Code 5 分钟没回答，检查一下它是不是还在运行 /autopilot。');
  }

  // system / user 都是纯文本；json=true 时要求只回 JSON，返回解析好的对象
  async function chat({ system, user, json = false, maxTokens = 2000 }) {
    const c = await config();
    const p = PROVIDERS[c.provider];
    if (!p) throw new Error('还没选 AI。到「Autopilot → AI 设置」里选一家。');
    const model = c.models[c.provider] || p.model;
    const key = c.keys[c.provider] || '';
    if (p.kind !== 'bridge' && !key) throw new Error(`还没填 ${p.name} 的 API Key。`);
    let text;
    if (p.kind === 'bridge') text = await viaBridge(p, system, user, json);
    else if (p.kind === 'anthropic') {
      const res = await fetch(p.url, {
        method: 'POST',
        signal: timeout(120_000),
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${p.name} 报错：${(out.error && out.error.message) || res.status}`);
      if (out.stop_reason === 'refusal') throw new Error(`${p.name} 拒绝回答这个问题`);
      text = (out.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    } else {
      const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
      if (json) body.response_format = { type: 'json_object' };
      const res = await fetch(p.url, { method: 'POST', signal: timeout(120_000), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${p.name} 报错：${(out.error && out.error.message) || res.status}`);
      text = ((out.choices || [])[0] || {}).message?.content || '';
    }
    return json ? parseJSON(text) : String(text).trim();
  }

  globalThis.LLM = { PROVIDERS, config, save, ready, chat, parseJSON };
})();
