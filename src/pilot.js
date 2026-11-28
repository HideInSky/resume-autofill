// Autopilot 在招聘网站页面里的「眼睛和手」：看这一页是什么（岗位详情 / 登录 / 验证码 / 人机验证 / 申请表 / 投递成功），
// 再按 Autopilot 页面的指令点按钮、填登录框。申请表本身还是用 filler.js 填。
// 人机验证（滑块、点字、图形验证码）一律不碰，交给用户自己做。
(() => {
  if (globalThis.__raPilot) return;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && +st.opacity !== 0;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const APPLY = /^(立即|马上|一键)?(投递|申请|应聘)(简历|职位|该职位|此职位|岗位|该岗位)?$|^我要(投递|申请|应聘)$|^投个简历$|^apply( now| for this job)?$/i;
  const SUBMIT = /^(确认|立即|最终)?(提交|投递)(申请|简历|申请表)?$|^确认(投递|提交|申请)$|^提交并投递$|^submit( application)?$/i;
  const NEXT = /^(下一步|保存并继续|保存并下一步|保存，?下一步|继续填写|next|continue)$/i;
  const LOGIN = /^(登 ?录|立即登录|马上登录|登录\s*\/\s*注册|注册\s*\/\s*登录|注册并登录|login|log in|sign in)$/i;
  const REGISTER = /^(注 ?册|立即注册|免费注册|注册账号|注册新账号|创建账号|没有账号[，,]?\s*(去|立即)?注册|sign up|register)$/i;
  const REG_SUBMIT = /^(注 ?册|立即注册|完成注册|注册并登录|确认注册)$/;
  const SEND = /(获取|发送)(短信|手机)?(验证码|动态码)|^获取$|^发送$/;
  const SENT = /\d+\s*(s|秒)|重新(获取|发送)|已发送/i;
  const DONE = /投递成功|申请成功|提交成功|简历已投递|您已投递|已成功投递|成功投递|感谢(您的)?(投递|申请|关注)|已申请该职位|您已申请过|已经投递过|重复投递/;
  const ALREADY = /^(已投递|已申请|已应聘)$/;
  const AGREE = /同意|已阅读|已知悉|知晓|授权|接受.{0,8}(协议|声明|条款)|privacy|agree/i;
  const CAPTCHA_TEXT = /拖动(下方)?滑块|向右(拖动|滑动)|请完成(安全)?验证|请依次点击|按顺序点击|人机验证|安全验证|请完成下方验证|拼图/;
  const CAPTCHA_SEL = [
    'iframe[src*="captcha" i]', 'iframe[src*="geetest" i]', 'iframe[src*="turing" i]', '[id^="tcaptcha" i]',
    '[class*="geetest" i]', '[class*="captcha" i]', '[id*="captcha" i]', '[id*="nc_" i][id*="wrapper" i]', '.nc-container',
    '[class*="slide-verify" i]', '[class*="slider-verify" i]', '[class*="verify-wrap" i]', '[class*="yidun" i]',
  ].join(',');

  const clickables = () =>
    [...document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"], [class*="btn" i], [class*="button" i]')].filter(visible);
  const textOf = (el) => norm(el.value && el.tagName === 'INPUT' ? el.value : el.innerText || el.textContent || el.getAttribute('aria-label') || '');
  const disabled = (el) => el.disabled || el.getAttribute('aria-disabled') === 'true' || /disabled/i.test(el.className || '');
  // 同一个按钮常常是外层 div 套着 span：只留最里面那个文字匹配的
  function find(re, { allowDisabled = false } = {}) {
    const hits = clickables().filter((el) => {
      const t = textOf(el);
      return t && t.length <= 30 && re.test(t) && (allowDisabled || !disabled(el));
    });
    return hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)));
  }
  function press(el) {
    el.scrollIntoView({ block: 'center' });
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    el.click();
  }
  function setVal(el, v) {
    el.focus();
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }
  // 输入框旁边的文字：placeholder、aria-label、label、同一行的标题
  function labelOf(el) {
    const parts = [el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.name, el.id];
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) parts.push(l.textContent);
    }
    const wrap = el.closest('label, [class*="form-item" i], [class*="formitem" i], [class*="field" i], [class*="item" i], tr, li');
    if (wrap) {
      const lab = wrap.querySelector('label, [class*="label" i], th, dt');
      if (lab && !lab.contains(el)) parts.push(lab.textContent);
    }
    return norm(parts.filter(Boolean).join(' ')).slice(0, 120);
  }
  const inputs = () => [...document.querySelectorAll('input, textarea, select')].filter((el) => visible(el) && !['hidden', 'submit', 'button', 'image', 'reset'].includes(el.type));
  const isCode = (el) => /验证码|动态码|校验码|code|otp/i.test(labelOf(el)) && !/图形|图片|captcha|img/i.test(labelOf(el));
  const isImgCode = (el) => /图形|图片|captcha|img/i.test(labelOf(el)) && /验证码|code/i.test(labelOf(el));
  const isPhone = (el) => el.type === 'tel' || /手机|电话|phone|mobile/i.test(labelOf(el));
  const isAccount = (el) => !isCode(el) && !isPhone(el) && el.type !== 'password' && el.tagName === 'INPUT' && /账号|帐号|用户名|邮箱|手机号|email|user|account|login/i.test(labelOf(el));

  function captcha() {
    for (const el of document.querySelectorAll(CAPTCHA_SEL)) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height > 4000) return true;
    }
    if (inputs().some(isImgCode)) return true;
    // 只看弹层里的文字，免得正文里提到「验证」就误判
    for (const el of document.querySelectorAll('[class*="modal" i], [class*="dialog" i], [class*="popup" i], [class*="mask" i], [role="dialog"]')) {
      if (visible(el) && CAPTCHA_TEXT.test(norm(el.innerText).slice(0, 400))) return true;
    }
    return false;
  }

  function errors() {
    const out = [];
    for (const el of document.querySelectorAll('[class*="error" i], [class*="err-msg" i], [class*="explain" i], [role="alert"], [class*="message" i] [class*="notice" i], [class*="toast" i]')) {
      if (!visible(el)) continue;
      const t = norm(el.innerText);
      if (t && t.length < 80 && !out.includes(t)) out.push(t);
      if (out.length >= 5) break;
    }
    return out;
  }

  // 还空着的必填项（填表之后用来问 AI）
  let lastMissing = [];
  function missing() {
    const out = [];
    for (const el of inputs()) {
      if (el.type === 'password' || el.type === 'file' || el.type === 'checkbox' || el.type === 'radio' || el.readOnly) continue;
      if (el.value && el.value.trim()) continue;
      const wrap = el.closest('[class*="form-item" i], [class*="field" i], [class*="item" i], label, tr, li') || el.parentElement;
      const star = wrap && /[*＊]/.test(norm((wrap.querySelector('label, [class*="label" i]') || {}).textContent || ''));
      const req = el.required || el.getAttribute('aria-required') === 'true' || star || el.dataset.raMiss != null;
      if (!req) continue;
      const item = { label: labelOf(el), type: el.tagName === 'TEXTAREA' ? 'textarea' : el.tagName === 'SELECT' ? 'select' : 'text' };
      if (el.tagName === 'SELECT') item.options = [...el.options].map((o) => norm(o.textContent)).filter(Boolean).slice(0, 40);
      if (!item.label) continue;
      out.push({ el, item });
    }
    lastMissing = out;
    return out.map((m, i) => ({ i, ...m.item }));
  }

  function scan() {
    const body = norm(document.body ? document.body.innerText : '').slice(0, 20000);
    const all = inputs();
    const pw = all.filter((el) => el.type === 'password');
    const code = all.filter(isCode);
    const send = find(SEND, { allowDisabled: true });
    const fields = all.filter((el) => el.type !== 'password' && !isCode(el) && el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'search');
    const loginish = pw.length || (code.length && send.length);
    const s = {
      url: location.href,
      title: document.title,
      done: DONE.test(body) || find(ALREADY, { allowDisabled: true }).length > 0,
      captcha: captcha(),
      login: null,
      fields: fields.length,
      apply: find(APPLY).length > 0,
      submit: find(SUBMIT).length > 0,
      next: find(NEXT).length > 0,
      errors: errors(),
    };
    // 登录 / 注册框：字段少（真正的申请表一般有很多项）
    if (loginish && fields.length < 8) {
      s.login = {
        kind: code.length && send.length ? 'sms' : 'password',
        register: pw.length >= 2, // 两个密码框（密码 + 确认密码）= 注册表
        codeSent: send.some((b) => SENT.test(textOf(b)) || disabled(b)),
        canRegister: find(REGISTER).length > 0,
      };
    }
    return s;
  }

  function fillLogin({ account = '', phone = '', password = '' }) {
    let n = 0;
    for (const el of inputs()) {
      if (el.type === 'password' && password) (setVal(el, password), n++);
      else if (isPhone(el) && !isCode(el) && phone) (setVal(el, phone), n++);
      else if (isAccount(el) && (account || phone)) (setVal(el, /手机/.test(labelOf(el)) && phone ? phone : account || phone), n++);
    }
    return n;
  }
  function agree() {
    let n = 0;
    for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
      if (cb.checked) continue;
      const box = cb.closest('label, [class*="agree" i], [class*="protocol" i], [class*="checkbox" i], div, p') || cb.parentElement;
      if (!box || !AGREE.test(norm(box.innerText).slice(0, 200))) continue;
      const target = cb.closest('label') || (visible(cb) ? cb : box.querySelector('[class*="checkbox" i]') || cb);
      press(target);
      if (!cb.checked) cb.click();
      n++;
    }
    return n;
  }
  const clickFirst = (re) => {
    const b = find(re)[0];
    if (!b) return null;
    // 新窗口打开的链接：交给 Autopilot 在同一个标签页里打开，免得跑丢
    const a = b.closest('a[href]');
    if (a && a.target === '_blank' && /^https?:/.test(a.href)) return { href: a.href };
    press(b);
    return { clicked: textOf(b) };
  };

  globalThis.__raPilot = {
    scan,
    missing,
    answer(list) {
      let n = 0;
      for (const { i, value } of list || []) {
        const m = lastMissing[i];
        if (!m || value == null || value === '') continue;
        const el = m.el;
        if (el.tagName === 'SELECT') {
          const opt = [...el.options].find((o) => norm(o.textContent) === norm(value)) || [...el.options].find((o) => norm(o.textContent).includes(norm(value)));
          if (!opt) continue;
          setVal(el, opt.value);
        } else setVal(el, String(value).slice(0, 2000));
        n++;
      }
      return n;
    },
    fillLogin,
    agree,
    sendCode: () => clickFirst(SEND),
    async enterCode(code) {
      const el = inputs().find(isCode);
      if (!el) return false;
      setVal(el, code);
      await sleep(300);
      agree();
      return clickFirst(REG_SUBMIT) || clickFirst(LOGIN) || clickFirst(/^(确定|确认|提交|下一步|验证)$/) || true;
    },
    login: () => clickFirst(LOGIN),
    register: () => clickFirst(REG_SUBMIT),
    goRegister: () => clickFirst(REGISTER),
    apply: () => clickFirst(APPLY),
    next: () => clickFirst(NEXT),
    submit: () => clickFirst(SUBMIT),
  };
})();
