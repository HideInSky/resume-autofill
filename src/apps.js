// 投递记录：每填一个网申页面记一行，存在本机浏览器里；也可以连到一个本地 CSV 文件，用 Excel 打开。
// 侧边栏、投递记录页和后台共用。
globalThis.Apps = (() => {
  const COLUMNS = [
    ['date', '日期'],
    ['company', '公司'],
    ['position', '职位'],
    ['status', '状态'],
    ['city', '城市'],
    ['channel', '渠道'],
    ['resume', '简历版本'],
    ['note', '备注'],
    ['url', '链接'],
  ];
  // 已投递 → 已沟通 → 笔试 → 一面 → 二面 → HR 面 → Offer；中途可能 已拒绝 / 已放弃
  const STATUSES = ['待投递', '已投递', '已沟通', '笔试', '一面', '二面', 'HR 面', 'Offer', '已拒绝', '已放弃'];

  const today = () => {
    const d = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  // 同一个网申页面（去掉 ? 后面的参数）+ 同一个职位算同一条
  const keyOf = (url, position) => {
    try {
      const u = new URL(url);
      return u.origin + u.pathname + '#' + (position || '');
    } catch {
      return String(url || '') + '#' + (position || '');
    }
  };

  async function list() {
    const { applications = [] } = await chrome.storage.local.get('applications');
    return applications;
  }
  async function save(rows) {
    await chrome.storage.local.set({ applications: rows, applicationsAt: Date.now() });
  }

  // 填完一个网申页面：没记过就加一行（状态「待投递」），记过就只补上空着的格子
  async function record(info) {
    const rows = await list();
    const key = keyOf(info.url, info.position);
    const old = rows.find((r) => keyOf(r.url, r.position) === key) || rows.find((r) => r.url && keyOf(r.url, '') === keyOf(info.url, '') && !r.position);
    if (old) {
      for (const [k] of COLUMNS) if (!old[k] && info[k]) old[k] = info[k];
    } else {
      rows.unshift({ id: id(), date: today(), status: '待投递', note: '', ...pick(info) });
    }
    await save(rows);
  }
  // 在网申页面上点了「投递 / 提交」：这一页的记录改成「已投递」
  async function submitted(url) {
    const rows = await list();
    const base = keyOf(url, '');
    let hit = false;
    for (const r of rows) {
      if (r.url && keyOf(r.url, '') === base && r.status === '待投递') {
        r.status = '已投递';
        r.date = today();
        hit = true;
      }
    }
    if (hit) await save(rows);
  }
  const pick = (o) => Object.fromEntries(COLUMNS.map(([k]) => [k, String(o[k] ?? '').trim()]));

  // —— CSV（Excel 能直接打开；开头加 BOM，中文才不会乱码）——
  const cell = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  function toCSV(rows) {
    const lines = [COLUMNS.map(([, h]) => h).join(',')];
    for (const r of rows) lines.push(COLUMNS.map(([k]) => cell(String(r[k] ?? ''))).join(','));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const out = [];
    let row = [];
    let v = '';
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') (v += '"'), i++;
        else if (c === '"') q = false;
        else v += c;
      } else if (c === '"') q = true;
      else if (c === ',') row.push(v), (v = '');
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(v), out.push(row), (row = []), (v = '');
      } else v += c;
    }
    if (v || row.length) row.push(v), out.push(row);
    const [head = [], ...body] = out;
    // 按表头认列，列的顺序、多出来的列都不要紧
    const idx = COLUMNS.map(([k, h]) => [k, head.findIndex((x) => x.trim() === h)]);
    return body
      .filter((r) => r.some((x) => x.trim()))
      .map((r) => {
        const o = { id: id() };
        for (const [k, i] of idx) o[k] = i >= 0 ? (r[i] || '').trim() : '';
        if (!o.status && o.company) o.status = '已投递';
        return o;
      });
  }

  // 合并两份记录时认「同一条」：有链接看链接 + 职位，没有就看公司 + 职位
  const rowKey = (r) => (r.url ? keyOf(r.url, r.position) : `${r.company}|${r.position}`);

  return { COLUMNS, STATUSES, list, save, record, submitted, toCSV, parseCSV, today, id, rowKey };
})();
