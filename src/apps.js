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
    ['archived', '归档'],
  ];
  // 收藏 → 已投递 → 已沟通 → 笔试 → 一面 → 二面 → HR 面 → Offer；中途可能 已拒绝 / 已放弃
  const STATUSES = ['收藏', '已投递', '已沟通', '笔试', '一面', '二面', 'HR 面', 'Offer', '已拒绝', '已放弃'];
  // 看板的五列：每列包含哪些状态，拖进这一列时改成哪个状态
  const STAGES = [
    { id: 'saved', name: '收藏', statuses: ['收藏'], drop: '收藏' },
    { id: 'applied', name: '已投递', statuses: ['已投递', '待投递', ''], drop: '已投递' },
    { id: 'interview', name: '面试中', statuses: ['已沟通', '笔试', '一面', '二面', 'HR 面'], drop: '已沟通' },
    { id: 'offer', name: 'Offer', statuses: ['Offer'], drop: 'Offer' },
    { id: 'closed', name: '已结束', statuses: ['已拒绝', '已放弃'], drop: '已拒绝' },
  ];
  // 渠道（默认官网）
  const CHANNELS = ['官网', '岗位库', '内推', '牛客', 'BOSS 直聘', '猎聘', '智联招聘', '前程无忧', '实习僧', 'LinkedIn', '宣讲会', '邮件', '其他'];
  // 列表里的进度条：收藏 → 已投递 → 笔试 → 面试 → Offer
  const STEPS = [['收藏'], ['已投递', '待投递', ''], ['已沟通', '笔试'], ['一面', '二面', 'HR 面'], ['Offer']];
  const STEP_NAMES = ['收藏', '已投递', '笔试', '面试', 'Offer'];
  const stepOf = (status) => STEPS.findIndex((g) => g.includes(status || ''));
  const stageOf = (status) => STAGES.find((g) => g.statuses.includes(status || '')) || STAGES[1];

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

  const find = (rows, info) => {
    const key = keyOf(info.url, info.position);
    return rows.find((r) => r.url && keyOf(r.url, r.position) === key) || rows.find((r) => r.url && info.url && keyOf(r.url, '') === keyOf(info.url, '') && (!r.position || !info.position));
  };
  // 记一条（默认「已投递」）。记过的就只补上空着的格子；从「收藏」变成投递时更新状态和日期
  async function record(info, status = '已投递') {
    const rows = await list();
    const old = find(rows, info);
    if (old) {
      for (const [k] of COLUMNS) if (!old[k] && info[k] && k !== 'status') old[k] = info[k];
      if (STATUSES.indexOf(status) > STATUSES.indexOf(old.status) && stageOf(old.status).id === 'saved') {
        old.status = status;
        old.date = today();
      }
    } else {
      rows.unshift({ id: id(), date: today(), note: '', ...pick(info), status, archived: '' });
    }
    await save(rows);
    return old || rows[0];
  }
  const has = async (url) => !!find(await list(), { url, position: '' });
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
        if (o.archived === '否') o.archived = '';
        return o;
      });
  }

  // 合并两份记录时认「同一条」：有链接看链接 + 职位，没有就看公司 + 职位
  const rowKey = (r) => (r.url ? keyOf(r.url, r.position) : `${r.company}|${r.position}`);

  return { COLUMNS, STATUSES, STAGES, stageOf, CHANNELS, STEP_NAMES, stepOf, list, save, record, has, toCSV, parseCSV, today, id, rowKey };
})();
