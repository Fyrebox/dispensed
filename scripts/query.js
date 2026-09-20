#!/usr/bin/env node
// Checkpoint script: node scripts/query.js "how much is shipping" UK
import { retrieve } from '../src/pipeline/retrieve.js';

const [q, jur = 'UNKNOWN'] = process.argv.slice(2);
if (!q) { console.error('usage: node scripts/query.js "<question>" [AU|UK|NZ]'); process.exit(1); }
const { retrieved, chunks } = await retrieve(q, jur);
for (const r of retrieved) {
  const c = chunks.find((x) => x.id === r.chunk_id);
  console.log(`\n${r.score.toFixed(3)}  ${r.chunk_id}  [${c.jurisdiction}] ${c.heading}\n   ${c.source_url}\n   ${c.text.slice(0, 220).replace(/\n/g, ' ')}…`);
}
process.exit(0);
