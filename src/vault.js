// 本地存储。资料和文件只写入 chrome.storage.local（本机磁盘），从不联网。
// 设置主密码后：PBKDF2-SHA256（60 万次）派生密钥 + AES-256-GCM 加密资料和文件；
// 解锁后的密钥只放在 chrome.storage.session（内存，关闭浏览器即清空）。
(() => {
  const ITERATIONS = 600000;
  const local = chrome.storage.local;
  const session = chrome.storage.session;
  const te = new TextEncoder();
  const td = new TextDecoder();

  const toB64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  async function deriveKey(password, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }
  const importKey = (b64) =>
    crypto.subtle.importKey('raw', fromB64(b64), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  const exportKey = async (key) => toB64(await crypto.subtle.exportKey('raw', key));

  async function encrypt(key, value) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(value)));
    return { iv: toB64(iv), ct: toB64(ct) };
  }
  async function decrypt(key, record) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(record.iv) }, key, fromB64(record.ct));
    return JSON.parse(td.decode(pt));
  }

  const getRec = async (name) => (await local.get(name))[name] || null;
  const sessionKey = async () => {
    const k = (await session.get('key')).key;
    if (!k) throw new Error('locked');
    return importKey(k);
  };

  // 'vault' 记录决定是否加密；'files' 记录跟随它
  async function read(name) {
    const rec = await getRec(name);
    if (!rec) return {};
    if (rec.mode !== 'enc') return rec.data || {};
    return decrypt(await sessionKey(), rec);
  }
  async function write(name, value, key) {
    const main = await getRec('vault');
    if (!key && (!main || main.mode !== 'enc')) {
      await local.set({ [name]: { v: 1, mode: 'plain', data: value } });
      return;
    }
    const enc = await encrypt(key || (await sessionKey()), value);
    const extra = name === 'vault' && main ? { iter: main.iter, salt: main.salt } : {};
    await local.set({ [name]: { v: 1, mode: 'enc', ...extra, ...enc } });
  }

  const Vault = {
    toB64,
    // 'empty' | 'plain' | 'locked' | 'unlocked'
    async state() {
      const rec = await getRec('vault');
      if (!rec) return 'empty';
      if (rec.mode !== 'enc') return 'plain';
      return (await session.get('key')).key ? 'unlocked' : 'locked';
    },

    load: () => read('vault'),
    save: (profile) => write('vault', profile),
    // 文件：{ resumes: [{name,type,size,data(base64)}], active: 0, photo: {...} }
    loadFiles: () => read('files'),
    saveFiles: (files) => write('files', files),

    async unlock(password) {
      const rec = await getRec('vault');
      if (!rec || rec.mode !== 'enc') return true;
      try {
        const key = await deriveKey(password, fromB64(rec.salt), rec.iter);
        await decrypt(key, rec);
        await session.set({ key: await exportKey(key) });
        return true;
      } catch {
        return false;
      }
    },

    async lock() {
      await session.remove('key');
    },

    // 设置或修改主密码（需要当前处于未加密或已解锁状态）
    async setPassword(password) {
      const profile = await read('vault');
      const files = await read('files');
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveKey(password, salt, ITERATIONS);
      const enc = await encrypt(key, profile);
      await local.set({ vault: { v: 1, mode: 'enc', iter: ITERATIONS, salt: toB64(salt), ...enc } });
      await write('files', files, key);
      await session.set({ key: await exportKey(key) });
    },

    async removePassword() {
      const profile = await read('vault');
      const files = await read('files');
      await local.set({
        vault: { v: 1, mode: 'plain', data: profile },
        files: { v: 1, mode: 'plain', data: files },
      });
      await session.remove('key');
    },

    async wipe() {
      await local.clear();
      await session.clear();
    },
  };

  globalThis.Vault = Vault;
})();
