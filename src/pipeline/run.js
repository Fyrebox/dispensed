import { ObjectId } from 'mongodb';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { estimateCostUsd } from '../llm/openai.js';
import { ESCALATE_ALWAYS } from '../llm/schemas.js';
import { classify } from './classify.js';
import { retrieve } from './retrieve.js';
import { compose } from './compose.js';
import { ground } from './ground.js';
import { route, handoffText } from './route.js';

const CF_TO_JUR = { AU: 'AU', GB: 'UK', NZ: 'NZ' };

/**
 * Where the jurisdiction came from, most trusted first:
 *   override  — the test toggle on the demo page
 *   explicit  — the patient named a country/city/currency in the message
 *   header    — Cloudflare's cf-ipcountry on the request
 *   inferred  — spelling / phrasing hints only
 */
export function resolveJurisdiction({ override, cfCountry, classified }) {
  if (override && config.jurisdictions.includes(override)) return { jurisdiction: override, source: 'override' };
  if (classified.jurisdiction !== 'UNKNOWN' && classified.jurisdiction_evidence === 'explicit') {
    return { jurisdiction: classified.jurisdiction, source: 'explicit' };
  }
  const fromHeader = CF_TO_JUR[(cfCountry || '').toUpperCase()];
  if (fromHeader) return { jurisdiction: fromHeader, source: 'header' };
  if (classified.jurisdiction !== 'UNKNOWN') return { jurisdiction: classified.jurisdiction, source: 'inferred' };
  return { jurisdiction: 'UNKNOWN', source: 'none' };
}

const STATUS_FOR = { AUTO_ANSWER: 'auto_resolved', DRAFT_FOR_APPROVAL: 'awaiting_human', ESCALATE: 'awaiting_human' };

/**
 * Full pipeline for one patient message. Writes the conversation, the patient
 * message and the agent message (with every decision input) before returning.
 *
 * opts.persist=false runs the pipeline without touching Mongo (used by the eval
 * harness, which writes its own records).
 */
export async function runPipeline({ text, conversationId, override, cfCountry, channel = 'web', persist = true, thresholds }) {
  const started = Date.now();
  const usage = { tokens_in: 0, tokens_out: 0, embed_tokens: 0 };
  const add = (r) => { usage.tokens_in += r.tokens_in || 0; usage.tokens_out += r.tokens_out || 0; };

  // [1] risk classifier — no retrieval context, runs first on purpose
  const cls = await classify(text);
  add(cls);
  const classified = cls.data;
  const { jurisdiction, source: jurisdiction_source } = resolveJurisdiction({ override, cfCountry, classified });

  let retrieved = [];
  let chunks = [];
  let composed = null;
  let grounding = null;
  let topScore = null;

  const category = classified.category;
  const needsRetrieval = !ESCALATE_ALWAYS.has(category) && category !== 'OUT_OF_SCOPE';

  if (needsRetrieval) {
    // [2] retriever
    const r = await retrieve(text, jurisdiction);
    retrieved = r.retrieved;
    chunks = r.chunks;
    usage.embed_tokens += r.embed_tokens;
    topScore = retrieved.length ? Math.max(...retrieved.map((x) => x.score)) : null;

    const floor = (thresholds || config.thresholds).floor;
    if (topScore !== null && topScore >= floor) {
      // [3] composer
      const c = await compose({ text, jurisdiction, chunks });
      add(c);
      composed = c.data;
      // [4] grounding gate — sees only the draft and the cited chunks
      const cited = chunks.filter((ch) => composed.cited_chunk_ids.includes(ch.id));
      const g = await ground({ answer: composed.answer, chunks: cited.length ? cited : chunks });
      add(g);
      grounding = g.data;
    }
  }

  const routed = route(
    { category, topScore, grounded: grounding?.grounded, fullyAnswered: composed?.fully_answered },
    thresholds || config.thresholds,
  );

  // What the patient sees. Only AUTO_ANSWER on GENERAL_INFO shows model text.
  let reply;
  let draft = null;
  if (routed.decision === 'AUTO_ANSWER' && category === 'GENERAL_INFO') {
    reply = composed.answer;
  } else if (category === 'ACCOUNT_SPECIFIC' && grounding?.grounded && composed) {
    // General process first, then hand off. The composed part is grounded and cited.
    reply = `${composed.answer}\n\n${handoffText(category, jurisdiction, routed.reason)}`;
  } else {
    reply = handoffText(category, jurisdiction, routed.reason);
    if (routed.decision === 'DRAFT_FOR_APPROVAL') draft = composed?.answer ?? null;
  }

  const latency_ms = Date.now() - started;
  const cost_usd = estimateCostUsd(usage);
  const citations = (composed?.cited_chunk_ids || [])
    .map((id) => chunks.find((c) => c.id === id))
    .filter(Boolean)
    .map((c) => ({ chunk_id: c.id, heading: c.heading, source_url: c.source_url }));

  const agentMessage = {
    role: 'agent',
    text: reply,
    draft,
    decision: routed.decision,
    decision_reason: routed.reason,
    risk: classified,
    jurisdiction,
    jurisdiction_source,
    retrieved,
    retrieved_chunks: chunks.map((c) => ({ id: c.id, heading: c.heading, source_url: c.source_url, jurisdiction: c.jurisdiction, text: c.text })),
    composed,
    grounding,
    citations,
    confidence: composed?.confidence ?? null,
    grounded: grounding?.grounded ?? null,
    top_score: topScore,
    thresholds: thresholds || config.thresholds,
    model: cls.model,
    latency_ms,
    tokens_in: usage.tokens_in,
    tokens_out: usage.tokens_out,
    embed_tokens: usage.embed_tokens,
    cost_usd,
  };

  let convId = conversationId;
  if (persist) {
    const db = await getDb();
    const now = new Date();
    const status = STATUS_FOR[routed.decision];
    if (!convId) {
      const ins = await db.collection('conversations').insertOne({
        started_at: now,
        channel,
        status,
        jurisdiction,
        jurisdiction_source,
        risk_category: category,
        urgency: classified.urgency,
        decision: routed.decision,
        first_line: text.split('\n')[0].slice(0, 140),
        outcome_note: null,
        resolved_by: null,
        resolved_at: null,
        updated_at: now,
      });
      convId = ins.insertedId;
    } else {
      convId = new ObjectId(convId);
      // A later message can only make a conversation more cautious, never less.
      const upd = { updated_at: now, decision: routed.decision, risk_category: category, urgency: classified.urgency };
      if (status === 'awaiting_human') upd.status = status;
      await db.collection('conversations').updateOne({ _id: convId }, { $set: upd });
    }
    await db.collection('messages').insertMany([
      { conversation_id: convId, role: 'patient', text, created_at: now },
      { conversation_id: convId, ...agentMessage, created_at: new Date(now.getTime() + 1) },
    ]);
  }

  return { conversation_id: convId ? String(convId) : null, ...agentMessage };
}
