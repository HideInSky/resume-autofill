// Autopilot：找到和你资料匹配的岗位 → 你确认（或自动确认）→ 一个个打开官网自动投递。
// 遇到短信验证码：在这一页输入，Autopilot 接着干；遇到人机验证（滑块、点字）：标出来，你点进去做完它再继续；
// 要注册账号的：用「我的资料 → 网申账号」里的用户名和密码注册。
// 这一页要一直开着，Autopilot 才会跑。
(() => {
  const $ = (id) => document.getElementById(id);
  if (!$('view-autopilot')) return;
  const h = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.flat().filter((k) => k != null && k !== false));
    return n;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const today = () => new Date().toLocaleDateString('sv');

  const STATUS = {
    review: { label: '待你确认', tone: 'info' },
    queued: { label: '排队中', tone: '' },
    running: { label: '正在投递', tone: 'info' },
    sms: { label: '需要验证码', tone: 'warn' },
    captcha: { label: '需要人机验证', tone: 'warn' },
    login: { label: '需要你登录', tone: 'warn' },
    perm: { label: '需要授权', tone: 'warn' },
    confirm: { label: '待你最后确认', tone: 'warn' },
    help: { label: '需要你处理', tone: 'warn' },
    done: { label: '已投递', tone: 'ok' },
    skipped: { label: '已跳过', tone: '' },
  };
  const TABS = [
    { key: 'review', name: '待你确认', has: ['review'] },
    { key: 'queue', name: '投递中', has: ['queued', 'running'] },
    { key: 'you', name: '需要你', has: ['sms', 'captcha', 'login', 'perm', 'confirm', 'help'] },
    { key: 'done', name: '已完成', has: ['done', 'skipped'] },
  ];
  const DEFAULTS = { daily: 30, confirmSubmit: false, closeDone: true, agree: true, autoConfirm: false, autoMin: 80 };

  let st = { items: [], set: { ...DEFAULTS }, day: { date: today(), n: 0 }, match: {} };
  let tab = 'review';
  let running = false;
  let saving = Promise.resolve();
  async function loadState() {
    const { pilot } = await chrome.storage.local.get('pilot');
    if (pilot) st = { ...st, ...pilot, set: { ...DEFAULTS, ...(pilot.set || {}) } };
    if (st.day.date !== today()) st.day = { date: today(), n: 0 };
    for (const it of st.items) if (it.status === 'running') it.status = 'queued'; // 上次关页面时正在投的，重新排队
  }
  const save = () => (saving = saving.then(() => chrome.storage.local.set({ pilot: st })));
  const update = (it, patch) => {
    Object.assign(it, patch, { at: Date.now() });
    save();
    render();
  };

  // —— 加岗位 ——
  function add(job, status = 'queued') {
    const key = job.key || job.url;
    const old = st.items.find((x) => x.key === key);
    if (old) {
      if (['review', 'skipped', 'help'].includes(old.status) && status === 'queued') update(old, { status, note: '' });
      return old;
    }
    const it = { id: crypto.randomUUID(), key, company: job.company, title: job.title, city: job.city || '', url: job.url, score: job.score ?? null, why: job.why || '', status, note: '', at: Date.now() };
    st.items.unshift(it);
    save();
    render();
    return it;
  }
  globalThis.Pilot = {
    add: (job) => {
      const it = add(job, 'queued');
      Telemetry.send('pilot_add', { from: 'jobs' });
      return it;
    },
  };

  // —— 资料 ——
  async function profile() {
    const book = await Vault.book();
    return (book.list[Math.min(book.active || 0, book.list.length - 1)] || {}).data || {};
  }
  function summary(p) {
    const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k]).map((k) => [k, String(o[k]).slice(0, 300)]));
    return JSON.stringify({
      求职意向: pick(p.intent, ['position', 'salary']),
      期望城市: ((p.intent || {}).cities || []).flat().filter(Boolean),
      教育: (p.education || []).map((e) => pick(e, ['school', 'degree', 'major', 'start', 'end', 'gpa', 'rank'])),
      工作和实习: (p.work || []).map((w) => pick(w, ['company', 'title', 'kind', 'start', 'end', 'description'])),
      项目: (p.project || []).map((x) => pick(x, ['name', 'role', 'description'])),
      技能: pick(p.other, ['skills', 'languages', 'certificates', 'awards']),
    });
  }

  // —— 匹配岗位 ——
  const graduating = (p) => {
    const ends = (p.education || []).map((e) => String(e.end || '')).filter(Boolean).sort();
    const last = ends[ends.length - 1] || '';
    return !last || last >= String(new Date().getFullYear() - 1);
  };
  async function match() {
    const btn = $('ap-match');
    const say = (t) => ($('ap-match-note').textContent = t);
    btn.disabled = true;
    try {
      const p = await profile();
      const data = await JobsDB.get();
      if (!data) return say('岗位数据还没下载下来，先打开「岗位」页看看。');
      const types = [...document.querySelectorAll('#ap-types input:checked')].map((c) => c.value);
      const cities = $('ap-cities').value.split(/[,，、\s]+/).filter(Boolean);
      const words = $('ap-words').value.split(/[,，、\s]+/).filter(Boolean);
      st.match = { types, cities: $('ap-cities').value, words: $('ap-words').value };
      save();
      const seen = new Set(st.items.map((x) => x.key));
      let pool = data.jobs.filter((j) => !seen.has(j[0] + ':' + j[1]));
      if (types.length) pool = pool.filter((j) => types.includes(j[4]));
      if (cities.length) pool = pool.filter((j) => j[3].split('|').some((c) => cities.some((w) => c.includes(w))));
      const kw = (j) => words.filter((w) => (j[2] + ' ' + j[6]).toLowerCase().includes(w.toLowerCase())).length;
      if (words.length) pool = pool.filter((j) => kw(j) > 0);
      pool.sort((a, b) => kw(b) - kw(a) || b[7].localeCompare(a[7]));
      pool = pool.slice(0, +$('ap-max').value || 60);
      if (!pool.length) return say('没有符合条件的新岗位，换换城市或关键词。');
      const ai = await LLM.ready();
      const found = [];
      if (!ai) {
        for (const j of pool) found.push({ j, score: null, why: words.length ? '职位名里有你的关键词' : '' });
      } else {
        const me = summary(p);
        for (let i = 0; i < pool.length; i += 15) {
          const batch = pool.slice(i, i + 15);
          say(`AI 正在看第 ${i + 1}–${i + batch.length} 个，共 ${pool.length} 个…`);
          const rows = [];
          for (const [k, j] of batch.entries()) {
            const d = await JobsDB.detailOf(j);
            rows.push({ i: k, 公司: JobsDB.name(j[0]), 职位: j[2], 类型: j[4], 类别: j[6], 城市: j[3].split('|').slice(0, 3).join('、'), 要求: (d.r || d.d || '').slice(0, 400) });
          }
          let out;
          try {
            out = await LLM.chat({
              system: '你是求职匹配助手。根据候选人的资料，给每个岗位打 0-100 的匹配分：看专业和经历是否对口、学历和年限是否满足、城市是否在期望里。只输出 JSON：{"results":[{"i":0,"score":85,"why":"不超过20个字的理由"}]}',
              user: `候选人资料：${me}\n\n岗位列表：${JSON.stringify(rows)}`,
              json: true,
            });
          } catch (e) {
            say(e.message);
            return;
          }
          for (const r of out.results || []) if (batch[r.i]) found.push({ j: batch[r.i], score: Math.max(0, Math.min(100, +r.score || 0)), why: String(r.why || '').slice(0, 60) });
        }
      }
      found.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      const min = st.set.autoMin;
      let auto = 0;
      for (const f of found) {
        if (f.score != null && f.score < 40) continue;
        const d = await JobsDB.detailOf(f.j);
        const status = st.set.autoConfirm && f.score != null && f.score >= min ? 'queued' : 'review';
        if (status === 'queued') auto++;
        add({ key: f.j[0] + ':' + f.j[1], company: JobsDB.name(f.j[0]), title: f.j[2], city: f.j[3].split('|')[0], url: d.u, score: f.score, why: f.why }, status);
      }
      Telemetry.send('pilot_match', { n: found.length, ai: ai ? 1 : 0, auto });
      say(`找到 ${found.length} 个${ai ? '' : '（没设置 AI，按关键词粗筛，没有打分）'}${auto ? `，其中 ${auto} 个 ≥ ${min} 分已自动加入投递` : ''}。`);
      tab = auto && auto === found.length ? 'queue' : 'review';
      render();
    } finally {
      btn.disabled = false;
    }
  }

  // —— 投递：一次一个 ——
  const tabOf = async (it) => {
    if (it.tab == null) return null;
    try {
      return await chrome.tabs.get(it.tab);
    } catch {
      return null;
    }
  };
  async function waitLoad(tabId, ms = 20000) {
    for (let t = 0; t < ms; t += 400) {
      const tb = await chrome.tabs.get(tabId).catch(() => null);
      if (!tb) return null;
      if (tb.status === 'complete') break;
      await sleep(400);
    }
    await sleep(1500); // 单页应用加载完还要渲染一下
    return chrome.tabs.get(tabId).catch(() => null);
  }
  const originOf = (u) => {
    try {
      return new URL(u).origin;
    } catch {
      return '';
    }
  };
  const allowed = (u) => chrome.permissions.contains({ origins: [originOf(u) + '/*'] });
  async function call(tabId, fn, ...args) {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: fn, args });
    return r && r.result;
  }
  async function inject(tabId) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/schema.js', 'src/filler.js', 'src/pilot.js'] });
  }
  const P = (name, ...a) => (tabId) => call(tabId, (n, args) => globalThis.__raPilot[n](...args), name, a);
  // 新标签页打开的申请页：跟过去
  const opened = new Map();
  chrome.tabs.onCreated.addListener((t) => {
    if (t.openerTabId != null) opened.set(t.openerTabId, t.id);
  });

  async function drive(it) {
    let tb = await tabOf(it);
    if (!tb) {
      tb = await chrome.tabs.create({ url: it.url, active: false });
      chrome.tabs.group({ tabIds: [tb.id], ...(st.groupId != null ? { groupId: st.groupId } : {}) }).then((g) => (st.groupId = g)).catch(() => chrome.tabs.group({ tabIds: [tb.id] }).then((g) => (st.groupId = g)).catch(() => {}));
    }
    update(it, { status: 'running', tab: tb.id, note: '' });
    const me = await profile();
    const acct = me.account || {};
    const phone = (me.basic || {}).phone || '';
    let lastSig = '';
    let same = 0;
    for (let step = 0; step < 30 && running; step++) {
      const id = it.tab;
      tb = await waitLoad(id);
      if (!tb) return update(it, { status: 'help', note: '标签页被关掉了', tab: null });
      if (opened.has(id)) {
        const nid = opened.get(id);
        opened.delete(id);
        if (await chrome.tabs.get(nid).catch(() => null)) {
          it.tab = nid;
          continue;
        }
      }
      if (!(await allowed(tb.url))) return update(it, { status: 'perm', note: originOf(tb.url) });
      let s;
      try {
        await inject(id);
        s = await P('scan')(id);
      } catch (e) {
        return update(it, { status: 'help', note: '这一页打不开或不让扩展操作：' + e.message });
      }
      const sig = JSON.stringify([s.url, s.login, s.fields, s.apply, s.submit, s.next, s.errors]);
      same = sig === lastSig ? same + 1 : 0;
      lastSig = sig;
      if (same >= 3) return update(it, { status: 'help', note: s.errors[0] ? '页面提示：' + s.errors.join('；') : '页面卡住了，没有往下走' });

      if (s.done) return finish(it);
      if (s.captcha) return update(it, { status: 'captcha', note: '' });
      if (s.login) {
        if (s.login.kind === 'sms') {
          if (it.code) {
            const code = it.code;
            delete it.code;
            await P('enterCode', code)(id);
            await sleep(2500);
            continue;
          }
          if (!it.codeAt || Date.now() - it.codeAt > 120_000) {
            if (!phone) return update(it, { status: 'login', note: '「我的资料」里没有手机号' });
            await P('fillLogin', { account: acct.username || phone, phone, password: acct.password || '' })(id);
            if (st.set.agree) await P('agree')(id);
            await P('sendCode')(id);
            it.codeAt = Date.now();
            await sleep(2000);
            const again = await P('scan')(id);
            if (again.captcha) return update(it, { status: 'captcha', note: '发验证码前要先过人机验证' });
          }
          return update(it, { status: 'sms', note: `验证码已发到 ${phone.replace(/^(\d{3})\d+(\d{4})$/, '$1****$2')}` });
        }
        if (!acct.password) return update(it, { status: 'login', note: '「我的资料 → 网申账号」里没有密码' });
        it.tries = (it.tries || 0) + 1;
        if (it.tries > 4) return update(it, { status: 'login', note: s.errors[0] || '登录没成功' });
        await P('fillLogin', { account: acct.username || (me.basic || {}).email || phone, phone, password: acct.password })(id);
        if (st.set.agree) await P('agree')(id);
        // 先试登录；登录不上（没注册过）就去注册
        if (s.login.register) await P('register')(id);
        else if (it.tries >= 2 && s.login.canRegister) await P('goRegister')(id);
        else await P('login')(id);
        await sleep(2500);
        continue;
      }
      if (s.fields >= 3) {
        await runFill({ tabId: id, opts: { auto: false, overwrite: false, fillPassword: true, save: false, record: 'off' } });
        await answerMissing(id, me);
        if (st.set.agree) await P('agree')(id);
        if (s.next && !s.submit) {
          await P('next')(id);
          await sleep(2500);
          continue;
        }
        if (s.submit) {
          if (st.set.confirmSubmit && !it.go) return update(it, { status: 'confirm', note: '表填好了，看一眼没问题就点「提交」' });
          delete it.go;
          await P('submit')(id);
          await sleep(3500);
          continue;
        }
        // 有的表最后一个按钮写的是「投递简历」
        if (s.apply) {
          if (st.set.confirmSubmit && !it.go) return update(it, { status: 'confirm', note: '表填好了，看一眼没问题就点「提交」' });
          delete it.go;
          await P('apply')(id);
          await sleep(3500);
          continue;
        }
        return update(it, { status: 'help', note: '表填好了，但没找到提交按钮' });
      }
      if (s.apply) {
        const r = await P('apply')(id);
        if (r && r.href) await chrome.tabs.update(id, { url: r.href });
        await sleep(2500);
        continue;
      }
      if (s.submit) {
        await P('submit')(id);
        await sleep(3500);
        continue;
      }
      return update(it, { status: 'help', note: '没认出这一页（没有投递按钮，也不是申请表）' });
    }
    if (running) update(it, { status: 'help', note: '走了很多步还没投完' });
  }

  async function answerMissing(tabId, me) {
    const list = await P('missing')(tabId);
    if (!list || !list.length || !(await LLM.ready())) return;
    try {
      const out = await LLM.chat({
        system: '你在帮求职者填网申表。根据他的资料回答表单里还空着的问题，实事求是，不编造经历；资料里没有、也推断不出的就留空字符串。选择题只能从 options 里原样选一个。只输出 JSON：{"answers":[{"i":0,"value":"..."}]}',
        user: `资料：${summary(me)}\n\n基本信息：${JSON.stringify(me.basic || {}).slice(0, 1500)}\n\n空着的问题：${JSON.stringify(list)}`,
        json: true,
      });
      await P('answer', out.answers || [])(tabId);
    } catch (e) {
      console.warn('answerMissing', e);
    }
  }

  async function finish(it) {
    st.day.n++;
    update(it, { status: 'done', note: '', doneAt: Date.now() });
    await Apps.record({ company: it.company, position: it.title, city: it.city, url: it.url, channel: 'Autopilot', jobId: it.key }, '已投递').catch(() => {});
    Telemetry.send('pilot_done', {});
    if (st.set.closeDone && it.tab != null) chrome.tabs.remove(it.tab).catch(() => {});
  }

  async function loop() {
    if (running) return;
    running = true;
    render();
    try {
      while (running) {
        if (st.day.date !== today()) st.day = { date: today(), n: 0 };
        if (st.day.n >= st.set.daily) {
          $('ap-run-note').textContent = `今天已经投了 ${st.day.n} 个，到了每天的上限。`;
          break;
        }
        // 人机验证做完了没有：做完了就接着投
        for (const it of st.items.filter((x) => x.status === 'captcha' && x.tab != null)) {
          try {
            await inject(it.tab);
            const s = await P('scan')(it.tab);
            if (!s.captcha) update(it, { status: 'queued' });
          } catch {}
        }
        const it = st.items.slice().reverse().find((x) => x.status === 'queued');
        if (!it) {
          if (!st.items.some((x) => x.status === 'captcha')) break;
          await sleep(4000);
          continue;
        }
        await drive(it).catch((e) => update(it, { status: 'help', note: e.message }));
      }
    } finally {
      running = false;
      render();
    }
  }

  // —— 界面 ——
  function row(it) {
    const s = STATUS[it.status] || { label: it.status };
    const acts = [];
    const btn = (label, fn, primary) => {
      const b = h('button', { className: primary ? 'primary small' : 'small', textContent: label });
      b.addEventListener('click', fn);
      acts.push(b);
    };
    const focus = async () => {
      const tb = await tabOf(it);
      if (tb) {
        await chrome.tabs.update(tb.id, { active: true });
        await chrome.windows.update(tb.windowId, { focused: true });
      } else window.open(it.url, '_blank', 'noopener');
    };
    if (it.status === 'review') {
      btn('确认投递', () => (update(it, { status: 'queued' }), loop()), true);
      btn('跳过', () => update(it, { status: 'skipped' }));
      btn('看岗位', () => window.open(it.url, '_blank', 'noopener'));
    }
    if (it.status === 'sms') {
      const input = h('input', { className: 'ap-code', inputMode: 'numeric', autocomplete: 'one-time-code', placeholder: '短信验证码', maxLength: 8 });
      const go = () => {
        const v = input.value.trim();
        if (!v) return input.focus();
        it.code = v;
        update(it, { status: 'queued', note: '' });
        loop();
      };
      input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
      acts.push(input);
      btn('继续', go, true);
      btn('重新发送', () => (delete it.codeAt, update(it, { status: 'queued' }), loop()));
    }
    if (it.status === 'captcha') {
      btn('去验证', focus, true);
      btn('我验证好了', () => (update(it, { status: 'queued' }), loop()));
    }
    if (it.status === 'perm') {
      btn('允许这个网站', async () => {
        if (await chrome.permissions.request({ origins: [it.note + '/*'] })) (update(it, { status: 'queued', note: '' }), loop());
      }, true);
    }
    if (it.status === 'confirm') {
      btn('看一眼', focus);
      btn('提交', () => ((it.go = true), update(it, { status: 'queued' }), loop()), true);
    }
    if (['login', 'help'].includes(it.status)) {
      btn('打开', focus, true);
      btn('重试', () => ((it.tries = 0), update(it, { status: 'queued' }), loop()));
      btn('我自己投完了', () => finish(it));
    }
    if (['queued'].includes(it.status)) btn('移出', () => update(it, { status: 'review' }));
    if (it.status === 'done') btn('打开', focus);
    if (it.status === 'skipped') btn('恢复', () => update(it, { status: 'review' }));
    const name = it.company || '';
    const lg = h('span', { className: 'logo', textContent: name.slice(0, 1) });
    lg.style.setProperty('--h', globalThis.JobsDB ? JobsDB.hue(name) : [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7));
    return h(
      'div',
      { className: 'ap-row' },
      lg,
      h(
        'div',
        { className: 'ap-main' },
        h('b', { textContent: it.title }),
        h('span', { className: 'muted', textContent: [name, it.city].filter(Boolean).join(' · ') }),
        it.why || it.note ? h('span', { className: 'ap-note' + (it.note ? ' warn' : ''), textContent: it.note || it.why }) : null
      ),
      it.score != null ? h('span', { className: 'ap-score', title: 'AI 匹配分', textContent: String(it.score) }) : null,
      h('span', { className: 'ap-status ' + (s.tone || ''), textContent: s.label }),
      h('div', { className: 'ap-acts' }, acts)
    );
  }
  function render() {
    const counts = Object.fromEntries(TABS.map((t) => [t.key, st.items.filter((x) => t.has.includes(x.status)).length]));
    $('ap-tabs').replaceChildren(
      ...TABS.map((t) => {
        const b = h('button', { className: 'ap-tab' + (t.key === tab ? ' on' : ''), role: 'tab', ariaSelected: String(t.key === tab) }, t.name, counts[t.key] ? h('span', { className: 'n' + (t.key === 'you' ? ' warn' : ''), textContent: String(counts[t.key]) }) : null);
        b.addEventListener('click', () => ((tab = t.key), render()));
        return b;
      })
    );
    const cur = TABS.find((t) => t.key === tab);
    const list = st.items.filter((x) => cur.has.includes(x.status));
    const empty = {
      review: '还没有待确认的岗位。在上面「找岗位」里点「开始匹配」，或者在「岗位」页点某个岗位的「Autopilot」。',
      queue: '没有排队的岗位。',
      you: '没有需要你处理的。遇到短信验证码、人机验证会出现在这里。',
      done: '还没有投完的。',
    }[tab];
    $('ap-list').replaceChildren(...(list.length ? list.map(row) : [h('p', { className: 'muted ap-empty', textContent: empty })]));
    if (tab === 'review' && list.length) {
      const all = h('button', { className: 'small', textContent: `全部确认（${list.length}）` });
      all.addEventListener('click', () => {
        for (const it of list) it.status = 'queued';
        save();
        tab = 'queue';
        render();
        loop();
      });
      $('ap-list').prepend(h('div', { className: 'ap-bulk' }, all));
    }
    const queued = st.items.filter((x) => x.status === 'queued').length;
    $('ap-run').textContent = running ? '暂停' : queued ? `开始投递（${queued}）` : '开始投递';
    $('ap-run').classList.toggle('primary', !running);
    $('ap-run').disabled = !running && !queued;
    $('ap-today').textContent = `今天已投 ${st.day.n} / ${st.set.daily}`;
    if (running) $('ap-run-note').textContent = '正在投递。这一页要一直开着；投递用的标签页在后台，可以点进去看。';
    else if (!$('ap-run-note').textContent.startsWith('今天已经')) $('ap-run-note').textContent = '';
    const nav = document.querySelector('.topnav a[data-view="autopilot"] .n');
    if (nav) (nav.textContent = counts.you || ''), (nav.hidden = !counts.you);
  }

  // —— AI 设置 ——
  async function renderAI() {
    const c = await LLM.config();
    const sel = $('ap-provider');
    sel.replaceChildren(h('option', { value: '', textContent: '不用 AI（只按关键词筛，不打分）' }), ...Object.entries(LLM.PROVIDERS).map(([k, p]) => h('option', { value: k, textContent: p.name })));
    sel.value = c.provider;
    const p = LLM.PROVIDERS[c.provider];
    $('ap-key-row').hidden = !p || p.kind === 'bridge';
    $('ap-cc').hidden = !p || p.kind !== 'bridge';
    if (p && p.kind !== 'bridge') {
      $('ap-key').value = c.keys[c.provider] || '';
      $('ap-model').value = c.models[c.provider] || '';
      $('ap-model').placeholder = p.model;
      $('ap-key-link').href = p.keyUrl;
      $('ap-key-link').textContent = `去 ${p.name} 拿 API Key ↗`;
    }
  }
  async function saveAI() {
    const c = await LLM.config();
    const k = $('ap-provider').value;
    if (k && LLM.PROVIDERS[k].kind !== 'bridge') {
      c.keys[k] = $('ap-key').value.trim();
      c.models[k] = $('ap-model').value.trim();
    }
    await LLM.save({ provider: k, keys: c.keys, models: c.models });
  }
  $('ap-provider').addEventListener('change', async () => {
    await LLM.save({ provider: $('ap-provider').value });
    renderAI();
  });
  for (const id of ['ap-key', 'ap-model']) $(id).addEventListener('change', saveAI);
  $('ap-test').addEventListener('click', async () => {
    await saveAI();
    const out = $('ap-test-note');
    out.textContent = '正在试…';
    try {
      const r = await LLM.chat({ system: '只回答两个字：可以', user: '能用吗？' });
      out.textContent = '能用 ✓ ' + r.slice(0, 20);
    } catch (e) {
      out.textContent = e.message;
    }
  });

  // —— 投递设置 ——
  function renderSet() {
    $('ap-daily').value = st.set.daily;
    $('ap-confirm').checked = st.set.confirmSubmit;
    $('ap-close').checked = st.set.closeDone;
    $('ap-agree').checked = st.set.agree;
    $('ap-auto').checked = st.set.autoConfirm;
    $('ap-min').value = st.set.autoMin;
  }
  const bindSet = (id, key, get) =>
    $(id).addEventListener('change', () => {
      st.set[key] = get($(id));
      save();
      render();
    });
  bindSet('ap-daily', 'daily', (e) => Math.max(1, Math.min(200, +e.value || 30)));
  bindSet('ap-confirm', 'confirmSubmit', (e) => e.checked);
  bindSet('ap-close', 'closeDone', (e) => e.checked);
  bindSet('ap-agree', 'agree', (e) => e.checked);
  bindSet('ap-auto', 'autoConfirm', (e) => e.checked);
  bindSet('ap-min', 'autoMin', (e) => Math.max(0, Math.min(100, +e.value || 80)));

  $('ap-match').addEventListener('click', match);
  $('ap-run').addEventListener('click', async () => {
    if (running) {
      running = false;
      return render();
    }
    // 一次要齐要投的网站的权限（必须在点击里要）
    const origins = [...new Set(st.items.filter((x) => x.status === 'queued').map((x) => originOf(x.url) + '/*').filter((o) => o !== '/*'))];
    if (origins.length && !(await chrome.permissions.contains({ origins }))) {
      if (!(await chrome.permissions.request({ origins }))) return;
    }
    tab = 'queue';
    loop();
  });
  $('ap-clear').addEventListener('click', () => {
    st.items = st.items.filter((x) => !['done', 'skipped'].includes(x.status));
    save();
    render();
  });

  (async () => {
    await loadState();
    const p = await profile().catch(() => ({}));
    const m = st.match || {};
    const types = m.types || (graduating(p) ? ['校招', '实习'] : ['社招']);
    for (const c of document.querySelectorAll('#ap-types input')) c.checked = types.includes(c.value);
    $('ap-cities').value = m.cities ?? ((p.intent || {}).cities || []).flat().filter((c) => c && !/全国|不限|各地/.test(c)).join('、');
    $('ap-words').value = m.words ?? ((p.intent || {}).position || '');
    renderSet();
    renderAI();
    render();
  })();
  chrome.storage.local.onChanged.addListener((c) => {
    if (c.pilot && !running && c.pilot.newValue) {
      st = { ...st, ...c.pilot.newValue };
      render();
    }
  });
})();
