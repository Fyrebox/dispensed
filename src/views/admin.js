import { layout, esc } from './layout.js';

const badge = (v) => `<span class="badge b-${esc(v)}">${esc(String(v ?? '').replace(/_/g, ' '))}</span>`;
const when = (d) => (d ? new Date(d).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const scoreClass = (s) => (s >= 0.45 ? '' : s >= 0.30 ? 'mid' : 'low');

export function listPage({ conversations, filters, posthog }) {
  const opt = (name, values, cur) =>
    `<select name="${name}" onchange="this.form.submit()"><option value="">${name}: all</option>${values
      .map((v) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${v.replace(/_/g, ' ')}</option>`)
      .join('')}</select>`;
  const rows = conversations
    .map(
      (c) => `<tr>
  <td class="mono">${when(c.started_at)}</td>
  <td><a href="/admin/conversations/${c._id}">${esc(c.first_line)}</a></td>
  <td>${badge(c.decision)}</td>
  <td>${badge(c.status)}</td>
  <td>${esc(c.jurisdiction)} <span class="muted">(${esc(c.jurisdiction_source || '')})</span></td>
</tr>`,
    )
    .join('');
  const body = `
<h1>Conversations</h1>
<form class="toolbar" method="get">
  ${opt('status', ['open', 'resolved'], filters.status)}
  ${opt('decision', ['ANSWERED', 'PARTIAL', 'NOT_COVERED'], filters.decision)}
  ${opt('jurisdiction', ['AU', 'UK', 'NZ', 'UNKNOWN'], filters.jurisdiction)}
  <span class="muted">${conversations.length} shown</span>
  <span style="flex:1"></span>
  <form method="post" action="/admin/reset" class="inline-form" onsubmit="return confirm('Wipe all conversations and re-seed the demo?')"><button class="btn btn-ghost btn-sm">Reset demo</button></form>
</form>
<table>
<thead><tr><th>Time</th><th>Patient message</th><th>Decision</th><th>Status</th><th>Jurisdiction</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5" class="muted">No conversations yet.</td></tr>'}</tbody>
</table>`;
  return layout({ title: 'Conversations', body, admin: true, posthog });
}

export function detailPage({ conversation: c, messages, posthog, flash }) {
  const transcript = messages
    .map((m) => {
      const who = m.role === 'patient' ? 'Patient' : m.role === 'human' ? `Human (${esc(m.sent_by || 'admin')})` : 'Agent';
      return `<div class="msg ${m.role}"><div class="bubble"><div class="muted" style="font-size:11px;margin-bottom:4px">${who} · ${when(m.created_at)}</div>${esc(m.text)}</div></div>`;
    })
    .join('');
  const agents = messages.filter((m) => m.role === 'agent');
  const last = agents[agents.length - 1];
  const decisionPanels = agents
    .map(
      (m, i) => `<div class="panel">
  <h3>Reply ${agents.length > 1 ? i + 1 : ''} ${badge(m.decision)}</h3>
  <dl class="kv">
    <dt>Reason</dt><dd>${esc(m.decision_reason)}</dd>
    <dt>Jurisdiction</dt><dd>${esc(m.jurisdiction)} <span class="muted">via ${esc(m.jurisdiction_source)}</span></dd>
    <dt>Top score</dt><dd>${m.top_score == null ? '<span class="muted">nothing retrieved</span>' : `<span class="score ${scoreClass(m.top_score)}">${m.top_score.toFixed(3)}</span>`}</dd>
    <dt>Composer</dt><dd>${m.composed ? `confidence ${m.composed.confidence?.toFixed(2)} · ${m.composed.fully_answered ? 'fully answered' : `partial: ${esc(m.composed.unanswered_part || '')}`}` : '<span class="muted">not run</span>'}</dd>
    <dt>Cost</dt><dd class="mono">${m.latency_ms} ms · ${m.tokens_in}+${m.tokens_out} tok · $${(m.cost_usd || 0).toFixed(4)} · ${esc(m.model || '')}</dd>
  </dl>
  ${m.retrieved_chunks?.length ? `<h3 style="margin-top:14px">Retrieved chunks</h3>${m.retrieved_chunks
    .map((ch, j) => {
      const s = m.retrieved?.[j]?.score ?? 0;
      const cited = m.composed?.cited_chunk_ids?.includes(ch.id);
      return `<div class="chunk"><span class="score ${scoreClass(s)}">${s.toFixed(3)}</span> <span class="mono">${esc(ch.id)}</span> ${cited ? '<span class="badge b-ANSWERED">cited</span>' : ''} [${esc(ch.jurisdiction)}] <a href="${esc(ch.source_url)}" target="_blank" rel="noopener">${esc(ch.heading)}</a><pre>${esc(ch.text)}</pre></div>`;
    })
    .join('')}` : ''}
</div>`,
    )
    .join('');

  const resolveForm =
    c.status === 'resolved'
      ? `<div class="panel"><h3>Resolved</h3><dl class="kv"><dt>Outcome</dt><dd>${esc(c.outcome_note || '')}</dd><dt>By</dt><dd>${esc(c.resolved_by)} · ${when(c.resolved_at)}</dd></dl>
  ${c.promoted_chunk_id
    ? `<p class="badge b-promoted">Promoted to knowledge base as ${esc(c.promoted_chunk_id)}</p>`
    : `<h3 style="margin-top:14px">Promote to knowledge base</h3>
  <form method="post" action="/admin/conversations/${c._id}/promote">
    <input class="wide" name="heading" placeholder="Heading, e.g. 'Refund when parcel arrives damaged'" required value="${esc(c.first_line)}">
    <p><textarea class="wide" name="text" rows="5" required>${esc(c.outcome_note || '')}</textarea></p>
    <p><select name="jurisdiction">${['', 'AU', 'UK', 'NZ', 'ALL'].map((j) => `<option value="${j}" ${(j || c.jurisdiction) === c.jurisdiction ? 'selected' : ''}>${j || `use conversation (${esc(c.jurisdiction)})`}</option>`).join('')}</select>
    <button class="btn btn-green btn-sm">Promote</button> <span class="muted">Writes a new chunk with origin "promoted", embedded and retrievable immediately.</span></p>
  </form>`}
</div>`
      : `<div class="panel"><h3>Resolve</h3>
  <form method="post" action="/admin/conversations/${c._id}/resolve">
    <textarea class="wide" name="note" rows="4" placeholder="What did the human answer? Write it here — it can be promoted to the knowledge base afterwards so the next patient gets it automatically." required></textarea>
    <p><button class="btn btn-sm">Resolve with outcome</button></p>
  </form>
</div>`;

  const body = `
<p><a href="/admin">← Conversations</a></p>
${flash ? `<div class="notice">${esc(flash)}</div>` : ''}
<h1>${esc(c.first_line)}</h1>
<p class="muted">${when(c.started_at)} · ${badge(c.status)} ${badge(c.decision)} · ${esc(c.jurisdiction)}</p>
<div class="grid">
  <div>
    <div class="panel"><h3>Transcript</h3><div class="thread" style="max-height:none">${transcript}</div></div>
    ${resolveForm}
  </div>
  <div>${decisionPanels}</div>
</div>`;
  return layout({ title: 'Conversation', body, admin: true, posthog });
}

export function metricsPage({ m, posthog }) {
  const jurs = m.byJur
    .map((c) => `<div><div style="display:flex;justify-content:space-between;font-size:13px"><span>${esc(c.jurisdiction)}</span><span class="mono">${c.n}</span></div><div class="bar"><span style="width:${m.pct(c.n)}%"></span></div></div>`)
    .join('');
  const gaps = m.gaps
    .map((c) => `<tr><td><a href="/admin/conversations/${c._id}">${esc(c.first_line)}</a></td><td>${badge(c.decision)}</td><td>${esc(c.jurisdiction)}</td></tr>`)
    .join('');
  const body = `
<h1>Metrics</h1>
<div class="stats">
  <div class="stat big"><div class="n">${m.pct(m.answered)}<span style="font-size:40px">%</span></div><div class="l">of messages fully answered from published pages, with citations</div></div>
  <div class="stat"><div class="n">${m.total}</div><div class="l">messages processed</div></div>
  <div class="stat"><div class="n">${m.answered}</div><div class="l">answered · ${m.pct(m.answered)}%</div></div>
  <div class="stat"><div class="n">${m.partial}</div><div class="l">partly answered · ${m.pct(m.partial)}%</div></div>
  <div class="stat"><div class="n">${m.notCovered}</div><div class="l">not covered by published pages · ${m.pct(m.notCovered)}%</div></div>
  <div class="stat"><div class="n">${m.minutesSaved}</div><div class="l">estimated human minutes saved<br><span style="font-size:11.5px">Assumption: ${m.baseline} min average handling time per message (published live-chat benchmarks, applied uniformly). Full ${m.baseline} min per answered message, half per partial. Not the provider's real numbers.</span></div></div>
  <div class="stat"><div class="n">${m.medianLatency}<span style="font-size:18px"> ms</span></div><div class="l">median end-to-end latency</div></div>
  <div class="stat"><div class="n">$${m.medianCost.toFixed(4)}</div><div class="l">median model cost per message (list prices, assumption)</div></div>
  <div class="stat"><div class="n">${m.medianTopScore.toFixed(2)}</div><div class="l">median top retrieval score</div></div>
</div>
<div class="grid">
  <div class="panel"><h3>Gaps: recent questions the pages could not fully answer</h3><p class="muted" style="font-size:12.5px">Resolve one with the human answer and promote it, and the next patient gets it automatically.</p><table><thead><tr><th>Question</th><th>Decision</th><th>Jur.</th></tr></thead><tbody>${gaps || '<tr><td colspan="3" class="muted">none yet</td></tr>'}</tbody></table></div>
  <div class="panel"><h3>Messages by jurisdiction</h3><div style="display:grid;gap:10px">${jurs || '<span class="muted">none yet</span>'}</div></div>
</div>`;
  return layout({ title: 'Metrics', body, admin: true, posthog });
}

export function evalPage({ runs, posthog, flash }) {
  const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
  const latest = runs[0];
  const card = (r) => {
    const s = r.results;
    return `<div class="stats">
  <div class="stat big" style="padding:22px"><div class="n" style="font-size:64px">${pct(s.retrieval_hit_at_3)}</div><div class="l">retrieval hit@3: a chunk from the labelled source page is in the top 3</div></div>
  <div class="stat"><div class="n">${pct(s.retrieval_hit_at_5)}</div><div class="l">retrieval hit@5</div></div>
  <div class="stat"><div class="n">${pct(s.cited_correct_page)}</div><div class="l">answer cites the labelled page</div></div>
  <div class="stat"><div class="n">${pct(s.answered_rate)}</div><div class="l">fully answered</div></div>
  <div class="stat"><div class="n">${pct(s.partial_rate)}</div><div class="l">partly answered</div></div>
  <div class="stat"><div class="n">${pct(s.not_covered_rate)}</div><div class="l">not covered</div></div>
  <div class="stat"><div class="n">${s.median_latency_ms}<span style="font-size:18px"> ms</span></div><div class="l">median latency</div></div>
  <div class="stat"><div class="n">$${(s.median_cost_usd || 0).toFixed(4)}</div><div class="l">median cost per message</div></div>
</div>`;
  };
  const history = runs
    .map(
      (r) => `<tr><td class="mono">${when(r.run_at)}</td><td>${esc(r.notes || '')}</td><td class="mono">${pct(r.results.retrieval_hit_at_3)}</td><td class="mono">${pct(r.results.cited_correct_page)}</td><td class="mono">${pct(r.results.answered_rate)}</td><td class="mono">${r.results.n}</td></tr>`,
    )
    .join('');
  const body = `
<h1>Eval</h1>
${flash ? `<div class="notice">${esc(flash)}</div>` : ''}
<form method="post" action="/admin/eval/import" class="inline-form"><button class="btn btn-ghost btn-sm">Import committed runs</button></form>
${latest ? `<p class="muted">Latest run ${when(latest.run_at)} · dataset ${esc(latest.dataset_version)} · ${esc(latest.notes || '')}</p>${card(latest)}` : '<p class="muted">No eval runs yet. Run <code>npm run eval</code>.</p>'}
<div class="panel"><h3>Run history</h3><table><thead><tr><th>Run</th><th>Notes</th><th>hit@3</th><th>Cites page</th><th>Answered</th><th>n</th></tr></thead><tbody>${history || '<tr><td colspan="6" class="muted">none</td></tr>'}</tbody></table></div>`;
  return layout({ title: 'Eval', body, admin: true, posthog });
}

export function kbPage({ chunks, counts, posthog, flash }) {
  const rows = chunks
    .map(
      (c) => `<tr><td class="mono">${esc(c.id)}</td><td>${badge(c.origin)}</td><td>${esc(c.jurisdiction)}</td><td>${esc(c.topic)}</td><td><a href="${esc(c.source_url)}" target="_blank" rel="noopener">${esc(c.heading)}</a><div class="muted" style="font-size:12px">${esc(c.text.slice(0, 160))}…</div></td></tr>`,
    )
    .join('');
  const jurCounts = ['AU', 'UK', 'NZ', 'ALL'].map((j) => `${j} ${chunks.filter((c) => c.jurisdiction === j).length}`).join(' · ');
  const body = `<h1>Knowledge base</h1>
${flash ? `<div class="notice">${esc(flash)}</div>` : ''}
${counts.mongo !== counts.chroma ? `<div class="notice">Store mismatch: ${counts.mongo} chunks in MongoDB, ${counts.chroma} in Chroma. Reload the snapshot.</div>` : ''}
<p class="muted">${chunks.length} chunks · ${jurCounts} · ${chunks.filter((c) => c.origin === 'promoted').length} promoted from conversations · Chroma ${counts.chroma}
<form method="post" action="/admin/kb/load-snapshot" class="inline-form" onsubmit="return confirm('Re-embed and load all published chunks from data/kb_chunks.json?')"><button class="btn btn-ghost btn-sm">Load published snapshot</button></form></p>
<table><thead><tr><th>Id</th><th>Origin</th><th>Jur.</th><th>Topic</th><th>Heading</th></tr></thead><tbody>${rows}</tbody></table>`;
  return layout({ title: 'Knowledge base', body, admin: true, posthog });
}

export function loginPage({ next, error, posthog }) {
  const body = `
<section class="card" style="max-width:420px;margin:40px auto">
  <h2 style="margin-bottom:6px">Admin console</h2>
  <p class="muted" style="margin-top:0">Password only. No account needed.</p>
  ${error ? '<div class="notice" style="background:var(--pink);color:var(--pink-2)">That password didn\'t match.</div>' : ''}
  <form method="post" action="/admin/login">
    <input type="hidden" name="next" value="${esc(next || '/admin')}">
    <input class="wide" type="password" name="password" placeholder="Password" autofocus required autocomplete="current-password">
    <p style="margin-bottom:0"><button class="btn">Sign in</button></p>
  </form>
</section>`;
  return layout({ title: 'Sign in', body, admin: true, posthog, bare: true });
}
