// 文档：上传、查看、删除简历 PDF。网格 / 列表两种看法，最近上传的排最前。
(() => {
  const $ = (id) => document.getElementById(id);
  const h = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.flat().filter((k) => k != null && k !== false));
    return n;
  };
  const MAX = 5 * 1024 * 1024;
  let files = {};
  let book = { active: 0, list: [] };
  let view = localStorage.getItem('ra-docs-view') || 'grid';
  let query = '';
  const picked = new Set();
  const urls = new Map();

  const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB');
  const ext = (name) => (/\.(\w+)$/.exec(name) || [, ''])[1].toUpperCase() || '文件';
  function ago(t) {
    if (!t) return '较早';
    const s = (Date.now() - t) / 1000;
    if (s < 60) return '刚刚';
    if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
    if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`;
    if (s < 86400 * 365) return `${Math.floor(s / 86400 / 30)} 个月前`;
    return `${Math.floor(s / 86400 / 365)} 年前`;
  }
  function urlOf(f) {
    if (!urls.has(f.name + f.size)) {
      const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
      urls.set(f.name + f.size, URL.createObjectURL(new Blob([bytes], { type: f.type || 'application/pdf' })));
    }
    return urls.get(f.name + f.size);
  }
  // 哪几套资料在用这份（没单独选的，用第一份）
  const usedBy = (f) =>
    book.list.filter((p) => p.resume === f.name || (!p.resume && files.resumes[0] === f) || (p.resume && !files.resumes.some((x) => x.name === p.resume) && files.resumes[0] === f)).map((p) => p.name);

  async function save() {
    await Vault.saveFiles(files);
    document.dispatchEvent(new Event('ra-files-changed'));
  }
  function flash(text) {
    const box = $('status');
    box.textContent = text;
    box.hidden = false;
    clearTimeout(flash.t);
    flash.t = setTimeout(() => (box.hidden = true), 2500);
  }

  function menu(f) {
    const pop = h('div', { className: 'menu-pop' });
    const item = (label, fn, cls) => {
      const b = h('button', { type: 'button', textContent: label, className: cls || '' });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        b.closest('details').open = false;
        fn();
      });
      return b;
    };
    const def = book.list[book.active];
    pop.append(
      ...[
        item('查看', () => open(f)),
        item('重命名', () => rename(f)),
        item('下载', () => h('a', { href: urlOf(f), download: f.name }).click()),
        AI_ENDPOINT && isPdf(f) ? item('用 AI 整理进我的资料', () => offerAI(f)) : null,
        def && !usedBy(f).includes(def.name) ? item(`设为「${def.name}」使用的简历`, () => useFor(f)) : null,
        item('删除', () => remove([f]), 'danger'),
      ].filter(Boolean)
    );
    const d = h('details', { className: 'menu dots' }, h('summary', { ariaLabel: '更多操作', title: '更多操作', textContent: '⋮' }), pop);
    d.addEventListener('click', (e) => e.stopPropagation());
    return d;
  }
  const open = (f) => window.open(urlOf(f), '_blank');
  // 改名：资料方案里选的简历、投递记录里的「简历版本」一起跟着改
  async function rename(f) {
    const extOf = (/\.\w+$/.exec(f.name) || [''])[0];
    const base = f.name.slice(0, f.name.length - extOf.length);
    const input = (prompt('新的名字', base) || '').trim().replace(/[\\/:*?"<>|]/g, '');
    if (!input || input === base) return;
    const name = input + extOf;
    if (files.resumes.some((x) => x !== f && x.name === name)) return flash('已经有同名的文件了');
    const old = f.name;
    f.name = name;
    await Vault.saveFiles(files);
    book = await Vault.book();
    let changed = false;
    for (const p of book.list) if (p.resume === old) (p.resume = name), (changed = true);
    if (changed) await Vault.saveBook(book);
    const rows = await Apps.list();
    if (rows.some((r) => r.resume === old)) await Apps.save(rows.map((r) => (r.resume === old ? { ...r, resume: name } : r)));
    document.dispatchEvent(new Event('ra-files-changed'));
    render();
    flash(`已改名为「${input}」`);
  }
  async function useFor(f) {
    book = await Vault.book();
    book.list[book.active].resume = f.name;
    await Vault.saveBook(book);
    document.dispatchEvent(new Event('ra-files-changed'));
    render();
    flash(`「${book.list[book.active].name}」以后上传「${f.name}」`);
  }
  async function remove(list) {
    const names = list.map((f) => `「${f.name}」`).join('、');
    if (!confirm(`删除 ${names}？删除后不能恢复。`)) return;
    files.resumes = files.resumes.filter((f) => !list.includes(f));
    list.forEach((f) => picked.delete(f));
    await save();
    render();
    flash(`已删除 ${list.length} 份`);
  }
  function check(f) {
    const c = h('input', { type: 'checkbox', checked: picked.has(f), ariaLabel: '选择 ' + f.name });
    c.addEventListener('click', (e) => e.stopPropagation());
    c.addEventListener('change', () => {
      c.checked ? picked.add(f) : picked.delete(f);
      render();
    });
    return c;
  }
  const badge = (f) => {
    const who = usedBy(f);
    return who.length ? h('span', { className: 'tag star', textContent: '★ ' + who.join('、'), title: '这几套资料上传这份简历' }) : null;
  };

  function render() {
    const all = (files.resumes || []).slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    const list = all.filter((f) => !query || f.name.toLowerCase().includes(query.toLowerCase()));
    $('d-grid').setAttribute('aria-selected', String(view === 'grid'));
    $('d-list').setAttribute('aria-selected', String(view === 'list'));
    $('d-select-bar').hidden = !picked.size;
    $('d-count').textContent = all.length ? `${all.length} / ${DOC_LIMIT} 份` : '';
    $('d-selected').textContent = `已选 ${picked.size} 份`;
    if (!all.length) {
      const up = h('button', { className: 'primary', textContent: '上传简历 PDF' });
      up.addEventListener('click', () => $('d-file').click());
      $('docs').replaceChildren(
        h(
          'div',
          { className: 'd-empty' },
          h('b', { textContent: '先上传你的简历' }),
          h('span', { className: 'muted', textContent: `网申页面遇到上传简历的地方会自动传上去。每份不超过 5 MB，最多 ${DOC_LIMIT} 份。` }),
          AI_ENDPOINT ? h('span', { className: 'muted', textContent: '上传后可以让 AI 把简历内容整理进「我的资料」，省得一项项填。' }) : null,
          up,
          h(
            'p',
            { className: 'muted d-empty-note' },
            AI_ENDPOINT ? '不想把 PDF 上传到云端？' : '想让 AI 帮你填资料？',
            '到',
            h('a', { href: '#s-import', textContent: '「我的资料」第 1 步' }),
            '复制提示词，自己用 ChatGPT 或 Claude 整理简历，再把结果粘贴回来。'
          )
        )
      );
      return;
    }
    if (view === 'grid') {
      $('docs').replaceChildren(
        h(
          'div',
          { className: 'd-grid' },
          list.map((f) => {
            const thumb = /pdf/i.test(f.type) || /\.pdf$/i.test(f.name)
              ? h('iframe', { src: urlOf(f) + '#toolbar=0&navpanes=0&scrollbar=0&view=FitH', title: f.name, tabIndex: -1, loading: 'lazy' })
              : h('span', { className: 'd-ext', textContent: ext(f.name) });
            const c = h(
              'article',
              { className: 'd-card' + (picked.has(f) ? ' picked' : '') },
              h('div', { className: 'd-thumb' }, thumb, h('span', { className: 'd-check' }, check(f)), badge(f)),
              h('div', { className: 'd-info' }, h('div', {}, h('b', { textContent: f.name.replace(/\.\w+$/, ''), title: f.name }), h('span', { className: 'muted', textContent: `${ago(f.addedAt)} · ${ext(f.name)}` })), menu(f))
            );
            c.querySelector('.d-thumb').addEventListener('click', () => open(f));
            return c;
          })
        )
      );
    } else {
      const allPicked = list.length && list.every((f) => picked.has(f));
      const head = h('input', { type: 'checkbox', checked: allPicked, ariaLabel: '全选' });
      head.addEventListener('change', () => {
        list.forEach((f) => (head.checked ? picked.add(f) : picked.delete(f)));
        render();
      });
      $('docs').replaceChildren(
        h(
          'div',
          { className: 'd-table' },
          h('div', { className: 'd-row d-headrow' }, head, h('span', { textContent: '名称' }), h('span', { textContent: '文件' }), h('span', { textContent: '上传时间' }), h('span', { textContent: '大小' }), h('span')),
          list.map((f) => {
            const r = h(
              'div',
              { className: 'd-row' + (picked.has(f) ? ' picked' : '') },
              check(f),
              h('span', { className: 'd-name' }, h('b', { textContent: f.name.replace(/\.\w+$/, ''), title: f.name }), badge(f)),
              h('span', { className: 'muted', textContent: ext(f.name) }),
              h('span', { className: 'muted', textContent: ago(f.addedAt) }),
              h('span', { className: 'muted', textContent: kb(f.size) }),
              menu(f)
            );
            r.addEventListener('click', () => open(f));
            return r;
          })
        )
      );
    }
  }

  // —— 用 AI 把简历整理进「我的资料」（用户同意后才把这份 PDF 发到服务器）——
  const isPdf = (f) => /pdf/i.test(f.type || '') || /\.pdf$/i.test(f.name);
  function offerAI(f) {
    const dlg = $('ai-dialog');
    $('ai-file').textContent = f.name;
    Telemetry.send('ai_offer');
    dlg.onclose = () => {
      const choice = dlg.returnValue === 'parse' ? 'parse' : 'skip';
      Telemetry.send('ai_consent', { choice });
      if (choice === 'parse') parseAI(f);
    };
    dlg.returnValue = '';
    dlg.showModal();
  }
  let parsing = false;
  async function parseAI(f) {
    if (parsing) return;
    parsing = true;
    const t0 = Date.now();
    const box = $('status');
    box.textContent = `正在整理「${f.name}」，大约要 20 秒…`;
    box.hidden = false;
    clearTimeout(flash.t);
    let err = '';
    try {
      const res = await fetch(AI_ENDPOINT + '/v1/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ install: await Telemetry.id(), pdf: f.data }),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.text) {
        err = out.error || 'http_' + res.status;
        throw new Error(out.message || 'AI 整理失败了，过一会儿再试');
      }
      // 交给「我的资料」那边导入（和手动粘贴导入走同一条路）
      const result = await new Promise((resolve) => {
        document.addEventListener('ra-ai-imported', (e) => resolve(e.detail), { once: true });
        document.dispatchEvent(new CustomEvent('ra-ai-import', { detail: { text: out.text, source: f.name } }));
      });
      if (result.error) {
        err = 'import';
        throw new Error(result.error);
      }
      Telemetry.send('ai_parse', { ok: true, ms: Date.now() - t0, fields: result.count });
      location.hash = '#s-fill';
    } catch (e) {
      if (!err) err = 'network';
      Telemetry.send('ai_parse', { ok: false, ms: Date.now() - t0, err });
      flash(e.message && err !== 'network' ? e.message : '连不上 AI 整理服务，检查一下网络再试');
    } finally {
      parsing = false;
    }
  }

  $('d-grid').addEventListener('click', () => {
    view = 'grid';
    localStorage.setItem('ra-docs-view', view);
    render();
  });
  $('d-list').addEventListener('click', () => {
    view = 'list';
    localStorage.setItem('ra-docs-view', view);
    render();
  });
  $('d-search').addEventListener('input', (e) => {
    query = e.target.value.trim();
    render();
  });
  $('d-clear').addEventListener('click', () => {
    picked.clear();
    render();
  });
  $('d-delete').addEventListener('click', () => remove([...picked]));
  $('d-upload').addEventListener('click', () => $('d-file').click());
  $('d-file').addEventListener('change', async (e) => {
    const chosen = [...e.target.files];
    e.target.value = '';
    files = await Vault.loadFiles();
    files.resumes = files.resumes || [];
    let n = 0;
    let lastPdf = null;
    let refused = 0;
    for (const f of chosen) {
      if (f.size > MAX) {
        flash(`「${f.name}」超过 5 MB，没有上传`);
        continue;
      }
      // 最多 DOC_LIMIT 份（同名的是替换旧版本，不算新的一份）
      if (!files.resumes.some((x) => x.name === f.name) && files.resumes.length >= DOC_LIMIT) {
        refused++;
        continue;
      }
      const data = Vault.toB64(await f.arrayBuffer());
      // 同名的当作新版本，替换旧的
      files.resumes = files.resumes.filter((x) => x.name !== f.name);
      const item = { name: f.name, type: f.type, size: f.size, data, addedAt: Date.now() };
      files.resumes.push(item);
      if (isPdf(item)) lastPdf = item;
      n++;
    }
    if (refused) {
      Telemetry.send('doc_limit', { refused });
      alert(`最多保存 ${DOC_LIMIT} 份简历，有 ${refused} 份没有上传。先删掉不用的，再上传新的。`);
    }
    if (!n) return;
    await save();
    render();
    flash(`上传了 ${n} 份`);
    Telemetry.send('doc_upload', { n, total: files.resumes.length });
    Telemetry.firstAction('upload_pdf');
    if (lastPdf && AI_ENDPOINT) offerAI(lastPdf);
  });
  document.addEventListener('click', (e) => {
    for (const d of document.querySelectorAll('details.menu[open]')) if (!d.contains(e.target)) d.open = false;
  });

  async function load() {
    if ((await Vault.state()) === 'locked') {
      $('docs').replaceChildren(h('div', { className: 'd-empty' }, h('b', { textContent: '资料已加密锁定' }), h('span', { className: 'muted', textContent: '先在「我的资料」里输入密码解锁。' })));
      return;
    }
    files = await Vault.loadFiles();
    files.resumes = files.resumes || [];
    book = await Vault.book();
    render();
  }
  document.addEventListener('ra-view', (e) => {
    if (e.detail === 'documents') load();
  });
  load();
})();
