// 匿名使用统计：只发事件名和几个计数（比如第一次打开先点了哪里、AI 整理成功没有），
// 不含任何资料、简历内容、网址或账号。编号是第一次打开时随机生成的，和你本人对不上。
// 没配置服务器地址（AI_ENDPOINT 为空）或在「我的资料 → 隐私」里关掉时，什么都不发。
const Telemetry = (() => {
  const KEY = 'telemetry';
  let cache = null;
  async function state() {
    if (cache) return cache;
    const got = (await chrome.storage.local.get(KEY))[KEY];
    cache = got && got.id ? got : { id: crypto.randomUUID(), firstAt: Date.now(), once: {}, off: false, fresh: true };
    if (cache.fresh) {
      delete cache.fresh;
      await chrome.storage.local.set({ [KEY]: cache });
      cache.isNew = true; // 这次是第一次打开
    }
    return cache;
  }
  const save = () => {
    const { isNew, ...rest } = cache;
    return chrome.storage.local.set({ [KEY]: rest });
  };
  async function send(event, props = {}) {
    if (!AI_ENDPOINT) return;
    const t = await state();
    if (t.off) return;
    fetch(AI_ENDPOINT + '/v1/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ install: t.id, event, props, v: chrome.runtime.getManifest().version }),
      keepalive: true,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    }).catch(() => {});
  }
  // 只发一次（比如「第一次打开」「第一个操作」）
  async function once(key, event, props) {
    const t = await state();
    if (t.once[key]) return;
    t.once[key] = Date.now();
    await save();
    return send(event, props);
  }
  // 第一次打开后做的第一件事：upload_pdf / open_profile / prompt_copy / paste_import / open_jobs / open_tracker
  const firstAction = (action) => once('first_action', 'first_action', { action });
  return {
    send,
    once,
    firstAction,
    state,
    id: async () => (await state()).id,
    isOff: async () => (await state()).off,
    setOff: async (off) => {
      (await state()).off = !!off;
      await save();
    },
  };
})();
