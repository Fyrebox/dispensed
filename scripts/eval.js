#!/usr/bin/env node
/**
 * Retrieval + answer eval. Runs every labelled question in data/tickets.json
 * through the pipeline (no persistence), scores retrieval against the labelled
 * source page, records answered / partial / not-covered, writes an eval_runs
 * document and prints a scorecard.
 *
 *   node scripts/eval.js --tag "v3 kb"
 *   node scripts/eval.js --limit 10 --concurrency 4
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config.js';
import { getDb, closeDb } from '../src/db.js';
import { runPipeline } from '../src/pipeline/run.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const tag = flag('tag', '');
const limit = Number(flag('limit', 0));
const concurrency = Number(flag('concurrency', 4));

const median = (xs) => { const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

function score(rows) {
  const n = rows.length;
  const rate = (f) => (n ? rows.filter(f).length / n : null);
  return {
    n,
    retrieval_hit_at_3: rate((r) => r.top_sources.slice(0, 3).includes(r.expected_source_url)),
    retrieval_hit_at_5: rate((r) => r.top_sources.slice(0, 5).includes(r.expected_source_url)),
    cited_correct_page: rate((r) => r.cited_sources.includes(r.expected_source_url)),
    answered_rate: rate((r) => r.decision === 'ANSWERED'),
    partial_rate: rate((r) => r.decision === 'PARTIAL'),
    not_covered_rate: rate((r) => r.decision === 'NOT_COVERED'),
    median_top_score: median(rows.map((r) => r.top_score)),
    median_latency_ms: median(rows.map((r) => r.latency_ms)),
    median_cost_usd: median(rows.map((r) => r.cost_usd)),
  };
}

function printScorecard(s, notes) {
  const pct = (x) => (x == null ? '   —' : `${Math.round(x * 100)}%`.padStart(4));
  console.log(`\n══ Scorecard ${notes ? `(${notes}) ` : ''}n=${s.n}`);
  console.log(`  retrieval hit@3         ${pct(s.retrieval_hit_at_3)}   (labelled page in top 3)`);
  console.log(`  retrieval hit@5         ${pct(s.retrieval_hit_at_5)}`);
  console.log(`  cites the labelled page ${pct(s.cited_correct_page)}`);
  console.log(`  fully answered          ${pct(s.answered_rate)}`);
  console.log(`  partly answered         ${pct(s.partial_rate)}`);
  console.log(`  not covered             ${pct(s.not_covered_rate)}`);
  console.log(`  median top score        ${s.median_top_score.toFixed(3)}`);
  console.log(`  median latency          ${String(s.median_latency_ms).padStart(5)} ms`);
  console.log(`  median cost / message   $${s.median_cost_usd.toFixed(4)}`);
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

async function main() {
  const db = await getDb();
  const file = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'tickets.json'), 'utf8'));
  let tickets = file.tickets.filter((t) => t.expected_source_url);
  if (limit) tickets = tickets.slice(0, limit);

  let done = 0;
  const rows = await mapLimit(tickets, concurrency, async (t) => {
    let out;
    try {
      out = await runPipeline({ text: t.text, override: t.jurisdiction, persist: false });
    } catch (e) {
      console.error(`  ✗ ${t.id}: ${e.message}`);
      out = { decision: 'ERROR', decision_reason: e.message, retrieved_chunks: [], citations: [], latency_ms: 0, cost_usd: 0, top_score: null, text: '' };
    }
    done += 1;
    const topSources = (out.retrieved_chunks || []).map((c) => c.source_url);
    const hit = topSources.slice(0, 3).includes(t.expected_source_url);
    process.stdout.write(`${hit ? '✓' : '✗'} ${String(done).padStart(3)}/${tickets.length} ${t.id} ${out.decision} ${(out.top_score ?? 0).toFixed(2)} «${t.text.slice(0, 60)}»\n`);
    return {
      id: t.id, text: t.text, jurisdiction: t.jurisdiction, expected_source_url: t.expected_source_url,
      decision: out.decision, decision_reason: out.decision_reason, top_score: out.top_score ?? null,
      top_sources: topSources, cited_sources: (out.citations || []).map((c) => c.source_url),
      reply: out.text, latency_ms: out.latency_ms, cost_usd: out.cost_usd,
    };
  });

  const results = score(rows);
  printScorecard(results, tag);
  const _id = `run_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await db.collection('eval_runs').insertOne({ _id, run_at: new Date(), dataset_version: file.version, model: config.openai.model, results, notes: tag, per_ticket: rows });
  await fs.mkdir(path.join(ROOT, 'data', 'eval'), { recursive: true });
  await fs.writeFile(path.join(ROOT, 'data', 'eval', `${_id}.json`), JSON.stringify({ _id, dataset_version: file.version, notes: tag, results, per_ticket: rows }, null, 2));
  console.log(`\nSaved eval_runs/${_id} and data/eval/${_id}.json`);
  await closeDb();
}

main().catch((e) => { console.error(e); process.exit(1); });
