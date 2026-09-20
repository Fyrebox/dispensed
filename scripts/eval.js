#!/usr/bin/env node
/**
 * Eval harness. Runs every ticket in data/tickets.json through the full pipeline
 * (no persistence), scores against the labels, writes an eval_runs document and
 * prints a scorecard.
 *
 *   node scripts/eval.js --tag before
 *   node scripts/eval.js --floor 0.30 --auto 0.50 --tag after
 *   node scripts/eval.js --replay latest --floor 0.30 --auto 0.50   re-route the last run's raw
 *                                                                  results with new thresholds, no model calls
 *   node scripts/eval.js --limit 10 --concurrency 4
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config.js';
import { getDb, closeDb } from '../src/db.js';
import { runPipeline } from '../src/pipeline/run.js';
import { route } from '../src/pipeline/route.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const thresholds = { floor: Number(flag('floor', config.thresholds.floor)), auto: Number(flag('auto', config.thresholds.auto)) };
const tag = flag('tag', '');
const limit = Number(flag('limit', 0));
const concurrency = Number(flag('concurrency', 4));
const replay = flag('replay', null);

const UNSAFE = new Set(['CLINICAL', 'ADVERSE_EVENT', 'REGULATORY']);
const median = (xs) => { const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

function score(rows) {
  const n = rows.length;
  const clinical = rows.filter((r) => ['CLINICAL', 'ADVERSE_EVENT'].includes(r.expected_category));
  const general = rows.filter((r) => r.expected_category === 'GENERAL_INFO');
  const groundedRan = rows.filter((r) => r.grounded !== null && r.grounded !== undefined);
  const withSource = rows.filter((r) => r.expected_source_url);
  const confusion = {};
  for (const r of rows) {
    confusion[r.expected_category] ??= {};
    confusion[r.expected_category][r.category] = (confusion[r.expected_category][r.category] || 0) + 1;
  }
  return {
    n,
    routing_accuracy: n ? rows.filter((r) => r.decision === r.expected_decision).length / n : null,
    category_accuracy: n ? rows.filter((r) => r.category === r.expected_category).length / n : null,
    clinical_recall: clinical.length ? clinical.filter((r) => r.decision === 'ESCALATE').length / clinical.length : null,
    false_auto_answers: rows.filter((r) => UNSAFE.has(r.expected_category) && r.decision === 'AUTO_ANSWER').length,
    over_escalation_rate: general.length ? general.filter((r) => r.decision === 'ESCALATE').length / general.length : null,
    groundedness_pass_rate: groundedRan.length ? groundedRan.filter((r) => r.grounded).length / groundedRan.length : null,
    retrieval_hit_at_3: withSource.length ? withSource.filter((r) => (r.top3_sources || []).includes(r.expected_source_url)).length / withSource.length : null,
    median_latency_ms: median(rows.map((r) => r.latency_ms)),
    median_cost_usd: median(rows.map((r) => r.cost_usd)),
    confusion,
  };
}

function printScorecard(results, thresholds, notes) {
  const pct = (x) => (x == null ? '   —' : `${Math.round(x * 100)}%`.padStart(4));
  console.log(`\n══ Scorecard ${notes ? `(${notes}) ` : ''}floor ${thresholds.floor} · auto ${thresholds.auto} · n=${results.n}`);
  console.log(`  routing accuracy        ${pct(results.routing_accuracy)}`);
  console.log(`  category accuracy       ${pct(results.category_accuracy)}`);
  console.log(`  CLINICAL RECALL         ${pct(results.clinical_recall)}   (target 100%: anything less is a blocker)`);
  console.log(`  false auto answers      ${String(results.false_auto_answers).padStart(4)}   (target 0)`);
  console.log(`  over-escalation rate    ${pct(results.over_escalation_rate)}   (GENERAL_INFO that escalated: the cost of caution)`);
  console.log(`  groundedness pass rate  ${pct(results.groundedness_pass_rate)}`);
  console.log(`  retrieval hit@3         ${pct(results.retrieval_hit_at_3)}`);
  console.log(`  median latency          ${String(results.median_latency_ms).padStart(5)} ms`);
  console.log(`  median cost / message   $${results.median_cost_usd.toFixed(4)}`);
  console.log('\n  confusion (rows expected → columns predicted)');
  const cats = Object.keys(results.confusion);
  const cols = [...new Set(cats.flatMap((k) => Object.keys(results.confusion[k])))].sort();
  console.log('  ' + ''.padEnd(18) + cols.map((c) => c.slice(0, 8).padStart(9)).join(''));
  for (const k of cats) console.log('  ' + k.padEnd(18) + cols.map((c) => String(results.confusion[k][c] || '').padStart(9)).join(''));
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
  let tickets = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'tickets.json'), 'utf8'));
  const dataset_version = tickets.version || 'unversioned';
  tickets = tickets.tickets || tickets;
  if (limit) tickets = tickets.slice(0, limit);

  let rows;
  let notes = tag;
  if (replay) {
    const prev = replay === 'latest'
      ? await db.collection('eval_runs').find({ per_ticket: { $exists: true }, replay_of: { $exists: false } }).sort({ run_at: -1 }).limit(1).next()
      : await db.collection('eval_runs').findOne({ _id: replay });
    if (!prev) throw new Error('no previous run to replay');
    let missing = 0;
    rows = prev.per_ticket.map((r) => {
      const needsCompose = !UNSAFE.has(r.category) && r.category !== 'OUT_OF_SCOPE' && r.top_score !== null && r.top_score >= thresholds.floor;
      if (needsCompose && r.grounded == null) missing += 1; // composer never ran under the old floor
      const routed = route({ category: r.category, topScore: r.top_score, grounded: r.grounded, fullyAnswered: r.fully_answered }, thresholds);
      return { ...r, decision: routed.decision, decision_reason: routed.reason };
    });
    notes = `${tag ? tag + ' · ' : ''}replay of ${prev._id}`;
    if (missing) console.warn(`⚠ ${missing} tickets fell under the old floor and were never composed; they route as ESCALATE here. Run a fresh eval for exact numbers.`);
  } else {
    let done = 0;
    rows = await mapLimit(tickets, concurrency, async (t) => {
      const started = Date.now();
      let out;
      try {
        out = await runPipeline({ text: t.text, override: t.jurisdiction, persist: false, thresholds });
      } catch (e) {
        console.error(`  ✗ ${t.id}: ${e.message}`);
        out = { decision: 'ESCALATE', decision_reason: `error: ${e.message}`, risk: { category: 'ERROR' }, retrieved_chunks: [], latency_ms: Date.now() - started, cost_usd: 0 };
      }
      done += 1;
      const ok = out.decision === t.expected_decision && out.risk.category === t.expected_category;
      process.stdout.write(`${ok ? '✓' : '✗'} ${String(done).padStart(3)}/${tickets.length} ${t.id} ${t.expected_category}→${out.risk.category} ${t.expected_decision}→${out.decision}${ok ? '' : `  «${t.text.slice(0, 60)}»`}\n`);
      return {
        id: t.id, text: t.text, jurisdiction: t.jurisdiction,
        expected_category: t.expected_category, expected_decision: t.expected_decision, expected_source_url: t.expected_source_url || null,
        category: out.risk.category, decision: out.decision, decision_reason: out.decision_reason, risk_reason: out.risk.reason,
        top_score: out.top_score ?? null, grounded: out.grounded ?? null, fully_answered: out.composed?.fully_answered ?? null,
        top3_sources: (out.retrieved_chunks || []).slice(0, 3).map((c) => c.source_url),
        reply: out.text, draft: out.composed?.answer ?? null, unsupported_claims: out.grounding?.unsupported_claims ?? null,
        latency_ms: out.latency_ms, cost_usd: out.cost_usd,
      };
    });
  }

  const results = score(rows);
  printScorecard(results, thresholds, notes);
  if (replay && !argv.includes('--save')) { console.log('\n(replay not saved; pass --save to record it)'); await closeDb(); return; }
  const _id = `run_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await db.collection('eval_runs').insertOne({ _id, run_at: new Date(), dataset_version, thresholds, model: config.openai.model, results, notes, per_ticket: rows, ...(replay ? { replay_of: replay } : {}) });
  await fs.mkdir(path.join(ROOT, 'data', 'eval'), { recursive: true });
  await fs.writeFile(path.join(ROOT, 'data', 'eval', `${_id}.json`), JSON.stringify({ _id, dataset_version, thresholds, notes, results, per_ticket: rows }, null, 2));
  console.log(`\nSaved eval_runs/${_id} and data/eval/${_id}.json`);
  await closeDb();
}

main().catch((e) => { console.error(e); process.exit(1); });
