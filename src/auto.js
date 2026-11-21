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
  // 单页应用：切换步骤、展开折叠的段落时会出现新的控件
  new MutationObserver(ask).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'hidden'],
  });
})();
