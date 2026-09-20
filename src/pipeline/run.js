import { ObjectId } from 'mongodb';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { estimateCostUsd } from '../llm/openai.js';
import { retrieve } from './retrieve.js';
import { compose } from './compose.js';

const CF_TO_JUR = { AU: 'AU', GB: 'UK', NZ: 'NZ' };

/** Where the jurisdiction came from: the test toggle, then Cloudflare's cf-ipcountry header, else UNKNOWN (search all). */
export function resolveJurisdiction({ override, cfCountry }) {
  if (override && config.jurisdictions.includes(override)) return { jurisdiction: override, source: 'override' };
  const fromHeader = CF_TO_JUR[(cfCountry || '').toUpperCase()];
  if (fromHeader) return { jurisdiction: fromHeader, source: 'header' };
  return { jurisdiction: 'UNKNOWN', source: 'none' };
}

const NOTHING_FOUND = `I couldn't find anything on the published pages about that. The support team can help directly.`;

export function decide(composed) {
  if (!composed || !composed.cited_chunk_ids?.length) return { decision: 'NOT_COVERED', reason: 'no published passage covers the question' };
  if (composed.fully_answered) return { decision: 'ANSWERED', reason: `answered from ${composed.cited_chunk_ids.length} cited passage(s)` };
  return { decision: 'PARTIAL', reason: `partly answered: ${composed.unanswered_part || 'part of the question is not covered'}` };
}

/**
 * Plain RAG for one patient message: retrieve top-k published chunks for the
 * jurisdiction, compose a cited answer from them, log everything, reply.
 *
 * opts.persist=false runs without touching Mongo (the eval harness).
 */
export async function runPipeline({ text, conversationId, override, cfCountry, channel = 'web', persist = true }) {
  const started = Date.now();
  const { jurisdiction, source: jurisdiction_source } = resolveJurisdiction({ override, cfCountry });

  const r = await retrieve(text, jurisdiction);
  const { retrieved, chunks } = r;
  const topScore = retrieved.length ? Math.max(...retrieved.map((x) => x.score)) : null;

  let composed = null;
  const usage = { tokens_in: 0, tokens_out: 0, embed_tokens: r.embed_tokens };
  if (chunks.length) {
    const c = await compose({ text, jurisdiction, chunks });
    usage.tokens_in += c.tokens_in;
    usage.tokens_out += c.tokens_out;
    composed = c.data;
    // Only keep citations that point at chunks we actually supplied.
    composed.cited_chunk_ids = composed.cited_chunk_ids.filter((id) => chunks.some((ch) => ch.id === id));
  }
  const { decision, reason } = decide(composed);
  const reply = composed?.answer || NOTHING_FOUND;

  const latency_ms = Date.now() - started;
  const cost_usd = estimateCostUsd(usage);
  const citations = (composed?.cited_chunk_ids || [])
    .map((id) => chunks.find((c) => c.id === id))
    .filter(Boolean)
    .map((c) => ({ chunk_id: c.id, heading: c.heading, source_url: c.source_url }));

  const agentMessage = {
    role: 'agent',
    text: reply,
    decision,
    decision_reason: reason,
    jurisdiction,
    jurisdiction_source,
    retrieved,
    retrieved_chunks: chunks.map((c) => ({ id: c.id, heading: c.heading, source_url: c.source_url, jurisdiction: c.jurisdiction, text: c.text })),
    composed,
    citations,
    confidence: composed?.confidence ?? null,
    top_score: topScore,
    model: config.openai.model,
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
    if (!convId) {
      const ins = await db.collection('conversations').insertOne({
        started_at: now,
        channel,
        status: 'open',
        jurisdiction,
        jurisdiction_source,
        decision,
        first_line: text.split('\n')[0].slice(0, 140),
        outcome_note: null,
        resolved_by: null,
        resolved_at: null,
        updated_at: now,
      });
      convId = ins.insertedId;
    } else {
      convId = new ObjectId(convId);
      await db.collection('conversations').updateOne({ _id: convId }, { $set: { updated_at: now, decision } });
    }
    await db.collection('messages').insertMany([
      { conversation_id: convId, role: 'patient', text, created_at: now },
      { conversation_id: convId, ...agentMessage, created_at: new Date(now.getTime() + 1) },
    ]);
  }

  return { conversation_id: convId ? String(convId) : null, ...agentMessage };
}
