// 把资料注入指定标签页并执行填写。弹窗（手动点击）和后台（自动填写）共用。
// 需要先加载 vault.js。
// 这个标签页用哪套资料：弹窗里为它单独选过的优先，否则用默认方案
globalThis.pickProfile = async function (tabId) {
  const book = await Vault.book(); // 已锁定时会抛出 'locked'
  const { tabProfiles = {} } = await chrome.storage.session.get('tabProfiles');
  const i = book.list.findIndex((p) => p.name === tabProfiles[tabId]);
  return { book, index: i >= 0 ? i : Math.min(book.active || 0, book.list.length - 1) };
};

globalThis.runFill = async function ({ tabId, frameIds, opts }) {
  const { book, index } = await pickProfile(tabId);
  const entry = book.list[index];
  const profile = structuredClone(entry.data || {});
  // 期望城市：三层卡片按从上到下、从左到右展开成第一 / 二 / 三意向
  const cities = ((profile.intent || {}).cities || []).flat().filter(Boolean);
  if (cities.length) Object.assign(profile.intent, { city: cities[0], city2: cities[1] || '', city3: cities[2] || '' });
  // 没开「填写密码框」时，密码根本不会被传进页面
  if (!opts.fillPassword && profile.account) delete profile.account.password;

  const files = await Vault.loadFiles();
  const resumes = files.resumes || [];
  const chosen = { resume: resumes.find((f) => f.name === entry.resume) || resumes[0], photo: files.photo };
  const meta = {};
  for (const [kind, f] of Object.entries(chosen)) if (f) meta[kind] = { name: f.name, type: f.type, size: f.size };

  const inject = async (target) => {
    await chrome.scripting.executeScript({ target, files: ['src/schema.js', 'src/filler.js'] });
    return chrome.scripting.executeScript({
      target,
      func: (p, f, o) => globalThis.__resumeAutofill(p, f, o),
      args: [profile, meta, opts],
    });
  };

  let frames;
  if (frameIds) frames = await inject({ tabId, frameIds });
  else {
    try {
      frames = await inject({ tabId, allFrames: true });
    } catch {
      frames = await inject({ tabId });
    }
  }

  const reports = [];
  for (const frame of frames) {
    const report = frame.result;
    if (!report) continue;
    // 只有页面上确实有要传的上传框时，才把文件内容送进那个 frame
    if (report.wantFiles.length) {
      const data = Object.fromEntries(report.wantFiles.map((k) => [k, chosen[k]]));
      const [res] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frame.frameId] },
        func: (d) => globalThis.__resumeAutofillFiles(d),
        args: [data],
      });
      report.filled.push(...((res && res.result) || []));
    }
    reports.push(report);
  }
  return reports;
};
