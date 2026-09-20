# Triage Prototype

> Prototype built for a job application. Not affiliated with any healthcare provider. Answers are drawn from publicly published pages, conversations are synthetic, and nothing here is medical advice.

A patient-support assistant for a telehealth business. It answers questions from the clinic's published pages only, with a citation on every fact, says so when the pages don't cover something, and logs every retrieval and reply in an admin console where a human can fill the gaps and promote answers back into the knowledge base.

## Architecture

```
patient message  (+ country: test toggle, else Cloudflare cf-ipcountry header, else all three)
      |
      v
[1] retriever: Chroma top-k for that jurisdiction, over-fetched by cosine,
    re-ranked with a lexical-overlap blend (embeddings alone confuse
    "is delivery free" with "free consultations")
      |
      v
[2] composer (gpt-5.6-luna, structured output): answers only from the
    retrieved passages, cites chunk ids inline, reports what it could
    not answer → ANSWERED / PARTIAL / NOT_COVERED
      |
      v
[3] log everything: retrieved chunks with scores, citations, confidence,
    latency, tokens, cost — before the reply is sent
      |
      v
admin console: conversations, gaps, resolve with a human answer,
promote it into the knowledge base in one click, metrics, eval history
```

**Jurisdiction.** The knowledge base covers three published sites (AU, UK, NZ) because the same question has different answers in each: shipping is $9.95 under $129 in AU, free over £99 in the UK, always free in NZ. In production the country comes from Cloudflare's `cf-ipcountry` header; the demo page has a toggle to test the others. With no country, the top passages from each country are retrieved and the reply says how the answer differs.

**Production note — the risk gate.** The first version of this build put a risk classifier in front of retrieval: clinical, adverse-event and regulatory questions were routed to a human before any passage was looked up, and a grounding verifier checked every claim after composition. Measured on a 120-ticket labelled set it hit 100% clinical recall with zero unsafe auto-answers — and answered only 35 of 54 general questions automatically, drafting or escalating the rest. It was too conservative to demonstrate the retrieval, so it was removed from this demo. In a regulated business that gate is the product and goes back in front of this pipeline before it touches a real patient; the code for it is in the git history (commits up to `d4b18e9`).

## Stack

Node 22 + Express, MongoDB (application data), Chroma (vectors, own Railway service, private network only), OpenAI `gpt-5.6-luna` for composition (structured outputs) and `text-embedding-3-small` for embeddings, server-rendered HTML with a little vanilla JS, PostHog for demo usage events, Railway for hosting.

Chroma note: at ~230 chunks, cosine similarity in-process over embeddings stored in MongoDB would be faster and remove a service. Chroma is used because it is the standard answer and reads clearly to a reviewer.

## Knowledge base

`data/sources.json` lists 33 published pages (FAQ, how it works, pricing, delivery, terms, refunds, complaints, conduct, contact, privacy) across the AU, UK and NZ sites. `scripts/ingest.js` fetches them, strips chrome, chunks by heading (one chunk per FAQ question and answer, never split; other sections merged to 60–400 words), de-duplicates the FAQ block that each site repeats on several pages, embeds, and writes to Chroma plus a MongoDB mirror. Result: 231 chunks (AU 74, UK 110, NZ 47), snapshot committed in `data/kb_chunks.json` so a fresh deploy loads without re-fetching (admin → Knowledge base → Load published snapshot).

## Run it

```bash
cp .env.example .env      # add OPENAI_API_KEY, set ADMIN_PASS
npm install
# local services
chroma run --path .data/chroma --port 8000
mongod --dbpath .data/mongo
# knowledge base
npm run ingest            # fetch, chunk, embed, store
node scripts/query.js "how much is shipping" UK
# app
npm run dev               # http://localhost:3000  ·  admin at /admin (basic auth)
# eval + tests
npm run eval -- --tag "my change"
npm test
```

## Scorecard

54 synthetic questions, each hand-labelled with the published page that answers it (`data/tickets.json`), full pipeline, `gpt-5.6-luna`. Runs are kept in `data/eval/` and on the admin Eval tab.

| metric | rag v1, hybrid re-rank |
| --- | --- |
| Retrieval hit@3 (labelled page in top 3) | 91% |
| Retrieval hit@5 | 94% |
| Reply cites the labelled page | 85% |
| Fully answered | 89% |
| Partly answered | 9% |
| Not covered | 2% |
| Median latency / cost per message | 2.2 s / $0.0031 |

The misses are mostly the same fact published on two pages (the AU $9.95 fee is on the FAQ and the pricing page; the composer cited the other one), plus two questions the pages genuinely don't answer (regional delivery time, courier name). Those show up on the Metrics tab as gaps, which is the point.

## Guardrails

Published pages only. No real patient data; synthetic questions are labelled as such in `data/tickets.json` and on the landing page. No logos, wordmarks or brand assets; the visual style borrows type, colour and layout conventions only. API keys in environment variables; the public chat endpoint is rate limited; Chroma is not exposed publicly.
