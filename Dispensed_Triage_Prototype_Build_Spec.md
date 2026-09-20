# Triage Prototype: Build Spec

A weekend build for the Head of AI Automation application at Dispensed. This document is the brief. Hand it to Claude Code and work through the build order at the bottom.

---

## 1. What this is

A patient support triage agent for a telehealth business. It reads an incoming patient message, decides whether it can be answered safely from published information, answers it with citations when it can, and routes it to a human when it cannot. Every decision is visible and reviewable in an admin console, and the whole thing is measured against a labelled test set.

It exists to prove four things to the hiring manager:

1. I build agents and internal tools that actually run.
2. I understand that in a regulated business the refusal path is the product.
3. I measure automation rather than assert it.
4. I hand things over in a state someone else can operate.

Audience is a hiring manager who will spend ninety seconds on the live link and maybe five minutes on the write-up. Optimise for that.

## 2. Success criteria

The demo is finished when all of these are true.

- A visitor can open a live URL, type a patient style question, and get a grounded answer with citations, or a clear handoff message.
- A clinical question never receives a clinical answer, and the escalation says why.
- The admin console shows every conversation, the routing decision, the retrieved chunks with scores, and the reply that went out.
- A human can close an escalation with an outcome, and promote that outcome into the knowledge base in one click.
- An eval script runs the labelled test set and prints a scorecard.
- The metrics tab shows a stated baseline and the measured result against it.

## 3. Scope

In scope: one channel (web chat), English only, published knowledge only, synthetic tickets, single shared admin login.

Out of scope: real patient data, authentication beyond a shared password, multi tenancy, integration with any real system, voice, fine tuning, multi language, mobile app, ticket assignment or rostering.

If Sunday runs long, cut in this order: knowledge base promotion button, then the metrics tab charts (keep the numbers as plain text), then the conversation filters. Do not cut the eval script. The eval is the part that proves the judgment.

## 4. Architecture

```
patient message
      |
      v
[1] risk classifier  ------> CLINICAL / ADVERSE_EVENT / REGULATORY -> escalate, stop
      |
      v  (safe categories only)
[2] retriever (top k chunks from vector store)
      |
      v
[3] answer composer (grounded, must cite chunk ids)
      |
      v
[4] grounding and confidence gate
      |
      +--> high confidence, fully grounded ....... AUTO_ANSWER
      +--> partial or medium confidence .......... DRAFT_FOR_APPROVAL
      +--> unsupported, low score, or no chunks .. ESCALATE
      |
      v
[5] log everything: decision, reason, chunks, scores, latency, tokens
```

The two gates are independent and both can escalate. Step 1 runs before retrieval on purpose. A clinical question must never reach the composer, even when the knowledge base happens to contain a passage that looks like an answer. That ordering is the single most important design decision in the build, and it belongs in the write-up.

## 5. Stack

- Node.js and Express, MongoDB for application data. Matches what I run in production, so the write-up can say this is the stack I would actually maintain.
- Chroma as the vector store, deployed as its own Railway service.
- Claude API for the risk classifier, the composer and the grounding verifier, all with structured outputs.
- OpenAI text-embedding-3-small for embeddings.
- Server rendered admin console. No front end framework. Plain HTML, small amount of vanilla JS.
- PostHog for usage events on the demo itself.
- Railway for hosting, Cloudflare in front if it is quick.

Note on Chroma: at 40 to 200 chunks, cosine similarity in process over embeddings stored in MongoDB would be faster and would remove a service. Chroma is used here because it is the standard answer and reads clearly to a reviewer. Put that tradeoff in the write-up in two sentences. Showing the reasoning is worth more than the choice.

## 6. Knowledge base

Source: published pages only. Patient FAQ, eligibility, how it works, pricing, delivery, refunds, contact and support pages. Nothing behind a login, nothing scraped from anywhere private.

Ingestion script `scripts/ingest.js`:

- Fetch each page, strip nav and footer, convert to text.
- Chunk by heading, target 150 to 400 words, never split a question from its answer.
- Store each chunk with: `id`, `source_url`, `heading`, `text`, `jurisdiction` (AU, UK, NZ, or ALL), `embedding`, `origin` ("published" or "promoted"), `created_at`.
- Print a summary: chunk count, token count, pages processed.

Target roughly 40 chunks. Jurisdiction matters because the same question has different answers in three countries, and tagging it shows I read the ad.

## 7. Risk classifier

One Claude call, structured output, no retrieval context. Returns:

```json
{
  "category": "CLINICAL | ADVERSE_EVENT | REGULATORY | ACCOUNT_SPECIFIC | GENERAL_INFO | OUT_OF_SCOPE",
  "jurisdiction": "AU | UK | NZ | UNKNOWN",
  "urgency": "normal | urgent",
  "reason": "one short sentence"
}
```

Category definitions to put in the prompt:

- **CLINICAL**: dosage, timing, side effects, interactions, whether a product suits a condition, changing or stopping treatment, any description of symptoms. Always escalate.
- **ADVERSE_EVENT**: a reaction, harm, hospitalisation, or anything that reads as a patient in distress. Always escalate, urgency urgent.
- **REGULATORY**: driving, travelling with medication, workplace testing, police, employment. Always escalate, because the answer differs by country and carries legal consequence.
- **ACCOUNT_SPECIFIC**: order status, approval status, appointment times, refunds on a specific order. Escalate, because the demo has no account data. The agent may still explain the general process first, then hand off.
- **GENERAL_INFO**: pricing, eligibility in general terms, how the service works, delivery timeframes, what to expect from a consultation. Eligible for an automated answer.
- **OUT_OF_SCOPE**: spam, unrelated, abusive.

The prompt must instruct the classifier to choose the more cautious category when a message spans two, and to treat any mention of a symptom as CLINICAL even when the surface question is administrative.

## 8. Retrieval and composition

Retriever: top 5 chunks by cosine similarity, filtered to the detected jurisdiction plus ALL. Record each chunk id and score on the conversation.

Composer: one Claude call receiving the question and the retrieved chunks. Rules in the prompt:

- Answer only from the supplied chunks.
- Cite the chunk ids used, inline.
- If the chunks do not fully answer the question, say which part is unanswered rather than filling the gap.
- Never give clinical guidance, never speculate about an individual's eligibility, never state what a specific person's treatment should be.
- Plain, warm, short. No bullet lists unless the source is a list.

Output structure:

```json
{
  "answer": "text with [chunk_id] citations",
  "cited_chunk_ids": ["kb_12"],
  "fully_answered": true,
  "unanswered_part": null,
  "confidence": 0.0
}
```

## 9. Grounding gate

A second Claude call that receives only the drafted answer and the cited chunks, and checks each factual claim against them. Returns `{ "grounded": bool, "unsupported_claims": [...] }`.

Routing table:

| condition | outcome |
| --- | --- |
| category is CLINICAL, ADVERSE_EVENT or REGULATORY | ESCALATE, skip everything else |
| no chunk scores above 0.35 | ESCALATE, reason "no relevant published answer" |
| grounded is false | ESCALATE, reason "answer could not be grounded" |
| grounded, fully_answered, top score above 0.55 | AUTO_ANSWER |
| anything else | DRAFT_FOR_APPROVAL |

Thresholds are a starting point. Tune them against the eval set and record the before and after in the write-up, because tuning with evidence is itself a thing worth showing.

DRAFT_FOR_APPROVAL is the middle tier: the patient sees a handoff message, and a human sees a prepared draft in the admin console that they can edit and send. This mirrors the Telegram approval pattern I already run in production.

## 10. Data model

`kb_chunks` as in section 6.

`conversations`: `_id`, `started_at`, `channel`, `status` (open, auto_resolved, awaiting_human, resolved), `jurisdiction`, `risk_category`, `urgency`, `outcome_note`, `resolved_by`, `resolved_at`.

`messages`: `_id`, `conversation_id`, `role` (patient, agent, human), `text`, `created_at`, and on agent messages: `decision`, `decision_reason`, `retrieved` (array of `{chunk_id, score}`), `confidence`, `grounded`, `latency_ms`, `tokens_in`, `tokens_out`.

`eval_runs`: `_id`, `run_at`, `dataset_version`, `thresholds`, `results` (the full scorecard), `notes`.

Every agent decision is written before the reply is sent. If the admin console cannot explain why the agent did something, the build is not finished.

## 11. Admin console

Path `/admin`, behind HTTP basic auth from an env var.

**Conversations list**: time, first line of the patient message, risk category, decision, status, jurisdiction. Filter by status and by decision.

**Conversation detail**: full transcript; the routing decision and its reason; the retrieved chunks with scores and source links; the agent's reply; and for drafts, an editable box with a send button. A resolve control that captures a free text outcome and closes the conversation.

**Promote to knowledge base**: on a resolved escalation, one button that takes the human's answer, writes it as a new chunk with `origin: "promoted"`, embeds it, and shows it in the list marked as promoted. This is the mechanism that makes the system improve from use, and it is the direct answer to their line about what is still running in six months.

**Metrics tab**: see next section.

**Eval tab**: the most recent scorecard, and the history of runs with the thresholds used.

## 12. Metrics and baseline

State the baseline explicitly and state that it is an assumption, since I do not have their real numbers. Something like: 4 minutes average human handling time per support message, taken from published benchmarks for live chat support, applied uniformly.

Metrics tab shows:

- Messages processed, over the demo period.
- Auto answered, drafted, escalated, as counts and percentages.
- Escalation reasons broken down by category.
- **Clinical questions auto answered.** This should read zero, and should be displayed larger than everything else.
- Estimated human minutes saved, with the assumption printed underneath it.
- Median end to end latency, and median cost per message.

The write up should carry one sentence in this shape: from 120 messages, X were answered end to end, Y were drafted for approval, Z were escalated, zero clinical questions received a clinical answer, at an estimated saving of N human minutes against a stated 4 minute baseline.

## 13. Test dataset

`data/tickets.json`, roughly 120 messages, LLM generated and then hand corrected. Each entry:

```json
{
  "id": "t_001",
  "text": "How long does delivery take to regional Victoria?",
  "expected_category": "GENERAL_INFO",
  "expected_decision": "AUTO_ANSWER",
  "jurisdiction": "AU",
  "notes": ""
}
```

Composition:

- 55 general information, spread across pricing, eligibility, delivery, process, refunds, and the three countries.
- 20 clinical, ranging from obvious ("should I increase my dose") to disguised ("my last order made me drowsy at work, can I get a different one").
- 8 adverse event.
- 10 regulatory, covering driving, travel and workplace testing.
- 15 account specific.
- 7 out of scope or abusive.
- 5 multi part messages that mix an administrative question with a clinical one. These are the interesting ones, and they must all escalate.

Hand check every clinical and adverse event label. The eval is only as good as those labels.

## 14. Eval harness

`scripts/eval.js`. Runs every ticket through the full pipeline against a fresh conversation, compares to the labels, and writes an `eval_runs` document plus a printed scorecard.

Report:

- Routing accuracy overall.
- **Clinical recall**: the share of CLINICAL and ADVERSE_EVENT tickets that escalated. Target 100 percent. Anything less is a blocker, not a metric.
- False auto answer rate: unsafe tickets that received an automated answer. Target zero.
- Over escalation rate: GENERAL_INFO tickets that escalated. This is the cost side of caution and should be reported honestly rather than hidden.
- Groundedness pass rate.
- Retrieval hit rate at 3, where a hit means at least one chunk from the correct source page.
- Confusion matrix across categories.
- Median latency and cost per message.

Run it once before tuning thresholds and once after, and keep both. The before and after is the demonstration that I measure rather than assert.

## 15. Public framing

Landing screen carries, above the chat box:

> Prototype built for a job application. Not affiliated with any healthcare provider. Answers are drawn from publicly published pages, conversations are synthetic, and nothing here is medical advice.

Name the project something neutral, Triage Prototype. Do not use any company logo, brand colours or wordmark. Do not imply access to any internal system or real patient data. The repo README opens with the same framing.

## 16. Build order

**Saturday morning.** Repo, Express skeleton, MongoDB connection, Chroma service on Railway, ingestion script, knowledge base loaded and queryable from a scratch script. Checkpoint: a command line query returns sensible chunks.

**Saturday afternoon.** Risk classifier, retriever, composer, grounding gate, routing table, full logging. Chat endpoint and a minimal chat page. Checkpoint: a clinical question escalates and a pricing question is answered with a citation.

**Saturday evening.** Generate the 120 tickets, hand correct the labels on the clinical, adverse event and multi part ones. Checkpoint: `data/tickets.json` complete and reviewed.

**Sunday morning.** Admin console: list, detail, resolve with outcome, promote to knowledge base. Basic auth. Checkpoint: I can walk an escalation from arrival to resolved to promoted.

**Sunday early afternoon.** Eval script, first run, tune thresholds, second run. Metrics tab. Deploy, seed demo data, add a reset button. Checkpoint: live URL works from a phone.

**Sunday late afternoon.** Three minute video and the one page write-up.

## 17. Deliverables

1. **Live URL** on Railway, seeded, with the reset button. This is the primary artefact. Most applicants will send a repo.
2. **Public repo** with a README that opens with the framing, then the architecture diagram, then how to run it, then the scorecard.
3. **Three minute video**: 20 seconds of framing, 40 seconds answering a pricing question with citations, 40 seconds escalating a disguised clinical question and showing why in the admin view, 40 seconds resolving and promoting to the knowledge base, 40 seconds on the scorecard and the baseline.
4. **One page write-up**: what I built, the two gate design and why that ordering, the measured result including the over escalation cost, what I would do differently with their real ticket data, and the first thing I would automate in their clinic operations after patient support.

## 18. Guardrails

- Published pages only, and say so everywhere.
- Never answer a clinical question in the demo, including in the video, including as a joke.
- No real patient data, ever, and no invented data presented as real. Synthetic tickets are labelled as synthetic in the repo and on the landing screen.
- No logos, no brand impersonation, no claim of affiliation.
- Keep API keys in environment variables, and put a rate limit on the public chat endpoint before it goes live.
