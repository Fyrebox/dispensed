import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { chatPage } from '../views/chat.js';
import { runPipeline } from '../pipeline/run.js';

export const chatRouter = Router();

const CF_TO_JUR = { AU: 'AU', GB: 'UK', NZ: 'NZ' };
const cfCountry = (req) => req.get('cf-ipcountry') || '';

chatRouter.get('/', (req, res) => {
  res.send(chatPage({ posthog: config.posthog, detected: CF_TO_JUR[cfCountry(req).toUpperCase()] || null }));
});

const limiter = rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many messages, try again in a minute.' } });

chatRouter.post('/api/chat', limiter, async (req, res, next) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text is required' });
    if (text.length > 2000) return res.status(400).json({ error: 'message too long' });
    const override = config.jurisdictions.includes(req.body?.jurisdiction) ? req.body.jurisdiction : undefined;
    const conversationId = typeof req.body?.conversation_id === 'string' && /^[a-f0-9]{24}$/.test(req.body.conversation_id) ? req.body.conversation_id : undefined;
    const out = await runPipeline({ text, conversationId, override, cfCountry: cfCountry(req) });
    // Patient-facing payload: reply, decision, citations. Never the retrieved chunk bodies or the draft.
    res.json({
      conversation_id: out.conversation_id,
      text: out.text,
      decision: out.decision,
      jurisdiction: out.jurisdiction,
      jurisdiction_source: out.jurisdiction_source,
      citations: out.citations,
    });
  } catch (e) {
    next(e);
  }
});
