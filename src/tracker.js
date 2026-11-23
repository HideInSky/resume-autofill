// 投递记录：看板。五列 收藏 / 已投递 / 面试中 / Offer / 已结束，卡片可以拖到别的列。
// 数据存在浏览器里；可以连到一个本地 CSV 文件，改动自动写进去，在 Excel 里改了切回来会读进来。
(() => {
  const $ = (id) => document.getElementById(id);
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
  const ICON = {
    saved: '<path d="M5.5 3h9v14l-4.5-3.2L5.5 17z"/>',
    applied: '<path d="M3 10l14-6-5 13-2.5-5.5z"/><path d="M9.5 11.5L17 4"/>',
    interview: '<rect x="3" y="4" width="14" height="10" rx="2"/><path d="M7 17h6M10 14v3"/>',
    offer: '<path d="M3 7.5h14v9.5H3zM10 7.5v9.5M3 11h14"/><path d="M10 7.5C8 7.5 6 6.5 6.8 4.6 7.8 2.6 10 5 10 7.5c0-2.5 2.2-4.9 3.2-2.9.8 1.9-1.2 2.9-3.2 2.9"/>',
    closed: '<circle cx="10" cy="10" r="7"/><path d="M7.5 7.5l5 5M12.5 7.5l-5 5"/>',
    pin: '<path d="M10 17.5s-5.5-5-5.5-9a5.5 5.5 0 0111 0c0 4-5.5 9-5.5 9z"/><circle cx="10" cy="8.5" r="2"/>',
  };
  let rows = [];
  let resumes = []; // 「文档」里的简历文件名
  let view = localStorage.getItem('ra-tracker-view') || 'board';
  let scope = 'active'; // active / archived
  let query = '';
  let editing = null;

  function toast(text, undo) {
    const box = $('status');
    box.replaceChildren(text);
    if (undo) {
      const b = h('button', { className: 'link', textContent: '撤销' });
      b.addEventListener('click', () => {
        undo();
        box.hidden = true;
      });
      box.append(' ', b);
    }
    box.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (box.hidden = true), undo ? 6000 : 2500);
  }

  let saving = Promise.resolve();
  function commit() {
    saving = saving.then(async () => {
      await Apps.save(rows);
      await writeFile();
    });
    return saving;
  }

  // —— 看板 ——
  const md = (d) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
    return m ? `${Number(m[2])}月${Number(m[3])}日` : '';
  };
  const hue = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  function logo(company) {
    const n = h('span', { className: 'logo', textContent: (company || '？').trim().slice(0, 1).toUpperCase() });
    n.style.setProperty('--h', hue(company || ''));
    n.setAttribute('aria-hidden', 'true');
    return n;
  }
  function card(r) {
    const c = h('article', { className: 'tcard', draggable: true, tabIndex: 0 });
    c.dataset.id = r.id;
    const stage = Apps.stageOf(r.status);
    const sub = stage.statuses.length > 1 && r.status && r.status !== stage.drop ? h('span', { className: 'tag', textContent: r.status }) : null;
    c.append(
      h('div', { className: 'tcard-head' }, logo(r.company), h('span', { className: 'tcard-co', textContent: r.company || '未填公司' }), sub),
      h('div', { className: 'tcard-title', textContent: r.position || '未填职位' }),
      r.city ? h('div', { className: 'tcard-meta' }, svg(ICON.pin, 13), h('span', { textContent: r.city })) : null,
      h('div', { className: 'tcard-foot', textContent: (r.status === '收藏' ? '收藏于 ' : '记录于 ') + (md(r.date) || '—') })
    );
    c.addEventListener('click', () => openEditor(r));
    c.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') openEditor(r);
    });
    c.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', r.id);
      e.dataTransfer.effectAllowed = 'move';
      c.classList.add('dragging');
    });
    c.addEventListener('dragend', () => c.classList.remove('dragging'));
    return c;
  }
  const matches = (r) => {
    const q = query.toLowerCase();
    return !q || ['company', 'position', 'city', 'note'].some((k) => String(r[k] || '').toLowerCase().includes(q));
  };
  const EMPTY = {
    saved: '在「岗位」里收藏的会出现在这里',
    applied: '填过、投过的网申会自动记在这里',
    interview: '把卡片拖到这里',
    offer: '把卡片拖到这里',
    closed: '被拒或放弃的拖到这里',
  };
  function render() {
    const inScope = rows.filter((r) => (scope === 'archived') === !!r.archived);
    const shown = inScope.filter(matches).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    for (const b of $('t-view').children) b.setAttribute('aria-selected', String(b.dataset.view === view));
    $('board').className = { list: 'tlist', chart: 'tchart' }[view] || 'board';
    if (view === 'list') renderList(shown);
    else if (view === 'chart') renderChart(shown);
    else renderBoard(shown);
    renderScope();
  }
  function renderBoard(shown) {
    $('board').replaceChildren(
      ...Apps.STAGES.map((g) => {
        const items = shown.filter((r) => Apps.stageOf(r.status).id === g.id);
        const col = h(
          'section',
          { className: 'col col-' + g.id },
          h('header', { className: 'col-head' }, svg(ICON[g.id]), h('b', { textContent: g.name }), h('span', { className: 'n', textContent: String(items.length) })),
          items.length
            ? h('div', { className: 'col-body' }, items.map(card))
            : h('div', { className: 'col-empty' }, h('b', { textContent: '还没有' }), h('span', { textContent: EMPTY[g.id] }))
        );
        col.addEventListener('dragover', (e) => {
          e.preventDefault();
          col.classList.add('over');
        });
        col.addEventListener('dragleave', () => col.classList.remove('over'));
        col.addEventListener('drop', (e) => {
          e.preventDefault();
          col.classList.remove('over');
          const r = rows.find((x) => x.id === e.dataTransfer.getData('text/plain'));
          if (!r || Apps.stageOf(r.status).id === g.id) return;
          // 「收藏」只放从「岗位」里收藏的
          if (g.id === 'saved' && !r.jobId) return toast('「收藏」只放从「岗位」里收藏的岗位');
          Apps.setStatus(r, g.drop);
          commit();
          render();
        });
        return col;
      })
    );
  }
  function renderScope() {
    const archived = rows.filter((r) => r.archived).length;
    $('t-scope').replaceChildren(
      ...[
        ['active', '进行中', rows.length - archived],
        ['archived', '已归档', archived],
      ].map(([id, name, n]) => {
        const b = h('button', { role: 'tab', ariaSelected: String(scope === id) }, name, h('span', { className: 'n', textContent: String(n) }));
        b.addEventListener('click', () => {
          scope = id;
          render();
        });
        return b;
      })
    );
    // 回复率 = 有进展的 ÷ 投出去的（不算收藏）
    const sent = rows.filter((r) => Apps.stageOf(r.status).id !== 'saved');
    const replied = sent.filter((r) => !['已投递', '待投递', ''].includes(r.status || ''));
    $('t-stats').textContent = sent.length ? `投出 ${sent.length} 份 · ${replied.length} 份有回音 · 回复率 ${Math.round((replied.length / sent.length) * 100)}%` : '';
  }
  // —— 列表：一行一条。公司 / 职位 / 城市，进度条，状态；下面一行是日期、渠道、简历版本、备注 ——
  const statusesFor = (r) => Apps.STATUSES.filter((s) => s !== '收藏' || r.jobId || r.status === '收藏');
  function select(options, value, onChange, label) {
    const list = value && !options.includes(value) ? [value, ...options] : options;
    const sel = h('select', { ariaLabel: label }, list.map((o) => h('option', { value: o, textContent: o || '（未选）' })));
    sel.value = value || list[0];
    sel.addEventListener('change', () => onChange(sel.value));
    sel.addEventListener('click', (e) => e.stopPropagation());
    return sel;
  }
  const resumeLabel = (name) => String(name || '').replace(/\.(pdf|docx?)$/i, '');
  function resumeSelect(r) {
    const names = resumes.slice();
    if (r.resume && !names.includes(r.resume)) names.unshift(r.resume);
    const sel = h('select', { ariaLabel: '简历版本' }, h('option', { value: '', textContent: '（未选）' }), names.map((n) => h('option', { value: n, textContent: resumeLabel(n) })));
    sel.value = r.resume || '';
    sel.addEventListener('change', () => {
      r.resume = sel.value;
      commit();
    });
    return sel;
  }
  function inlineInput(r, key, placeholder, label) {
    const input = h('input', { className: 'inline', value: r[key] || '', placeholder, ariaLabel: label });
    input.addEventListener('change', () => {
      r[key] = input.value.trim();
      commit();
    });
    return input;
  }
  function stepper(r) {
    const at = Apps.stepOf(r.status);
    const closed = Apps.stageOf(r.status).id === 'closed';
    return h(
      'div',
      { className: 'stepper' + (closed ? ' closed' : '') },
      Apps.STEP_NAMES.map((name, i) =>
        h('div', { className: 'step' + (i <= at ? ' done' : '') + (i === at ? ' now' : '') }, h('span', { className: 'step-name', textContent: name }), h('i', { className: 'dot' }))
      ),
      closed ? h('span', { className: 'step-closed', textContent: r.status }) : null
    );
  }
  function renderList(shown) {
    if (!shown.length) {
      $('board').replaceChildren(h('div', { className: 'col-empty' }, h('b', { textContent: '还没有记录' }), h('span', { textContent: '填过、投过的网申会自动记在这里' })));
      return;
    }
    $('board').replaceChildren(
      ...shown.map((r) => {
        const status = select(statusesFor(r), r.status || '已投递', (v) => {
          Apps.setStatus(r, v);
          commit();
          render();
        }, '状态');
        status.className = 'status-sel';
        const more = h('button', { className: 'icon-x', title: '更多', ariaLabel: '更多', textContent: '⋯' });
        more.addEventListener('click', () => openEditor(r));
        return h(
          'article',
          { className: 'trow' },
          h(
            'div',
            { className: 'trow-main' },
            logo(r.company),
            h('div', { className: 'trow-id' }, h('b', { textContent: r.company || '未填公司' }), h('span', { textContent: r.position || '未填职位' }), h('span', { className: 'trow-city' }, svg(ICON.pin, 13), inlineInput(r, 'city', '城市', '城市'))),
            stepper(r),
            h('div', { className: 'trow-status' }, status, more)
          ),
          h(
            'div',
            { className: 'trow-meta' },
            h('span', { className: 'meta' }, h('small', { textContent: '日期' }), h('span', { textContent: r.date || '—' })),
            h('label', { className: 'meta' }, h('small', { textContent: '渠道' }), select(Apps.CHANNELS, r.channel || '官网', (v) => ((r.channel = v), commit()), '渠道')),
            h('label', { className: 'meta' }, h('small', { textContent: '简历版本' }), resumeSelect(r)),
            h('label', { className: 'meta grow' }, h('small', { textContent: '备注' }), inlineInput(r, 'note', '写点什么，比如面试时间', '备注'))
          )
        );
      })
    );
  }
  // —— 图表：每天投了多少（获得面试及以上的标黄），下面三张小卡片看回复、节奏、转化 ——
  const SVG = 'http://www.w3.org/2000/svg';
  const s = (tag, attrs = {}, text) => {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  };
  const dayMs = 86400000;
  const parse = (d) => (/^\d{4}-\d{2}-\d{2}/.test(d || '') ? new Date(d.slice(0, 10) + 'T00:00:00') : null);
  const ymd = (t) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  // 这一条最远走到了哪一步（被拒前到过面试也算）
  const furthest = (r) => Math.max(Apps.stepOf(r.status), ...(r.history || []).map((h) => Apps.stepOf(h.s)), 1);
  function renderChart(all) {
    const sent = all.filter((r) => r.status !== '收藏' && parse(r.date));
    const today = parse(Apps.today()).getTime();
    const first = Math.min(today, ...sent.map((r) => parse(r.date).getTime()));
    const days = Math.max(14, Math.min(90, Math.round((today - first) / dayMs) + 1));
    const start = today - (days - 1) * dayMs;
    const buckets = Array.from({ length: days }, (_, i) => ({ t: start + i * dayMs, blue: 0, gold: 0 }));
    for (const r of sent) {
      const i = Math.round((parse(r.date).getTime() - start) / dayMs);
      if (i < 0 || i >= days) continue;
      furthest(r) >= 3 ? buckets[i].gold++ : buckets[i].blue++;
    }
    const max = Math.max(4, ...buckets.map((b) => b.blue + b.gold));
    const W = 1000, H = 260, L = 34, B = 26, T = 10;
    const bw = (W - L) / days;
    const y = (v) => T + (H - T - B) * (1 - v / max);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'bars', role: 'img', 'aria-label': '每天投递的数量' });
    const step = Math.ceil(max / 4);
    for (let v = 0; v <= max; v += step) {
      svg.append(s('line', { x1: L, x2: W, y1: y(v), y2: y(v), class: 'grid' }), s('text', { x: L - 8, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, String(v)));
    }
    const every = Math.ceil(days / 10);
    buckets.forEach((b, i) => {
      const x = L + i * bw + bw * 0.18;
      const w = bw * 0.64;
      const g = s('g');
      const total = b.blue + b.gold;
      const d = new Date(b.t);
      g.append(s('title', {}, `${d.getMonth() + 1}月${d.getDate()}日：投了 ${total} 份` + (b.gold ? `，其中 ${b.gold} 份拿到了面试` : '')));
      if (b.blue) g.append(s('rect', { x, y: y(b.blue), width: w, height: y(0) - y(b.blue), rx: 3, class: 'blue' }));
      if (b.gold) g.append(s('rect', { x, y: y(total), width: w, height: y(b.blue) - y(total), rx: 3, class: 'gold' }));
      g.append(s('rect', { x: L + i * bw, y: T, width: bw, height: H - T - B, class: 'hit' }));
      svg.append(g);
      if (i % every === 0 || i === days - 1) svg.append(s('text', { x: L + i * bw + bw / 2, y: H - 6, class: 'axis', 'text-anchor': 'middle' }, `${d.getMonth() + 1}/${d.getDate()}`));
    });
    const inRange = sent.filter((r) => parse(r.date).getTime() >= start).length;
    const chart = h(
      'section',
      { className: 'chart-card' },
      h('header', {}, h('div', {}, h('h2', { textContent: '每天投递' }), h('span', { className: 'muted', textContent: `最近 ${days} 天投了 ${inRange} 份` })),
        h('div', { className: 'legend' }, h('span', { className: 'key blue' }, '只投递 / 笔试'), h('span', { className: 'key gold' }, '拿到面试及以上'))),
      svg
    );
    $('board').replaceChildren(chart, h('h2', { className: 'insights-title', textContent: '概况' }), insights(sent, today));
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const stat = (label, value, unit) => h('div', { className: 'stat' }, h('span', { className: 'muted', textContent: label }), h('b', {}, value, unit ? h('small', { textContent: ' ' + unit }) : null));
  function insights(sent, today) {
    // 回复：第一次从「已投递」往前走（或被拒）的那天
    const replies = sent
      .map((r) => {
        const h1 = (r.history || []).find((x) => x.s !== '已投递' && x.s !== '收藏' && x.s !== '待投递' && parse(x.at));
        return h1 ? (parse(h1.at) - parse(r.date)) / dayMs : null;
      })
      .filter((v) => v != null && v >= 0);
    const waiting = sent.filter((r) => ['已投递', '待投递', ''].includes(r.status || ''));
    const longest = waiting.length ? Math.max(...waiting.map((r) => Math.round((today - parse(r.date)) / dayMs))) : 0;
    const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const byDay = Array(7).fill(0);
    sent.forEach((r) => byDay[parse(r.date).getDay()]++);
    const top = byDay.indexOf(Math.max(...byDay));
    const first = sent.length ? Math.min(...sent.map((r) => parse(r.date).getTime())) : today;
    const span = Math.max(1, Math.round((today - first) / dayMs) + 1);
    const last30 = sent.filter((r) => today - parse(r.date) < 30 * dayMs).length;
    const year = sent.filter((r) => r.date.startsWith(String(new Date(today).getFullYear()))).length;
    const reach = (n) => sent.filter((r) => furthest(r) >= n).length;
    const bar = (label, a, b) =>
      h('div', { className: 'funnel' }, h('div', { className: 'funnel-row' }, h('span', { textContent: label }), h('b', { textContent: pct(a, b) + '%' })), h('div', { className: 'meter' }, h('i', { style: `width:${pct(a, b)}%` })), h('span', { className: 'muted small', textContent: `${a} / ${b}` }));
    return h(
      'div',
      { className: 'insights' },
      h('section', { className: 'chart-card' }, h('h3', { textContent: '回复与跟进' }),
        stat('平均多久有回音', replies.length ? (replies.reduce((x, y2) => x + y2, 0) / replies.length).toFixed(1) : '—', replies.length ? '天' : ''),
        h('hr'), h('div', { className: 'kv' }, h('span', { textContent: '还没回音的比例' }), h('b', { textContent: pct(waiting.length, sent.length) + '%' })),
        h('hr'), h('div', { className: 'kv' }, h('span', { textContent: '等得最久的一份' }), h('b', { textContent: `${longest} 天` }))),
      h('section', { className: 'chart-card' }, h('h3', { textContent: '投递节奏' }),
        stat('一共投了', String(sent.length), '份'),
        h('hr'), h('div', { className: 'kv' }, h('span', { textContent: '投得最多的是' }), h('b', { textContent: sent.length ? `${WEEK[top]}（${byDay[top]} 份）` : '—' })),
        h('hr'), h('div', { className: 'grid4' }, stat('平均每天', (sent.length / span).toFixed(1)), stat('平均每周', ((sent.length / span) * 7).toFixed(1)), stat('最近 30 天', String(last30)), stat('今年', String(year)))),
      h('section', { className: 'chart-card' }, h('h3', { textContent: '转化' }),
        bar('投递 → 笔试 / 沟通', reach(2), sent.length), bar('笔试 → 面试', reach(3), reach(2)), bar('面试 → Offer', reach(4), reach(3)),
        h('p', { className: 'muted small', textContent: '回音和转化按你改状态的日期算；改过状态的记录越多越准。' }))
    );
  }

  $('t-view').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (!b) return;
    view = b.dataset.view;
    localStorage.setItem('ra-tracker-view', view);
    render();
  });

  $('t-search').addEventListener('input', (e) => {
    query = e.target.value.trim();
    render();
  });

  // —— 编辑一条（弹出的面板）——
  const FIELD_TYPE = { date: 'date', url: 'url' };
  function openEditor(r) {
    editing = r;
    $('t-dialog-title').textContent = r.company ? `${r.company} · ${r.position || '未填职位'}` : '添加记录';
    $('t-fields').replaceChildren(
      ...Apps.COLUMNS.filter(([k]) => k !== 'archived').map(([k, label]) => {
        let input;
        // 记下来的日期、公司、职位、链接不能改；新加的一条才能填
        const locked = rows.includes(r) && ['date', 'company', 'position', 'url'].includes(k);
        if (k === 'status') {
          input = h('select', {}, statusesFor(r).map((s) => h('option', { value: s, textContent: s })));
          input.value = Apps.STATUSES.includes(r.status) ? r.status : '已投递';
        } else if (k === 'channel') {
          const list = r.channel && !Apps.CHANNELS.includes(r.channel) ? [r.channel, ...Apps.CHANNELS] : Apps.CHANNELS;
          input = h('select', {}, list.map((s) => h('option', { value: s, textContent: s })));
          input.value = r.channel || '官网';
        } else if (k === 'resume') {
          const list = r.resume && !resumes.includes(r.resume) ? [r.resume, ...resumes] : resumes;
          input = h('select', {}, h('option', { value: '', textContent: '（未选）' }), list.map((n) => h('option', { value: n, textContent: resumeLabel(n) })));
          input.value = r.resume || '';
        } else if (locked) {
          input = h('input', { value: r[k] || '—', readOnly: true, className: 'locked', tabIndex: -1 });
        } else if (k === 'note') {
          input = h('textarea', { value: r[k] || '', rows: 3 });
        } else {
          input = h('input', { type: FIELD_TYPE[k] || 'text', value: r[k] || '' });
        }
        if (!locked) input.name = k;
        return h('label', { className: 'field' + (k === 'note' || k === 'url' ? ' wide' : '') }, h('span', { textContent: label }), input);
      })
    );
    const known = rows.includes(r);
    $('t-archive').textContent = r.archived ? '取消归档' : '归档';
    $('t-open').hidden = !r.url;
    if (r.url) $('t-open').href = r.url;
    $('t-delete').hidden = !known;
    $('t-archive').hidden = !known;
    $('t-dialog').showModal();
  }
  $('t-dialog').addEventListener('close', () => {
    const r = editing;
    editing = null;
    if ($('t-dialog').returnValue !== 'save' || !r) return;
    for (const el of $('t-fields').querySelectorAll('[name]')) {
      if (el.name === 'status') Apps.setStatus(r, el.value);
      else r[el.name] = el.value.trim();
    }
    if (!r.history) r.history = [{ s: r.status, at: r.date || Apps.today() }];
    if (!rows.includes(r)) rows.unshift(r);
    commit();
    render();
  });
  $('t-delete').addEventListener('click', () => {
    const r = editing;
    const at = rows.indexOf(r);
    rows.splice(at, 1);
    $('t-dialog').close();
    commit();
    render();
    toast(`已删除「${r.company || '未命名'}」`, () => {
      rows.splice(at, 0, r);
      commit();
      render();
    });
  });
  $('t-archive').addEventListener('click', () => {
    const r = editing;
    r.archived = r.archived ? '' : '是';
    $('t-dialog').close();
    commit();
    render();
    toast(r.archived ? '已归档，在「已归档」里能找到' : '已移回进行中');
  });
  $('t-add').addEventListener('click', () =>
    openEditor({ id: Apps.id(), date: Apps.today(), company: '', position: '', status: '已投递', city: '', channel: '官网', resume: '', note: '', url: '', archived: '' })
  );

  // —— 导入 / 导出 CSV ——
  function merge(base, extra) {
    const keys = new Set(base.map(Apps.rowKey));
    return [...base, ...extra.filter((r) => !keys.has(Apps.rowKey(r)))];
  }
  const closeMenu = () => document.querySelectorAll('details.menu[open]').forEach((d) => (d.open = false));
  $('t-import').addEventListener('click', () => $('t-import-file').click());
  $('t-import-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    closeMenu();
    if (!f) return;
    const got = Apps.parseCSV(await f.text());
    if (!got.length) return toast('没读到记录：第一行要有「日期、公司、职位、状态」这些列名');
    const before = rows.length;
    rows = merge(rows, got);
    await commit();
    render();
    toast(`导入了 ${rows.length - before} 条` + (rows.length - before < got.length ? `，${got.length - (rows.length - before)} 条已经有了` : ''));
  });
  $('t-export').addEventListener('click', () => {
    closeMenu();
    const url = URL.createObjectURL(new Blob([Apps.toCSV(rows)], { type: 'text/csv;charset=utf-8' }));
    h('a', { href: url, download: '投递记录.csv' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  // —— 本地 CSV 文件（文件句柄存在 IndexedDB 里，下次打开还认得）——
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
  const setHandle = (fh) => idb('readwrite', (s) => (fh ? s.put(fh, 'applications.csv') : s.delete('applications.csv')));
  let handle = null;
  let ready = false;

  async function writeFile() {
    if (!handle || !ready) return;
    try {
      const w = await handle.createWritable();
      await w.write(Apps.toCSV(rows));
      await w.close();
      const f = await handle.getFile();
      await chrome.storage.local.set({ applicationsSync: { at: f.lastModified, keys: rows.map(Apps.rowKey) } });
      showFile();
    } catch {
      showFile('没写进文件：如果它正在 Excel 里打开，关掉后回到这页就会补写。');
    }
  }
  // 文件比上次同步新（在 Excel 里改过）：以文件为准，再加上这期间新记的
  async function syncFromFile() {
    if (!handle || !ready) return;
    const f = await handle.getFile();
    const { applicationsSync: sync = { at: 0, keys: [] } } = await chrome.storage.local.get('applicationsSync');
    if (f.lastModified > sync.at && f.size) {
      const old = new Set(sync.keys);
      rows = merge(Apps.parseCSV(await f.text()), rows.filter((r) => !old.has(Apps.rowKey(r))));
      await Apps.save(rows);
      render();
    }
    await writeFile();
  }
  function showFile(err) {
    $('t-file-link').hidden = ready;
    $('t-file-new').hidden = !!handle;
    $('t-file-unlink').hidden = !handle;
    $('t-file-link').textContent = handle && !ready ? `重新连接「${handle.name}」` : '连接本地 CSV 文件';
    $('t-file-state').className = err ? 'err' : 'muted';
    $('t-file-state').textContent =
      err ||
      (ready
        ? `已同步到「${handle.name}」。这里的改动会写进去；在 Excel 里改了，回到这页会读进来。`
        : handle
          ? '浏览器需要你再允许一次读写这个文件。'
          : '记录存在这个浏览器里。连到一个本地 CSV 文件（比如 resume-autofill/data 里的「投递记录.csv」），就能用 Excel 打开。');
  }
  const CSV_TYPE = [{ description: 'CSV 表格', accept: { 'text/csv': ['.csv'] } }];
  async function use(fh) {
    handle = fh;
    ready = (await fh.requestPermission({ mode: 'readwrite' })) === 'granted';
    await setHandle(fh);
    await chrome.storage.local.set({ applicationsSync: { at: 0, keys: [] } }); // 新连上的文件：把里面的记录合进来
    await syncFromFile();
    showFile();
  }
  $('t-file-link').addEventListener('click', async () => {
    try {
      if (handle && !ready) {
        ready = (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
        await syncFromFile();
        return showFile();
      }
      const [fh] = await showOpenFilePicker({ types: CSV_TYPE, id: 'applications' });
      await use(fh);
    } catch (e) {
      if (e.name !== 'AbortError') showFile('没能打开这个文件：' + e.message);
    }
  });
  $('t-file-new').addEventListener('click', async () => {
    try {
      await use(await showSaveFilePicker({ suggestedName: '投递记录.csv', types: CSV_TYPE, id: 'applications' }));
    } catch (e) {
      if (e.name !== 'AbortError') showFile('没能新建文件：' + e.message);
    }
  });
  $('t-file-unlink').addEventListener('click', async () => {
    handle = null;
    ready = false;
    await setHandle(null);
    showFile();
  });

  // 别处（网申页面上的弹窗、岗位页的收藏）新记了一条：看板跟着更新
  chrome.storage.local.onChanged.addListener((changes) => {
    if (!changes.applications) return;
    const now = changes.applications.newValue || [];
    if (JSON.stringify(now) === JSON.stringify(rows)) return;
    rows = now;
    render();
    writeFile();
  });
  window.addEventListener('focus', () => syncFromFile().catch(() => {}));

  async function loadResumes() {
    try {
      if ((await Vault.state()) === 'locked') return;
      resumes = (((await Vault.loadFiles()) || {}).resumes || []).slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).map((f) => f.name);
    } catch {}
  }
  document.addEventListener('ra-files-changed', async () => {
    await loadResumes();
    render();
  });

  (async () => {
    rows = await Apps.list();
    await loadResumes();
    render();
    if (!('showOpenFilePicker' in window)) {
      for (const id of ['t-file-link', 't-file-new']) $(id).hidden = true;
      $('t-file-state').textContent = '这个浏览器不支持直接读写本地文件，可以用导入 / 导出。';
      return;
    }
    handle = (await getHandle()) || null;
    if (handle) ready = (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
    showFile();
    await syncFromFile().catch(() => showFile('读不到之前连接的文件，可能被移走或删掉了。'));
  })();
})();
