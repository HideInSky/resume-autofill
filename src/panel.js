// 侧边栏：点工具栏图标打开，一直留在网页旁边。两个标签页——
// 「填写」：这个页面填了哪些、还差哪些；「资料」：点一下复制，粘贴到没填上的地方。
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
let book = { active: 0, list: [] };
let index = 0; // 这个标签页用第几套资料
let profile = {};
let tab = null;

const hasData = (p) =>
  Object.values(p || {}).some((v) =>
    Array.isArray(v) ? v.some((item) => Object.values(item || {}).some(Boolean)) : Object.values(v || {}).some(Boolean)
  );

async function refresh() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const state = await Vault.state();
  const locked = state === 'locked';
  if (!locked) ({ book, index } = await pickProfile(tab.id));
  profile = locked ? {} : book.list[index].data || {};
  const ready = !locked && book.list.some((p) => hasData(p.data));
  $('locked').hidden = !locked;
  $('empty').hidden = locked || ready;
  $('ready').hidden = !ready;
  $('lock').hidden = state !== 'unlocked';
  if (locked) $('pw').focus();
  if (!ready) return;
  renderCards();
  renderAuto();
  renderProfiles();
  renderFill();
  chrome.storage.local.get('settings').then(({ settings = {} }) => ($('opt-save').checked = settings.autoSave === true));
}

// —— 标签页 ——
function show(which) {
  for (const k of ['fill', 'prof']) {
    $('tab-' + k).setAttribute('aria-selected', String(k === which));
    $('pane-' + k).hidden = k !== which;
  }
}
$('tab-fill').addEventListener('click', () => show('fill'));
$('tab-prof').addEventListener('click', () => show('prof'));
if (location.hash === '#prof') show('prof');

// —— 这个页面用哪套资料 ——
function renderProfiles() {
  $('prof-row').hidden = book.list.length < 2;
  $('prof-pick').replaceChildren(
    ...book.list.map((p, i) => {
      const o = el('option', '', p.name + (i === book.active ? '（默认）' : ''));
      o.value = i;
      return o;
    })
  );
  $('prof-pick').value = String(index);
  $('prof-default').hidden = index === book.active;
}
$('prof-pick').addEventListener('change', async (e) => {
  index = Number(e.target.value);
  profile = book.list[index].data || {};
  const { tabProfiles = {} } = await chrome.storage.session.get('tabProfiles');
  tabProfiles[tab.id] = book.list[index].name;
  await chrome.storage.session.set({ tabProfiles });
  renderProfiles();
  renderCards();
  // 换了资料：把这个页面上已经填的内容按新的这套重填一遍
  fill(true);
});
$('prof-default').addEventListener('click', async () => {
  book.active = index;
  await Vault.saveBook(book);
  renderProfiles();
});

// —— 自动填写总开关（= 授予 / 撤销访问所有网站的权限）——
const ALL = ['<all_urls>', '*://*/*'];
async function renderAuto() {
  const { origins = [] } = await chrome.permissions.getAll();
  $('opt-auto').checked = origins.some((o) => ALL.includes(o));
}
$('opt-auto').addEventListener('change', async (e) => {
  if (e.target.checked) await chrome.permissions.request({ origins: ['<all_urls>'] });
  else {
    const { origins = [] } = await chrome.permissions.getAll();
    if (origins.length) await chrome.permissions.remove({ origins });
  }
  renderAuto();
});
$('allow').addEventListener('click', async () => {
  const ok = await chrome.permissions.request({ origins: ['<all_urls>'] });
  renderAuto();
  if (ok) fill();
});

// —— 「填写」：这个页面的清单 ——
async function goto(frameId, kind, i) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [frameId] },
      func: (k, n) => globalThis.__raGoto && globalThis.__raGoto(k, n),
      args: [kind, i],
    });
  } catch {} // 页面已经换了：清单马上会刷新
}

function group(title, cls, rows, open) {
  const box = el('details', 'p-card list ' + cls);
  box.open = open;
  const sum = el('summary');
  sum.append(el('b', '', title), el('span', 'count', String(rows.length)));
  const ul = el('ul');
  for (const r of rows) {
    const li = el('li');
    const mark = el('i', 'mark', cls === 'done' ? '✓' : '!');
    mark.setAttribute('aria-hidden', 'true');
    if (r.go) {
      const b = el('button', 'item');
      b.title = '点一下，滚到页面上这一项';
      b.append(mark, el('span', '', r.text));
      b.addEventListener('click', r.go);
      li.append(b);
    } else {
      const d = el('div', 'item');
      d.append(mark, el('span', '', r.text));
      li.append(d);
    }
    ul.append(li);
  }
  box.append(sum, ul);
  return box;
}

async function renderFill() {
  if (!tab) return;
  const { fills = {} } = await chrome.storage.session.get('fills');
  const rec = fills[tab.id];
  const done = [];
  const missing = [];
  const noData = new Set();
  for (const [fid, f] of Object.entries((rec && rec.frames) || {})) {
    f.done.forEach((text, i) => done.push({ text, go: () => goto(Number(fid), 'done', i) }));
    f.missing.forEach((text, i) => missing.push({ text: text || '没认出名字的一项', go: () => goto(Number(fid), 'miss', i) }));
    (f.noData || []).forEach((l) => noData.add(l));
  }
  const total = done.length + missing.length;
  $('st-bar').hidden = !total;
  $('st-bar').value = total ? done.length / total : 0;
  if (!total) {
    $('st-title').textContent = '这个页面还没填';
    $('st-sub').textContent = '打开网申表单后点下面的按钮。';
    $('fill').textContent = '填写当前页面';
  } else {
    $('st-title').textContent = missing.length ? `还差 ${missing.length} 项要你自己填` : '都填好了';
    $('st-sub').textContent = `已填 ${done.length} 项` + (book.list.length > 1 && rec.profile ? ` · 用的是「${rec.profile}」` : '');
    $('fill').textContent = '重新填写';
  }
  const lists = [];
  if (missing.length) lists.push(group('要你自己填', 'miss', missing, true));
  if (noData.size) {
    const g = group('资料里还没写', 'nodata', [...noData].map((text) => ({ text })), true);
    const add = el('button', 'link', '去补上');
    add.addEventListener('click', () => chrome.runtime.openOptionsPage());
    g.append(add);
    lists.push(g);
  }
  if (done.length) lists.push(group('已填好', 'done', done, done.length <= 12 || !missing.length));
  $('lists').replaceChildren(...lists);
}
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.fills) renderFill();
});

async function fill(forceOverwrite) {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const result = $('result');
  result.className = 'muted';
  result.textContent = '填写中…下拉框要一个个点开选，可能要几秒。';
  $('allow').hidden = true;
  $('fill').disabled = true;
  try {
    const reports = await runFill({
      tabId: tab.id,
      opts: { overwrite: forceOverwrite === true || $('opt-overwrite').checked, fillPassword: $('opt-password').checked, save: $('opt-save').checked },
    });
    const n = reports.reduce((sum, r) => sum + r.filled.length, 0);
    const kept = reports.reduce((sum, r) => sum + r.kept, 0);
    result.textContent = n || kept ? '' : '这个页面上没找到认得的表单项。';
  } catch (e) {
    // 没有这个网页的权限（侧边栏开着时换了页面），或者是浏览器不让碰的页面
    const { origins = [] } = await chrome.permissions.getAll();
    const allowed = origins.some((o) => ALL.includes(o));
    result.className = 'err';
    result.textContent = allowed
      ? '这个页面填不了：浏览器内置页面和应用商店页面不允许扩展操作。'
      : '浏览器还没允许扩展碰这个网页。点下面的按钮允许一次，以后打开网申页面就会自动填。';
    $('allow').hidden = allowed;
  }
  $('fill').disabled = false;
}
$('fill').addEventListener('click', () => fill());

// —— 「资料」：点一下复制 ——
// 每张卡片只摆最常用的几项，其余收在「更多」里
const ICONS = {
  school: '<path d="M2 8l8-4 8 4-8 4z"/><path d="M5.5 10v3.5c0 1 2 2 4.5 2s4.5-1 4.5-2V10M18 8v4.5"/>',
  work: '<rect x="2.5" y="6" width="15" height="10.5" rx="2"/><path d="M7 6V4.8A1.3 1.3 0 018.3 3.5h3.400A1.3 1.3 0 0113 4.8V6M2.5 11h15"/>',
  project: '<path d="M2.5 6.5A1.5 1.5 0 014 5h3.5l1.5 2H16a1.5 1.5 0 011.5 1.5v6A1.5 1.5 0 0116 16H4a1.5 1.5 0 01-1.5-1.5z"/>',
};
function badge(kind, text) {
  const b = el('span', 'avatar ' + kind, text || '');
  b.setAttribute('aria-hidden', 'true');
  if (ICONS[kind]) b.innerHTML = `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[kind]}</svg>`;
  return b;
}
function copyable(b, value) {
  b.title = '点一下复制';
  b.addEventListener('click', async () => {
    await navigator.clipboard.writeText(value);
    b.classList.add('copied');
    setTimeout(() => b.classList.remove('copied'), 1000);
  });
  return b;
}
// 一行只有值（卡片上的重点信息）
const line = (value, cls) => (value ? copyable(el('button', 'copy ' + (cls || ''), value), value) : null);
// 带名称的一行（「更多」里的）
function copyRow(label, value, secret) {
  const b = el('button', 'copy labeled');
  // 密码只把最后三位换成星号，够你认出是哪一个
  b.append(el('small', '', label), el('span', '', secret ? value.slice(0, -3) + '***' : value));
  return copyable(b, value);
}
function more(sec, item, shown, title) {
  const rows = sec.fields
    .filter((f) => !shown.includes(f.key) && item[f.key] && typeof item[f.key] === 'string')
    .map((f) => copyRow(f.label, item[f.key], f.type === 'password'));
  if (!rows.length) return null;
  const d = el('details', 'more');
  d.append(el('summary', '', title || '更多'), ...rows);
  return d;
}
const ym = (v) => String(v || '').replace('-', '.');
function dates(item) {
  if (!item.start && !item.end) return null;
  const box = el('div', 'dates');
  box.append(...[line(ym(item.start), 'sub'), item.start && item.end ? el('span', 'muted', '–') : null, line(ym(item.end), 'sub')].filter(Boolean));
  return box;
}
// 一段经历：左边固定的占位图标，右边 标题 / 副标题 / 时间 / 描述
function entry(kind, sec, item, head, subs, body, icon) {
  const box = el('div', 'p-entry');
  const main = el('div', 'p-main');
  const shown = [...head, ...subs.flat(), 'start', 'end', ...body];
  main.append(
    ...[
      ...head.map((k) => line(item[k], 'strong')),
      ...subs.map((keys) => {
        const parts = keys.map((k) => line(item[k], 'sub')).filter(Boolean);
        if (!parts.length) return null;
        const row = el('div', 'dates');
        parts.forEach((p, n) => row.append(...(n ? [el('span', 'muted', '·'), p] : [p])));
        return row;
      }),
      dates(item),
      ...body.map((k) => line(item[k], 'body')),
      more(sec, item, shown),
    ].filter(Boolean)
  );
  box.append(icon || badge(kind), main);
  return box;
}
// 公司用名字的第一个字当图标，颜色按名字固定
const hue = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
function initial(name) {
  const b = el('span', 'avatar co', (name || '？').trim().slice(0, 1).toUpperCase());
  b.style.setProperty('--h', hue(name || ''));
  b.setAttribute('aria-hidden', 'true');
  return b;
}
const LAYOUT = {
  education: (sec, item) => entry('school', sec, item, ['school'], [['degree', 'major']], []),
  work: (sec, item) => entry('work', sec, item, ['company'], [['title', 'city']], ['description'], initial(item.company)),
  project: (sec, item) => entry('project', sec, item, ['name'], [['role']], ['description']),
};
function basicCard(sec) {
  const b = profile.basic || {};
  const place = [b.province, b.city, b.district].filter((x, n, all) => x && all.indexOf(x) === n).join(' ');
  const box = el('div', 'p-entry');
  const main = el('div', 'p-main');
  main.append(...[line(b.name, 'strong'), line(place, 'sub'), line(b.email, 'sub'), line(b.phone, 'sub'), more(sec, b, ['name', 'email', 'phone', 'province', 'city', 'district'])].filter(Boolean));
  if (!main.children.length) return null;
  box.append(badge('me', (b.name || '我').slice(0, 1)), main);
  const card = el('section', 'p-card');
  card.append(box);
  return card;
}
function renderCards() {
  const byId = Object.fromEntries(RESUME_SCHEMA.sections.map((s) => [s.id, s]));
  const cards = [basicCard(byId.basic)];
  for (const id of ['education', 'work', 'project']) {
    const blocks = (profile[id] || []).filter((item) => Object.values(item || {}).some(Boolean)).map((item) => LAYOUT[id](byId[id], item));
    if (!blocks.length) continue;
    const card = el('section', 'p-card');
    card.append(el('h2', '', byId[id].title), ...blocks);
    cards.push(card);
  }
  // 其余的（求职意向、语言、账号、其他）：直接全部展开
  for (const sec of RESUME_SCHEMA.sections) {
    if (['basic', 'education', 'work', 'project', 'custom'].includes(sec.id)) continue;
    const items = sec.repeat ? profile[sec.id] || [] : [profile[sec.id] || {}];
    const blocks = items.map((item) => more(sec, item, [], ' ')).filter(Boolean);
    if (!blocks.length) continue;
    const card = el('section', 'p-card');
    card.append(el('h2', '', sec.title));
    blocks.forEach((b) => {
      const group = el('div', 'p-group');
      group.append(...[...b.children].slice(1));
      card.append(group);
    });
    cards.push(card);
  }
  $('cards').replaceChildren(...cards.filter(Boolean));
}

$('locked').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ok = await Vault.unlock($('pw').value);
  $('pw').value = '';
  $('pw-msg').textContent = ok ? '' : '密码不对';
  if (ok) refresh();
});
// 切换标签页时，跟着换成那个页面的清单和资料
chrome.tabs.onActivated.addListener(refresh);
$('setup').addEventListener('click', () => chrome.runtime.openOptionsPage());
// 投递记录：在新标签页打开表格
// 编辑资料和投递记录是同一个页面的两个标签
const openApp = (view) => chrome.tabs.create({ url: chrome.runtime.getURL('src/app.html#' + view) });
$('tracker').addEventListener('click', () => openApp('tracker'));
async function renderCount() {
  const n = (await Apps.list()).length;
  $('app-count').textContent = String(n);
  $('app-count').hidden = !n;
}
renderCount();
$('edit').addEventListener('click', () => openApp('profile'));
$('lock').addEventListener('click', async () => {
  await Vault.lock();
  refresh();
});
// 资料页改了内容：这里跟着更新
chrome.storage.local.onChanged.addListener((changes) => {
  if (changes.applications) renderCount();
  if (Object.keys(changes).some((k) => !k.startsWith('applications')) && !document.hidden) refresh();
});

refresh();
