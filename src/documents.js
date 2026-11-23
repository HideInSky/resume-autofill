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
      item('查看', () => open(f)),
      item('下载', () => h('a', { href: urlOf(f), download: f.name }).click()),
      def && def.resume !== f.name ? item(`设为「${def.name}」使用的简历`, () => useFor(f)) : null,
      item('删除', () => remove([f]), 'danger')
    );
    const d = h('details', { className: 'menu dots' }, h('summary', { ariaLabel: '更多操作', title: '更多操作', textContent: '⋮' }), pop);
    d.addEventListener('click', (e) => e.stopPropagation());
    return d;
  }
  const open = (f) => window.open(urlOf(f), '_blank');
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
    $('d-selected').textContent = `已选 ${picked.size} 份`;
    if (!all.length) {
      $('docs').replaceChildren(
        h('div', { className: 'd-empty' }, h('b', { textContent: '还没有简历文件' }), h('span', { className: 'muted', textContent: '上传 PDF 后，网申页面遇到上传简历的地方会自动传上去。每份不超过 5 MB。' }))
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
    for (const f of chosen) {
      if (f.size > MAX) {
        flash(`「${f.name}」超过 5 MB，没有上传`);
        continue;
      }
      const data = Vault.toB64(await f.arrayBuffer());
      // 同名的当作新版本，替换旧的
      files.resumes = files.resumes.filter((x) => x.name !== f.name);
      files.resumes.push({ name: f.name, type: f.type, size: f.size, data, addedAt: Date.now() });
      n++;
    }
    if (!n) return;
    await save();
    render();
    flash(`上传了 ${n} 份`);
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
