import OpenAI from 'openai';
import { config } from '../config.js';

let client;
function getClient() {
  if (!config.openai.apiKey) throw new Error('OPENAI_API_KEY is not set');
  if (!client) client = new OpenAI({ apiKey: config.openai.apiKey });
  return client;
}

export async function embed(texts) {
  const input = Array.isArray(texts) ? texts : [texts];
  const res = await getClient().embeddings.create({ model: config.openai.embedModel, input });
  return {
    vectors: res.data.map((d) => d.embedding),
    tokens: res.usage?.total_tokens ?? 0,
  };
}

/**
 * One structured-output call. Returns the parsed object plus the numbers we log
 * on every agent message (latency, tokens). Throws if the model refuses or the
 * output does not match the schema — callers treat that as an escalation.
 */
export async function structured({ name, schema, system, user }) {
  const started = Date.now();
  const res = await getClient().responses.parse({
    model: config.openai.model,
    input: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    text: { format: { type: 'json_schema', name, schema, strict: true } },
  });
  const parsed = res.output_parsed;
  if (!parsed) throw new Error(`No structured output for ${name}`);
  return {
    data: parsed,
    latency_ms: Date.now() - started,
    tokens_in: res.usage?.input_tokens ?? 0,
    tokens_out: res.usage?.output_tokens ?? 0,
    model: res.model,
  };
}

// Approximate pricing used only for the "cost per message" metric. Stated as an
// assumption in the metrics tab; update when the real rate card is known.
export const PRICE_PER_MTOK = { input: 1.25, output: 10.0, embed: 0.02 };
export function estimateCostUsd({ tokens_in = 0, tokens_out = 0, embed_tokens = 0 }) {
  return (
    (tokens_in * PRICE_PER_MTOK.input + tokens_out * PRICE_PER_MTOK.output + embed_tokens * PRICE_PER_MTOK.embed) /
    1_000_000
  );
}
