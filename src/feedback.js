// 右下角「反馈」：用户自己写的话发到投简历神器的服务器；没配服务器时打开 GitHub 提 issue。
(() => {
  const $ = (id) => document.getElementById(id);
  const open = $('fb-open');
  if (!open) return;
  const box = $('fb');
  const endpoint = typeof AI_ENDPOINT === 'string' ? AI_ENDPOINT : '';
  const show = (on) => {
    box.hidden = !on;
    open.setAttribute('aria-expanded', String(on));
    if (on) $('fb-text').focus();
  };
  open.addEventListener('click', () => {
    if (!endpoint) return window.open('https://github.com/HideInSky/resume-autofill/issues/new', '_blank', 'noopener');
    show(box.hidden);
  });
  $('fb-cancel').addEventListener('click', () => show(false));
  box.addEventListener('keydown', (e) => e.key === 'Escape' && show(false));
  $('fb-send').addEventListener('click', async () => {
    const text = $('fb-text').value.trim();
    const note = $('fb-note');
    if (!text) return $('fb-text').focus();
    $('fb-send').disabled = true;
    note.textContent = '正在发送…';
    try {
      const res = await fetch(endpoint + '/v1/feedback', {
        method: 'POST',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ install: await Telemetry.id(), text, contact: $('fb-contact').value.trim(), page: document.body.dataset.view || '', v: chrome.runtime.getManifest().version }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.message || '没发出去');
      $('fb-text').value = '';
      note.textContent = '收到了，谢谢！';
      setTimeout(() => (show(false), (note.textContent = '')), 1400);
    } catch (e) {
      note.textContent = e.message === 'Failed to fetch' ? '没联网，过会儿再试' : e.message;
    } finally {
      $('fb-send').disabled = false;
    }
  });
})();
