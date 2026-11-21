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
    flash('已保存 ✓');
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
function control(field, value, onInput) {
  let input;
  if (field.type === 'textarea') {
    input = el('textarea', { value: value || '' });
  } else if (field.type === 'select') {
    input = el('select', {}, field.options.map((o) => el('option', { value: o, textContent: o || '（未填）' })));
    input.value = value || field.fallback || '';
  } else {
    input = el('input', { type: field.type || 'text', value: value || '', autocomplete: 'off', placeholder: field.placeholder || '' });
  }
  input.addEventListener('input', () => onInput(input.value));
  let body = input;
  if (field.type === 'password') {
    const toggle = el('button', { type: 'button', textContent: '显示' });
    toggle.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      toggle.textContent = input.type === 'password' ? '显示' : '隐藏';
    });
    body = el('div', { className: 'pw' }, [input, toggle]);
  }
  return el('label', { className: 'field' + (field.type === 'textarea' ? ' wide' : '') }, [
    el('span', { textContent: field.label }),
    body,
  ]);
}

function grid(sec, data) {
  return el(
    'div',
    { className: 'grid' },
    sec.fields.map((f) =>
      control(f, data[f.key], (v) => {
        data[f.key] = v;
        queueSave();
      })
    )
  );
}

function renderSection(sec) {
  const card = el('section', { className: 'card' }, [el('h2', { textContent: sec.title })]);
  if (sec.hint) card.append(el('p', { className: 'muted', textContent: sec.hint }));

  if (!sec.repeat) {
    if (!profile[sec.id] || typeof profile[sec.id] !== 'object') profile[sec.id] = {};
    card.append(grid(sec, profile[sec.id]));
    return card;
  }

  if (!Array.isArray(profile[sec.id])) profile[sec.id] = [];
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
  const add = el('button', { type: 'button', textContent: `+ 添加${sec.title}` });
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
  $('photo-name').textContent = files.photo ? `照片：${files.photo.name}（${kb(files.photo.size)}）` : '还没有照片。';
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

// —— 资料方案（PM / DA …）——
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
  const name = (prompt('新方案的名字（如 PM、DA）。内容先复制当前这套，再改不一样的地方。') || '').trim();
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
$('auto-password').addEventListener('change', async (e) => {
  const { settings = {} } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, autoPassword: e.target.checked } });
  flash('已保存 ✓');
});

// —— 页面状态 ——
async function refresh() {
  const state = await Vault.state();
  const locked = state === 'locked';
  $('locked').hidden = !locked;
  $('editor').hidden = locked;
  if (locked) return;

  const encrypted = state === 'unlocked';
  $('sec-state').textContent = encrypted
    ? '🔒 已用主密码加密（AES-256）。关闭浏览器后自动锁定。'
    : '⚠️ 尚未设置主密码：资料以明文保存在本机浏览器中。建议设置主密码，尤其是在保存了网申密码或身份证号时。';
  $('pw-set').textContent = encrypted ? '修改主密码' : '设置主密码';
  $('pw-remove').hidden = !encrypted;
  $('lock-now').hidden = !encrypted;
  book = await Vault.book();
  if (cur == null || cur >= book.list.length) cur = Math.min(book.active || 0, book.list.length - 1);
  book.list[cur].data ||= {};
  profile = book.list[cur].data;
  files = await Vault.loadFiles();
  const { settings = {} } = await chrome.storage.local.get('settings');
  $('auto-password').checked = settings.autoPassword !== false;
  renderEditor();
  renderFiles();
  renderSites();
}

async function wipe() {
  if (!confirm('确定清空全部资料、文件和主密码吗？此操作无法撤销。')) return;
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

$('pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('pw-msg');
  const a = $('pw1').value;
  msg.className = 'err';
  if (a.length < 8) return (msg.textContent = '主密码至少 8 位。');
  if (a !== $('pw2').value) return (msg.textContent = '两次输入不一致。');
  await saveNow();
  await Vault.setPassword(a);
  $('pw1').value = $('pw2').value = '';
  msg.className = 'ok';
  msg.textContent = '主密码已设置。请牢记——忘记后无法找回。';
  refresh();
});

$('pw-remove').addEventListener('click', async () => {
  if (!confirm('取消加密后资料将以明文保存，确定吗？')) return;
  await saveNow();
  await Vault.removePassword();
  refresh();
});

$('lock-now').addEventListener('click', async () => {
  await saveNow();
  await Vault.lock();
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
