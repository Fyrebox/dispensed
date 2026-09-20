import { config } from '../config.js';
import { getCollection, toSimilarity } from '../chroma.js';
import { embed } from '../llm/openai.js';

/**
 * Top-k chunks by cosine similarity, filtered to the detected jurisdiction plus ALL.
 * UNKNOWN jurisdiction searches everything; the composer is told to flag country differences.
 */
export async function retrieve(question, jurisdiction = 'UNKNOWN', k = 5) {
  const started = Date.now();
  const col = await getCollection();
  const { vectors, tokens } = await embed(question);
  const where =
    jurisdiction && config.jurisdictions.includes(jurisdiction)
      ? { jurisdiction: { $in: [jurisdiction, 'ALL'] } }
      : undefined;
  const res = await col.query({
    queryEmbeddings: vectors,
    nResults: k,
    where,
    include: ['documents', 'metadatas', 'distances'],
  });
  const ids = res.ids?.[0] ?? [];
  const retrieved = ids.map((id, i) => ({ chunk_id: id, score: Number(toSimilarity(res.distances[0][i]).toFixed(4)) }));
  const chunks = ids.map((id, i) => ({
    id,
    text: res.documents[0][i],
    ...res.metadatas[0][i],
  }));
  return { retrieved, chunks, embed_tokens: tokens, latency_ms: Date.now() - started };
}
