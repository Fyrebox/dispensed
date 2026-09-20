import { ChromaClient } from 'chromadb';
import { config } from './config.js';

let collection;

export async function getCollection() {
  if (collection) return collection;
  const u = new URL(config.chroma.url);
  const client = new ChromaClient({
    host: u.hostname,
    port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80),
    ssl: u.protocol === 'https:',
  });
  // Embeddings are supplied by us (OpenAI), so no embedding function on the collection.
  collection = await client.getOrCreateCollection({
    name: config.chroma.collection,
    metadata: { 'hnsw:space': 'cosine' },
    embeddingFunction: null,
  });
  return collection;
}

// Chroma returns cosine *distance* (0 = identical). Convert to similarity so
// thresholds read the way the spec writes them (0.35 floor, 0.55 auto).
export const toSimilarity = (distance) => 1 - distance;
