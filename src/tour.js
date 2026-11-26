// 新手指引：第一次打开时，按顺序高亮「先做什么、再做什么」，其余变暗。
// 看完或跳过后不再自动出现；「我的资料」标题下的「新手指引」可以再看一遍。
(() => {
  const STEPS = [
    { view: 'documents', sel: '#d-upload', title: '先上传简历 PDF', text: '在「文档」里上传你的简历。网申时遇到上传简历的地方，会自动传上去。最多存 8 份。' },
    { view: 'profile', sel: '#s-profile', title: '选一套资料', text: '只投一类岗位，用默认这一套就行。要投几类岗位（经历写法、简历不同），可以各复制一套。' },
    { view: 'profile', sel: '#s-import .import-ways', title: '把简历导入资料', text: '用插件自带的 AI 整理刚上传的 PDF，或者复制提示词交给你自己的 ChatGPT / Claude，再把结果粘贴回来。' },
    { view: 'profile', sel: '#s-fill', title: '检查并补全', text: '往下看一遍：红框是还没填的必填项，蓝框是替你填的默认值，不对就改。改动自动保存。' },
    { view: 'profile', sel: '#s-auto', title: '打开自动填写', text: '打开后，进入网申页面会直接填好。也可以点浏览器右上角的扩展图标，在侧边栏里点「填写当前页面」。' },
  ];
  const h = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.filter(Boolean));
    return n;
  };
  let i = 0;
  let nodes = null;
  const target = () => document.querySelector(STEPS[i].sel);

  function place() {
    const el = target();
    if (!nodes || !el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    Object.assign(nodes.hole.style, { top: r.top - pad + 'px', left: r.left - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    const card = nodes.card;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const gap = 16;
    let top = r.bottom + pad + gap;
    if (top + ch > innerHeight - 12) top = r.top - pad - gap - ch; // 下面放不下：放上面
    if (top < 12) top = Math.min(innerHeight - ch - 12, Math.max(12, r.top + 12)); // 上下都放不下：压在高亮区里
    const left = Math.min(innerWidth - cw - 12, Math.max(12, r.left));
    Object.assign(card.style, { top: top + 'px', left: left + 'px' });
  }

  async function go(n) {
    i = n;
    const step = STEPS[i];
    if (document.body.dataset.view !== step.view) {
      location.hash = '#' + (step.view === 'documents' ? 'documents' : step.sel.slice(1));
      await new Promise((r) => setTimeout(r, 60));
    }
    const el = target();
    if (!el || !el.getClientRects().length) return n + 1 < STEPS.length ? go(n + 1) : finish('done');
    const tall = el.getBoundingClientRect().height > innerHeight * 0.55;
    // 页面开了平滑滚动：这里要立刻到位，否则下面的偏移会打断它
    el.scrollIntoView({ block: tall ? 'start' : 'center', behavior: 'instant' });
    if (tall) scrollBy({ top: -60, behavior: 'instant' }); // 让出顶部的导航栏
    nodes.title.textContent = step.title;
    nodes.text.textContent = step.text;
    nodes.n.textContent = `${i + 1} / ${STEPS.length}`;
    nodes.back.hidden = i === 0;
    nodes.next.textContent = i === STEPS.length - 1 ? '开始使用' : '下一步';
    place();
    nodes.next.focus();
    Telemetry.send('tour', { step: i + 1 });
  }

  async function finish(how) {
    if (!nodes) return;
    for (const n of [nodes.block, nodes.hole, nodes.card]) n.remove();
    delete document.body.dataset.tour;
    nodes = null;
    removeEventListener('resize', place);
    removeEventListener('scroll', place, true);
    removeEventListener('keydown', onKey);
    await chrome.storage.local.set({ tourDone: Date.now() });
    Telemetry.send('tour', { [how]: i + 1 });
  }
  const onKey = (e) => {
    if (e.key === 'Escape') finish('skip');
  };

  function start() {
    if (nodes) return;
    const title = h('b');
    const text = h('p');
    const n = h('span', { className: 'tour-n' });
    const skip = h('button', { className: 'link', textContent: '跳过' });
    const back = h('button', { textContent: '上一步' });
    const next = h('button', { className: 'primary' });
    const card = h('div', { className: 'tour-card', role: 'dialog', ariaLabel: '新手指引' }, title, text, h('div', { className: 'tour-foot' }, n, skip, back, next));
    nodes = { block: h('div', { className: 'tour-block' }), hole: h('div', { className: 'tour-hole' }), card, title, text, n, back, next };
    document.body.append(nodes.block, nodes.hole, card);
    document.body.dataset.tour = '1';
    skip.addEventListener('click', () => finish('skip'));
    back.addEventListener('click', () => go(i - 1));
    next.addEventListener('click', () => (i === STEPS.length - 1 ? finish('done') : go(i + 1)));
    addEventListener('resize', place);
    addEventListener('scroll', place, true);
    addEventListener('keydown', onKey);
    go(0);
  }

  // 第一次打开、资料没上锁时自动开始
  (async () => {
    const { tourDone } = await chrome.storage.local.get('tourDone');
    if (tourDone || (await Vault.state()) === 'locked') return;
    setTimeout(start, 400);
  })();
  const again = document.getElementById('tour-again');
  if (again) again.addEventListener('click', start);
})();
