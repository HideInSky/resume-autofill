// 填表引擎：被注入页面后识别字段并写入值。
// 不依赖任何 chrome API，不联网，不提交表单。
(() => {
  const S = globalThis.RESUME_SCHEMA;
  // 自动模式下，每个控件在一次页面生命周期里只尝试一次（用户清空后不会被反复填回去）
  const seen = (globalThis.__raSeen ??= new WeakSet());
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const norm = (s) =>
    String(s || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_\-.\[\]()（）:：*＊/\\|,，]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const shortText = (node) => {
    const t = norm(node && node.textContent);
    return t && t.length <= 60 ? t : '';
  };

  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

  // —— 选项匹配 ——
  // 同义词：下拉框 / 单选框的选项文字和资料里的写法不一定一样
  const SYNONYMS = [
    ['女', 'female', 'woman', 'f', '女士'],
    ['男', 'male', 'man', 'm', '先生'],
    ['是', 'yes', 'true', 'y'],
    ['否', 'no', 'false', 'n'],
    ['本科', '学士', 'bachelor', 'bachelors', "bachelor's", 'undergraduate', 'ba', 'bs'],
    ['硕士', 'master', 'masters', "master's", 'ms', 'ma', 'graduate'],
    ['博士', 'phd', 'ph d', 'doctor', 'doctorate', 'doctoral'],
    ['大专', '专科', 'associate'],
    ['中共党员', '党员'],
    ['共青团员', '团员'],
    ['汉族', '汉'],
    ['身份证', '居民身份证', 'id card', 'identity card', 'national id'],
    ['护照', 'passport'],
    ['中国', 'china', '中国大陆', 'prc'],
    ['全国各地', '中国国内各地', '全国', '不限'],
    ['中国香港', '香港', 'hong kong'],
    ['美国', 'united states', 'usa', 'us', 'united states of america', '美利坚合众国'],
    ['英国', 'united kingdom', 'uk', 'britain', 'great britain'],
    ['加拿大', 'canada'],
    ['澳大利亚', 'australia'],
    ['新加坡', 'singapore'],
    ['日本', 'japan'],
    ['德国', 'germany'],
    ['法国', 'france'],
  ];
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const isCJK = (s) => /[^\x00-\x7f]/.test(s);
  function termsFor(value) {
    const v = norm(value);
    const group = SYNONYMS.find((g) => g.includes(v));
    // 自己的写法排最前，同义词其次
    return group ? [v, ...group.filter((t) => t !== v)] : [v];
  }
  const termHits = (text, term) =>
    isCJK(term) ? text.includes(term) : new RegExp('(^|[^a-z0-9])' + escapeRe(term) + '($|[^a-z0-9])').test(text);
  // 在一组 {text} 选项里找最合适的：精确相等 → 选项包含资料 → 资料包含选项（如「上海市」对「上海」）
  function pickOption(options, value) {
    const terms = termsFor(value);
    const exact = options.find((o) => terms.includes(o.text));
    if (exact) return exact;
    for (const t of terms) {
      const hit = options.find((o) => o.text && termHits(o.text, t));
      if (hit) return hit;
    }
    const v = terms[0];
    return (
      options
        .filter((o) => o.text.length >= (isCJK(o.text) ? 2 : 4) && v.includes(o.text))
        .sort((a, b) => b.text.length - a.text.length)[0] || null
    );
  }

  // —— 找控件、读标题 ——
  const FIELD_SEL = 'input,textarea,select';
  const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'checkbox', 'range', 'color']);
  const LABEL_SEL = 'legend,label,th,dt,[class*="label"],[class*="Label"],[class*="title"],[class*="Title"]';
  const DATE_SEL = '[class*="date"],[class*="Date"],[data-tag*="date"],[class*="calendar"],.ant-picker';
  const SELECT_WRAP = '[class*="select"],[class*="Select"],[class*="cascader"],[class*="dropdown"]';

  function collect(root, out = []) {
    root.querySelectorAll(FIELD_SEL).forEach((el) => out.push(el));
    root.querySelectorAll('*').forEach((el) => el.shadowRoot && collect(el.shadowRoot, out));
    return out;
  }

  const inDatePicker = (el) => !!el.closest(DATE_SEL);
  // 网站自己画的下拉框：一个只读输入框，点了以后才弹出选项
  function isCustomSelect(el) {
    if (el.tagName !== 'INPUT' || inDatePicker(el)) return false;
    if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox') return true;
    return el.readOnly && (!!el.closest(SELECT_WRAP) || /请选择|select|choose/i.test(el.placeholder));
  }

  function radioGroup(el) {
    const root = el.getRootNode();
    if (el.name) return [...root.querySelectorAll('input[type="radio"]')].filter((r) => r.name === el.name);
    let box = el.closest('[role="radiogroup"],fieldset');
    for (let n = el.parentElement, d = 0; !box && n && d < 6; n = n.parentElement, d++) {
      if (n.querySelectorAll('input[type="radio"]').length > 1) box = n;
    }
    return box ? [...box.querySelectorAll('input[type="radio"]')] : [el];
  }

  // 往外找包住这个控件的「表单项」，取离它最近、排在它前面的标题
  function containerInfo(el, group) {
    for (let node = el.parentElement, d = 0; node && node !== document.body && d < 8; node = node.parentElement, d++) {
      const all = [...node.querySelectorAll(FIELD_SEL)].filter((x) => !SKIP_TYPES.has(x.type));
      let units;
      if (el.type === 'file') units = all.filter((x) => x.type === 'file');
      else if (group) {
        if (all.some((x) => x.type !== 'file' && !group.includes(x))) return null;
        units = [el];
      } else {
        const rest = all.filter((x) => x.type !== 'file');
        const radios = rest.filter((x) => x.type === 'radio');
        units = rest.filter((x) => x.type !== 'radio').concat(radios.slice(0, 1));
      }
      if (units.length > 3) return null;
      if (node.getAttribute('aria-label')) return { text: norm(node.getAttribute('aria-label')), pos: units.indexOf(el), size: units.length };
      let best = null;
      for (const c of node.querySelectorAll(LABEL_SEL)) {
        if (!(c.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue; // 标题要在控件前面
        if (c.contains(el) || c.querySelector(FIELD_SEL)) continue;
        const wrap = c.closest('label');
        if (wrap && wrap.querySelector(FIELD_SEL)) continue; // 单选项自己的文字
        if (c.tagName === 'LABEL' && c.control && c.control !== el) continue;
        if (shortText(c)) best = c;
      }
      if (best) return { text: shortText(best), forAttr: norm(best.getAttribute('for')), pos: units.indexOf(el), size: units.length };
    }
    return null;
  }

  // 兜底：往前、往上找最近的一小段文字
  function nearbyText(el) {
    let node = el;
    for (let depth = 0; depth < 3 && node; depth++) {
      let sib = node.previousSibling;
      while (sib) {
        if (sib.nodeType === 1 && sib.querySelector && sib.querySelector(FIELD_SEL)) break;
        const t = shortText(sib);
        if (t) return t;
        sib = sib.previousSibling;
      }
      node = node.parentElement;
    }
    return '';
  }

  function sectionHint(el, own) {
    const ids = Object.keys(S.sectionHints);
    const find = (strs) => ids.find((id) => strs.some((s) => S.sectionHints[id].test(s)));
    const direct = find(own);
    if (direct) return direct;
    for (let n = el.parentElement, d = 0; n && n !== document.body && d < 12; n = n.parentElement, d++) {
      const hit = find([norm(`${n.id || ''} ${typeof n.className === 'string' ? n.className : ''}`)]);
      if (hit) return hit;
    }
    return null;
  }

  function describe(el, group) {
    const own = ['name', 'id', 'autocomplete', 'data-automation-id', 'data-testid']
      .map((a) => norm(el.getAttribute(a)))
      .filter(Boolean);
    let labels = [];
    if (!group && el.type !== 'file') {
      (el.labels ? [...el.labels] : []).forEach((l) => labels.push(shortText(l)));
      ['aria-label', 'placeholder', 'title'].forEach((a) => labels.push(norm(el.getAttribute(a))));
      (el.getAttribute('aria-labelledby') || '')
        .split(/\s+/)
        .filter(Boolean)
        .forEach((id) => labels.push(shortText(el.ownerDocument.getElementById(id))));
    }
    const box = containerInfo(el, group);
    if (box) {
      labels.push(box.text);
      if (box.forAttr) own.push(box.forAttr);
    }
    labels = labels.filter(Boolean);
    if (!labels.length && !group) labels = [nearbyText(el)].filter(Boolean);
    return {
      own,
      labels,
      parts: [...labels, ...own],
      pos: box ? box.pos : 0,
      size: box ? box.size : 1,
      hint: sectionHint(el, own),
    };
  }

  // —— 写入 ——
  function setRaw(el, value) {
    const proto =
      el.tagName === 'SELECT'
        ? HTMLSelectElement.prototype
        : el.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function setNative(el, value) {
    setRaw(el, value);
    // React / Vue 等框架靠这些事件感知变化
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }
  function press(el) {
    const o = { bubbles: true, cancelable: true, view: window };
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, o));
  }
  const pressKey = (el, key) => {
    for (const t of ['keydown', 'keyup']) el.dispatchEvent(new KeyboardEvent(t, { key, code: key, bubbles: true }));
  };

  function formatDate(value, el) {
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
    if (!m) return value;
    const [, y, mo, d] = m;
    if (el.type === 'date') return `${y}-${mo}-${d || '01'}`;
    if (el.type === 'month') return `${y}-${mo}`;
    const ph = (el.getAttribute('placeholder') || '').toLowerCase();
    if (/^\s*m{1,2}\s*\/\s*d{1,2}\s*\/\s*y/.test(ph)) return `${mo}/${d || '01'}/${y}`;
    if (/^\s*m{1,2}\s*\/\s*y/.test(ph)) return `${mo}/${y}`;
    if (/年/.test(ph)) return `${y}年${mo}月` + (d && /日/.test(ph) ? `${d}日` : '');
    if (ph.includes('/')) return [y, mo, d].filter(Boolean).join('/');
    if (/y\.m/.test(ph)) return [y, mo, d].filter(Boolean).join('.');
    // 日期选择器一般要完整日期；类名里带 month 的只要年月
    const picker = el.closest(DATE_SEL);
    if (picker && !/month/i.test(`${picker.className} ${picker.getAttribute('data-tag') || ''}`)) return `${y}-${mo}-${d || '01'}`;
    return [y, mo, d].filter(Boolean).join('-');
  }

  function highlight(el) {
    el.style.outline = '2px solid #22c55e';
    el.style.outlineOffset = '1px';
  }

  // —— 自定义下拉框：点开 → 等选项出现 → 点选项；找不到就输入关键字过滤再找 ——
  const OPTION_SEL =
    '[role="option"],li[class*="item"],li[class*="option"],[class*="select-item"],[class*="dropdown"] [class*="option"],[class*="cascader-node"]';
  const visibleOptions = () => [...document.querySelectorAll(OPTION_SEL)].filter(visible);
  const toOptions = (els) => els.map((el) => ({ el, text: norm(el.textContent) }));
  function queries(value) {
    const v = String(value).trim();
    const list = isCJK(v) ? [v, v.slice(0, 4), v.slice(0, 2)] : [v, v.split(/\s+/)[0]];
    return [...new Set(list)].filter((q) => q.length >= 2);
  }
  async function fillCustomSelect(el, value) {
    const before = new Set(visibleOptions());
    const fresh = () => visibleOptions().filter((o) => !before.has(o));
    const waitFresh = async (ms) => {
      for (const end = Date.now() + ms; Date.now() < end; await sleep(40)) {
        if (fresh().length) {
          await sleep(50);
          return fresh();
        }
      }
      return [];
    };
    press(el);
    let hit = pickOption(toOptions(await waitFresh(1500)), value);
    if (!hit) {
      // 选项太多（学校、专业）只渲染了一部分：输入关键字让它过滤
      for (const q of queries(value)) {
        setRaw(el, q);
        await sleep(400);
        hit = pickOption(toOptions(fresh()), value);
        if (hit) break;
      }
      if (!hit) setRaw(el, '');
    }
    if (hit) {
      press(hit.el);
      await sleep(120);
      return true;
    }
    pressKey(el, 'Escape');
    press(document.body);
    await sleep(100);
    return false;
  }

  // —— 文件上传 ——
  // input 自己的类名里常带 upload，所以从它的父元素开始找外框
  const uploadBox = (el) => (el.parentElement && el.parentElement.closest('[class*="upload"],[class*="Upload"]')) || el.parentElement;
  const FILE_LABEL = { resume: '文件 · 简历', photo: '文件 · 照片' };
  const EXT_RE = /\.(pdf|docx?|png|jpe?g|gif|bmp|txt|rtf)\b/gi;
  function fileKind(desc) {
    const test = (re) => desc.parts.some((p) => re.test(p));
    if (test(S.files.skip)) return null;
    if (test(S.files.photo)) return 'photo';
    if (test(S.files.resume)) return 'resume';
    return null;
  }
  const acceptOk = (el, name) => {
    const accept = (el.getAttribute('accept') || '').toLowerCase();
    if (!accept || accept.includes('/')) return true;
    const ext = '.' + String(name).split('.').pop().toLowerCase();
    return accept.split(',').some((a) => a.trim() === ext);
  };
  // 上传框里已经有文件了吗：恰好出现一个文件名，或已经显示了图片（列出多个扩展名的是格式提示）
  const hasFile = (el, box) =>
    el.files.length > 0 || (box.textContent.match(EXT_RE) || []).length === 1 || !!box.querySelector('img[src]:not([src=""])');

  // 第二步：真正把文件塞进上传框（文件内容只在需要时才传进页面）
  globalThis.__resumeAutofillFiles = function (data) {
    const done = [];
    for (const { el, kind } of globalThis.__raPendingFiles || []) {
      const f = data && data[kind];
      if (!f || !el.isConnected) continue;
      const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], f.name, { type: f.type || 'application/octet-stream' }));
      el.files = dt.files;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      const box = uploadBox(el);
      if (box) highlight(box);
      done.push(`${FILE_LABEL[kind]}（${f.name}）`);
    }
    globalThis.__raPendingFiles = [];
    return done;
  };

  // —— 主流程 ——
  // files: { resume: {name,type,size}, photo: {...} } 只是文件信息，不含内容
  globalThis.__resumeAutofill = async function (profile, files, opts = {}) {
    if (globalThis.__raRunning) return null;
    globalThis.__raRunning = true;
    try {
      return await run(profile || {}, files || {}, opts);
    } finally {
      globalThis.__raRunning = false;
    }
  };

  async function run(profile, files, opts) {
    const report = { filled: [], kept: 0, noData: [], unknown: 0, wantFiles: [] };
    const state = { current: null, idx: {}, seen: {} };
    const pending = (globalThis.__raPendingFiles = []);
    const sectionById = Object.fromEntries(S.sections.map((s) => [s.id, s]));
    const customs = (profile.custom || [])
      .map((c) => ({
        keys: String(c.keywords || '')
          .split(/[,，]/)
          .map(norm)
          .filter(Boolean),
        value: c.value,
      }))
      .filter((c) => c.keys.length && c.value);

    function useField(sec, field) {
      let value;
      let label = `${sec.title} · ${field.label}`;
      if (sec.repeat) {
        state.current = sec.id;
        state.idx[sec.id] ??= 0;
        const used = (state.seen[sec.id] ??= new Set());
        if (used.has(field.key)) {
          state.idx[sec.id]++;
          used.clear();
        }
        used.add(field.key);
        const i = state.idx[sec.id];
        value = profile[sec.id]?.[i]?.[field.key];
        label = `${sec.title} #${i + 1} · ${field.label}`;
      } else {
        value = profile[sec.id]?.[field.key];
      }
      // 默认值只用在资料里确实有的那一段经历上
      const exists = !sec.repeat || !!profile[sec.id]?.[state.idx[sec.id]];
      if ((value == null || value === '') && field.fallback && exists) value = field.fallback;
      return { value, label, field };
    }

    const LOC = ['country', 'province', 'city'];

    function resolve(desc, isSelect) {
      const any = (re) => desc.parts.some((p) => re.test(p));
      for (const c of customs) {
        if (c.keys.some((k) => desc.parts.some((p) => p.includes(k)))) {
          return { value: c.value, label: `自定义 · ${c.keys[0]}`, field: {} };
        }
      }
      for (const sec of S.sections) {
        for (const field of sec.fields) {
          if (field.pre && any(field.match) && !(field.not && any(field.not))) return useField(sec, field);
        }
      }
      if (any(S.skip)) return null;

      // 同一个标题下并排的 2~3 个控件：按位置当作 国家 / 省 / 市
      const place = (sec, field) => {
        if (desc.size >= 2 && LOC.includes(field.generic)) {
          const order = desc.size >= 3 ? LOC : field.generic === 'country' ? ['country', 'city'] : ['province', 'city'];
          const g = order[desc.pos];
          const alt = sec.fields.find((x) => x.generic === g);
          if (!alt) return { value: '', label: `${sec.title} · ${g}`, field: {} };
          field = alt;
        }
        return useField(sec, field);
      };

      const match = (parts) => {
        const test = (re) => parts.some((p) => re.test(p));
        const kindOk = (field) => !field.only || (field.only === 'select') === isSelect;
        const tryGeneric = () => {
          for (const [g, re] of Object.entries(S.generic)) {
            if (!test(re)) continue;
            const sec = sectionById[desc.hint || state.current];
            const field = sec && sec.fields.find((x) => x.generic === g);
            if (field) return place(sec, field);
          }
          return null;
        };
        for (const sec of S.sections) {
          if (sec.id === 'custom') continue;
          if (sec.id === 'basic') {
            for (const field of sec.fields) {
              const re = field.early === true ? field.match : field.early;
              if (re && kindOk(field) && test(re)) return place(sec, field);
            }
            const g = tryGeneric();
            if (g) return g;
          }
          for (let field of sec.fields) {
            if (!field.match || !kindOk(field) || !test(field.match) || (field.not && test(field.not))) continue;
            // 「毕业院校所在国家」这种：属于这一段，但其实问的是地点
            if (sec.repeat && field.anchor) {
              const loc = LOC.find((g) => test(S.generic[g]));
              field = (loc && sec.fields.find((x) => x.generic === loc)) || field;
            }
            return place(sec, field);
          }
        }
        return null;
      };

      // 先只看页面上显示的标题；认不出来再参考 name / id 这些内部名字
      return (desc.labels.length ? match(desc.labels) : null) || match(desc.parts);
    }

    const radioDone = new WeakSet();
    for (const el of collect(document)) {
      if (el.disabled || SKIP_TYPES.has(el.type) || radioDone.has(el)) continue;

      // 文件上传框（input 本身通常是隐藏的，看它外面的框）
      if (el.type === 'file') {
        const box = uploadBox(el);
        if (!visible(box)) continue;
        const fresh = !(opts.auto && seen.has(el));
        seen.add(el);
        if (!fresh) continue;
        const kind = fileKind(describe(el));
        if (!kind) continue;
        if (!files[kind]) { report.noData.push(FILE_LABEL[kind]); continue; }
        if (!opts.overwrite && hasFile(el, box)) { report.kept++; continue; }
        if (!acceptOk(el, files[kind].name)) { report.unknown++; continue; }
        pending.push({ el, kind });
        if (!report.wantFiles.includes(kind)) report.wantFiles.push(kind);
        continue;
      }

      const isRadio = el.type === 'radio';
      const group = isRadio ? radioGroup(el) : null;
      if (group) group.forEach((r) => radioDone.add(r));
      if (!visible(isRadio ? el.closest('label') || el.parentElement : el)) continue;
      const fresh = !(opts.auto && seen.has(el));
      (group || [el]).forEach((x) => seen.add(x));

      if (el.type === 'password') {
        const pw = profile.account?.password;
        if (fresh && opts.fillPassword && pw && (opts.overwrite || !el.value)) {
          setNative(el, pw);
          highlight(el);
          report.filled.push('网申账号 · 密码');
        }
        continue;
      }

      const kind = isRadio ? 'radio' : el.tagName === 'SELECT' ? 'select' : isCustomSelect(el) ? 'custom' : 'text';
      if (kind === 'text' && (el.readOnly || el.type === 'search')) continue;

      // 即使这个控件不用再填，也要走一遍识别，才能数清「现在是第几段经历」
      const hit = resolve(describe(el, group), kind !== 'text');
      if (!fresh) continue;
      if (!hit) { report.unknown++; continue; }
      if (hit.value == null || hit.value === '') { report.noData.push(hit.label); continue; }
      const value = String(hit.value);

      if (kind === 'radio') {
        if (!opts.overwrite && group.some((r) => r.checked)) { report.kept++; continue; }
        const options = group.map((r) => ({
          el: r,
          text: norm((r.labels && r.labels[0] && r.labels[0].textContent) || r.getAttribute('aria-label') || r.value),
        }));
        const opt = pickOption(options, value);
        if (!opt) { report.unknown++; continue; }
        opt.el.click();
        highlight(opt.el.closest('label') || opt.el);
      } else if (kind === 'select') {
        if (!opts.overwrite && el.selectedIndex > 0 && el.value !== '') { report.kept++; continue; }
        const options = [...el.options].filter((o) => o.value !== '').map((o) => ({ el: o, text: norm(o.textContent) }));
        const opt = pickOption(options, value);
        if (!opt) { report.unknown++; continue; }
        setNative(el, opt.el.value);
        highlight(el);
      } else if (kind === 'custom') {
        const wrap = el.closest(SELECT_WRAP);
        const chosen = wrap && wrap.querySelector('[class*="selection-item"],[class*="selected-value"],[class*="single-value"]');
        if (!opts.overwrite && (el.value.trim() || (chosen && chosen.textContent.trim()))) { report.kept++; continue; }
        if (!(await fillCustomSelect(el, value))) { report.unknown++; continue; }
        highlight(el);
      } else {
        if (!opts.overwrite && el.value.trim()) { report.kept++; continue; }
        const isDate = hit.field.type === 'date' || hit.field.type === 'month';
        const out = isDate ? formatDate(value, el) : value;
        if ((el.type === 'date' || el.type === 'month') && !/^\d{4}-\d{2}(-\d{2})?$/.test(out)) { report.unknown++; continue; }
        if (el.type === 'number' && isNaN(Number(out))) { report.unknown++; continue; }
        setNative(el, out);
        if (isDate && inDatePicker(el)) pressKey(el, 'Enter');
        highlight(el);
      }
      report.filled.push(hit.label);
    }
    return report;
  }
})();
