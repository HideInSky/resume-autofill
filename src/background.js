// 后台：只负责「进入页面自动填写」。
// 你授权过的网站（浏览器的站点权限）= 开了自动填写的网站；没授权的网站，扩展完全碰不到。
importScripts('vault.js', 'apps.js', 'run.js');

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
    opts: { auto: true, overwrite: false, fillPassword: settings.autoPassword !== false, save: settings.autoSave === true, record: settings.recordPrompt || 'ask' },
  });
  const n = reports.reduce((sum, r) => sum + r.filled.length, 0);
  if (n) badge(tabId, String(n), '#15803d');
}

// 点工具栏图标：直接在侧边栏打开（不会像弹窗那样一点网页就关掉）
if (chrome.sidePanel) chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// 页面换了（刷新 / 跳转）：上一页的填写清单作废
async function forgetFill(tabId) {
  const { fills = {} } = await chrome.storage.session.get('fills');
  if (!(tabId in fills)) return;
  delete fills[tabId];
  await chrome.storage.session.set({ fills });
}
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') forgetFill(tabId);
});

// 标签页关掉后，忘掉它单独选的资料方案和填写清单
chrome.tabs.onRemoved.addListener(async (tabId) => {
  forgetFill(tabId);
  const { tabProfiles = {} } = await chrome.storage.session.get('tabProfiles');
  if (tabId in tabProfiles) {
    delete tabProfiles[tabId];
    await chrome.storage.session.set({ tabProfiles });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'autofill' && sender.tab) autofill(sender).catch((e) => console.warn('autofill', e));
  // 打开了自动填写的网站，页面一加载：按设置决定要不要在右下角问「记到投递记录？」
  if (msg && msg.type === 'record-card' && sender.tab && sender.frameId === 0) {
    (async () => {
      const { settings = {} } = await chrome.storage.local.get('settings');
      const mode = settings.recordPrompt || 'ask';
      if (mode === 'off' || (mode === 'ask' && !msg.job)) return;
      const target = { tabId: sender.tab.id, frameIds: [0] };
      await chrome.scripting.executeScript({ target, files: ['src/schema.js', 'src/filler.js'] });
      await chrome.scripting.executeScript({ target, func: (m) => globalThis.__raAskRecord && globalThis.__raAskRecord(m), args: [mode] });
    })().catch((e) => console.warn('record-card', e));
  }
  // 网申页面上的小卡片：这一页记过没有、是不是从「岗位」里点进来的
  if (msg && msg.type === 'page-check' && sender.tab) {
    (async () => {
      const url = sender.tab.url || msg.url;
      const { pendingJobs = {} } = await chrome.storage.session.get('pendingJobs');
      let origin = '';
      try { origin = new URL(url).origin; } catch {}
      sendResponse({ recorded: await Apps.has(url), job: pendingJobs[origin] || null });
    })().catch(() => sendResponse({}));
    return true;
  }
  // 用户点了「保存」或者自己点了「投递 / 提交」：记一条「已投递」
  if (msg && msg.type === 'record' && sender.tab) {
    (async () => {
      const { book, index } = await pickProfile(sender.tab.id);
      // 从「岗位」点进来的：记在那个岗位的网址上，收藏过的那条直接变成「已投递」
      const { jobUrl, ...info } = msg.info;
      const { resumes = [] } = (await Vault.loadFiles()) || {};
      const file = resumes.find((f) => f.name === book.list[index].resume) || resumes[0];
      await Apps.record({ ...info, url: jobUrl || sender.tab.url || info.url, resume: file ? file.name : '' }, '已投递');
    })().catch((e) => console.warn('record', e));
  }
});
