import { Router } from 'express';
import basicAuth from 'express-basic-auth';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import * as store from '../store.js';
import { loadSnapshot, kbCounts } from '../kb.js';
import { listPage, detailPage, metricsPage, evalPage, kbPage } from '../views/admin.js';

export const adminRouter = Router();
adminRouter.use(basicAuth({ users: { [config.admin.user]: config.admin.pass }, challenge: true, realm: 'triage-admin' }));

const ph = config.posthog;

adminRouter.get('/', async (req, res, next) => {
  try {
    const filters = { status: req.query.status, decision: req.query.decision, category: req.query.category };
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
  try { res.send(evalPage({ runs: await store.evalRuns(), posthog: ph })); } catch (e) { next(e); }
});

adminRouter.post('/reset', async (req, res, next) => {
  try {
    let seed = [];
    try { seed = JSON.parse(await fs.readFile(path.resolve(import.meta.dirname, '../../data/seed.json'), 'utf8')); } catch {}
    await store.resetDemo(seed);
    res.redirect('/admin');
  } catch (e) { next(e); }
});
