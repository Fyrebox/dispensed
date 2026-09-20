(function () {
  const thread = document.getElementById('thread');
  const form = document.getElementById('form');
  const input = document.getElementById('input');
  const send = document.getElementById('send');
  const seg = document.querySelector('.seg');
  let conversationId = null;
  let override = '';
  try { override = localStorage.getItem('jur') || ''; } catch (e) {}
  seg.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', b.dataset.jur === override);
    b.addEventListener('click', () => {
      override = b.dataset.jur;
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      try { localStorage.setItem('jur', override); } catch (e) {}
    });
  });

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function render(reply) {
    const cites = reply.citations || [];
    const index = {};
    cites.forEach((c, i) => (index[c.chunk_id] = i + 1));
    let html = esc(reply.text).replace(/\[(kb_[A-Za-z0-9_-]+)\]/g, (m, id) =>
      index[id] ? `<sup><a href="${esc(cites[index[id] - 1].source_url)}" target="_blank" rel="noopener" title="${esc(cites[index[id] - 1].heading)}">${index[id]}</a></sup>` : '',
    );
    const tag =
      reply.decision === 'ANSWERED'
        ? '<span class="tag auto">Answered from published pages</span>'
        : reply.decision === 'PARTIAL'
          ? '<span class="tag draft">Partly covered by published pages</span>'
          : '<span class="tag esc">Not covered by published pages</span>';
    const sources = cites.length
      ? `<div class="sources">Sources: ${cites.map((c, i) => `<a href="${esc(c.source_url)}" target="_blank" rel="noopener">[${i + 1}] ${esc(c.heading)}</a>`).join(' · ')}</div>`
      : '';
    return `<div class="bubble">${html}${sources}${tag}</div>`;
  }

  function add(role, inner) {
    const d = document.createElement('div');
    d.className = `msg ${role}`;
    d.innerHTML = inner;
    thread.appendChild(d);
    thread.scrollTop = thread.scrollHeight;
    return d;
  }

  async function submit(text) {
    text = text.trim();
    if (!text) return;
    add('patient', `<div class="bubble">${esc(text)}</div>`);
    input.value = '';
    send.disabled = true;
    const pending = add('agent thinking', '<div class="bubble">Checking…</div>');
    if (window.posthog) posthog.capture('chat_sent', { override: override || 'auto' });
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, conversation_id: conversationId, jurisdiction: override || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      conversationId = data.conversation_id;
      pending.className = 'msg agent';
      pending.innerHTML = render(data);
      if (window.posthog) posthog.capture('decision_shown', { decision: data.decision, jurisdiction: data.jurisdiction });
    } catch (e) {
      pending.className = 'msg agent';
      pending.innerHTML = `<div class="bubble">Something went wrong (${esc(e.message)}). Please try again.</div>`;
    } finally {
      send.disabled = false;
      input.focus();
    }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); submit(input.value); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => submit(c.dataset.q)));
})();
