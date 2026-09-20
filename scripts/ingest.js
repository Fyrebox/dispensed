#!/usr/bin/env node
/**
 * Knowledge-base ingestion.
 *
 *   node scripts/ingest.js                 fetch every page in data/sources.json, chunk, embed, store
 *   node scripts/ingest.js --from-snapshot re-embed and store data/kb_chunks.json without fetching
 *   node scripts/ingest.js --dry           fetch + chunk, print, write the snapshot, do not embed/store
 *
 * Published pages only. Each chunk is stored in Chroma (vector) and mirrored in
 * MongoDB kb_chunks (for the admin console and the promote-to-KB flow).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { config } from '../src/config.js';
import { getDb, closeDb } from '../src/db.js';
import { getCollection } from '../src/chroma.js';
import { embed } from '../src/llm/openai.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const SNAPSHOT = path.join(ROOT, 'data', 'kb_chunks.json');
const args = new Set(process.argv.slice(2));

const MIN_WORDS = 150;
const MAX_WORDS = 400;

// Sections on policy pages that are legal boilerplate a patient would never ask
// support about. Dropped to keep the store focused.
const SKIP_HEADINGS =
  /intellectual property|indemnity|linked sites|amendment of the terms|third-party|release regarding|^feedback$|^modification$|user content|^deals$|dispute resolution|^terms$|^jurisdiction$|ready to start|book a consultation|cookie/i;

const CTA_LINES = /get started|see timelines|start eligibility|book (free )?consult|how it works|log in/i;

const STRIP = 'script,style,noscript,svg,iframe,nav,header,footer,.w-nav,.footer,[class*=cookie],[class*=faq_icon],[class*=youtube],[class*=trustpilot],[class*=review],form,button';

const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const clean = (s) => s.replace(/\s+/g, ' ').replace(/ /g, ' ').trim();
const slugOf = (url) => {
  const p = new URL(url).pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  return (p[p.length - 1] || 'home').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
};

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (triage-prototype ingest)' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

/** FAQ pages: one chunk per question + answer, never split. */
function chunkFaq($, root, pageTitle) {
  const out = [];
  root.find('.faq_list').each((_, list) => {
    const $list = $(list);
    const section = clean(
      $list.prevAll('h2,h3').first().text() || $list.parent().children('h2,h3').first().text() || 'FAQ',
    );
    $list.find('[class*="faq_item"]').each((_, item) => {
      const q = clean($(item).find('.faq_top').first().text());
      const a = clean($(item).find('.faq_bottom').first().text());
      if (!q || !a) return;
      out.push({ heading: section && section !== q ? `${section} — ${q}` : q, text: `Q: ${q}\nA: ${a}` });
    });
  });
  return out;
}

/**
 * Everything else: linearise the DOM into lines, marking headings, then group.
 * Handles Webflow pages that put copy in leaf <div>s, in <p>s, or in one big
 * <div> of <strong>heading</strong><br>text<br><br> runs (the terms pages).
 */
const H = '\u0001H\u0001';
function linearise($, root) {
  root.find('h1,h2,h3,h4').each((_, el) => {
    $(el).replaceWith(`\n${H}${clean($(el).text())}\n`);
  });
  root.find('strong,b').each((_, el) => {
    const $el = $(el);
    const t = clean($el.text());
    const next = el.next;
    const standalone = next && next.type === 'tag' && next.name === 'br';
    const wholeBlock = !next && clean($el.parent().text()) === t;
    if (t && words(t) <= 12 && (standalone || wholeBlock)) $el.replaceWith(`\n${H}${t}\n`);
  });
  root.find('br').replaceWith('\n');
  root.find('p,div,li,td,tr,section,article,ul,ol,blockquote').each((_, el) => {
    $(el).append('\n');
    $(el).prepend('\n');
  });
  return root
    .text()
    .split('\n')
    .map(clean)
    .filter(Boolean);
}

function chunkByHeading($, root, pageTitle) {
  const lines = linearise($, root);
  const sections = [];
  let cur = { heading: pageTitle, paras: [] };
  const seen = new Set();
  for (const line of lines) {
    if (line.startsWith(H)) {
      if (cur.paras.length) sections.push(cur);
      cur = { heading: line.slice(H.length), paras: [] };
      continue;
    }
    if (/^\d{1,2}$/.test(line)) continue; // step numbers on the process pages
    if (words(line) < 3 && !/\d/.test(line)) continue;
    if (words(line) <= 6 && CTA_LINES.test(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue; // Webflow duplicates blocks for responsive layouts
    seen.add(key);
    cur.paras.push(line);
  }
  if (cur.paras.length) sections.push(cur);

  // Drop boilerplate and near-empty sections, then size to 150-400 words.
  const kept = sections.filter((s) => !SKIP_HEADINGS.test(s.heading) && words(s.paras.join(' ')) >= 12);
  const out = [];
  let acc = null;
  const flush = () => { if (acc) { out.push(acc); acc = null; } };
  for (const s of kept) {
    const body = s.paras.join('\n');
    if (words(body) > MAX_WORDS) {
      flush();
      let part = [];
      for (const p of s.paras) {
        if (words([...part, p].join(' ')) > MAX_WORDS && part.length) {
          out.push({ heading: s.heading, text: part.join('\n') });
          part = [];
        }
        part.push(p);
      }
      if (part.length) out.push({ heading: s.heading, text: part.join('\n') });
      continue;
    }
    if (!acc) { acc = { heading: s.heading, text: body }; continue; }
    if (words(acc.text) < MIN_WORDS && words(acc.text + ' ' + body) <= MAX_WORDS) {
      acc = { heading: `${acc.heading} / ${s.heading}`, text: `${acc.text}\n\n${s.heading}\n${body}` };
    } else {
      flush();
      acc = { heading: s.heading, text: body };
    }
  }
  flush();
  return out;
}

function chunkPage(html, source) {
  const $ = cheerio.load(html);
  $(STRIP).remove();
  const root = $('main').length ? $('main') : $('body');
  const pageTitle = clean($('h1').first().text() || $('title').text().split('|')[0]);
  const chunks = chunkFaq($, root, pageTitle);
  root.find('.faq_list, .faqs-header').remove();
  chunks.push(...chunkByHeading($, root, pageTitle));
  const slug = slugOf(source.url);
  return chunks.map((c, i) => ({
    id: `kb_${source.jurisdiction}_${slug}_${i + 1}`,
    source_url: source.url,
    page_title: pageTitle,
    heading: c.heading,
    text: c.text,
    jurisdiction: source.jurisdiction,
    topic: source.topic,
    origin: 'published',
  }));
}

async function collect() {
  const { sources } = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'sources.json'), 'utf8'));
  const all = [];
  const seen = new Set();
  let pages = 0;
  for (const s of sources) {
    try {
      const html = await fetchHtml(s.url);
      // The same FAQ block is embedded on several pages of each site; keep the first copy only.
      const chunks = chunkPage(html, s).filter((c) => {
        const key = `${c.jurisdiction}|${c.text.toLowerCase().replace(/\W+/g, ' ')}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      pages += 1;
      console.log(`${s.jurisdiction}  ${String(chunks.length).padStart(3)} chunks  ${s.url}`);
      all.push(...chunks);
    } catch (e) {
      console.error(`FAILED ${s.url}: ${e.message}`);
    }
  }
  return { chunks: all, pages };
}

async function store(chunks) {
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
  // Replace every published chunk for the pages we just processed. Promoted chunks are untouched.
  const urls = [...new Set(chunks.map((c) => c.source_url))];
  await db.collection('kb_chunks').deleteMany({ origin: 'published', source_url: { $in: urls } });
  for (const url of urls) await col.delete({ where: { source_url: url } });
  const now = new Date();
  await col.upsert({
    ids: chunks.map((c) => c.id),
    embeddings: chunks.map((c) => c.embedding),
    documents: chunks.map((c) => c.text),
    metadatas: chunks.map((c) => ({
      source_url: c.source_url,
      heading: c.heading,
      jurisdiction: c.jurisdiction,
      topic: c.topic,
      origin: c.origin,
    })),
  });
  await db.collection('kb_chunks').insertMany(
    chunks.map((c) => ({ _id: c.id, ...c, created_at: now })),
  );
  return tokens;
}

async function main() {
  let chunks, pages;
  if (args.has('--from-snapshot')) {
    chunks = JSON.parse(await fs.readFile(SNAPSHOT, 'utf8'));
    pages = new Set(chunks.map((c) => c.source_url)).size;
  } else {
    ({ chunks, pages } = await collect());
    await fs.writeFile(SNAPSHOT, JSON.stringify(chunks, null, 2));
  }
  const totalWords = chunks.reduce((n, c) => n + words(c.text), 0);
  const byJur = Object.fromEntries(config.jurisdictions.map((j) => [j, chunks.filter((c) => c.jurisdiction === j).length]));
  if (args.has('--dry')) {
    for (const c of chunks) console.log(`\n[${c.id}] ${c.heading} (${words(c.text)}w)\n${c.text.slice(0, 200)}…`);
    console.log(`\nDRY: ${pages} pages, ${chunks.length} chunks, ~${totalWords} words`, byJur);
    return;
  }
  const tokens = await store(chunks);
  console.log(`\nIngested ${pages} pages → ${chunks.length} chunks (${tokens} embedding tokens, ~${totalWords} words)`, byJur);
  await closeDb();
}

main().catch((e) => { console.error(e); process.exit(1); });
