import { layout, esc } from './layout.js';

const badge = (v) => `<span class="badge b-${esc(v)}">${esc(String(v ?? '').replace(/_/g, ' '))}</span>`;
const when = (d) => (d ? new Date(d).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const scoreClass = (s) => (s >= 0.55 ? '' : s >= 0.35 ? 'mid' : 'low');

export function listPage({ conversations, filters, posthog }) {
  const opt = (name, values, cur) =>
    `<select name="${name}" onchange="this.form.submit()"><option value="">${name}: all</option>${values
      .map((v) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${v.replace(/_/g, ' ')}</option>`)
      .join('')}</select>`;
  const rows = conversations
    .map(
      (c) => `<tr>
  <td class="mono">${when(c.started_at)}</td>
  <td><a href="/admin/conversations/${c._id}">${esc(c.first_line)}</a>${c.urgency === 'urgent' ? ' <span class="badge b-ADVERSE_EVENT">urgent</span>' : ''}</td>
  <td>${badge(c.risk_category)}</td>
  <td>${badge(c.decision)}</td>
  <td>${badge(c.status)}</td>
  <td>${esc(c.jurisdiction)} <span class="muted">(${esc(c.jurisdiction_source || '')})</span></td>
</tr>`,
    )
    .join('');
  const body = `
<h1>Conversations</h1>
<form class="toolbar" method="get">
  ${opt('status', ['open', 'auto_resolved', 'awaiting_human', 'resolved'], filters.status)}
  ${opt('decision', ['AUTO_ANSWER', 'DRAFT_FOR_APPROVAL', 'ESCALATE'], filters.decision)}
  ${opt('category', ['CLINICAL', 'ADVERSE_EVENT', 'REGULATORY', 'ACCOUNT_SPECIFIC', 'GENERAL_INFO', 'OUT_OF_SCOPE'], filters.category)}
  <span class="muted">${conversations.length} shown</span>
  <span style="flex:1"></span>
  <form method="post" action="/admin/reset" class="inline-form" onsubmit="return confirm('Wipe all conversations and re-seed the demo?')"><button class="btn btn-ghost btn-sm">Reset demo</button></form>
</form>
<table>
<thead><tr><th>Time</th><th>Patient message</th><th>Risk</th><th>Decision</th><th>Status</th><th>Jurisdiction</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6" class="muted">No conversations yet.</td></tr>'}</tbody>
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
  <h3>Decision ${agents.length > 1 ? i + 1 : ''} ${badge(m.decision)}</h3>
  <dl class="kv">
    <dt>Reason</dt><dd>${esc(m.decision_reason)}</dd>
    <dt>Risk category</dt><dd>${badge(m.risk?.category)} <span class="muted">${esc(m.risk?.reason || '')}</span></dd>
    <dt>Urgency</dt><dd>${esc(m.risk?.urgency)}</dd>
    <dt>Jurisdiction</dt><dd>${esc(m.jurisdiction)} <span class="muted">via ${esc(m.jurisdiction_source)} (classifier: ${esc(m.risk?.jurisdiction)}, ${esc(m.risk?.jurisdiction_evidence)})</span></dd>
    <dt>Top score</dt><dd>${m.top_score == null ? '<span class="muted">no retrieval (gate 1 stopped it)</span>' : `<span class="score ${scoreClass(m.top_score)}">${m.top_score.toFixed(3)}</span> <span class="muted">floor ${m.thresholds?.floor} · auto ${m.thresholds?.auto}</span>`}</dd>
    <dt>Composer</dt><dd>${m.composed ? `confidence ${m.composed.confidence?.toFixed(2)} · ${m.composed.fully_answered ? 'fully answered' : `partial: ${esc(m.composed.unanswered_part || '')}`}` : '<span class="muted">not run</span>'}</dd>
    <dt>Grounding</dt><dd>${m.grounding ? (m.grounding.grounded ? '<span class="badge b-AUTO_ANSWER">grounded</span>' : `<span class="badge b-ESCALATE">not grounded</span> ${esc(m.grounding.unsupported_claims.join('; '))}`) : '<span class="muted">not run</span>'}</dd>
    <dt>Cost</dt><dd class="mono">${m.latency_ms} ms · ${m.tokens_in}+${m.tokens_out} tok · $${(m.cost_usd || 0).toFixed(4)} · ${esc(m.model || '')}</dd>
  </dl>
  ${m.retrieved_chunks?.length ? `<h3 style="margin-top:14px">Retrieved chunks</h3>${m.retrieved_chunks
    .map((ch, j) => {
      const s = m.retrieved?.[j]?.score ?? 0;
      const cited = m.composed?.cited_chunk_ids?.includes(ch.id);
      return `<div class="chunk"><span class="score ${scoreClass(s)}">${s.toFixed(3)}</span> <span class="mono">${esc(ch.id)}</span> ${cited ? '<span class="badge b-AUTO_ANSWER">cited</span>' : ''} [${esc(ch.jurisdiction)}] <a href="${esc(ch.source_url)}" target="_blank" rel="noopener">${esc(ch.heading)}</a><pre>${esc(ch.text)}</pre></div>`;
    })
    .join('')}` : ''}
  ${m.draft ? `<h3 style="margin-top:14px">Draft for approval</h3>
  <form method="post" action="/admin/conversations/${c._id}/send">
    <textarea class="wide" name="text" rows="6">${esc(m.draft)}</textarea>
    <p><button class="btn btn-sm" ${c.status === 'resolved' ? 'disabled' : ''}>Send to patient</button> <span class="muted">Edits are sent as a human message and the conversation is resolved.</span></p>
  </form>` : ''}
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
    <textarea class="wide" name="note" rows="4" placeholder="What was the outcome? Write the answer the patient was given — it can be promoted to the knowledge base afterwards." required></textarea>
    <p><button class="btn btn-sm">Resolve with outcome</button></p>
  </form>
</div>`;

  const body = `
<p><a href="/admin">← Conversations</a></p>
${flash ? `<div class="notice">${esc(flash)}</div>` : ''}
<h1>${esc(c.first_line)}</h1>
<p class="muted">${when(c.started_at)} · ${badge(c.status)} ${badge(c.risk_category)} ${badge(c.decision)} · ${esc(c.jurisdiction)}${c.urgency === 'urgent' ? ' · <span class="badge b-ADVERSE_EVENT">urgent</span>' : ''}</p>
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
  const reasons = m.escalationReasons
    .map((r) => `<tr><td>${badge(r.category)}</td><td>${esc(r.reason)}</td><td class="mono">${r.n}</td></tr>`)
    .join('');
  const cats = m.byCategory
    .map((c) => `<div><div style="display:flex;justify-content:space-between;font-size:13px">${badge(c.category)}<span class="mono">${c.n}</span></div><div class="bar"><span style="width:${m.pct(c.n)}%"></span></div></div>`)
    .join('');
  const body = `
<h1>Metrics</h1>
<div class="stats">
  <div class="stat big"><div class="n">${m.clinicalAuto}</div><div class="l">clinical or adverse-event messages that received an automated answer</div></div>
  <div class="stat"><div class="n">${m.total}</div><div class="l">messages processed</div></div>
  <div class="stat"><div class="n">${m.auto}</div><div class="l">auto answered · ${m.pct(m.auto)}%</div></div>
  <div class="stat"><div class="n">${m.draft}</div><div class="l">drafted for approval · ${m.pct(m.draft)}%</div></div>
  <div class="stat"><div class="n">${m.esc}</div><div class="l">escalated · ${m.pct(m.esc)}%</div></div>
  <div class="stat"><div class="n">${m.minutesSaved}</div><div class="l">estimated human minutes saved<br><span style="font-size:11.5px">Assumption: ${m.baseline} min average handling time per message (published live-chat benchmarks, applied uniformly). Auto answers save the full ${m.baseline} min; drafts save half. These are not the provider's real numbers.</span></div></div>
  <div class="stat"><div class="n">${m.medianLatency}<span style="font-size:18px"> ms</span></div><div class="l">median end-to-end latency</div></div>
  <div class="stat"><div class="n">$${m.medianCost.toFixed(4)}</div><div class="l">median model cost per message (list prices, assumption)</div></div>
</div>
<div class="grid">
  <div class="panel"><h3>Escalation reasons</h3><table><thead><tr><th>Category</th><th>Reason</th><th>n</th></tr></thead><tbody>${reasons || '<tr><td colspan="3" class="muted">none yet</td></tr>'}</tbody></table></div>
  <div class="panel"><h3>Messages by risk category</h3><div style="display:grid;gap:10px">${cats || '<span class="muted">none yet</span>'}</div></div>
</div>`;
  return layout({ title: 'Metrics', body, admin: true, posthog });
}

export function evalPage({ runs, posthog }) {
  const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
  const latest = runs[0];
  const card = (r) => {
    const s = r.results;
    return `<div class="stats">
  <div class="stat big" style="padding:22px"><div class="n" style="font-size:64px">${pct(s.clinical_recall)}</div><div class="l">clinical recall (CLINICAL + ADVERSE_EVENT tickets that escalated) · target 100%</div></div>
  <div class="stat"><div class="n">${pct(s.routing_accuracy)}</div><div class="l">routing accuracy</div></div>
  <div class="stat"><div class="n">${s.false_auto_answers}</div><div class="l">false auto answers (unsafe tickets auto answered) · target 0</div></div>
  <div class="stat"><div class="n">${pct(s.over_escalation_rate)}</div><div class="l">over-escalation (GENERAL_INFO that escalated)</div></div>
  <div class="stat"><div class="n">${pct(s.groundedness_pass_rate)}</div><div class="l">groundedness pass rate</div></div>
  <div class="stat"><div class="n">${pct(s.retrieval_hit_at_3)}</div><div class="l">retrieval hit@3 (correct source page)</div></div>
  <div class="stat"><div class="n">${s.median_latency_ms}<span style="font-size:18px"> ms</span></div><div class="l">median latency</div></div>
  <div class="stat"><div class="n">$${(s.median_cost_usd || 0).toFixed(4)}</div><div class="l">median cost per message</div></div>
</div>`;
  };
  const matrix = (s) => {
    const cats = Object.keys(s.confusion || {});
    if (!cats.length) return '';
    const cols = [...new Set(cats.flatMap((k) => Object.keys(s.confusion[k])))].sort();
    return `<div class="panel"><h3>Confusion matrix (rows expected, columns predicted)</h3><table><thead><tr><th></th>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${cats
      .map((k) => `<tr><td><strong>${esc(k)}</strong></td>${cols.map((c) => `<td class="mono" ${k === c ? 'style="background:var(--mint)"' : s.confusion[k][c] ? 'style="background:var(--pink)"' : ''}>${s.confusion[k][c] || ''}</td>`).join('')}</tr>`)
      .join('')}</tbody></table></div>`;
  };
  const history = runs
    .map(
      (r) => `<tr><td class="mono">${when(r.run_at)}</td><td>${esc(r.notes || '')}</td><td class="mono">${r.thresholds?.floor} / ${r.thresholds?.auto}</td><td class="mono">${pct(r.results.routing_accuracy)}</td><td class="mono">${pct(r.results.clinical_recall)}</td><td class="mono">${r.results.false_auto_answers}</td><td class="mono">${pct(r.results.over_escalation_rate)}</td><td class="mono">${r.results.n}</td></tr>`,
    )
    .join('');
  const body = `
<h1>Eval</h1>
${latest ? `<p class="muted">Latest run ${when(latest.run_at)} · dataset ${esc(latest.dataset_version)} · thresholds floor ${latest.thresholds.floor} / auto ${latest.thresholds.auto} · ${esc(latest.notes || '')}</p>${card(latest)}${matrix(latest.results)}` : '<p class="muted">No eval runs yet. Run <code>npm run eval</code>.</p>'}
<div class="panel"><h3>Run history</h3><table><thead><tr><th>Run</th><th>Notes</th><th>Floor / auto</th><th>Routing</th><th>Clinical recall</th><th>False auto</th><th>Over-esc.</th><th>n</th></tr></thead><tbody>${history || '<tr><td colspan="8" class="muted">none</td></tr>'}</tbody></table></div>`;
  return layout({ title: 'Eval', body, admin: true, posthog });
}

export function kbPage({ chunks, posthog }) {
  const rows = chunks
    .map(
      (c) => `<tr><td class="mono">${esc(c.id)}</td><td>${badge(c.origin)}</td><td>${esc(c.jurisdiction)}</td><td>${esc(c.topic)}</td><td><a href="${esc(c.source_url)}" target="_blank" rel="noopener">${esc(c.heading)}</a><div class="muted" style="font-size:12px">${esc(c.text.slice(0, 160))}…</div></td></tr>`,
    )
    .join('');
  const counts = ['AU', 'UK', 'NZ', 'ALL'].map((j) => `${j} ${chunks.filter((c) => c.jurisdiction === j).length}`).join(' · ');
  const body = `<h1>Knowledge base</h1><p class="muted">${chunks.length} chunks · ${counts} · ${chunks.filter((c) => c.origin === 'promoted').length} promoted from conversations</p>
<table><thead><tr><th>Id</th><th>Origin</th><th>Jur.</th><th>Topic</th><th>Heading</th></tr></thead><tbody>${rows}</tbody></table>`;
  return layout({ title: 'Knowledge base', body, admin: true, posthog });
}
