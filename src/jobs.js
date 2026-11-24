// 岗位（商店版）：各大厂招聘官网的公开岗位，随扩展打包在 src/jobs-data 里，浏览时不联网。
// 左边列表、右边详情；按 地点 / 类型 / 经验 / 类别 / 公司 筛选。收藏会进「投递记录」的收藏列。
(() => {
  const $ = (id) => document.getElementById(id);
  if (!$('view-jobs')) return;
  const h = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.flat().filter((k) => k != null && k !== false));
    return n;
  };
  const svg = (paths, size = 16) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    n.setAttribute('viewBox', '0 0 20 20');
    n.setAttribute('width', size);
    n.setAttribute('height', size);
    n.setAttribute('aria-hidden', 'true');
    n.innerHTML = paths;
    return n;
  };
  const BOOKMARK = '<path d="M5.5 3h9v14l-4.5-3.2L5.5 17z"/>';
  const PIN = '<path d="M10 17.5s-5.5-5-5.5-9a5.5 5.5 0 0111 0c0 4-5.5 9-5.5 9z"/><circle cx="10" cy="8.5" r="2"/>';

  let data = null; // { fetched, companies, jobs: [[slug, id, title, cities, type, level, category, posted]] }
  let companyName = {};
  let shown = [];
  let limit = 60;
  let current = null;
  let saved = new Map(); // 岗位网址 → 投递记录
  const details = new Map();
  const FILTERS = [
    { key: 'city', name: '地点', col: 3, multi: true },
    { key: 'type', name: '类型', col: 4, order: ['校招', '实习', '社招'] },
    { key: 'level', name: '经验', col: 5, order: ['应届', '1-3年', '3-5年', '5-10年', '10年以上', '不限'] },
    { key: 'category', name: '类别', col: 6, order: ['技术', '算法', '数据', '产品', '设计', '运营', '市场', '销售', '金融', '硬件', '游戏', '职能', '其他'] },
  ];
  const picked = JSON.parse(localStorage.getItem('ra-job-filters') || '{}');
  for (const f of FILTERS) picked[f.key] = new Set(picked[f.key] || []);
  let query = '';
  const persist = () => localStorage.setItem('ra-job-filters', JSON.stringify(Object.fromEntries(FILTERS.map((f) => [f.key, [...picked[f.key]]]))));

  const hue = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  function logo(name, big) {
    const n = h('span', { className: 'logo' + (big ? ' big' : ''), textContent: (name || '？').slice(0, 1).toUpperCase() });
    n.style.setProperty('--h', hue(name || ''));
    n.setAttribute('aria-hidden', 'true');
    return n;
  }
  // 地点分「中国」「国外」两组：港澳台算中国
  const CN_LATIN = /beijing|shanghai|shenzhen|guangzhou|hangzhou|chengdu|nanjing|wuhan|suzhou|xi'?an|hong ?kong|macau|taipei|china/i;
  const ABROAD = /新加坡|美国|日本|东京|大阪|韩国|首尔|英国|伦敦|德国|法国|巴黎|荷兰|阿姆斯特丹|加拿大|多伦多|澳大利亚|悉尼|墨尔本|印度|印尼|雅加达|越南|胡志明|河内|泰国|曼谷|马来西亚|吉隆坡|菲律宾|马尼拉|巴西|圣保罗|墨西哥|迪拜|阿联酋|沙特|利雅得|以色列|俄罗斯|莫斯科|西班牙|意大利|瑞士|瑞典|芬兰|波兰|土耳其|硅谷|西雅图|纽约|洛杉矶|旧金山|圣何塞|海外|欧洲|北美|中东|非洲|拉美|东南亚|全球/;
  const regionOf = (city) => (CN_LATIN.test(city) ? '中国' : ABROAD.test(city) || (/[a-z]/i.test(city) && !/[\u4e00-\u9fa5]/.test(city)) ? '国外' : '中国');
  const REGION = (r) => '@' + r; // 「中国（全部）」「国外（全部）」这两个选项的值
  const valuesOf = (j, f) => {
    if (f.key !== 'city') return [j[f.col]];
    const cities = j[3] ? j[3].split('|') : [];
    return [...cities, ...new Set(cities.map((c) => REGION(regionOf(c))))];
  };
  const ago = (d) => {
    if (!d) return '';
    const days = Math.floor((Date.now() - new Date(d + 'T00:00:00')) / 86400000);
    if (days <= 0) return '今天发布';
    if (days < 30) return `${days} 天前发布`;
    if (days < 365) return `${Math.floor(days / 30)} 个月前发布`;
    return d;
  };

  // —— 筛选 ——
  function counts(f) {
    const m = new Map();
    for (const j of data.jobs) for (const v of valuesOf(j, f)) if (v) m.set(v, (m.get(v) || 0) + 1);
    return m;
  }
  function renderFilters() {
    $('j-filters').replaceChildren(
      ...FILTERS.map((f) => {
        const n = picked[f.key].size;
        const d = h('details', { className: 'menu' }, h('summary', { className: 'chip-btn' + (n ? ' on' : '') }, f.name, n ? h('span', { className: 'n', textContent: String(n) }) : null));
        d.addEventListener('toggle', () => {
          if (!d.open) return;
          document.querySelectorAll('#j-filters details[open]').forEach((o) => o !== d && (o.open = false));
          d.append(options(f, d));
        });
        return d;
      }),
      ...(FILTERS.some((f) => picked[f.key].size) ? [clearBtn()] : [])
    );
  }
  function clearBtn() {
    const b = h('button', { className: 'link', textContent: '清除筛选' });
    b.addEventListener('click', () => {
      FILTERS.forEach((f) => picked[f.key].clear());
      persist();
      renderFilters();
      apply();
    });
    return b;
  }
  function options(f, d) {
    d.querySelector('.menu-pop')?.remove();
    const c = counts(f);
    let list = [...c.entries()];
    if (f.order) list.sort((a, b) => f.order.indexOf(a[0]) - f.order.indexOf(b[0]));
    else if (f.key === 'company') list = list.map(([k, v]) => [k, v, companyName[k] || k]).sort((a, b) => b[1] - a[1]);
    else list.sort((a, b) => b[1] - a[1]);
    const pop = h('div', { className: 'menu-pop j-pop' });
    const box = h('div', { className: 'j-opts' });
    // 地点：先「中国（全部）」「国外（全部）」，再按中国、国外分两组列城市
    if (f.key === 'city') {
      const real = list.filter(([k]) => !k.startsWith('@'));
      const head = (r) => [REGION(r), c.get(REGION(r)) || 0, `${r}（全部）`];
      list = [head('中国'), head('国外'), ['#中国'], ...real.filter(([k]) => regionOf(k) === '中国'), ['#国外'], ...real.filter(([k]) => regionOf(k) === '国外')];
    }
    const draw = (q) =>
      box.replaceChildren(
        ...list
          .filter(([k, , label]) => !q || (!k.startsWith('#') && !k.startsWith('@') && String(label || k).includes(q)))
          .slice(0, 400)
          .map(([k, v, label]) => {
            if (k.startsWith('#')) return h('div', { className: 'j-group', textContent: k.slice(1) });
            const cb = h('input', { type: 'checkbox', checked: picked[f.key].has(k) });
            cb.addEventListener('change', () => {
              cb.checked ? picked[f.key].add(k) : picked[f.key].delete(k);
              persist();
              apply();
              d.querySelector('summary').replaceChildren(f.name, picked[f.key].size ? h('span', { className: 'n', textContent: String(picked[f.key].size) }) : '');
              d.querySelector('summary').classList.toggle('on', !!picked[f.key].size);
            });
            return h('label', { className: 'check' }, cb, h('span', { textContent: label || k }), h('span', { className: 'muted', textContent: String(v) }));
          })
      );
    if (list.length > 12) {
      const s = h('input', { type: 'search', placeholder: '搜索' + f.name });
      s.addEventListener('input', () => draw(s.value.trim()));
      pop.append(s);
      setTimeout(() => s.focus({ preventScroll: true }));
    }
    draw('');
    pop.append(box);
    pop.addEventListener('click', (e) => e.stopPropagation());
    return pop;
  }
  document.addEventListener('click', (e) => {
    for (const d of document.querySelectorAll('#j-filters details[open]')) if (!d.contains(e.target)) d.open = false;
  });

  function apply() {
    const q = query.toLowerCase();
    shown = data.jobs.filter((j) => {
      for (const f of FILTERS) {
        const want = picked[f.key];
        if (want.size && !valuesOf(j, f).some((v) => want.has(v))) return false;
      }
      return !q || j[2].toLowerCase().includes(q) || (companyName[j[0]] || '').toLowerCase().includes(q);
    });
    if ($('j-sort').value === 'company') shown.sort((a, b) => (companyName[a[0]] || '').localeCompare(companyName[b[0]] || '', 'zh') || b[7].localeCompare(a[7]));
    limit = 60;
    $('j-count').textContent = `找到 ${shown.length.toLocaleString()} 个岗位`;
    renderList();
    if (!current || !shown.includes(current)) select(shown[0] || null);
  }
  $('j-search').addEventListener('input', (e) => {
    query = e.target.value.trim();
    apply();
  });
  $('j-sort').addEventListener('change', apply);

  // —— 列表 ——
  function item(j) {
    const name = companyName[j[0]] || j[0];
    const b = h(
      'button',
      { className: 'j-item' + (j === current ? ' on' : '') },
      logo(name),
      h(
        'span',
        { className: 'j-item-main' },
        h('b', { textContent: j[2] }),
        h('span', { textContent: name }),
        h('span', { className: 'muted', textContent: [j[3].split('|').slice(0, 2).join('、') + (j[3].split('|').length > 2 ? ' 等' : ''), j[4]].filter(Boolean).join(' · ') }),
        j[7] ? h('span', { className: 'muted small', textContent: ago(j[7]) }) : null
      ),
      saved.has(j[0] + ':' + j[1]) ? h('span', { className: 'j-saved', title: '已收藏' }, svg(BOOKMARK, 15)) : null
    );
    b.addEventListener('click', () => select(j));
    return b;
  }
  function renderList() {
    const items = shown.slice(0, limit).map(item);
    if (shown.length > limit) {
      const more = h('div', { className: 'j-more muted', textContent: '加载更多…' });
      new IntersectionObserver((es, ob) => {
        if (es.some((e) => e.isIntersecting)) {
          ob.disconnect();
          limit += 60;
          renderList();
        }
      }).observe(more);
      items.push(more);
    }
    if (!shown.length) items.push(h('div', { className: 'j-none muted', textContent: '没有符合条件的岗位，试试少选几个筛选条件。' }));
    $('j-items').replaceChildren(...items);
  }

  // —— 数据：只在打开「在线更新岗位」时下载，存在本机；关着时完全不联网 ——
  // 下载回来的只当 JSON 数据用：逐项检查类型，网址只认 http(s)，显示时一律用 textContent
  const DAY = 86400000;
  const str = (v, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
  const safeUrl = (u) => {
    try {
      const x = new URL(str(u, 2000));
      return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '';
    } catch {
      return '';
    }
  };
  function checkIndex(raw) {
    if (!raw || !Array.isArray(raw.jobs) || !Array.isArray(raw.companies)) throw new Error('岗位数据格式不对');
    return {
      fetched: str(raw.fetched, 20),
      companies: raw.companies.filter((c) => c && c.slug).map((c) => ({ slug: str(c.slug, 40), name: str(c.name, 40), site: safeUrl(c.site) })),
      jobs: raw.jobs.filter((r) => Array.isArray(r) && r.length >= 8).map((r) => r.slice(0, 8).map((x) => str(x, 200))),
    };
  }
  function checkDetail(raw) {
    const out = {};
    if (raw && typeof raw === 'object') for (const [id, v] of Object.entries(raw)) if (v && typeof v === 'object') out[str(id, 80)] = { u: safeUrl(v.u), d: str(v.d), r: str(v.r) };
    return out;
  }
  const online = async () => ((await chrome.storage.local.get('settings')).settings || {}).onlineJobs === true;
  // 自己抓过数据（scripts/jobs/run.py 生成 build/site/）再「加载已解压的扩展」时，直接读本机这份，不联网。
  // 商店包里没有 build/，这一步会找不到文件，照常走在线下载。
  let fromLocal = false;
  async function readLocal(path) {
    try {
      const res = await fetch(chrome.runtime.getURL('build/site/' + path), { cache: 'no-store' });
      return res.ok ? JSON.parse(await res.text()) : null;
    } catch {
      return null;
    }
  }
  // 不带 cookie、不带来源页、不带任何资料或标识
  async function download(path) {
    let last;
    for (const base of globalThis.JOB_SOURCES || []) {
      try {
        const res = await fetch(base + path, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return JSON.parse(await res.text());
      } catch (e) {
        last = e;
      }
    }
    throw last || new Error('没有配置岗位数据地址');
  }
  async function detailOf(j) {
    if (!details.has(j[0]))
      details.set(
        j[0],
        (async () => {
          if (fromLocal) return checkDetail(await readLocal(`c/${encodeURIComponent(j[0])}.json`));
          const key = 'jobsDetail:' + j[0];
          const cached = (await chrome.storage.local.get(key))[key];
          if (cached && cached.fetched === data.fetched) return cached.data;
          if (!(await online())) return cached ? cached.data : null;
          try {
            const fresh = checkDetail(await download(`c/${encodeURIComponent(j[0])}.json`));
            await chrome.storage.local.set({ [key]: { fetched: data.fetched, data: fresh } });
            return fresh;
          } catch {
            details.delete(j[0]); // 下次点开再试
            return cached ? cached.data : null;
          }
        })()
      );
    const all = await details.get(j[0]);
    const site = (data.companies.find((c) => c.slug === j[0]) || {}).site || '';
    return all && all[j[1]] ? all[j[1]] : { u: site, d: '', r: '', missing: true };
  }
  async function select(j) {
    current = j;
    for (const b of document.querySelectorAll('.j-item.on')) b.classList.remove('on');
    const idx = shown.indexOf(j);
    if (idx >= 0 && idx < limit) $('j-items').children[idx]?.classList.add('on');
    if (!j) return $('j-detail').replaceChildren();
    const d = await detailOf(j);
    if (current !== j) return;
    const name = companyName[j[0]] || j[0];
    const key = j[0] + ':' + j[1];
    const saveBtn = h('button', { className: 'icon-btn' + (saved.has(key) ? ' on' : ''), title: saved.has(key) ? '取消收藏' : '收藏到投递记录', ariaLabel: '收藏' }, svg(BOOKMARK, 18));
    saveBtn.addEventListener('click', () => toggleSave(j, d));
    const applyBtn = h('button', { className: 'primary', textContent: '去官网申请', disabled: !d.u });
    applyBtn.addEventListener('click', () => applyTo(j, d));
    const chips = [j[4], j[5] !== '不限' ? j[5] : '', j[6]].filter(Boolean);
    $('j-detail').replaceChildren(
      ...[h(
        'header',
        { className: 'j-d-head' },
        logo(name, true),
        h('div', { className: 'j-d-co' }, h('b', { textContent: name }), h('span', { className: 'muted', textContent: `官网数据 · 更新于 ${data.fetched || '—'}` })),
        h('div', { className: 'j-d-actions' }, saveBtn, applyBtn)
      ),
      h('h1', { textContent: j[2] }),
      h('p', { className: 'muted', textContent: [j[6], ago(j[7])].filter(Boolean).join(' · ') }),
      h(
        'div',
        { className: 'j-chips' },
        chips.map((c) => h('span', { className: 'pill-chip', textContent: c })),
        j[3] ? h('span', { className: 'pill-chip' }, svg(PIN, 13), j[3].split('|').slice(0, 4).join('、') + (j[3].split('|').length > 4 ? ` 等 ${j[3].split('|').length} 地` : '')) : null
      ),
      h('hr'),
      d.d ? h('section', {}, h('h2', { textContent: '岗位职责' }), h('div', { className: 'j-text', textContent: d.d })) : null,
      d.r ? h('section', {}, h('h2', { textContent: '任职要求' }), h('div', { className: 'j-text', textContent: d.r })) : null,
      !d.d && !d.r ? h('p', { className: 'muted', textContent: d.missing ? '详细介绍没能下载（可能没联网或没打开在线更新），请到官网查看。' : '这个岗位的详细介绍请到官网查看。' }) : null,
      d.u ? h('p', {}, h('a', { href: d.u, target: '_blank', rel: 'noopener noreferrer', textContent: d.missing ? '打开公司招聘官网 ↗' : '在官网查看原文 ↗' })) : null,
      ].filter(Boolean)
    );
    $('j-detail').scrollTop = 0;
  }

  // —— 收藏 / 申请 ——
  const recordOf = (j, d, status) => ({
    id: Apps.id(),
    date: Apps.today(),
    company: companyName[j[0]] || j[0],
    position: j[2],
    status,
    city: j[3].split('|')[0] || '',
    channel: '岗位库',
    resume: '',
    note: '',
    url: d.u,
    archived: '',
    jobId: j[0] + ':' + j[1],
  });
  async function toggleSave(j, d) {
    const rows = await Apps.list();
    const key = j[0] + ':' + j[1];
    const at = rows.findIndex((r) => r.jobId === key || (r.url && r.url === d.u));
    if (at >= 0 && rows[at].status === '收藏') rows.splice(at, 1);
    else if (at < 0) rows.unshift(recordOf(j, d, '收藏'));
    else return; // 已经投递过了，不动
    await Apps.save(rows);
  }
  async function applyTo(j, d) {
    // 记下这是从哪个岗位点进去的：到了网申页面，填完后问要不要记录时，公司和职位直接用这里的
    const { pendingJobs = {} } = await chrome.storage.session.get('pendingJobs');
    try {
      pendingJobs[new URL(d.u).origin] = { company: companyName[j[0]] || j[0], title: j[2], city: j[3].split('|')[0] || '', url: d.u, at: Date.now() };
      await chrome.storage.session.set({ pendingJobs });
    } catch {}
    window.open(d.u, '_blank', 'noopener');
  }
  async function loadSaved() {
    saved = new Map((await Apps.list()).filter((r) => r.jobId).map((r) => [r.jobId, r]));
  }
  chrome.storage.local.onChanged.addListener(async (c) => {
    if (!c.applications || !data) return;
    await loadSaved();
    renderList();
    if (current) select(current);
  });

  // 没有数据可显示时：说明原因，给一个下一步（不白屏）
  function notice(title, text, action) {
    $('j-count').textContent = '';
    $('j-items').replaceChildren();
    const box = h('div', { className: 'j-notice' }, h('b', { textContent: title }), h('p', { className: 'muted', textContent: text }));
    if (action) box.append(action);
    $('j-detail').replaceChildren(box);
  }
  function button(label, fn, primary) {
    const b = h('button', { className: primary ? 'primary' : '', textContent: label });
    b.addEventListener('click', fn);
    return b;
  }
  const goSetting = () => {
    location.hash = '#profile';
    setTimeout(() => document.getElementById('s-online')?.scrollIntoView({ block: 'center' }), 50);
  };
  function show(index, note) {
    data = index;
    companyName = Object.fromEntries(data.companies.map((c) => [c.slug, c.name]));
    details.clear();
    $('j-date').textContent = `数据更新于 ${data.fetched || '—'}` + (note ? ` · ${note}` : '');
    $('j-date').className = note && !fromLocal ? 'j-date warn' : 'j-date muted';
    renderFilters();
    apply();
  }
  let loading = null;
  async function load(force) {
    if (loading) return loading;
    loading = (async () => {
      await loadSaved();
      const local = await readLocal('index.json');
      fromLocal = !!local;
      if (local) {
        try {
          return show(checkIndex(local), '本机数据');
        } catch {
          fromLocal = false;
        }
      }
      const { jobsIndex: cached } = await chrome.storage.local.get('jobsIndex');
      const on = await online();
      if (!on) {
        if (cached) return show(cached.data, '在线更新已关闭');
        return notice('在线更新岗位已关闭', '岗位数据不打包在扩展里。打开「在线更新岗位」后，扩展会下载各大厂官网的公开岗位数据（只下载，不上传任何东西）。关着时扩展完全不联网。', button('去打开', goSetting, true));
      }
      if (cached && !force && Date.now() - cached.at < DAY) return show(cached.data);
      $('j-count').textContent = '正在下载最新岗位…';
      try {
        const fresh = checkIndex(await download('index.json'));
        await chrome.storage.local.set({ jobsIndex: { at: Date.now(), data: fresh } });
        show(fresh);
      } catch {
        if (cached) return show(cached.data, '这次没更新成功，显示的是上次下载的数据');
        notice('岗位数据没下载下来', '第一次使用需要联网下载岗位数据。请检查网络后重试。', button('重试', () => load(true), true));
      }
    })().finally(() => (loading = null));
    return loading;
  }
  // 资料页里的「在线更新岗位」开关
  const toggle = document.getElementById('online-jobs');
  if (toggle) {
    online().then((on) => (toggle.checked = on));
    toggle.addEventListener('change', async () => {
      const { settings = {} } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, onlineJobs: toggle.checked } });
      data = null;
    });
  }
  document.addEventListener('ra-view', (e) => {
    if (e.detail === 'jobs' && !data) load();
  });
  if (location.hash.startsWith('#jobs')) load();
})();
