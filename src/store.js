import { ObjectId } from 'mongodb';
import { getDb } from './db.js';
import { getCollection } from './chroma.js';
import { embed } from './llm/openai.js';
import { runPipeline } from './pipeline/run.js';

const oid = (id) => (id instanceof ObjectId ? id : new ObjectId(String(id)));

export async function listConversations({ status, decision, jurisdiction, limit = 200 } = {}) {
  const db = await getDb();
  const q = {};
  if (status) q.status = status;
  if (decision) q.decision = decision;
  if (jurisdiction) q.jurisdiction = jurisdiction;
  return db.collection('conversations').find(q).sort({ started_at: -1 }).limit(limit).toArray();
}

export async function getConversation(id) {
  const db = await getDb();
  const conversation = await db.collection('conversations').findOne({ _id: oid(id) });
  if (!conversation) return null;
  const messages = await db.collection('messages').find({ conversation_id: oid(id) }).sort({ created_at: 1 }).toArray();
  return { conversation, messages };
}

export async function sendDraft(id, text, by = 'admin') {
  const db = await getDb();
  const now = new Date();
  await db.collection('messages').insertOne({ conversation_id: oid(id), role: 'human', text, sent_by: by, created_at: now });
  await db.collection('conversations').updateOne(
    { _id: oid(id) },
    { $set: { status: 'resolved', resolved_by: by, resolved_at: now, updated_at: now, outcome_note: 'Draft reviewed and sent' } },
  );
}

export async function resolveConversation(id, note, by = 'admin') {
  const db = await getDb();
  const now = new Date();
  await db.collection('conversations').updateOne(
    { _id: oid(id) },
    { $set: { status: 'resolved', outcome_note: note, resolved_by: by, resolved_at: now, updated_at: now } },
  );
}

/**
 * Promote a human's answer into the knowledge base: new chunk, origin "promoted",
 * embedded and written to both stores. This is how the system improves from use.
 */
export async function promoteToKb(id, { heading, text, jurisdiction }) {
  const db = await getDb();
  const col = await getCollection();
  const conv = await db.collection('conversations').findOne({ _id: oid(id) });
  const jur = jurisdiction || conv?.jurisdiction || 'ALL';
  const chunkId = `kb_${jur}_promoted_${String(id).slice(-6)}_${Date.now().toString(36)}`;
  const { vectors } = await embed(`${heading}\n${text}`);
  const meta = { source_url: `/admin/conversations/${id}`, heading, jurisdiction: jur, topic: 'promoted', origin: 'promoted' };
  await col.upsert({ ids: [chunkId], embeddings: vectors, documents: [text], metadatas: [meta] });
  await db.collection('kb_chunks').insertOne({
    _id: chunkId, id: chunkId, ...meta, text, page_title: 'Promoted from conversation', created_at: new Date(), conversation_id: oid(id),
  });
  await db.collection('conversations').updateOne({ _id: oid(id) }, { $set: { promoted_chunk_id: chunkId, updated_at: new Date() } });
  return chunkId;
}

export async function listKb() {
  const db = await getDb();
  return db.collection('kb_chunks').find({}, { projection: { embedding: 0 } }).sort({ origin: -1, jurisdiction: 1, _id: 1 }).toArray();
}

export const BASELINE_MINUTES = 4; // stated assumption: average human handling time per support message

export async function metrics() {
  const db = await getDb();
  const agent = db.collection('messages');
  const [total, byDecision, byJur, gaps, latencies] = await Promise.all([
    agent.countDocuments({ role: 'agent' }),
    agent.aggregate([{ $match: { role: 'agent' } }, { $group: { _id: '$decision', n: { $sum: 1 } } }]).toArray(),
    agent.aggregate([{ $match: { role: 'agent' } }, { $group: { _id: '$jurisdiction', n: { $sum: 1 } } }]).toArray(),
    // Questions the published pages could not answer: the list of what to write or promote next.
    db.collection('conversations').find({ decision: { $in: ['NOT_COVERED', 'PARTIAL'] } }).sort({ started_at: -1 }).limit(15).toArray(),
    agent.find({ role: 'agent' }, { projection: { latency_ms: 1, cost_usd: 1, top_score: 1 } }).toArray(),
  ]);
  const count = (arr, k) => arr.find((x) => x._id === k)?.n ?? 0;
  const answered = count(byDecision, 'ANSWERED');
  const partial = count(byDecision, 'PARTIAL');
  const notCovered = count(byDecision, 'NOT_COVERED');
  const median = (xs) => {
    const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  };
  return {
    total, answered, partial, notCovered,
    pct: (n) => (total ? Math.round((n / total) * 100) : 0),
    byJur: byJur.map((x) => ({ jurisdiction: x._id, n: x.n })).sort((a, b) => b.n - a.n),
    gaps,
    minutesSaved: Math.round(answered * BASELINE_MINUTES + partial * BASELINE_MINUTES * 0.5),
    baseline: BASELINE_MINUTES,
    medianLatency: median(latencies.map((x) => x.latency_ms)),
    medianCost: median(latencies.map((x) => x.cost_usd)),
    medianTopScore: median(latencies.map((x) => x.top_score)),
  };
}

export async function evalRuns() {
  const db = await getDb();
  return db.collection('eval_runs').find().sort({ run_at: -1 }).limit(20).toArray();
}

/** Demo reset: wipe conversations, keep the knowledge base and eval history, re-seed. */
export async function resetDemo(seedTickets = []) {
  const db = await getDb();
  await db.collection('messages').deleteMany({});
  await db.collection('conversations').deleteMany({});
  for (const t of seedTickets) {
    await runPipeline({ text: t.text, override: t.jurisdiction, channel: 'seed' });
  }
}
