import express from 'express';
import path from 'node:path';
import { config } from './config.js';
import { getDb } from './db.js';
import { chatRouter } from './routes/chat.js';
import { adminRouter } from './routes/admin.js';

const app = express();
app.set('trust proxy', 1); // Railway / Cloudflare in front
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(express.static(path.resolve(import.meta.dirname, '../public'), { maxAge: '1h' }));

app.get('/health', (req, res) => res.json({ ok: true, model: config.openai.model }));
app.use('/', chatRouter);
app.use('/admin', adminRouter);

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  const msg = err.message || 'Internal error';
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: msg });
  res.status(500).send(`<pre>${msg}</pre>`);
});

await getDb();
app.listen(config.port, () => console.log(`triage-prototype on http://localhost:${config.port} (model ${config.openai.model})`));
