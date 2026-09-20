import { config } from '../config.js';
import { getCollection, toSimilarity } from '../chroma.js';
import { embed } from '../llm/openai.js';

const STOP = new Set('a an the is are do does did i my me you your it in on at to of for and or with can how what when where which who why much many long free get there any this that from be'.split(' '));
const terms = (s) => [...new Set(s.toLowerCase().replace(/[^a-z0-9$£ ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)))];

/**
 * Lexical overlap between the question and a chunk, 0..1. Cheap hybrid signal:
 * embeddings alone confuse "is delivery free" with "free consultations".
 */
function overlap(qTerms, chunk) {
  if (!qTerms.length) return 0;
  const hay = `${chunk.heading} ${chunk.text}`.toLowerCase();
  const hits = qTerms.filter((t) => hay.includes(t) || (t.endsWith('s') && hay.includes(t.slice(0, -1)))).length;
  return hits / qTerms.length;
}

const OVERFETCH = 3;
const W_VECTOR = 0.75;

/**
 * Top-k chunks for the jurisdiction (plus ALL): over-fetch by cosine similarity,
 * re-rank with a blend of cosine and lexical overlap, keep the top k.
 * UNKNOWN jurisdiction takes the top 3 from each country so the composer can
 * say how the answer differs.
 */
export async function retrieve(question, jurisdiction = 'UNKNOWN', k = 5) {
  const started = Date.now();
  const col = await getCollection();
  const { vectors, tokens } = await embed(question);
  const qTerms = terms(question);
  const known = config.jurisdictions.includes(jurisdiction);
  const queries = known ? [{ jur: jurisdiction, n: k }] : config.jurisdictions.map((jur) => ({ jur, n: 3 }));

  const hits = [];
  for (const { jur, n } of queries) {
    const res = await col.query({
      queryEmbeddings: vectors,
      nResults: n * OVERFETCH,
      where: { jurisdiction: { $in: [jur, 'ALL'] } },
      include: ['documents', 'metadatas', 'distances'],
    });
    const cand = (res.ids?.[0] ?? []).map((id, i) => {
      const c = { id, text: res.documents[0][i], ...res.metadatas[0][i] };
      const vector_score = toSimilarity(res.distances[0][i]);
      const lexical = overlap(qTerms, c);
      return { ...c, vector_score: +vector_score.toFixed(4), lexical: +lexical.toFixed(2), score: +(W_VECTOR * vector_score + (1 - W_VECTOR) * lexical).toFixed(4) };
    });
    cand.sort((a, b) => b.score - a.score);
    for (const c of cand.slice(0, n)) if (!hits.some((h) => h.id === c.id)) hits.push(c);
  }
  hits.sort((a, b) => b.score - a.score);
  return {
    retrieved: hits.map((h) => ({ chunk_id: h.id, score: h.score, vector_score: h.vector_score, lexical: h.lexical })),
    chunks: hits.map(({ score, vector_score, lexical, ...c }) => c),
    embed_tokens: tokens,
    latency_ms: Date.now() - started,
  };
}
