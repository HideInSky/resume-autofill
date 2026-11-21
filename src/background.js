// 后台：只负责「进入页面自动填写」。
// 你授权过的网站（浏览器的站点权限）= 开了自动填写的网站；没授权的网站，扩展完全碰不到。
importScripts('vault.js', 'run.js');

// 让 auto.js 只在已授权的网站上运行
let syncing = Promise.resolve();
function syncScripts() {
  syncing = syncing
    .then(async () => {
      const { origins = [] } = await chrome.permissions.getAll();
      const existing = await chrome.scripting.getRegisteredContentScripts({ ids: ['auto'] });
      if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: ['auto'] });
      if (!origins.length) return;
      await chrome.scripting.registerContentScripts([
        { id: 'auto', matches: origins, js: ['src/auto.js'], runAt: 'document_idle', allFrames: true, persistAcrossSessions: true },
      ]);
    })
    .catch((e) => console.warn('syncScripts', e));
  return syncing;
}
chrome.runtime.onInstalled.addListener(syncScripts);
chrome.runtime.onStartup.addListener(syncScripts);
chrome.permissions.onAdded.addListener(syncScripts);
chrome.permissions.onRemoved.addListener(syncScripts);

const badge = (tabId, text, color) => {
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  if (color) chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
};

async function autofill(sender) {
  const tabId = sender.tab.id;
  const state = await Vault.state();
  if (state === 'empty') return;
  if (state === 'locked') return badge(tabId, '锁', '#b45309'); // 以前设置过加密：需要先点图标解锁
  const { settings = {} } = await chrome.storage.local.get('settings');
  const reports = await runFill({
    tabId,
    frameIds: [sender.frameId],
    opts: { auto: true, overwrite: false, fillPassword: settings.autoPassword !== false, save: settings.autoSave === true },
  });
  const n = reports.reduce((sum, r) => sum + r.filled.length, 0);
  if (n) badge(tabId, String(n), '#15803d');
}

// 标签页关掉后，忘掉它单独选的资料方案
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { tabProfiles = {} } = await chrome.storage.session.get('tabProfiles');
  if (tabId in tabProfiles) {
    delete tabProfiles[tabId];
    await chrome.storage.session.set({ tabProfiles });
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'autofill' && sender.tab) autofill(sender).catch((e) => console.warn('autofill', e));
});
