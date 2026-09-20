import fs from 'node:fs/promises';
import path from 'node:path';
import { getDb } from './db.js';
import { getCollection } from './chroma.js';
import { embed } from './llm/openai.js';

const SNAPSHOT = path.resolve(import.meta.dirname, '../data/kb_chunks.json');

/** Embed and write chunks to Chroma and the Mongo mirror. Replaces published chunks for the same pages; promoted chunks untouched. */
export async function storeChunks(chunks) {
  const db = await getDb();
  const col = await getCollection();
  let tokens = 0;
  const BATCH = 32;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const { vectors, tokens: t } = await embed(batch.map((c) => `${c.heading}\n${c.text}`));
    tokens += t;
    batch.forEach((c, j) => (c.embedding = vectors[j]));
  }
  const urls = [...new Set(chunks.map((c) => c.source_url))];
  await db.collection('kb_chunks').deleteMany({ origin: 'published', source_url: { $in: urls } });
  for (const url of urls) {
    try { await col.delete({ where: { source_url: url } }); } catch { /* nothing to delete on a fresh collection */ }
  }
  const now = new Date();
  await col.upsert({
    ids: chunks.map((c) => c.id),
    embeddings: chunks.map((c) => c.embedding),
    documents: chunks.map((c) => c.text),
    metadatas: chunks.map((c) => ({ source_url: c.source_url, heading: c.heading, jurisdiction: c.jurisdiction, topic: c.topic, origin: c.origin })),
  });
  await db.collection('kb_chunks').insertMany(chunks.map((c) => ({ _id: c.id, ...c, created_at: now })));
  return { tokens, count: chunks.length };
}

/** Load the committed snapshot (data/kb_chunks.json) into the stores. Used on a fresh deploy. */
export async function loadSnapshot() {
  const chunks = JSON.parse(await fs.readFile(SNAPSHOT, 'utf8'));
  return storeChunks(chunks);
}

export async function kbCounts() {
  const db = await getDb();
  const col = await getCollection();
  return { mongo: await db.collection('kb_chunks').countDocuments(), chroma: await col.count() };
}
