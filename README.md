# Triage Prototype

> Prototype built for a job application. Not affiliated with any healthcare provider. Answers are drawn from publicly published pages, conversations are synthetic, and nothing here is medical advice.

A patient-support triage agent for a telehealth business. It reads an incoming message, decides whether it can be answered safely from published information, answers with citations when it can, and routes to a human when it cannot. Every decision is visible in an admin console, and the whole thing is measured against a labelled test set.

In a regulated business the refusal path is the product. This build is organised around that.

## Architecture

```
patient message
      |
      v
[1] risk classifier  ------> CLINICAL / ADVERSE_EVENT / REGULATORY -> escalate, stop
      |                      (runs BEFORE retrieval, on purpose)
      v  (safe categories only)
[2] retriever (top 5 chunks from Chroma, filtered to jurisdiction + ALL)
      |
      v
[3] answer composer (grounded, must cite chunk ids)
      |
      v
[4] grounding and confidence gate
      |
      +--> grounded, fully answered, top score > 0.55 .... AUTO_ANSWER
      +--> partial or medium confidence ................. DRAFT_FOR_APPROVAL
      +--> unsupported, score < 0.35, or no chunks ...... ESCALATE
      |
      v
[5] log everything: decision, reason, chunks, scores, latency, tokens — before the reply is sent
```

The two gates are independent and both can escalate. Gate 1 runs before retrieval so a clinical question never reaches the composer, even when the knowledge base contains a passage that looks like an answer (it does: the UK site publishes dosing FAQs, and they are in the store).

**Jurisdiction.** The knowledge base covers three published sites (AU, UK, NZ) because the same question has different answers in each: shipping is $9.95 under $129 in AU, free over £99 in the UK, always free in NZ. In production the country comes from Cloudflare's `cf-ipcountry` header; the demo page has a toggle to test the others. Precedence: toggle → country named in the message → header → inferred from phrasing → UNKNOWN (answers per country, drafted for a human).

## Stack

Node 22 + Express, MongoDB (application data), Chroma (vectors, own service), OpenAI `gpt-5.6-luna` for the classifier, composer and grounding verifier (structured outputs), `text-embedding-3-small` for embeddings, server-rendered HTML with a little vanilla JS, PostHog for demo usage events, Railway for hosting.

Chroma note: at ~200 chunks, cosine similarity in-process over embeddings stored in MongoDB would be faster and remove a service. Chroma is used because it is the standard answer and reads clearly to a reviewer.

## Run it

```bash
cp .env.example .env      # add OPENAI_API_KEY, set ADMIN_PASS
npm install
# local services
chroma run --path .data/chroma --port 8000
mongod --dbpath .data/mongo
# knowledge base
npm run ingest            # fetch, chunk, embed, store (published pages only; see data/sources.json)
node scripts/query.js "how much is shipping" UK
# app
npm run dev               # http://localhost:3000  ·  admin at /admin (basic auth)
# eval
npm run eval -- --tag before
npm run eval -- --floor 0.30 --auto 0.50 --tag after
npm test
```

## Scorecard

_Filled in after the first eval runs. Both the before-tuning and after-tuning runs are kept in `data/eval/` and on the admin Eval tab._

## Guardrails

Published pages only. No clinical question is ever answered, including in the demo video. No real patient data; synthetic tickets are labelled as such in `data/tickets.json` and on the landing page. No logos, wordmarks or brand assets; the visual style borrows type, colour and layout conventions only. API keys in environment variables; the public chat endpoint is rate limited.
