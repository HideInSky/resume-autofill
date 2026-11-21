// 把资料注入指定标签页并执行填写。弹窗（手动点击）和后台（自动填写）共用。
// 需要先加载 vault.js。
globalThis.runFill = async function ({ tabId, frameIds, opts }) {
  const profile = structuredClone(await Vault.load()); // 已锁定时会抛出 'locked'
  // 没开「填写密码框」时，密码根本不会被传进页面
  if (!opts.fillPassword && profile.account) delete profile.account.password;

  const files = await Vault.loadFiles();
  const chosen = { resume: (files.resumes || [])[files.active || 0], photo: files.photo };
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
