// 投递记录页：像 Excel 一样的表格，直接在格子里改，自动保存。
// 可以连到一个本地 CSV 文件（比如放在 resume-autofill 文件夹里），每次改动都写进去，用 Excel 打开就能看。
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter((k) => k != null));
  return n;
};
let rows = [];
let filter = '全部';
let query = '';

// —— 提示条（带「撤销」）——
let toastTimer;
function toast(text, undo) {
  const box = $('status');
  box.replaceChildren(text);
  if (undo) {
    const b = el('button', { className: 'link', textContent: '撤销' });
    b.addEventListener('click', () => {
      undo();
      box.hidden = true;
    });
    box.append(' ', b);
  }
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.hidden = true), undo ? 6000 : 2500);
}

// —— 保存：先存浏览器，再写本地文件 ——
let saving = Promise.resolve();
function commit() {
  saving = saving.then(async () => {
    await Apps.save(rows);
    await writeFile();
  });
  return saving;
}

// —— 表格 ——
const WIDTH = { date: 132, company: 140, position: 240, status: 104, city: 96, channel: 96, resume: 104, note: 200, url: 56 };
function renderHead() {
  $('thead').replaceChildren(
    ...Apps.COLUMNS.map(([k, h]) => el('th', { textContent: h, style: `width:${WIDTH[k]}px` })),
    el('th', { style: 'width:44px', ariaLabel: '删除' })
  );
}
const STATUS_CLASS = { 待投递: 's-wait', 已投递: 's-sent', Offer: 's-offer', 已拒绝: 's-no', 已放弃: 's-no' };
function statusCell(r) {
  const sel = el('select', { className: 'cell status ' + (STATUS_CLASS[r.status] || 's-going'), ariaLabel: '状态' });
  const list = Apps.STATUSES.includes(r.status) || !r.status ? Apps.STATUSES : [r.status, ...Apps.STATUSES];
  sel.append(...list.map((s) => el('option', { value: s, textContent: s })));
  sel.value = r.status || '已投递';
  sel.addEventListener('change', () => {
    r.status = sel.value;
    sel.className = 'cell status ' + (STATUS_CLASS[r.status] || 's-going');
    commit();
    renderFilters();
  });
  return sel;
}
function textCell(r, k, label) {
  const input = el('input', { className: 'cell', value: r[k] || '', ariaLabel: label, spellcheck: false });
  if (k === 'date') input.type = 'date';
  input.addEventListener('change', () => {
    r[k] = input.value.trim();
    commit();
  });
  return input;
}
function linkCell(r) {
  if (!r.url) return el('span', { className: 'muted', textContent: '—' });
  const a = el('a', { href: r.url, target: '_blank', rel: 'noopener', title: r.url, className: 'open', textContent: '打开' });
  return a;
}
function visibleRows() {
  const q = query.toLowerCase();
  return rows.filter(
    (r) =>
      (filter === '全部' || r.status === filter) &&
      (!q || ['company', 'position', 'city', 'note', 'channel'].some((k) => String(r[k] || '').toLowerCase().includes(q)))
  );
}
function render() {
  rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const list = visibleRows();
  $('tbody').replaceChildren(
    ...list.map((r) => {
      const tr = el('tr');
      for (const [k, h] of Apps.COLUMNS) {
        const td = el('td');
        td.append(k === 'status' ? statusCell(r) : k === 'url' ? linkCell(r) : textCell(r, k, h));
        tr.append(td);
      }
      const del = el('button', { className: 'icon-del', title: '删除这一条', ariaLabel: '删除这一条', textContent: '×' });
      del.addEventListener('click', () => {
        const at = rows.indexOf(r);
        rows.splice(at, 1);
        commit();
        render();
        toast(`已删除「${r.company || '未命名'}」`, () => {
          rows.splice(at, 0, r);
          commit();
          render();
        });
      });
      tr.append(el('td', {}, del));
      return tr;
    })
  );
  $('empty').hidden = rows.length > 0;
  renderFilters();
}
function renderFilters() {
  const count = (s) => (s === '全部' ? rows.length : rows.filter((r) => r.status === s).length);
  const shown = ['全部', ...Apps.STATUSES.filter((s) => count(s))];
  if (!shown.includes(filter)) filter = '全部';
  $('filters').replaceChildren(
    ...shown.map((s) => {
      const b = el('button', { role: 'tab', ariaSelected: String(s === filter) }, s, el('span', { className: 'n', textContent: String(count(s)) }));
      b.addEventListener('click', () => {
        filter = s;
        render();
      });
      return b;
    })
  );
  // 回复率 = 有进展的（不是待投递 / 已投递）÷ 投出去的
  const sent = rows.filter((r) => r.status && r.status !== '待投递');
  const replied = sent.filter((r) => r.status !== '已投递');
  $('stats').textContent = sent.length ? `投出 ${sent.length} 份，${replied.length} 份有回音，回复率 ${Math.round((replied.length / sent.length) * 100)}%` : '';
}
$('search').addEventListener('input', (e) => {
  query = e.target.value.trim();
  render();
});
$('add').addEventListener('click', () => {
  rows.unshift({ id: Apps.id(), date: Apps.today(), company: '', position: '', status: '已投递', city: '', channel: '官网', resume: '', note: '', url: '' });
  filter = '全部';
  commit();
  render();
  $('tbody').querySelector('input:not([type="date"])').focus();
});

// —— 导入 / 导出 CSV ——
function merge(base, extra) {
  const keys = new Set(base.map(Apps.rowKey));
  return [...base, ...extra.filter((r) => !keys.has(Apps.rowKey(r)))];
}
$('import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const got = Apps.parseCSV(await f.text());
  if (!got.length) return toast('没读到记录：第一行要有「日期、公司、职位、状态」这些列名');
  const before = rows.length;
  rows = merge(rows, got);
  await commit();
  render();
  toast(`导入了 ${rows.length - before} 条` + (rows.length - before < got.length ? `（${got.length - (rows.length - before)} 条已经有了）` : ''));
});
$('export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([Apps.toCSV(rows)], { type: 'text/csv;charset=utf-8' }));
  el('a', { href: url, download: '投递记录.csv' }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// —— 本地 CSV 文件（浏览器的文件访问权限；文件句柄存在 IndexedDB 里，下次打开还认得）——
const idb = (mode, fn) =>
  new Promise((resolve, reject) => {
    const open = indexedDB.open('resume-autofill', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('handles');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('handles', mode);
      const req = fn(tx.objectStore('handles'));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    };
  });
const getHandle = () => idb('readonly', (s) => s.get('applications.csv'));
const setHandle = (h) => idb('readwrite', (s) => (h ? s.put(h, 'applications.csv') : s.delete('applications.csv')));
let handle = null;
let ready = false; // 有读写权限

async function writeFile() {
  if (!handle || !ready) return;
  try {
    const w = await handle.createWritable();
    await w.write(Apps.toCSV(rows));
    await w.close();
    const f = await handle.getFile();
    await chrome.storage.local.set({ applicationsSync: { at: f.lastModified, keys: rows.map(Apps.rowKey) } });
    showFile();
  } catch (e) {
    showFile('没写进文件：如果它正在 Excel 里打开，关掉后回到这页就会补写。');
  }
}
// 文件比上次同步新（在 Excel 里改过）：以文件为准，再加上这期间扩展新记的
async function syncFromFile() {
  if (!handle || !ready) return;
  const f = await handle.getFile();
  const { applicationsSync: sync = { at: 0, keys: [] } } = await chrome.storage.local.get('applicationsSync');
  if (f.lastModified > sync.at && f.size) {
    const fromFile = Apps.parseCSV(await f.text());
    const old = new Set(sync.keys);
    rows = merge(fromFile, rows.filter((r) => !old.has(Apps.rowKey(r))));
    await Apps.save(rows);
    render();
  }
  await writeFile();
}
function showFile(err) {
  $('file-link').hidden = ready;
  $('file-new').hidden = !!handle;
  $('file-unlink').hidden = !handle;
  $('file-link').textContent = handle && !ready ? `重新连接「${handle.name}」` : '连接本地 CSV 文件';
  $('file-state').className = err ? 'err' : 'muted';
  $('file-state').textContent =
    err ||
    (ready
      ? `已同步到本地文件「${handle.name}」：这里的改动会写进去，在 Excel 里改了，回到这页就会读进来。`
      : handle
        ? '浏览器需要你再允许一次读写这个文件。'
        : '记录存在这个浏览器里。想在 Excel 里看，可以连到一个本地 CSV 文件，比如 resume-autofill 文件夹里的「投递记录.csv」。');
}
const CSV_TYPE = [{ description: 'CSV 表格', accept: { 'text/csv': ['.csv'] } }];
async function use(h) {
  handle = h;
  ready = (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
  await setHandle(h);
  // 新连上的文件：把文件里已有的记录合进来（不当作「在 Excel 里删过」）
  await chrome.storage.local.set({ applicationsSync: { at: 0, keys: [] } });
  await syncFromFile();
  showFile();
}
$('file-link').addEventListener('click', async () => {
  try {
    if (handle && !ready) {
      ready = (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
      await syncFromFile();
      return showFile();
    }
    const [h] = await showOpenFilePicker({ types: CSV_TYPE, id: 'applications' });
    await use(h);
  } catch (e) {
    if (e.name !== 'AbortError') showFile('没能打开这个文件：' + e.message);
  }
});
$('file-new').addEventListener('click', async () => {
  try {
    await use(await showSaveFilePicker({ suggestedName: '投递记录.csv', types: CSV_TYPE, id: 'applications' }));
  } catch (e) {
    if (e.name !== 'AbortError') showFile('没能新建文件：' + e.message);
  }
});
$('file-unlink').addEventListener('click', async () => {
  handle = null;
  ready = false;
  await setHandle(null);
  showFile();
});

// 别处（侧边栏）新记了一条：表格跟着更新
chrome.storage.local.onChanged.addListener(async (changes) => {
  if (!changes.applications) return;
  const now = changes.applications.newValue || [];
  if (JSON.stringify(now) === JSON.stringify(rows)) return;
  const focused = document.activeElement && document.activeElement.classList.contains('cell');
  rows = now;
  if (!focused) render();
  writeFile();
});
// 从 Excel 切回来：看看文件有没有改过
window.addEventListener('focus', () => syncFromFile().catch(() => {}));

(async () => {
  renderHead();
  rows = await Apps.list();
  render();
  if (!('showOpenFilePicker' in window)) {
    $('file-bar').hidden = true;
    return;
  }
  handle = (await getHandle()) || null;
  if (handle) ready = (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
  showFile();
  await syncFromFile().catch(() => showFile('读不到之前连接的文件，可能被移走或删掉了。'));
})();
