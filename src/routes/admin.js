import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import * as store from '../store.js';
import { loadSnapshot, kbCounts } from '../kb.js';
import { listPage, detailPage, metricsPage, evalPage, kbPage, loginPage } from '../views/admin.js';
import { requireAdmin, passwordMatches, issueToken, setCookie, clearCookie } from '../auth.js';
import rateLimit from 'express-rate-limit';

export const adminRouter = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });

adminRouter.get('/login', (req, res) => {
  res.send(loginPage({ next: req.query.next, error: req.query.error, posthog: config.posthog }));
});

adminRouter.post('/login', loginLimiter, (req, res) => {
  const next = typeof req.body.next === 'string' && req.body.next.startsWith('/admin') ? req.body.next : '/admin';
  if (!passwordMatches(req.body.password)) return res.redirect(`/admin/login?error=1&next=${encodeURIComponent(next)}`);
  setCookie(res, issueToken());
  res.redirect(next);
});

adminRouter.post('/logout', (req, res) => {
  clearCookie(res);
  res.redirect('/admin/login');
});

adminRouter.use(requireAdmin);

const ph = config.posthog;

adminRouter.get('/', async (req, res, next) => {
  try {
    const filters = { status: req.query.status, decision: req.query.decision, jurisdiction: req.query.jurisdiction };
    res.send(listPage({ conversations: await store.listConversations(filters), filters, posthog: ph }));
  } catch (e) { next(e); }
});

adminRouter.get('/conversations/:id', async (req, res, next) => {
  try {
    const data = await store.getConversation(req.params.id);
    if (!data) return res.status(404).send('Not found');
    res.send(detailPage({ ...data, posthog: ph, flash: req.query.flash }));
  } catch (e) { next(e); }
});

adminRouter.post('/conversations/:id/send', async (req, res, next) => {
  try {
    await store.sendDraft(req.params.id, String(req.body.text || '').trim(), config.admin.user);
    res.redirect(`/admin/conversations/${req.params.id}?flash=Draft+sent+and+conversation+resolved`);
  } catch (e) { next(e); }
});

adminRouter.post('/conversations/:id/resolve', async (req, res, next) => {
  try {
    await store.resolveConversation(req.params.id, String(req.body.note || '').trim(), config.admin.user);
    res.redirect(`/admin/conversations/${req.params.id}?flash=Resolved`);
  } catch (e) { next(e); }
});

adminRouter.post('/conversations/:id/promote', async (req, res, next) => {
  try {
    const id = await store.promoteToKb(req.params.id, {
      heading: String(req.body.heading || '').trim(),
      text: String(req.body.text || '').trim(),
      jurisdiction: req.body.jurisdiction || undefined,
    });
    res.redirect(`/admin/conversations/${req.params.id}?flash=Promoted+as+${encodeURIComponent(id)}`);
  } catch (e) { next(e); }
});

adminRouter.get('/kb', async (req, res, next) => {
  try { res.send(kbPage({ chunks: await store.listKb(), counts: await kbCounts(), posthog: ph, flash: req.query.flash })); } catch (e) { next(e); }
});

// Fresh deploy: load the committed snapshot of published chunks (no fetching, embeds ~36k tokens).
adminRouter.post('/kb/load-snapshot', async (req, res, next) => {
  try {
    const { count, tokens } = await loadSnapshot();
    res.redirect(`/admin/kb?flash=${encodeURIComponent(`Loaded ${count} published chunks from snapshot (${tokens} embedding tokens)`)}`);
  } catch (e) { next(e); }
});

adminRouter.get('/metrics', async (req, res, next) => {
  try { res.send(metricsPage({ m: await store.metrics(), posthog: ph })); } catch (e) { next(e); }
});

adminRouter.get('/eval', async (req, res, next) => {
  try { res.send(evalPage({ runs: await store.evalRuns(), posthog: ph, flash: req.query.flash })); } catch (e) { next(e); }
});

// Import committed eval runs (data/eval/*.json) into this deployment's eval_runs.
adminRouter.post('/eval/import', async (req, res, next) => {
  try {
    const dir = path.resolve(import.meta.dirname, '../../data/eval');
    const db = await (await import('../db.js')).getDb();
    let n = 0;
    for (const f of (await fs.readdir(dir)).filter((x) => x.endsWith('.json'))) {
      const run = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
      const run_at = new Date(run._id.replace(/^run_/, '').replace(/-(\d\d)-(\d\d)-(\d\d\d)Z$/, ':$1:$2.$3Z'));
      await db.collection('eval_runs').replaceOne({ _id: run._id }, { ...run, run_at, model: 'gpt-5.6-luna' }, { upsert: true });
      n += 1;
    }
    res.redirect(`/admin/eval?flash=${encodeURIComponent(`Imported ${n} runs from data/eval`)}`);
  } catch (e) { next(e); }
});

adminRouter.post('/reset', async (req, res, next) => {
  try {
    let seed = [];
    try { seed = JSON.parse(await fs.readFile(path.resolve(import.meta.dirname, '../../data/seed.json'), 'utf8')); } catch {}
    await store.resetDemo(seed);
    res.redirect('/admin');
  } catch (e) { next(e); }
});
