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
    ['是', 'yes', 'true', 'y', '接受', '愿意', '服从', '同意', '可以'],
    ['否', 'no', 'false', 'n', '不接受', '不愿意', '不服从', '不同意', '不可以'],
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
    ['熟练', '熟悉', '良好', '商务会话'],
    ['精通', '无障碍沟通'],
    ['一般', '日常会话'],
    ['全国各地', '中国国内各地', '全国', '不限'],
    ['随时', '随时到岗', '立即', '立即到岗', '立刻', '一周内', '1周内'],
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
  // 外语考试：资料里可能写成「英语六级 580」，网站选项是 CET-6 这种
  const CERTS = [
    ['六级', 'cet 6', 'cet6'],
    ['四级', 'cet 4', 'cet4'],
    ['托福', 'toefl'],
    ['雅思', 'ielts'],
    ['专八', '专四', '专业八级', '专业四级', 'tem'],
    ['gre'],
    ['gmat'],
  ];
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const isCJK = (s) => /[^\x00-\x7f]/.test(s);
  function termsFor(value) {
    const v = norm(value);
    const group = SYNONYMS.find((g) => g.includes(v));
    // 自己的写法排最前，同义词其次
    if (group) return [v, ...group.filter((t) => t !== v)];
    const cert = CERTS.find((g) => g.some((t) => v.includes(t)));
    return cert ? [v, ...cert] : [v];
  }
  const termHits = (text, term) =>
    isCJK(term) ? text.includes(term) : new RegExp('(^|[^a-z0-9])' + escapeRe(term) + '($|[^a-z0-9])').test(text);
  // 在一组 {text} 选项里找最合适的：精确相等 → 选项包含资料 → 资料包含选项（如「上海市」对「上海」）
  function pickOption(options, value) {
    const terms = termsFor(value);
    const exact = options.find((o) => terms.includes(o.text));
    if (exact) return exact;
    // 想选「是 / 接受」时，别被「不接受」「否」这种带同样字眼的选项骗了
    const positive = terms.includes('是');
    const negated = (text) => positive && /^(不|否|无法|拒绝|暂不)|不(接受|愿意|服从|同意|可以)/.test(text);
    for (const t of terms) {
      const hit = options.find((o) => o.text && !negated(o.text) && termHits(o.text, t));
      if (hit) return hit;
    }
    const v = terms[0];
    // 「TOP10%」对「前10%」：数字和百分号对上就行
    const pct = /(\d+)\s*%/.exec(v);
    if (pct) {
      const hit = options.find((o) => new RegExp('(^|\\D)' + pct[1] + '\\s*%').test(o.text));
      if (hit) return hit;
    }
    return (
      options
        .filter((o) => o.text.length >= (isCJK(o.text) ? 2 : 4) && v.includes(o.text))
        .sort((a, b) => b.text.length - a.text.length)[0] || null
    );
  }

  // 成绩排名：资料里选的是一档（比如 20%）。在网站的选项里挑「不超过它」的最大一档，
  // 比如资料选 20%，选项有 前5% / 前10% / 前25% / 前50%，就选 前10%。
  // 网站的选项全都比它大时，选最小的那档。
  function pickPercent(options, value) {
    const n = parseFloat(String(value).replace(/[^\d.]/g, ''));
    if (isNaN(n)) return pickOption(options, value);
    const upper = (text) => {
      const nums = (text.match(/\d+(\.\d+)?(?=\s*%)/g) || []).map(Number);
      return nums.length ? Math.max(...nums) : null;
    };
    const tops = options.map((o) => ({ o, top: upper(o.text) })).filter((x) => x.top != null);
    if (!tops.length) return pickOption(options, '其他');
    const within = tops.filter((x) => x.top <= n).sort((a, b) => b.top - a.top);
    return (within[0] || tops.sort((a, b) => a.top - b.top)[0]).o;
  }

  // 语言水平：各家叫法不一样。找不到同样说法时，「精通」= 紧挨着「母语」、比它低一档的那个选项
  function pickLevel(options, value) {
    const hit = pickOption(options, value);
    if (hit || !/精通/.test(value)) return hit;
    const real = options.filter((o) => o.text);
    const i = real.findIndex((o) => /母语|native/.test(o.text));
    if (i < 0) return null;
    return i > 0 ? real[i - 1] : real[i + 1] || null; // 母语排最后就取前一个，排最前就取后一个
  }
  const pickerFor = (field) => (field.percent ? pickPercent : field.level ? pickLevel : pickOption);

  // —— 找控件、读标题 ——
  const FIELD_SEL = 'input,textarea,select';
  const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'checkbox', 'range', 'color']);
  const LABEL_SEL = 'legend,label,th,dt,[class*="label"],[class*="Label"],[class*="title"],[class*="Title"]';
  const DATE_SEL = '[class*="date"],[class*="Date"],[data-tag*="date"],[class*="calendar"],.ant-picker';
  const SELECT_WRAP = '[class*="select"],[class*="Select"],[class*="cascader"],[class*="dropdown"]';

  // 完全自绘、没有输入框的控件：
  // 1) 下拉框是一个 div[role=combobox]；2) 「起止时间」是两段可点的年月文字
  const PERIOD_SEL = '[class*="date-picker"][class*="period"]';
  const isPeriod = (el) => el.matches && el.matches(PERIOD_SEL) && !/label|panel|input|line/.test(String(el.className).replace(/date-picker-period/g, ''));
  const periodLabels = (root) => [...root.querySelectorAll('[class*="label"]')].filter((l) => !l.parentElement.closest('[class*="label"]'));
  const isComboDiv = (el) =>
    el.tagName !== 'INPUT' && el.getAttribute && el.getAttribute('role') === 'combobox' && ![...el.querySelectorAll('input')].some(visible);

  // Element 的「下拉菜单」被当成下拉框用：触发它的是一段文字，选项是一个平时藏着的菜单
  const DROP_SEL = '.el-dropdown-selfdefine';
  const isDropdown = (el) => !!el.matches && el.matches(DROP_SEL) && !el.closest('header,nav,[class*="header"],[class*="nav"]');
  const dropdownMenu = (el) => document.getElementById(el.getAttribute('aria-controls') || '') || el.parentElement.querySelector('ul,[role="menu"]');

  function collect(root, out = []) {
    root.querySelectorAll(FIELD_SEL).forEach((el) => out.push(el));
    root.querySelectorAll(DROP_SEL).forEach((el) => isDropdown(el) && out.push(el));
    root.querySelectorAll(`[role="combobox"],${PERIOD_SEL}`).forEach((el) => {
      if (isComboDiv(el) || (isPeriod(el) && !el.parentElement.closest(PERIOD_SEL))) out.push(el);
    });
    root.querySelectorAll('*').forEach((el) => el.shadowRoot && collect(el.shadowRoot, out));
    // 按页面上的先后顺序排
    return out.sort((a, b) => (a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  }

  const inDatePicker = (el) => !!el.closest(DATE_SEL);
  // 网站自己画的下拉框：一个只读输入框，点了以后才弹出选项
  function isCustomSelect(el) {
    if (isComboDiv(el)) return true;
    if (el.tagName !== 'INPUT' || inDatePicker(el)) return false;
    if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox' || el.closest('[role="combobox"]')) return true;
    if (el.closest('[class*="cascader"]')) return true; // 省 / 市这种一级一级点的选择器
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
    for (let node = el.parentElement, d = 0; node && node !== document.body && d < 12; node = node.parentElement, d++) {
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
        if (/desc|tip|hint|help|error|extra|placeholder|count/i.test(String(c.className))) continue; // 标题下面的说明、报错
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
    // 去掉「请输入」「请选择」这类开头，免得「请输入职责描述」被看成含有「入职」
    labels = labels.map((l) => l.replace(/^请?(输入|填写|选择|录入)(您的|你的)?/, '').trim()).filter(Boolean);
    if (!labels.length && !group) labels = [nearbyText(el)].filter(Boolean);
    return {
      own,
      labels,
      parts: [...labels, ...own],
      pos: box ? Math.max(0, box.pos) : 0,
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
  const KEY_CODES = { Enter: 13, Escape: 27 };
  const pressKey = (el, key) => {
    const code = KEY_CODES[key] || 0;
    for (const t of ['keydown', 'keyup']) el.dispatchEvent(new KeyboardEvent(t, { key, code: key, keyCode: code, which: code, bubbles: true }));
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

  // 「2周」「3个月」「随时」→ 从今天算起的那一天（YYYY-MM-DD）。本来就是日期的原样返回
  function leadDate(value) {
    const v = String(value).trim();
    if (/^\d{4}-\d{2}/.test(v)) return v;
    const d = new Date();
    const n = parseInt(v, 10) || 0;
    if (/周|week/.test(v)) d.setDate(d.getDate() + n * 7);
    else if (/月|month/.test(v)) d.setMonth(d.getMonth() + n);
    else if (/天|日|day/.test(v)) d.setDate(d.getDate() + n);
    const pad = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const today = () => leadDate('随时');

  // 正在处理的是资料里的哪一项：标框时记在元素上，侧边栏的清单从这里读
  let nowLabel = '';
  function highlight(el) {
    el.style.outline = '2px solid #22c55e';
    el.style.outlineOffset = '1px';
    delete el.dataset.raMiss;
    el.dataset.raOk = nowLabel || el.dataset.raOk || '';
  }
  // 没填上的：黄框，提醒用户自己填
  function flagMissing(el, label) {
    el.style.outline = '2px solid #eab308';
    el.style.outlineOffset = '1px';
    el.dataset.raMiss = String(label || '').slice(0, 40) || '1';
    delete el.dataset.raOk;
  }
  // 页面上现在的结果：绿框（填好的）和黄框（要用户自己填的）各有哪些
  function snapshot() {
    const names = (attr, key) => [...document.querySelectorAll(`[${attr}]`)].filter((el) => el.getClientRects().length).map((el) => el.dataset[key]);
    return { done: names('data-ra-ok', 'raOk').filter(Boolean), missing: names('data-ra-miss', 'raMiss').map((t) => (t === '1' ? '' : t)) };
  }
  // 侧边栏里点了清单上的一项：滚到页面上对应的位置
  globalThis.__raGoto = (kind, i) => {
    const el = [...document.querySelectorAll(kind === 'done' ? '[data-ra-ok]' : '[data-ra-miss]')].filter((x) => x.getClientRects().length)[i];
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const focusable = el.matches('input,textarea,select') ? el : el.querySelector('input,textarea,select');
    if (focusable && kind !== 'done') focusable.focus({ preventScroll: true });
  };
  function unflag(el) {
    if (!el.dataset.raMiss) return;
    el.style.outline = '';
    delete el.dataset.raMiss;
  }
  // 用户自己填了，黄框就去掉
  if (!globalThis.__raUnflag) {
    globalThis.__raUnflag = true;
    for (const t of ['input', 'change']) {
      document.addEventListener(t, (e) => {
        const el = e.target;
        if (!el || !el.dataset) return;
        if (el.dataset.raMiss && (el.value || el.checked)) unflag(el);
        const box = el.type === 'radio' && el.closest('[data-ra-miss]');
        if (box) unflag(box);
      }, true);
    }
  }

  // 自定义下拉框现在选的是什么（没选返回空）
  function pickedText(el) {
    // 已选的值通常显示在输入框旁边的一个小标签里，往外找几层
    let chosen = null;
    for (let n = el.parentElement, d = 0; n && d < 4 && !chosen; n = n.parentElement, d++) {
      if (n.matches(SELECT_WRAP)) chosen = n.querySelector('[class*="selection-item"],[class*="selected-value"],[class*="single-value"],[class*="select-value"],[class*="select__placeholder"]:not(.is-transparent)');
    }
    if (!chosen && isComboDiv(el)) chosen = el.querySelector('[class*="selected-value"],[class*="selection-item"]');
    if (chosen) return chosen.textContent.trim();
    // 通用判断：下拉外框里没有占位提示、却有文字，说明已经选过了
    const shell = el.tagName === 'INPUT' && el.closest('[class*="select"]:not([class*="search"]):not([class*="selection"]):not([class*="input"])');
    if (!shell || shell.querySelector('[class*="placeholder"]')) return '';
    // （选项列表就画在外框里面的不算：那是选项的文字）
    const copy = shell.cloneNode(true);
    copy.querySelectorAll('[class*="dropdown"],[role="listbox"]').forEach((d) => d.remove());
    return copy.textContent.trim();
  }

  // —— 自定义下拉框：点开 → 等选项出现 → 点选项；找不到就输入关键字过滤再找 ——
  const OPTION_SEL =
    '[role="option"],li[class*="item"],li[class*="option"],[class*="select-item"],[class*="select__list__item"],[class*="select-option"],[class*="tree__node__label"],[class*="tree-node__label"],[class*="tree-node-content-wrapper"],[class*="dropdown"] [class*="option"],[class*="cascader-node"]';
  const visibleOptions = () => [...document.querySelectorAll(OPTION_SEL)].filter(visible);
  const toOptions = (els) => els.map((el) => ({ el, text: norm(el.textContent) }));
  function queries(value) {
    const v = String(value).trim();
    const list = isCJK(v) ? [v, v.slice(0, 4), v.slice(0, 2)] : [v, v.split(/\s+/)[0]];
    return [...new Set(list)].filter((q) => q.length >= 2);
  }
  // more: 多选的下拉框里还要一起选上的其他值（第二、第三意向城市）
  async function fillCustomSelect(el, value, anyOk, pick = pickOption, more = []) {
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
    const trigger = el.closest('[role="combobox"]') || el; // 输入框在下拉外框里面时，点外框才会弹出选项
    press(trigger);
    // 级联选择（省 / 市 / 区）：资料里写成「浙江/杭州」，一级一级点下去
    if (el.closest('[class*="cascader"]')) {
      const parts = String(value).split(/\s*[\/／>,，]\s*/).filter(Boolean);
      let known = before;
      let picked = 0;
      const level = async () => {
        let opts = [];
        for (const end = Date.now() + 1500; Date.now() < end && !opts.length; await sleep(60)) opts = visibleOptions().filter((o) => !known.has(o));
        return toOptions(opts);
      };
      const choose = async (hit) => {
        known = new Set(visibleOptions());
        press(hit.el.querySelector('[class*="label"]') || hit.el);
        await sleep(200);
      };
      for (let i = 0; i < parts.length; i++) {
        const opts = await level();
        let hit = pickOption(opts, parts[i]);
        // 第一级是「中国大陆 / 海外」而资料里只写了省市：先点进中国
        // 资料里写的是「美国」而第一级是大区：把第一级一个个点开，看下一级里有没有
        if (!hit && !picked && i === 0) {
          const home = pickOption(opts, '中国');
          const tops = [...new Set([home, ...opts].filter(Boolean))].slice(0, 8);
          const topEls = new Set(opts.map((o) => o.el));
          // 名字完全一样的优先（「美国」别选成另一个大区里的「美国边远小岛」）
          const wanted = termsFor(parts[i]);
          const look = async (top) => {
            await choose(top);
            await sleep(150);
            return toOptions(visibleOptions().filter((o) => !before.has(o) && !topEls.has(o)));
          };
          let loose = null;
          for (const top of tops) {
            const sub = await look(top);
            hit = sub.find((o) => wanted.includes(o.text)) || null;
            if (hit) break;
            if (!loose && pickOption(sub, parts[i])) loose = top;
          }
          if (!hit && loose) hit = pickOption(await look(loose), parts[i]);
        }
        if (!hit) break;
        await choose(hit);
        picked++;
      }
      // 直辖市：「上海」下面还有一级「上海市」
      if (picked === parts.length) {
        const hit = pickOption(await level(), parts[parts.length - 1]);
        if (hit) await choose(hit);
      }
      const close = async () => {
        if (!visibleOptions().some((o) => !before.has(o))) return;
        pressKey(el, 'Escape');
        press(document.body);
        await sleep(100);
      };
      await close();
      // Element 的级联要点到最后一级才算数。没点到（比如资料里只有城市、没写省）：能搜索的就搜城市名
      if (el.tagName === 'INPUT' && el.closest('.el-cascader') && !el.value.trim()) {
        // 从最细的一级往回搜：「麦迪逊」搜不到就搜「威斯康星」
        for (const word of el.readOnly ? [] : [...parts].reverse()) {
          press(el);
          el.focus();
          setRaw(el, word);
          const found = await waitFor(() => {
            const list = [...document.querySelectorAll('[class*="suggestion-item"]')].filter(visible);
            return list.length ? list : null;
          }, 1200);
          const cand = toOptions(found || []);
          const hit = cand.find((o) => parts.every((p) => o.text.includes(norm(p)))) || cand.find((o) => o.text.includes(norm(word)));
          if (hit) {
            press(hit.el);
            await sleep(200);
            break;
          }
          setRaw(el, '');
          await close();
        }
        return !!el.value.trim();
      }
      return picked > 0;
    }
    const typer = el.tagName === 'INPUT' ? el : el.querySelector('input');
    const prior = typer ? typer.value : ''; // 没选上时要把框里原来的内容放回去，不能清掉用户写的
    const first = toOptions(await waitFresh(1500));
    let hit = pick(first, value);
    for (const v of hit ? [] : more) if ((hit = pick(first, v))) break; // 第一意向不在选项里：从第二、第三意向里找
    if (!hit && anyOk) hit = first.find((o) => o.text) || null; // 这一项随便选一个就行
    if (!hit && typer) {
      // 选项太多（学校、专业）只渲染了一部分：输入关键字让它过滤
      for (const q of queries(value)) {
        setRaw(typer, q);
        await sleep(400);
        hit = pickOption(toOptions(fresh()), value);
        if (hit) break;
      }
      if (!hit) setRaw(typer, prior);
    }
    if (hit) {
      // 已经选中的不再点（多选里再点一次会变成取消）
      const isOn = (o) => /(^|[\s_-])(selected|checked)($|[\s_-])/.test(String(o.className)) || o.getAttribute('aria-selected') === 'true';
      if (!isOn(hit.el)) press(hit.el);
      await sleep(320);
      // 多选的下拉选完不会自己收起来：把其余要选的也点上，再帮它收起
      if (fresh().length) {
        const wrap = el.closest('[class*="select"]');
        const multi = !!wrap && (/multi/.test(String(wrap.className)) || !!wrap.querySelector('[class*="tag"],[class*="overflow"]'));
        const done = new Set([hit.el]);
        for (const v of multi ? more : []) {
          const next = pick(toOptions(fresh().filter((o) => !done.has(o))), v);
          if (!next) continue;
          done.add(next.el);
          if (isOn(next.el)) continue;
          press(next.el);
          await sleep(200);
        }
        pressKey(typer || el, 'Escape');
        press(document.body);
        // 收起有个动画，等它真的消失；还在才再点一下它自己（否则会把刚收起的又点开）
        for (const end = Date.now() + 700; Date.now() < end && fresh().length; ) await sleep(60);
        if (fresh().length) press(trigger);
      }
      return true;
    }
    pressKey(el, 'Escape');
    press(document.body);
    await sleep(150);
    if (fresh().length) press(trigger); // 还没收起来：再点一下它自己
    await sleep(100);
    return false;
  }

  // Element 下拉菜单：选项一直在页面里（只是藏着），直接点对应的那一项
  async function fillDropdown(el, value, anyOk, pick = pickOption) {
    const menu = dropdownMenu(el);
    if (!menu) return false;
    const opts = toOptions([...menu.querySelectorAll('li,[role="menuitem"]')]).filter((o) => o.text && !/^请选择/.test(o.text));
    const hit = pick(opts, value) || (anyOk ? opts[0] : null);
    if (!hit) return false;
    hit.el.click();
    await sleep(150);
    return true;
  }

  // —— 只读的日期选择器（Ant Design / Element 等）：点开 → 写入 → 回车确认 ——
  function panelMode() {
    const open = [...document.querySelectorAll('[class*="picker-dropdown"],[class*="picker-panel"],[class*="date-picker"]')].filter(visible);
    const has = (re) => open.some((p) => p.querySelector(re));
    // 有的组件类名写着 date，面板里其实只有 1 月到 12 月
    if (open.some((p) => /0?1月/.test(p.textContent) && /12月/.test(p.textContent) && !/31/.test(p.textContent))) return 'month';
    if (has('[class*="date-panel"],[class*="date-table"]')) return 'date';
    if (has('[class*="month-panel"],[class*="month-table"]')) return 'month';
    if (has('[class*="year-panel"],[class*="year-table"]')) return 'year';
    return null;
  }
  async function fillPicker(el, value) {
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
    let range = el.closest('[class*="range"]');
    while (range && range.parentElement && range.parentElement.closest('[class*="range"]')) range = range.parentElement.closest('[class*="range"]'); // 取最外层
    const isStart = !!range && range.querySelectorAll('input').length > 1 && range.querySelector('input') === el;
    let tries = [value];
    for (let n = 0; n < tries.length; n++) {
      press(el);
      el.focus();
      await sleep(350);
      if (m && n === 0) {
        const all = { date: `${m[1]}-${m[2]}-${m[3] || '01'}`, month: `${m[1]}-${m[2]}`, year: m[1] };
        const mode = panelMode() || 'date';
        tries = [all[mode], ...Object.values(all).filter((x) => x !== all[mode])];
      }
      setRaw(el, tries[n]);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(150);
      pressKey(el, 'Enter');
      await sleep(350);
      // 起止时间的「开始」要等「结束」也填了才算数，这里先不让它失焦
      if (isStart) return true;
      el.blur();
      press(document.body);
      await sleep(250);
      if (el.value.trim()) return true;
    }
    return false;
  }

  // —— 自绘的「起止时间」：点年月文字 → 弹出年、月两列 → 依次点 ——
  const hasDigits = (el) => /\d/.test(el.textContent);
  const waitFor = async (fn, ms) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(80)) {
      const v = fn();
      if (v) return v;
    }
    return fn();
  };
  const periodLists = () =>
    [...document.querySelectorAll('[class*="date-picker"][class*="panel"] [class*="panel-list"]')].filter(
      (l) => visible(l) && !/item/.test(String(l.className).replace(/panel-list/g, ''))
    );
  async function fillPeriod(root, values, overwrite) {
    let done = 0;
    for (let i = 0; i < 2; i++) {
      const label = () => periodLabels(root)[i];
      const m = /^(\d{4})-(\d{2})/.exec(values[i] || '');
      if (!label() || !m || (!overwrite && hasDigits(label()))) continue;
      if (!periodLists().length || !/focus|active/.test(label().className)) press(label());
      // 年、月两列依次点；每点一下等文字变过来再点下一个
      for (const [col, text] of [[0, m[1]], [1, m[2]]]) {
        const item = await waitFor(() => {
          const list = periodLists()[col];
          return list && [...list.children].find((c) => c.textContent.trim() === text || c.textContent.trim() === String(Number(text)));
        }, 1500);
        if (!item) break;
        item.scrollIntoView({ block: 'nearest' });
        press(item);
        await waitFor(() => label() && label().textContent.includes(text), 1200);
        await sleep(120);
      }
      if (label() && label().textContent.includes(m[1]) && label().textContent.includes(m[2])) done++;
    }
    if (periodLists().length) {
      press(document.body);
      await sleep(150);
    }
    return done;
  }
  globalThis.__raTest = { fillPeriod };

  // —— 资料里的经历比页面上的段数多时，替用户点一下那一段的「添加」——
  const ADD_SECTIONS = S.headings;
  const HEAD_SEL = 'h1,h2,h3,h4,h5,legend,[class*="title"],[class*="Title"],[class*="header"]';
  const headSection = (text) => Object.keys(S.headings).find((id) => S.headings[id].test(text)) || null;
  // 页面上的段落小标题：能对应到某一段的，或者是真正的标题标签（用来判断「这一段结束了」）
  function sectionHeads() {
    const out = [];
    for (const h of document.querySelectorAll(HEAD_SEL)) {
      const t = shortText(h);
      if (!t || t.length > 16 || !visible(h)) continue;
      const sec = headSection(t);
      if (sec || /^(H[1-5]|LEGEND)$/.test(h.tagName)) out.push({ el: h, sec });
    }
    return out;
  }
  // 返回这一段所有可能的「添加」按钮：最里层的排前面（外层只是包着它的容器，点了没用）
  function findAddButtons(secId) {
    const out = [];
    const heads = [...document.querySelectorAll(HEAD_SEL)].filter((h) => visible(h) && shortText(h) && shortText(h).length <= 16);
    for (const b of document.querySelectorAll('button,[role="button"],a,[class*="add"]')) {
      if (b.disabled || !visible(b)) continue;
      const t = norm(b.textContent);
      if (!t || t.length > 16 || !/^(\+ ?)?(这里|点击)?(添加|新增|增加|add)/.test(t)) continue;
      if (ADD_SECTIONS[secId].test(t)) { out.push(b); continue; }
      if (Object.values(ADD_SECTIONS).some((re) => re.test(t))) continue; // 是别的段落的按钮
      // 按钮上只写了「添加」：看它上方最近的标题是哪一段
      let head = null;
      for (const h of heads) if (!h.contains(b) && h.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) head = h;
      if (head && ADD_SECTIONS[secId].test(shortText(head))) out.push(b);
    }
    const depth = (n) => { let d = 0; for (; n; n = n.parentElement) d++; return d; };
    return out.sort((a, b) => depth(b) - depth(a));
  }

  // 还空着的控件标黄框；已经有内容的把黄框去掉。返回还空着几个
  function markMissing() {
    const radioDone = new WeakSet();
    const combos = new WeakSet();
    let n = 0;
    for (const el of collect(document)) {
      if (el.disabled || SKIP_TYPES.has(el.type) || el.type === 'file' || el.type === 'password' || el.type === 'search' || radioDone.has(el)) continue;
      if (el.type !== 'radio' && el.getAttribute('aria-hidden') === 'true') continue;
      if (el.tagName === 'INPUT' && el.closest(PERIOD_SEL)) continue;
      const combo = el.tagName === 'INPUT' ? el.closest('[role="combobox"]') : null;
      if (combo && combos.has(combo)) continue;
      if (isComboDiv(el)) combos.add(el);
      let box = el;
      let empty;
      if (isPeriod(el)) empty = periodLabels(el).some((l) => !hasDigits(l));
      else if (el.type === 'radio') {
        const group = radioGroup(el);
        group.forEach((r) => radioDone.add(r));
        empty = !group.some((r) => r.checked);
        box = (el.closest('label') || el).parentElement;
      } else if (el.tagName === 'SELECT') empty = el.value === '';
      else if (isDropdown(el)) empty = !norm(el.textContent) || /请选择|select|choose/.test(norm(el.textContent));
      else if (isCustomSelect(el)) empty = !((el.value || '').trim() || pickedText(el));
      else {
        if (el.readOnly && !inDatePicker(el)) continue;
        empty = !el.value.trim();
      }
      if (!box || !visible(box)) continue;
      if (empty) {
        const d = describe(el, el.type === 'radio' ? radioGroup(el) : undefined);
        flagMissing(box, (d.labels || [])[0]);
        n++;
      } else unflag(box);
    }
    // 没有输入框、要点按钮去选的项（「+ 选择部门」）：也提醒一下
    for (const b of document.querySelectorAll('button,[role="button"]')) {
      if (b.disabled || !visible(b)) continue;
      const t = norm(b.textContent);
      if (t.length > 10 || !/^[+＋]? ?请?选择/.test(t)) continue;
      flagMissing(b, t.replace(/^[+＋] ?/, ''));
      n++;
    }
    return n;
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
      nowLabel = FILE_LABEL[kind];
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
    let passNo = 0;
    const pending = (globalThis.__raPendingFiles = []);
    const sectionById = Object.fromEntries(S.sections.map((s) => [s.id, s]));
    // 自带一条的段落（语言）：用户从没动过时，当作有一条用默认值的
    for (const sec of S.sections) if (sec.seed && !(profile[sec.id] || []).length) profile[sec.id] = [{}];
    // 年龄按出生日期算（周岁）
    const born = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec((profile.basic || {}).birthday || '');
    if (born) {
      const now = new Date();
      const hadBirthday = now.getMonth() + 1 > +born[2] || (now.getMonth() + 1 === +born[2] && now.getDate() >= +(born[3] || 1));
      profile.basic.age = String(now.getFullYear() - +born[1] - (hadBirthday ? 0 : 1));
    }
    const customs = (profile.custom || [])
      .map((c) => ({
        keys: String(c.keywords || '')
          .split(/[,，]/)
          .map(norm)
          .filter(Boolean),
        value: c.value,
      }))
      .filter((c) => c.keys.length && c.value);

    // 网站上可能已经存着几段经历，顺序和资料里的不一样（比如网站第 1 段是本科，资料第 1 段是硕士）。
    // 先看一遍页面上每一段已有的名称和时间，和资料里的对上号，再填；对不上的段落按资料里剩下的顺序来。
    let order = {};
    const flat = (v) => String(v || '').toLowerCase().replace(/[\s·｜|,，.。()（）-]/g, '');
    const same = (a, b) => flat(a).length >= 2 && flat(b).length >= 2 && (flat(a).includes(flat(b)) || flat(b).includes(flat(a)));
    const ym = (v) => { const d = String(v || '').replace(/\D/g, '').slice(0, 6); return d.length === 6 ? d : ''; };
    function arrange(blocks) {
      const out = {};
      for (const sec of S.sections) {
        const list = profile[sec.id] || [];
        if (!sec.repeat || list.length < 2) continue;
        const anchor = (sec.fields.find((x) => x.anchor) || {}).key;
        const pairs = [];
        let n = 0;
        for (const key of Object.keys(blocks)) {
          const [id, i] = key.split('#');
          if (id !== sec.id) continue;
          n = Math.max(n, +i + 1);
          list.forEach((e, j) => {
            const b = blocks[key];
            let score = 0;
            if (anchor && same(b[anchor], (e || {})[anchor])) score += 2;
            if (ym(b.start) && ym(b.start) === ym((e || {}).start)) score += 2;
            if (ym(b.end) && ym(b.end) === ym((e || {}).end)) score += 1;
            if (score) pairs.push({ i: +i, j, score });
          });
        }
        const map = [];
        const used = new Set();
        for (const p of pairs.sort((a, b) => b.score - a.score || a.i - b.i || a.j - b.j)) {
          if (map[p.i] !== undefined || used.has(p.j)) continue;
          map[p.i] = p.j;
          used.add(p.j);
        }
        const rest = list.map((_, j) => j).filter((j) => !used.has(j));
        for (let i = 0; i < Math.max(n, list.length); i++) if (map[i] === undefined) map[i] = rest.length ? rest.shift() : list.length + i; // 资料用完了：指向不存在的一段
        out[sec.id] = map;
      }
      return out;
    }

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
        label = `${sec.title} #${i + 1} · ${field.label}`;
      }
      // 页面上的第 i 段对应资料里的哪一段（见 arrange：网站上已有的经历按内容对号入座）
      const item = sec.repeat ? profile[sec.id]?.[order[sec.id]?.[state.idx[sec.id]] ?? state.idx[sec.id]] : profile[sec.id];
      value = item?.[field.key];
      // 默认值只用在资料里确实有的那一段经历上
      const exists = !sec.repeat || !!item;
      if ((value == null || value === '') && field.alt) value = item?.[field.alt];
      if ((value == null || value === '') && field.fallback && exists) value = field.fallback;
      return { value, label, field, entry: item, block: sec.repeat ? `${sec.id}#${state.idx[sec.id]}` : null };
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

      // 「最高学历 / 最高学历学校 / 最高学历毕业日期」：取学历最高的那段，不影响后面数第几段
      if (any(S.top)) {
        const edu = sectionById.education;
        const rest = desc.labels.map((p) => p.replace(S.top, '').trim()).filter(Boolean);
        const test = (re) => rest.some((p) => re.test(p));
        const field = !rest.length
          ? edu.fields.find((x) => x.key === 'degree')
          : edu.fields.find((x) => x.match && test(x.match) && !(x.not && test(x.not))) ||
            edu.fields.find((x) => x.generic && S.generic[x.generic] && test(S.generic[x.generic]));
        if (!field) return null;
        const rank = ['大专', '本科', '硕士', '博士'];
        const best = [...(profile.education || [])].sort((a, b) => rank.indexOf(b.degree) - rank.indexOf(a.degree))[0];
        return { value: best && best[field.key], label: `最高学历 · ${field.label}`, field };
      }

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
            if (g === 'range' || !test(re)) continue;
            const sec = sectionById[desc.hint || desc.headSec || state.current];
            const field = sec && sec.fields.find((x) => x.generic === g);
            if (field) return place(sec, field);
          }
          return null;
        };
        const inSection = (sec) => {
          for (let field of sec.fields) {
            if (!field.match || !kindOk(field) || !test(field.match) || (field.not && test(field.not))) continue;
            // 「毕业院校所在国家」这种：属于这一段，但其实问的是地点
            if (sec.repeat && field.anchor) {
              const loc = LOC.find((g) => test(S.generic[g]));
              field = (loc && sec.fields.find((x) => x.generic === loc)) || field;
            }
            return place(sec, field);
          }
          return null;
        };
        // 已经知道在哪一段经历里（看小标题或外层容器）：先按那一段的字段认
        // 「起止时间」下并排两个框：前一个是开始，后一个是结束
        if (desc.size === 2 && test(S.generic.range)) {
          const sec = sectionById[desc.hint || desc.headSec || state.current];
          const field = sec && sec.fields.find((x) => x.generic === (desc.pos === 0 ? 'start' : 'end'));
          if (field) return useField(sec, field);
        }
        const here = sectionById[desc.headSec];
        if (here && here.repeat) {
          const hit = inSection(here);
          if (hit) return hit;
        }
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
          const hit = inSection(sec);
          if (hit) return hit;
        }
        return null;
      };

      // 先只看页面上显示的标题；认不出来再参考 name / id 这些内部名字
      return (desc.labels.length ? match(desc.labels) : null) || match(desc.parts);
    }

    // scan: 只看不填，记下页面上每段经历现有的内容（给 arrange 用）
    async function pass(scan) {
    if (!scan && !opts.dry) {
      order = {};
      const found = await pass({});
      order = arrange(found);
    }
    state.current = null;
    state.idx = {};
    state.seen = {};
    report.kept = 0;
    report.unknown = 0;
    report.noData = [];
    const again = opts.auto || passNo > 0; // 第二遍起只处理新出现的控件
    const radioDone = new WeakSet();
    const combosDone = new WeakSet();
    const rewrote = new Set();
    const heads = sectionHeads();
    let hi = -1;
    let lastHead = null;
    for (const el of collect(document)) {
      if (el.disabled || SKIP_TYPES.has(el.type) || radioDone.has(el)) continue;
      // 组件内部用来量尺寸的隐藏副本（单选框除外：有的组件把真正的 radio 标成 aria-hidden）
      if (el.type !== 'radio' && el.getAttribute('aria-hidden') === 'true') continue;
      // 走到了哪个小标题下面
      while (hi + 1 < heads.length && !heads[hi + 1].el.contains(el) && heads[hi + 1].el.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) hi++;
      const head = hi >= 0 ? heads[hi] : null;
      if (head !== lastHead) {
        lastHead = head;
        state.current = head.sec; // 换了段落：通用字段（开始 / 结束时间等）跟着换
      }

      // 文件上传框（input 本身通常是隐藏的，看它外面的框）
      if (el.type === 'file') {
        if (scan) continue;
        const box = uploadBox(el);
        if (!visible(box)) continue;
        const fresh = !(again && seen.has(el));
        seen.add(el);
        if (!fresh) continue;
        const kind = fileKind(describe(el));
        if (!kind) continue;
        if (!files[kind]) { report.noData.push(FILE_LABEL[kind]); continue; }
        if (!opts.overwrite && hasFile(el, box)) { report.kept++; continue; }
        if (!acceptOk(el, files[kind].name)) { report.unknown++; continue; }
        if (!pending.some((p) => p.el === el)) pending.push({ el, kind });
        if (!report.wantFiles.includes(kind)) report.wantFiles.push(kind);
        continue;
      }

      if (el.tagName === 'INPUT' && el.closest(PERIOD_SEL)) continue; // 自绘起止时间里的隐藏输入框
      // 下拉框点开后里面才冒出来的搜索框：外框已经处理过了
      const combo = el.tagName === 'INPUT' ? el.closest('[role="combobox"]') : null;
      if (combo && combosDone.has(combo)) continue;
      if (isComboDiv(el)) combosDone.add(el);
      if (isPeriod(el)) {
        if (!visible(el)) continue;
        const fresh = !(again && seen.has(el));
        if (!scan) seen.add(el);
        const desc = describe(el);
        desc.headSec = head ? head.sec : null;
        const sec = sectionById[desc.hint || desc.headSec || state.current];
        const startField = sec && sec.fields.find((x) => x.generic === 'start');
        const endField = sec && sec.fields.find((x) => x.generic === 'end');
        if (!startField || !endField) { if (fresh && !scan) report.unknown++; continue; }
        const a = useField(sec, startField);
        const b = useField(sec, endField);
        if (scan) {
          const texts = periodLabels(el).map((l) => l.textContent);
          if (a.block) Object.assign((scan[a.block] ??= {}), { start: texts[0] || '', end: texts[1] || '' });
          continue;
        }
        if (opts.debug) (report.debug ??= []).push(`${desc.labels.join(' / ')} [period] -> ${a.label}`);
        if (!fresh || opts.dry) continue;
        if (!a.value && !b.value) { report.noData.push(a.label); continue; }
        const n = await fillPeriod(el, [a.value, b.value], opts.overwrite);
        nowLabel = a.label;
        if (n) { highlight(el); report.filled.push(a.label); } else if (periodLabels(el).some((l) => !hasDigits(l))) report.unknown++;
        else report.kept++;
        continue;
      }

      const isRadio = el.type === 'radio';
      const group = isRadio ? radioGroup(el) : null;
      if (group) group.forEach((r) => radioDone.add(r));
      if (!visible(isRadio ? el.closest('label') || el.parentElement : el)) continue;
      const fresh = !(again && seen.has(el));
      if (!scan) (group || [el]).forEach((x) => seen.add(x));

      if (scan && el.type === 'password') continue;
      if (el.type === 'password') {
        const pw = profile.account?.password;
        if (fresh && opts.fillPassword && pw && (opts.overwrite || !el.value)) {
          setNative(el, pw);
          nowLabel = '网申账号 · 密码';
          highlight(el);
          report.filled.push('网申账号 · 密码');
        }
        continue;
      }

      let kind = isRadio ? 'radio' : el.tagName === 'SELECT' ? 'select' : isDropdown(el) ? 'dropdown' : isCustomSelect(el) ? 'custom' : 'text';
      if (kind === 'text' && inDatePicker(el) && (el.readOnly || el.closest('.ant-picker,.el-date-editor,[class*="range-picker"],[class*="picker-input"]'))) kind = 'picker';
      if (kind === 'text' && (el.readOnly || el.type === 'search')) continue;

      // 即使这个控件不用再填，也要走一遍识别，才能数清「现在是第几段经历」
      const desc = describe(el, group);
      desc.headSec = head ? head.sec : null;
      const hit = resolve(desc, kind !== 'text' && kind !== 'picker');
      if (scan) {
        if (hit && hit.block && !isRadio) {
          const b = (scan[hit.block] ??= {});
          const k = hit.field.generic === 'start' || hit.field.generic === 'end' ? hit.field.generic : hit.field.key;
          b[k] ||= (el.value || '').trim();
        }
        continue;
      }
      if (opts.debug) (report.debug ??= []).push(`${desc.labels.join(' / ')} {${desc.own.join(',')}} [${kind}] -> ${hit ? hit.label : '?'}`);
      if (opts.dry) continue; // 只识别、不写入（调试用）
      if (!fresh) continue;
      if (!hit) { report.unknown++; continue; }
      if (hit.value == null || hit.value === '') { report.noData.push(hit.label); continue; }
      nowLabel = hit.label;
      let value = String(hit.value);
      // 最早可入职时间：日期框填 今天 + 资料里选的时长；文字框直接写时长
      let leadIsDate = false;
      if (hit.field.lead) {
        const ph = `${el.getAttribute ? el.getAttribute('placeholder') || '' : ''}`;
        leadIsDate = kind === 'picker' || el.type === 'date' || el.type === 'month' || (kind === 'text' && (inDatePicker(el) || /日期|date|yyyy/i.test(ph)));
        if (leadIsDate) value = leadDate(value);
        else if (kind === 'text' && /^随时$/.test(value)) value = '随时到岗';
      }
      // 这一段经历的公司 / 学校 / 项目名是我们刚写进去的：说明网站原来放的是另一段经历，
      // 同一段里剩下的旧内容（描述、时间等）也一起换掉，免得张冠李戴
      const stale = leadIsDate && /^\d{4}\D\d{1,2}/.test(el.value || '') && (el.value || '').replace(/\D/g, '-').slice(0, 10) < today(); // 网站里存着一个早就过去的日期
      const over = opts.overwrite || stale || !!hit.field.force || (!!hit.block && rewrote.has(hit.block));

      if (kind === 'radio') {
        if (!over && group.some((r) => r.checked)) { report.kept++; continue; }
        const options = group.map((r) => ({
          el: r,
          text: norm((r.labels && r.labels[0] && r.labels[0].textContent) || r.getAttribute('aria-label') || r.value),
        }));
        const opt = pickOption(options, value);
        if (!opt) { report.unknown++; continue; }
        opt.el.click();
        highlight(opt.el.closest('label') || opt.el);
      } else if (kind === 'select') {
        if (!over && el.selectedIndex > 0 && el.value !== '') { report.kept++; continue; }
        const options = [...el.options].filter((o) => o.value !== '').map((o) => ({ el: o, text: norm(o.textContent) }));
        const opt = pickerFor(hit.field)(options, value);
        if (!opt) { report.unknown++; continue; }
        setNative(el, opt.el.value);
        highlight(el);
      } else if (kind === 'dropdown') {
        const shown = norm(el.textContent);
        if (!opts.overwrite && shown && !/请选择|select|choose/.test(shown)) { report.kept++; continue; }
        if (!(await fillDropdown(el, value, hit.field.any, pickerFor(hit.field)))) { report.unknown++; continue; }
        highlight(el);
      } else if (kind === 'custom') {
        const picked = pickedText(el);
        // 期望城市是多选时，把第二、第三意向也选上
        const more = hit.entry === profile.intent && hit.field.key === 'city' ? [profile.intent.city2, profile.intent.city3].filter(Boolean) : [];
        // 多选框里已经选了一部分（比如网站只存了一个城市）：把资料里还没选上的补上，已选的不动
        const wrap = el.closest('[class*="select"]');
        const multi = !!wrap && (/multi/.test(String(wrap.className)) || !!wrap.querySelector('[class*="tags"],[class*="multiple"]'));
        const lacks = multi && more.length > 0 && [value, ...more].some((v) => !termsFor(v).some((t) => norm(picked).includes(t)));
        if (!over && !lacks && ((el.value || '').trim() || picked)) { report.kept++; continue; }
        // 省市一级一级点的选择器：把这一段的 国家 / 省 / 市 连起来当路径
        let path = value;
        if (el.closest('[class*="cascader"]') && hit.entry && LOC.includes(hit.field.generic) && !/[\/／>]/.test(value)) {
          path = [...new Set([...LOC.map((g) => hit.entry[g]), hit.entry.district].filter(Boolean))].join('/') || value;
        }
        if (!(await fillCustomSelect(el, path, hit.field.any, pickerFor(hit.field), more))) { report.unknown++; continue; }
        highlight(el);
      } else if (kind === 'picker') {
        if (!over && el.value.trim()) { report.kept++; continue; }
        if (!(await fillPicker(el, value))) { report.unknown++; continue; }
        highlight(el);
      } else {
        if (!over && el.value.trim()) { report.kept++; continue; }
        const isDate = hit.field.type === 'date' || hit.field.type === 'month' || leadIsDate;
        let out = isDate ? formatDate(value, el) : value;
        if (!opts.overwrite && el.value.trim() === out.trim()) { report.kept++; continue; }
        if (hit.field.percent && /^\d+(\.\d+)?%?$/.test(out)) out = `前${out.replace('%', '')}%`; // 文本框里写成「前20%」
        if ((el.type === 'date' || el.type === 'month') && !/^\d{4}-\d{2}(-\d{2})?$/.test(out)) { report.unknown++; continue; }
        if (el.type === 'number' && isNaN(Number(out))) { report.unknown++; continue; }
        setNative(el, out);
        if (isDate && inDatePicker(el)) pressKey(el, 'Enter');
        highlight(el);
      }
      report.filled.push(hit.label);
      if (hit.block && hit.field.anchor) rewrote.add(hit.block);
    }
    return scan;
    }

    // 填一遍；哪一段经历页面上不够用，就点那一段的「添加」再填，直到够用或点了没反应
    const addFailed = (globalThis.__raAddFailed ??= new Set());
    const count = (id) => (state.seen[id] ? state.idx[id] + 1 : 0);
    let last = null; // 上一次点的是哪一段、点之前有几段
    for (; passNo < 12; passNo++) {
      await pass();
      if (last && count(last.id) <= last.used) addFailed.add(last.id); // 点了但没多出能认的一段
      last = null;
      for (const id of opts.dry ? [] : Object.keys(ADD_SECTIONS)) {
        const hasDefaults = sectionById[id].fields.some((x) => x.fallback);
        const have = (profile[id] || []).filter((o) => o && (hasDefaults || Object.values(o).some(Boolean))).length;
        if (have <= count(id) || addFailed.has(id)) continue;
        const before = collect(document).filter(visible).length;
        const grew = () => collect(document).filter(visible).length > before;
        // 一个个试：有的按钮点了没反应（只是外框），换下一个
        for (const btn of findAddButtons(id)) {
          if (!btn.isConnected || !visible(btn)) continue;
          btn.scrollIntoView({ block: 'center' });
          press(btn);
          // 新的一段可能要过一会儿才渲染出来
          for (let waited = 0; waited < 2000 && !grew(); waited += 200) await sleep(200);
          if (grew()) break;
        }
        await sleep(300);
        if (!grew()) {
          addFailed.add(id);
          continue;
        }
        last = { id, used: count(id) };
        break;
      }
      if (!last || opts.dry) break;
    }
    // 最后扫一遍：还空着的控件标黄框。只在确实是份申请表的页面上做（填上过几项），免得把普通网页的输入框也标了
    globalThis.__raFilled = (globalThis.__raFilled || 0) + report.filled.length;
    if (!opts.dry && globalThis.__raFilled >= 3) report.missing = markMissing();

    // 可选：填完后点页面上的「保存」（只认按钮文字正好是「保存」的，不碰提交 / 投递）
    if (opts.save && report.filled.length) {
      for (const b of document.querySelectorAll('button,[role="button"]')) {
        if (b.disabled || !visible(b) || !/^保 ?存$/.test(norm(b.textContent))) continue;
        b.click();
        report.saved = (report.saved || 0) + 1;
        await sleep(1000);
      }
    }
    if (!opts.dry) report.state = snapshot();
    // 填上了教育经历和工作经历：这是份网申简历。问用户要不要记到投递记录，并留意用户自己点「投递 / 提交」
    const secs = (globalThis.__raSections ??= new Set());
    for (const l of report.filled) secs.add(l.split(' · ')[0].replace(/ #\d+$/, ''));
    const isApplication = (secs.has('教育经历') || secs.has('最高学历')) && secs.has('工作 / 实习经历');
    if (!opts.dry && isApplication && window === window.top) {
      watchSubmit();
      askToRecord();
    }
    return report;
  }

  // —— 页面右下角的小卡片（closed shadow root：不受页面样式影响，填表时也扫不到它）——
  function card() {
    if (globalThis.__raCard) return globalThis.__raCard;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      .c{width:300px;padding:16px;background:#fff;color:#17191c;border:1px solid #e3e5e1;border-radius:14px;box-shadow:0 16px 40px -12px rgba(0,0,0,.35);font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;animation:in .3s cubic-bezier(.16,1,.3,1)}
      @keyframes in{from{opacity:0;transform:translateY(10px)}}
      .t{display:flex;gap:8px;align-items:center;font-weight:650;font-size:15px}
      .t i{display:grid;place-items:center;width:22px;height:22px;border-radius:6px;background:#12a56f;color:#fff;font-style:normal;font-size:13px}
      p{margin:6px 0 10px;color:#5d636d;font-size:13px}
      label{display:block;margin-top:8px;color:#5d636d;font-size:12px}
      input{box-sizing:border-box;width:100%;margin-top:3px;padding:7px 10px;border:1px solid #c9ccc6;border-radius:8px;font:inherit;color:inherit;background:#fff}
      .b{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
      button{min-height:34px;padding:0 14px;border:1px solid #c9ccc6;border-radius:8px;background:#fff;font:inherit;font-weight:500;cursor:pointer}
      button.p{background:#12a56f;border-color:#12a56f;color:#fff;font-weight:600}
      .x{position:absolute;top:10px;right:10px;min-height:0;width:26px;height:26px;padding:0;border:0;color:#5d636d;font-size:18px}
      .w{position:relative}
    </style><div class="w"><div class="c" part="c"></div></div>`;
    document.documentElement.append(host);
    const box = root.querySelector('.c');
    globalThis.__raCard = { host, box, root, close: () => { host.remove(); globalThis.__raCard = null; } };
    return globalThis.__raCard;
  }
  const send = (msg) => { try { return chrome.runtime.sendMessage(msg); } catch { return Promise.resolve(null); } };
  async function askToRecord() {
    if (globalThis.__raAsked) return;
    globalThis.__raAsked = true;
    const info = pageInfo();
    const check = (await send({ type: 'page-check', url: location.href })) || {};
    if (check.recorded) return;
    if (check.job) Object.assign(info, { company: check.job.company || info.company, position: check.job.title || info.position, city: check.job.city || info.city, channel: '岗位库', jobUrl: check.job.url });
    const c = card();
    c.box.innerHTML = `<button class="x" title="关闭" aria-label="关闭">×</button>
      <div class="t"><i>✓</i>记到投递记录？</div>
      <p>这一页像是网申简历。记下来，之后在「投递记录」里跟进进度。</p>
      <label>公司<input name="company"></label><label>职位<input name="position"></label>
      <div class="b"><button class="n">不用</button><button class="p">保存</button></div>`;
    c.box.querySelector('[name=company]').value = info.company || '';
    c.box.querySelector('[name=position]').value = info.position || '';
    c.box.querySelector('.x').onclick = c.box.querySelector('.n').onclick = () => c.close();
    c.box.querySelector('.p').onclick = async () => {
      info.company = c.box.querySelector('[name=company]').value.trim();
      info.position = c.box.querySelector('[name=position]').value.trim();
      globalThis.__raInfo = info;
      await send({ type: 'record', info });
      done('已保存到投递记录', '可以在侧边栏「资料」→「投递记录」里查看和改状态。');
    };
    globalThis.__raInfo = info;
  }
  function done(title, text) {
    const c = card();
    c.box.innerHTML = `<button class="x" title="关闭" aria-label="关闭">×</button><div class="t"><i>✓</i></div><p></p>`;
    c.box.querySelector('.t').append(title);
    c.box.querySelector('p').textContent = text;
    c.box.querySelector('.x').onclick = () => c.close();
    clearTimeout(globalThis.__raCardTimer);
    globalThis.__raCardTimer = setTimeout(() => c.close(), 6000);
  }

  // —— 投递记录：这个页面是哪家公司、哪个职位、在哪个城市（猜不到就空着，用户在表里改）——
  const COMPANIES = [
    [/(^|\.)(qq|tencent)\.com$/, '腾讯'], [/mioffice|xiaomi/, '小米'], [/bytedance|toutiao|douyin/, '字节跳动'],
    [/kuaishou/, '快手'], [/alibaba|taobao|aliyun|alibabagroup/, '阿里巴巴'], [/antgroup|antfin/, '蚂蚁集团'],
    [/meituan/, '美团'], [/(^|\.)jd\.com$|jdcloud/, '京东'], [/baidu/, '百度'], [/netease|163\.com/, '网易'],
    [/pinduoduo|pddglobalhr|temu/, '拼多多'], [/didi/, '滴滴'], [/huawei/, '华为'], [/bilibili/, '哔哩哔哩'],
    [/xiaohongshu/, '小红书'], [/mihoyo/, '米哈游'], [/(^|\.)dji\.com$/, '大疆'], [/oppo/, 'OPPO'], [/vivo/, 'vivo'],
    [/iflytek/, '科大讯飞'], [/nio\.com|nio\.cn/, '蔚来'], [/xiaopeng|xpeng/, '小鹏汽车'], [/lixiang|lixiangauto/, '理想汽车'],
    [/horizon/, '地平线'], [/dewu|poizon/, '得物'], [/shopee/, 'Shopee'], [/ctrip|trip\.com/, '携程'],
  ];
  const CHANNELS = [
    [/nowcoder/, '牛客'], [/zhipin/, 'BOSS 直聘'], [/liepin/, '猎聘'], [/zhaopin\.com/, '智联招聘'], [/51job/, '前程无忧'],
    [/shixiseng/, '实习僧'], [/linkedin/, 'LinkedIn'], [/yingjiesheng/, '应届生求职网'],
  ];
  function pageInfo() {
    const host = location.hostname;
    const text = (document.body.innerText || '').slice(0, 20000);
    const clean = (t) => norm(t).replace(/(校园|社会)?招聘(官网)?|加入我们|官网|careers?|jobs?|网申|投递简历/gi, '').replace(/^[\s|_·—–-]+|[\s|_·—–-]+$/g, '');
    let company = (COMPANIES.find(([re]) => re.test(host)) || [])[1] || '';
    if (!company) {
      const site = document.querySelector('meta[property="og:site_name"]');
      const parts = document.title.split(/\s*[|_·—–-]\s*/).map(clean).filter((x) => x && x.length <= 20);
      company = (site && clean(site.content)) || parts[parts.length - 1] || '';
    }
    let position = '';
    const m = text.match(/(?:申请|应聘|投递|意向|当前)?(?:职位|岗位)(?:名称)?\s*[:：]\s*([^\n]{2,40})/);
    if (m) position = m[1].trim();
    if (!position) {
      for (const h of document.querySelectorAll('h1,h2,[class*="job-title"],[class*="jobTitle"],[class*="position-name"],[class*="positionName"]')) {
        const t = norm(h.textContent);
        if (t && t.length <= 40 && /工程师|分析|经理|运营|产品|设计|实习|研究|开发|算法|专员|顾问|管培|生|师|岗|engineer|analyst|manager|intern/i.test(t)) { position = t; break; }
      }
    }
    const c = text.match(/(?:工作地点|工作城市|工作地|base ?地)\s*[:：]?\s*([\u4e00-\u9fa5]{2,8})/i);
    return {
      url: location.href,
      company,
      position,
      city: c ? c[1] : '',
      channel: (CHANNELS.find(([re]) => re.test(host)) || [])[1] || '官网',
    };
  }
  // 用户自己点了「投递 / 提交」：告诉后台把这一条改成「已投递」。扩展自己从不点这些按钮
  function watchSubmit() {
    if (globalThis.__raWatchSubmit) return;
    globalThis.__raWatchSubmit = true;
    const SUBMIT = /^(确认)?(提交|投递)(简历|申请)?$|^立即(投递|申请)$|^投递简历$|^申请(该|此)?职位$|^submit( application)?$|^apply( now)?$/i;
    document.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      const b = e.target.closest && e.target.closest('button,[role="button"],a,input[type="submit"]');
      if (!b) return;
      const t = norm(b.value || b.textContent);
      if (t.length > 12 || !SUBMIT.test(t)) return;
      const info = { ...(globalThis.__raInfo || pageInfo()), url: location.href };
      send({ type: 'record', info });
      done('🎉 恭喜你完成了一份简历投递', `已保存到投递记录${info.company ? '：' + info.company + (info.position ? ' · ' + info.position : '') : ''}。`);
    }, true);
  }
})();
