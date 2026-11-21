const $ = (id) => document.getElementById(id);
const SECTIONS = RESUME_SCHEMA.sections;
const MAX_FILE = 5 * 1024 * 1024;
let book = { active: 0, list: [] }; // 全部资料方案
let cur = null; // 正在编辑第几套
let profile = {}; // = book.list[cur].data
let files = {};

const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  children.forEach((c) => node.append(c));
  return node;
};

// —— 保存（改动后自动保存）——
let saveTimer;
let statusTimer;
function flash(text, cls = 'ok') {
  const s = $('status');
  s.textContent = text;
  s.className = cls;
  s.hidden = false;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (s.hidden = true), 1800);
}
async function guarded(fn) {
  try {
    await fn();
    flash('已保存');
  } catch (e) {
    flash(e.message === 'locked' ? '已锁定，未保存——请刷新页面重新解锁' : '保存失败：' + e.message, 'err');
  }
}
const saveNow = () => {
  clearTimeout(saveTimer);
  return guarded(() => Vault.saveBook(book));
};
const queueSave = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
};

// —— 资料表单 ——
// 颜色：红 = 必填还没填；蓝 = 用的是默认值；灰 = 已填
function control(field, value, onInput) {
  let input;
  let val = value || '';
  if (field.type === 'textarea') {
    input = el('textarea');
  } else if (field.type === 'select') {
    input = el('select', {}, field.options.map((o) => el('option', { value: o, textContent: o || '（未填）' })));
  } else if (field.type === 'month' || field.type === 'date') {
    // 日期一律用数字写（2025-09），不用浏览器自带的日期控件——它会按系统语言显示成 September 2025
    input = el('input', { type: 'text', inputMode: 'numeric', autocomplete: 'off', placeholder: field.type === 'month' ? '如 2025-09' : '如 2000-07-28' });
  } else {
    input = el('input', { type: field.type || 'text', autocomplete: 'off', placeholder: field.placeholder || '' });
  }
  input.value = val || field.fallback || '';
  const paint = () => {
    input.classList.toggle('dflt', !val && !!field.fallback && input.value === field.fallback);
    input.classList.toggle('need', !val && !!field.req && !field.fallback);
  };
  paint();
  input.addEventListener('input', () => {
    val = input.value;
    onInput(val);
    paint();
  });
  if (field.type === 'month' || field.type === 'date') {
    // 输完后把 2025.9、2025年9月、20250901 这类写法统一成 2025-09 / 2025-09-01
    input.addEventListener('change', () => {
      const tidy = normDate(input.value.trim().replace(/^(\d{4})(\d{2})(\d{2})?$/, (m, y, mo, d) => [y, mo, d].filter(Boolean).join('-')), field.type);
      if (tidy === input.value) return;
      input.value = val = tidy;
      onInput(val);
      paint();
    });
  }
  let body = input;
  if (field.type === 'password') {
    const toggle = el('button', { type: 'button', textContent: '显示' });
    toggle.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      toggle.textContent = input.type === 'password' ? '显示' : '隐藏';
    });
    body = el('div', { className: 'pw' }, [input, toggle]);
  }
  const title = el('span', { textContent: field.label });
  if (field.req) title.append(el('b', { className: 'req', textContent: ' *' }));
  return el('label', { className: 'field' + (field.type === 'textarea' ? ' wide' : '') }, [title, body]);
}

// 期望城市：三层，每层最多 3 个，可以拖动换层 / 换顺序。填表时从上到下、从左到右依次用。
const TIER_NAMES = ['第一层（最想去）', '第二层', '第三层'];
const DEFAULT_CITY = '全国各地';
function tiersControl(field, data) {
  if (!Array.isArray(data.cities)) data.cities = [[data.city].filter(Boolean), [data.city2].filter(Boolean), [DEFAULT_CITY]];
  const tiers = data.cities;
  while (tiers.length < 3) tiers.push([]);
  const wrap = el('div', { className: 'field wide' });
  let drag = null;
  const changed = () => {
    queueSave();
    render();
  };
  const move = (t, at) => {
    if (!drag) return;
    const same = drag.t === t;
    if (!same && tiers[t].length >= 3) return flash('每层最多 3 个城市', 'err');
    const [city] = tiers[drag.t].splice(drag.i, 1);
    if (at == null || at > tiers[t].length) at = tiers[t].length;
    tiers[t].splice(same && at > drag.i ? at - 1 : at, 0, city);
    drag = null;
    changed();
  };
  function render() {
    const title = el('span', { textContent: field.label }, [el('b', { className: 'req', textContent: ' *' })]);
    const rows = tiers.map((list, t) => {
      const row = el('div', { className: 'tier' + (t === 0 && !list.length ? ' need' : '') }, [el('b', { className: 'tier-name', textContent: TIER_NAMES[t] })]);
      row.addEventListener('dragover', (e) => e.preventDefault());
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        move(t, null);
      });
      list.forEach((city, i) => {
        const del = el('button', { type: 'button', className: 'link', textContent: '×', title: '删除' });
        del.addEventListener('click', () => {
          list.splice(i, 1);
          changed();
        });
        const chip = el('span', { className: 'chip' + (city === DEFAULT_CITY ? ' dflt' : ''), draggable: true }, [city + ' ', del]);
        chip.addEventListener('dragstart', () => (drag = { t, i }));
        chip.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          move(t, i);
        });
        row.append(chip);
      });
      if (!list.length) row.append(el('span', { className: 'muted', textContent: t === 0 ? '还没有城市，在下面添加' : '（空）拖到这里' }));
      return row;
    });
    const input = el('input', { placeholder: '输入城市后回车，如 上海', autocomplete: 'off' });
    const add = () => {
      const city = input.value.trim();
      if (!city) return;
      const t = tiers.findIndex((l) => l.length < 3);
      if (t < 0) return flash('三层都满了，先删掉一个', 'err');
      tiers[t].push(city);
      changed();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        add();
      }
    });
    const btn = el('button', { type: 'button', textContent: '添加' });
    btn.addEventListener('click', add);
    wrap.replaceChildren(
      title,
      ...rows,
      el('div', { className: 'row' }, [input, btn]),
      el('span', { className: 'muted', textContent: '拖动城市可以换层或换顺序。网站问第一 / 第二 / 第三意向城市时，按从上到下、从左到右的顺序依次填。' })
    );
  }
  render();
  return wrap;
}

function grid(sec, data) {
  return el(
    'div',
    { className: 'grid' },
    sec.fields
      .filter((f) => !f.hidden)
      // 必填的排前面，其余保持原来的顺序
      .sort((a, b) => (b.req ? 1 : 0) - (a.req ? 1 : 0))
      .map((f) =>
        f.type === 'tiers'
          ? tiersControl(f, data)
          : control(f, data[f.key], (v) => {
              data[f.key] = v;
              queueSave();
            })
      )
  );
}

// 还有多少必填项没填（红框的个数）
function missingCount() {
  let n = 0;
  for (const sec of SECTIONS) {
    const items = sec.repeat ? profile[sec.id] || [] : [profile[sec.id] || {}];
    for (const item of items) {
      for (const f of sec.fields) {
        if (!f.req || f.fallback) continue;
        if (f.type === 'tiers' ? !(item.cities && item.cities[0] && item.cities[0].length) : !item[f.key]) n++;
      }
    }
  }
  return n;
}

function renderSection(sec) {
  const card = el('section', { className: 'card' }, [el('h2', { textContent: sec.title })]);
  if (sec.hint) card.append(el('p', { className: 'muted', textContent: sec.hint }));

  if (!sec.repeat) {
    if (!profile[sec.id] || typeof profile[sec.id] !== 'object') profile[sec.id] = {};
    card.append(grid(sec, profile[sec.id]));
    return card;
  }

  if (!Array.isArray(profile[sec.id])) profile[sec.id] = sec.seed ? [{}] : [];
  const list = profile[sec.id];
  const rerender = () => card.replaceWith(renderSection(sec));
  list.forEach((item, i) => {
    const remove = el('button', { type: 'button', className: 'link danger', textContent: '删除' });
    remove.addEventListener('click', () => {
      list.splice(i, 1);
      saveNow();
      rerender();
    });
    card.append(
      el('div', { className: 'entry' }, [
        el('div', { className: 'entry-head' }, [el('span', { textContent: `#${i + 1}` }), remove]),
        grid(sec, item),
      ])
    );
  });
  const add = el('button', { type: 'button', textContent: `添加${sec.title.replace(/（.*）/, '')}` });
  add.addEventListener('click', () => {
    list.push({});
    rerender();
  });
  card.append(el('div', { className: 'row' }, [add]));
  if (sec.id !== 'custom' && list.length > 1) {
    card.append(el('p', { className: 'muted', textContent: '按从上到下的顺序依次填入表单的第 1、2、3… 段，顺序要和网站上的要求一致（一般是最近的在前）。' }));
  }
  return card;
}

function renderEditor() {
  $('sections').replaceChildren(
    ...['basic', 'account', 'intent', 'education', 'work', 'project', 'language', 'other', 'custom'].map((id) =>
      renderSection(SECTIONS.find((s) => s.id === id))
    )
  );
}

// —— 简历和照片文件 ——
const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB');
const saveFiles = () => guarded(() => Vault.saveFiles(files));
async function readFile(file) {
  if (file.size > MAX_FILE) throw new Error(`「${file.name}」超过 5 MB`);
  return { name: file.name, type: file.type, size: file.size, data: Vault.toB64(await file.arrayBuffer()) };
}

function renderFiles() {
  const list = files.resumes || [];
  $('resumes').replaceChildren(
    ...list.map((f, i) => {
      const del = el('button', { className: 'link danger', textContent: '删除' });
      del.addEventListener('click', () => {
        list.splice(i, 1);
        saveFiles();
        renderFiles();
      });
      return el('div', { className: 'site' }, [
        el('span', { textContent: `${f.name}（${kb(f.size)}）` }),
        del,
      ]);
    })
  );
  if (!list.length) $('resumes').append(el('span', { className: 'muted', textContent: '还没有简历文件。' }));
  $('photo-name').textContent = files.photo ? `照片：${files.photo.name}（${kb(files.photo.size)}）` : '还没有照片';
  $('del-photo').hidden = !files.photo;
  renderProfiles();
}

$('add-resume').addEventListener('click', () => $('resume-file').click());
$('resume-file').addEventListener('change', async (e) => {
  try {
    files.resumes = files.resumes || [];
    for (const f of e.target.files) files.resumes.push(await readFile(f));
    await saveFiles();
  } catch (err) {
    flash(err.message, 'err');
  }
  e.target.value = '';
  renderFiles();
});
$('set-photo').addEventListener('click', () => $('photo-file').click());
$('photo-file').addEventListener('change', async (e) => {
  try {
    if (e.target.files[0]) files.photo = await readFile(e.target.files[0]);
    await saveFiles();
  } catch (err) {
    flash(err.message, 'err');
  }
  e.target.value = '';
  renderFiles();
});
$('del-photo').addEventListener('click', () => {
  delete files.photo;
  saveFiles();
  renderFiles();
});

// —— 资料方案（不同岗位各一套）——
function renderProfiles() {
  if (!book.list.length) return;
  $('prof-pick').replaceChildren(
    ...book.list.map((p, i) => el('option', { value: i, textContent: p.name + (i === book.active ? '（默认）' : '') }))
  );
  $('prof-pick').value = String(cur);
  const list = files.resumes || [];
  $('prof-resume').replaceChildren(
    el('option', { value: '', textContent: list.length ? `（第一份：${list[0].name}）` : '（还没有简历文件）' }),
    ...list.map((f) => el('option', { value: f.name, textContent: f.name }))
  );
  const want = book.list[cur].resume;
  $('prof-resume').value = list.some((f) => f.name === want) ? want : '';
  $('prof-del').hidden = book.list.length < 2;
  $('prof-default').hidden = cur === book.active;
}
function switchTo(i) {
  cur = i;
  book.list[cur].data ||= {};
  profile = book.list[cur].data;
  renderEditor();
  renderProfiles();
}
$('prof-pick').addEventListener('change', async (e) => {
  await saveNow();
  switchTo(Number(e.target.value));
});
$('prof-new').addEventListener('click', async () => {
  const name = (prompt('新方案的名字（比如岗位类别）。内容先复制当前这套，再改不一样的地方。') || '').trim();
  if (!name) return;
  if (book.list.some((p) => p.name === name)) return flash('已经有同名的方案了', 'err');
  book.list.push({ name, data: structuredClone(profile), resume: book.list[cur].resume || '' });
  switchTo(book.list.length - 1);
  saveNow();
});
$('prof-rename').addEventListener('click', () => {
  const name = (prompt('新名字', book.list[cur].name) || '').trim();
  if (!name || book.list.some((p, i) => i !== cur && p.name === name)) return;
  book.list[cur].name = name;
  renderProfiles();
  saveNow();
});
$('prof-default').addEventListener('click', () => {
  book.active = cur;
  renderProfiles();
  saveNow();
});
$('prof-del').addEventListener('click', () => {
  if (!confirm(`确定删除「${book.list[cur].name}」这套资料吗？`)) return;
  book.list.splice(cur, 1);
  if (book.active === cur) book.active = 0;
  else if (book.active > cur) book.active--;
  switchTo(0);
  saveNow();
});
$('prof-resume').addEventListener('change', (e) => {
  book.list[cur].resume = e.target.value;
  saveNow();
});

// —— 让 AI 填：通用格式（提示词和模板都从字段定义生成，新增字段会自动带上）——
const aiField = (f) => !f.hidden && f.type !== 'tiers';
const AI_SECTIONS = () => SECTIONS.filter((s) => s.id !== 'account' && s.id !== 'custom');
function buildTemplate() {
  const out = {};
  for (const sec of AI_SECTIONS()) {
    const blank = Object.fromEntries(sec.fields.filter(aiField).map((f) => [f.key, '']));
    out[sec.id] = sec.repeat ? [blank] : blank;
  }
  return out;
}
function buildPrompt() {
  const lines = [
    '请阅读我提供的简历（PDF 或文字），把信息填进下面的 JSON 模板。只输出一个 JSON 代码块，不要输出其他文字。',
    '',
    '规则：',
    '1. 只填简历里明确写了的内容；没有的保持空字符串 ""，不要编造、不要猜。唯一的例外是标了「可推断」的字段，按说明从姓名推出来。',
    '2. 日期：年月写成 YYYY-MM，完整日期写成 YYYY-MM-DD；「至今」留空。',
    '3. 标了「数组」的段落，每段经历一个对象，按时间从近到远排列，字段和模板里的示例对象相同；没有的给空数组 []。',
    '4. 标了「只能填」的字段，只能填给出的选项之一，否则留空。',
    '5. 经历描述保留原文要点，多条用换行分隔，不要改写、不要加 Markdown 符号。',
    '6. 键名必须和模板完全一致，不要增删键。',
    '',
    '字段说明：',
  ];
  for (const sec of AI_SECTIONS()) {
    lines.push(`[${sec.id}] ${sec.title}${sec.repeat ? '（数组）' : ''}`);
    for (const f of sec.fields.filter(aiField)) {
      let note = f.label;
      if (f.ai) note += `（可推断：${f.ai}）`;
      if (f.type === 'select') note += `（只能填：${f.options.filter(Boolean).join(' / ')}）`;
      else if (f.type === 'month') note += '（YYYY-MM）';
      else if (f.type === 'date') note += '（YYYY-MM-DD）';
      else if (f.placeholder) note += `（${f.placeholder}）`;
      lines.push(`  ${f.key}: ${note}`);
    }
  }
  lines.push('', 'JSON 模板：', '```json', JSON.stringify(buildTemplate(), null, 2), '```');
  return lines.join('\n');
}
// 把「2024.9」「2024年9月」「2024/09/01」这类写法统一成 YYYY-MM(-DD)
function normDate(v, type) {
  const m = /(\d{4})\s*[-./年]\s*(\d{1,2})(?:\s*[-./月]\s*(\d{1,2}))?/.exec(v);
  if (!m) return /^\d{4}$/.test(v.trim()) && type === 'month' ? '' : v;
  const ym = `${m[1]}-${m[2].padStart(2, '0')}`;
  return type === 'date' ? `${ym}-${(m[3] || '01').padStart(2, '0')}` : ym;
}
function cleanItem(sec, raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const f of sec.fields.filter(aiField)) {
    let v = raw[f.key];
    if (v == null || typeof v === 'object') continue;
    v = String(v).trim();
    if (!v) continue;
    if (f.type === 'month' || f.type === 'date') v = normDate(v, f.type);
    if (f.type === 'select' && !f.options.includes(v)) continue;
    if (v) out[f.key] = v;
  }
  return out;
}
function importAI(text, replace) {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('没找到 JSON 内容，请把 AI 返回的整段都粘贴进来');
  let data;
  try {
    data = JSON.parse(text.slice(a, b + 1));
  } catch {
    throw new Error('内容不是合法的 JSON（可能没复制完整），让 AI 重新输出一次');
  }
  let count = 0;
  for (const sec of AI_SECTIONS()) {
    const raw = data[sec.id];
    if (sec.repeat) {
      const items = (Array.isArray(raw) ? raw : []).map((r) => cleanItem(sec, r)).filter((o) => Object.keys(o).length);
      if (items.length || replace) profile[sec.id] = items;
      count += items.reduce((n, o) => n + Object.keys(o).length, 0);
    } else {
      const item = cleanItem(sec, raw);
      profile[sec.id] = { ...(profile[sec.id] || {}), ...item };
      count += Object.keys(item).length;
    }
  }
  return count;
}
$('ai-prompt').addEventListener('click', async () => {
  await navigator.clipboard.writeText(buildPrompt());
  flash('提示词已复制，去 AI 那边粘贴');
});
$('ai-template').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(buildTemplate(), null, 2)], { type: 'application/json' }));
  el('a', { href: url, download: 'resume-autofill-template.json' }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('ai-import').addEventListener('click', async () => {
  try {
    const n = importAI($('ai-text').value, $('ai-replace').checked);
    if (!n) throw new Error('里面没有可导入的内容');
    renderEditor();
    await saveNow();
    $('ai-text').value = '';
    const miss = missingCount();
    flash(`已导入 ${n} 项到「${book.list[cur].name}」。` + (miss ? `还有 ${miss} 个必填项没填，往下找红框` : '往下检查一遍'), miss ? 'err' : 'ok');
  } catch (err) {
    flash(err.message, 'err');
  }
});

// —— 自动填写的网站 ——
async function renderSites() {
  const { origins = [] } = await chrome.permissions.getAll();
  $('sites').replaceChildren(
    ...origins.map((origin) => {
      const del = el('button', { className: 'link danger', textContent: '关闭' });
      del.addEventListener('click', async () => {
        await chrome.permissions.remove({ origins: [origin] });
        renderSites();
      });
      const name = origin === '<all_urls>' || origin === '*://*/*' ? '已打开：所有网站' : origin.replace(/\/\*$/, '');
      return el('div', { className: 'site' }, [el('span', { textContent: name }), del]);
    })
  );
  if (!origins.length) $('sites').append(el('span', { className: 'muted', textContent: '自动填写现在是关闭的。' }));
  $('revoke-all').hidden = !origins.length;
  $('grant-all').hidden = origins.includes('<all_urls>') || origins.includes('*://*/*');
}
$('grant-all').addEventListener('click', async () => {
  await chrome.permissions.request({ origins: ['<all_urls>'] });
  renderSites();
});
$('revoke-all').addEventListener('click', async () => {
  const { origins = [] } = await chrome.permissions.getAll();
  if (origins.length) await chrome.permissions.remove({ origins });
  renderSites();
});
for (const [id, key] of [['auto-password', 'autoPassword'], ['auto-save', 'autoSave']]) {
  $(id).addEventListener('change', async (e) => {
    const { settings = {} } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, [key]: e.target.checked } });
    flash('已保存');
  });
}

// —— 页面状态 ——
async function refresh() {
  const state = await Vault.state();
  const locked = state === 'locked';
  $('locked').hidden = !locked;
  $('editor').hidden = locked;
  if (locked) return;

  const encrypted = state === 'unlocked';
  $('pw-remove').hidden = !encrypted;
  book = await Vault.book();
  if (cur == null || cur >= book.list.length) cur = Math.min(book.active || 0, book.list.length - 1);
  book.list[cur].data ||= {};
  profile = book.list[cur].data;
  files = await Vault.loadFiles();
  const { settings = {} } = await chrome.storage.local.get('settings');
  $('auto-password').checked = settings.autoPassword !== false;
  $('auto-save').checked = settings.autoSave === true;
  renderEditor();
  renderFiles();
  renderSites();
}

async function wipe() {
  if (!confirm('确定清空全部资料和文件吗？此操作无法撤销。')) return;
  await Vault.wipe();
  location.reload();
}

$('unlock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ok = await Vault.unlock($('unlock-pw').value);
  $('unlock-pw').value = '';
  $('unlock-msg').textContent = ok ? '' : '密码不对';
  if (ok) refresh();
});

$('pw-remove').addEventListener('click', async () => {
  if (!confirm('取消加密后就不用再输入密码了，资料以明文保存在本机。确定吗？')) return;
  await saveNow();
  await Vault.removePassword();
  refresh();
});

$('export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' }));
  el('a', { href: url, download: 'resume-autofill-backup.json' }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('格式不对');
    if (!confirm(`导入会覆盖「${book.list[cur].name}」这套资料，确定吗？`)) return;
    profile = book.list[cur].data = data;
    renderEditor();
    await saveNow();
  } catch (err) {
    flash('导入失败：' + err.message, 'err');
  }
});

$('wipe').addEventListener('click', wipe);
$('wipe-locked').addEventListener('click', wipe);

refresh();
