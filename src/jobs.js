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
  const valuesOf = (j, f) => (f.key === 'city' ? (j[3] ? j[3].split('|') : []) : [j[f.col]]);
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
    const draw = (q) =>
      box.replaceChildren(
        ...list
          .filter(([k, , label]) => !q || String(label || k).includes(q))
          .slice(0, 80)
          .map(([k, v, label]) => {
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

  // —— 详情 ——
  async function detailOf(j) {
    if (!details.has(j[0])) details.set(j[0], fetch(chrome.runtime.getURL(`src/jobs-data/c/${j[0]}.json`)).then((r) => r.json()));
    return (await details.get(j[0]))[j[1]] || {};
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
    const applyBtn = h('button', { className: 'primary', textContent: '去官网申请' });
    applyBtn.addEventListener('click', () => applyTo(j, d));
    const chips = [j[4], j[5] !== '不限' ? j[5] : '', j[6]].filter(Boolean);
    $('j-detail').replaceChildren(
      h(
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
      !d.d && !d.r ? h('p', { className: 'muted', textContent: '这个岗位的详细介绍请到官网查看。' }) : null,
      h('p', {}, h('a', { href: d.u, target: '_blank', rel: 'noopener', textContent: '在官网查看原文 ↗' }))
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

  let loading = null;
  async function load() {
    if (data) return;
    loading ??= (async () => {
      $('j-count').textContent = '正在载入岗位…';
      try {
        data = await fetch(chrome.runtime.getURL('src/jobs-data/index.json')).then((r) => r.json());
      } catch {
        $('j-count').textContent = '岗位数据没载入成功。';
        return;
      }
      companyName = Object.fromEntries(data.companies.map((c) => [c.slug, c.name]));
      await loadSaved();
      renderFilters();
      apply();
    })();
    return loading;
  }
  document.addEventListener('ra-view', (e) => {
    if (e.detail === 'jobs') load();
  });
  if (location.hash.startsWith('#jobs')) load();
})();
