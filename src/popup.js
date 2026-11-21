const $ = (id) => document.getElementById(id);
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
  profile = locked ? {} : await Vault.load();
  const ready = !locked && hasData(profile);
  $('locked').hidden = !locked;
  $('empty').hidden = locked || ready;
  $('ready').hidden = !ready;
  $('lock').hidden = state !== 'unlocked';
  if (locked) $('pw').focus();
  if (!ready) return;
  renderCopyList();
  renderSite();
  renderResumes();
}

// —— 在此网站自动填写（= 授予 / 撤销这个网站的权限）——
const siteOrigin = () => {
  try {
    const u = new URL(tab.url);
    return /^https?:$/.test(u.protocol) ? u.origin + '/*' : null;
  } catch {
    return null;
  }
};
async function renderSite() {
  const origin = siteOrigin();
  $('site-row').hidden = !origin;
  if (!origin) return;
  const { origins = [] } = await chrome.permissions.getAll();
  const all = origins.includes('<all_urls>') || origins.includes('*://*/*');
  $('opt-site').checked = all || origins.includes(origin);
  $('opt-site').disabled = all;
  $('site-label').textContent = all ? '已对所有网站开启自动填写' : `在此网站自动填写（${new URL(tab.url).hostname}）`;
}
$('opt-site').addEventListener('change', async (e) => {
  const origin = siteOrigin();
  if (!origin) return;
  // 授权弹窗可能会让这个小窗口关掉；后台会监听权限变化并完成设置
  if (e.target.checked) await chrome.permissions.request({ origins: [origin] });
  else await chrome.permissions.remove({ origins: [origin] });
  renderSite();
});

// —— 选择上传哪份简历 ——
async function renderResumes() {
  const files = await Vault.loadFiles();
  const list = files.resumes || [];
  $('resume-row').hidden = list.length < 2;
  $('resume-pick').replaceChildren(
    ...list.map((f, i) => {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = f.name;
      return o;
    })
  );
  $('resume-pick').value = String(files.active || 0);
}
$('resume-pick').addEventListener('change', async (e) => {
  const files = await Vault.loadFiles();
  files.active = Number(e.target.value);
  await Vault.saveFiles(files);
});

// 自动填不上的字段，点一下复制、手动粘贴
function renderCopyList() {
  const rows = [];
  for (const sec of RESUME_SCHEMA.sections) {
    if (sec.id === 'custom') continue;
    const items = sec.repeat ? profile[sec.id] || [] : [profile[sec.id] || {}];
    items.forEach((item, i) => {
      for (const f of sec.fields) {
        if (!item[f.key]) continue;
        rows.push({ label: f.label + (sec.repeat && items.length > 1 ? ` #${i + 1}` : ''), value: item[f.key], secret: f.type === 'password' });
      }
    });
  }
  $('copy').replaceChildren(
    ...rows.map((r) => {
      const btn = document.createElement('button');
      const label = document.createElement('b');
      const value = document.createElement('span');
      label.textContent = r.label;
      value.textContent = r.secret ? '••••••••' : r.value;
      btn.append(label, value);
      btn.addEventListener('click', async () => {
        await navigator.clipboard.writeText(r.value);
        label.textContent = '已复制 ✓';
        setTimeout(() => (label.textContent = r.label), 1000);
      });
      return btn;
    })
  );
}

async function fill() {
  const result = $('result');
  result.className = 'muted';
  result.style.whiteSpace = 'pre-line';
  result.textContent = '填写中…（下拉框要一个个点开选，可能要几秒）';
  $('fill').disabled = true;
  try {
    const reports = await runFill({
      tabId: tab.id,
      opts: { overwrite: $('opt-overwrite').checked, fillPassword: $('opt-password').checked },
    });
    const filled = reports.flatMap((r) => r.filled);
    const kept = reports.reduce((n, r) => n + r.kept, 0);
    const unknown = reports.reduce((n, r) => n + r.unknown, 0);
    const noData = [...new Set(reports.flatMap((r) => r.noData))];

    result.className = filled.length ? 'ok' : 'muted';
    const lines = [`已填写 ${filled.length} 项（页面上以绿框标出）`];
    if (kept) lines.push(`${kept} 项已有内容，未改动`);
    if (unknown) lines.push(`${unknown} 项没认出来或选项里没找到，请手动填写`);
    if (noData.length) lines.push(`资料里还没填：${noData.slice(0, 6).join('、')}${noData.length > 6 ? ' 等' : ''}`);
    lines.push('请检查后自行保存 / 提交——扩展不会替你点。');
    result.textContent = lines.join('\n');
  } catch (e) {
    result.className = 'err';
    result.textContent = '这个页面无法填写（浏览器内置页面或应用商店页面不允许扩展操作）。' + (e?.message ? `\n${e.message}` : '');
  }
  $('fill').disabled = false;
}

$('locked').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ok = await Vault.unlock($('pw').value);
  $('pw').value = '';
  $('pw-msg').textContent = ok ? '' : '密码不对';
  if (ok) refresh();
});
$('fill').addEventListener('click', fill);
$('setup').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('edit').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('lock').addEventListener('click', async () => {
  await Vault.lock();
  refresh();
});

refresh();
