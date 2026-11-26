// 只在你开启了自动填写的网站上运行。它自己不碰任何资料：
// 发现页面上有还没处理过的表单控件时，通知后台来填。
(() => {
  if (globalThis.__raAuto) return;
  globalThis.__raAuto = true;

  const SKIP = /^(hidden|submit|button|reset|image|checkbox|range|color)$/;
  const hasNew = () => {
    const seen = globalThis.__raSeen;
    for (const el of document.querySelectorAll('input,textarea,select')) {
      if (el.disabled || SKIP.test(el.type) || (seen && seen.has(el))) continue;
      const box = el.type === 'file' || el.type === 'radio' ? el.parentElement : el;
      if (box && box.getClientRects().length) return true;
    }
    return false;
  };

  let timer;
  const ask = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (globalThis.__raRunning) return ask();
      if (hasNew()) chrome.runtime.sendMessage({ type: 'autofill' }).catch(() => {});
    }, 800);
  };

  ask();
  // 「记到投递记录」的提示：页面像招聘页时告诉后台，由后台按侧边栏的设置决定问不问
  if (window === window.top) {
    setTimeout(() => {
      const head = `${document.title} ${location.hostname} ${location.pathname}`;
      const job = /招聘|网申|投递|应聘|校招|社招|职位详情|zhaopin|career|recruit|talent|campus|\bjobs?\b/i.test(head) ||
        /招聘|网申|投递简历|应聘/.test((document.body && document.body.innerText.slice(0, 8000)) || '');
      chrome.runtime.sendMessage({ type: 'record-card', job }).catch(() => {});
    }, 1500);
  }
  // 单页应用：切换步骤、展开折叠的段落时会出现新的控件
  new MutationObserver(ask).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'hidden'],
  });
})();
