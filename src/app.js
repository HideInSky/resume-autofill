// 顶部导航：我的资料 / 岗位（商店版才有）/ 投递记录 / 文档，按网址 # 后面的部分切换
(() => {
  const panels = [...document.querySelectorAll('[data-view-panel]')];
  const links = [...document.querySelectorAll('.topnav a')];
  const has = (v) => panels.some((p) => p.dataset.viewPanel === v);
  for (const a of links) a.hidden = !has(a.dataset.view);
  function show() {
    let v = location.hash.slice(1).split(/[?&]/)[0];
    if (!has(v)) v = 'profile';
    for (const p of panels) p.hidden = p.dataset.viewPanel !== v;
    for (const a of links) a.toggleAttribute('aria-current', a.dataset.view === v);
    document.title = { profile: '我的资料', jobs: '岗位', tracker: '投递记录', documents: '文档' }[v] + ' · 投简历神器';
    document.body.dataset.view = v;
    document.dispatchEvent(new CustomEvent('ra-view', { detail: v }));
  }
  window.addEventListener('hashchange', () => {
    show();
    scrollTo(0, 0);
  });
  show();
})();
