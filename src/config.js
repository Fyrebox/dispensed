import 'dotenv/config';

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 3000),
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
    embedModel: process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small',
  },
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/triage',
  chroma: {
    url: process.env.CHROMA_URL || 'http://localhost:8000',
    collection: process.env.CHROMA_COLLECTION || 'kb_chunks',
  },
  admin: {
    user: process.env.ADMIN_USER || 'admin',
    pass: process.env.ADMIN_PASS || 'change-me',
  },
  posthog: {
    key: process.env.POSTHOG_KEY || '',
    host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
  },
  jurisdictions: ['AU', 'UK', 'NZ'],
};
