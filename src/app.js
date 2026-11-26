// 顶部导航：文档 / 我的资料 / 岗位（商店版才有）/ 投递记录，按网址 # 后面的部分切换
(() => {
  const panels = [...document.querySelectorAll('[data-view-panel]')];
  const links = [...document.querySelectorAll('.topnav a')];
  const has = (v) => panels.some((p) => p.dataset.viewPanel === v);
  for (const a of links) a.hidden = !has(a.dataset.view);
  const current = () => {
    const v = location.hash.slice(1).split(/[?&]/)[0];
    if (has(v)) return v;
    // 「我的资料」里的步骤链接（#s-import 等）：显示它所在的那一页
    const target = v && document.getElementById(v);
    const panel = target && target.closest('[data-view-panel]');
    return panel ? panel.dataset.viewPanel : 'documents';
  };
  function show() {
    const v = current();
    for (const p of panels) p.hidden = p.dataset.viewPanel !== v;
    for (const a of links) a.toggleAttribute('aria-current', a.dataset.view === v);
    document.title = { profile: '我的资料', jobs: '岗位', tracker: '投递记录', documents: '文档' }[v] + ' · 投简历神器';
    document.body.dataset.view = v;
    document.dispatchEvent(new CustomEvent('ra-view', { detail: v }));
  }
  let last = current();
  window.addEventListener('hashchange', () => {
    const v = current();
    show();
    if (v === last) return; // 同一页里的步骤链接，不算换页
    last = v;
    scrollTo(0, 0);
    if (document.body.dataset.tour) return; // 新手指引带着翻的页，不算用户的操作
    // 用户自己切到了哪一页（第一次打开后先去了哪里）
    Telemetry.send('nav', { view: v });
    const action = { profile: 'open_profile', jobs: 'open_jobs', tracker: 'open_tracker' }[v];
    if (action) Telemetry.firstAction(action);
  });
  show();
  // 第一次打开：落在哪一页（从侧边栏「编辑资料」进来的会是 profile）
  Telemetry.state().then((t) => {
    if (t.isNew) Telemetry.once('first_open', 'first_open', { view: current() });
  });
})();
