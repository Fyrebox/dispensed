# Triage Prototype — Implementation Plan

Companion to `Dispensed_Triage_Prototype_Build_Spec.md`. The spec is the brief; this document records what was found on the published sites, the decisions that differ from the spec, and the concrete build order.

---

## 0. Decisions that differ from the spec

| Spec says | We do | Why |
| --- | --- | --- |
| Claude API for classifier / composer / grounding | **OpenAI `gpt-5.6-luna`** for all three, via the Responses API with JSON-schema structured outputs | Cyril's call. Also collapses to one vendor, since embeddings are already OpenAI `text-embedding-3-small`. Model id lives in `OPENAI_MODEL` env var; first task on day one is a one-line smoke call to confirm the id is live on the account. |
| Neutral look, no brand colours | **Same visual language as dispensed.com.au, no brand assets** | See §3. We copy the *style* (type, palette, pill buttons, card layout) and keep the spec's guardrails: no logo, no wordmark, no illustrations, name is "Triage Prototype", disclaimer above the chat box. Flagging this as a judgement call: it is the one place the spec and the brief pull in different directions. |
| ~40 chunks, one site | **~70–90 chunks across AU, UK, NZ** | There are three separate published sites, and the same question has different answers on each (see §1). Jurisdiction tagging only means something if all three are in the store. |
| Chroma | Chroma, as specified | Keep the write-up's two-sentence tradeoff (in-process cosine over Mongo would be faster at this size). |

---

## 1. What the published pages actually say (research done 20 Sep 2026)

Three separate public sites, one per jurisdiction. All three follow the same dispensing model:

**Dispensed is not the pharmacy.** In every jurisdiction: questionnaire → free clinician consult → if approved, prescription goes to a *partner pharmacy* → pharmacy sends a payment link → pharmacy dispatches. The sale is between patient and pharmacy; Dispensed "facilitates" payment. Refunds on medication follow the pharmacy's terms, and dispensed medicines are generally non-refundable once dispatched (damaged / wrong item must be reported within 3 days; pharmacy covers return freight). This is the single most important fact for the knowledge base, because a large share of "account-specific" tickets (where's my order, can I return this) are really "ask the pharmacy" — and the agent must know that without knowing any order.

### AU — dispensed.com.au
- Pages: `/faqs`, `/info/how-dispensed-works`, `/info/pricing`, `/info/delivery`, `/terms-conditions`, `/community-guidelines`, `/info/contact-us`, `/about-us`, `/privacy-policy`
- Free initial consult, no referral, 18+, plans from **$99/month**, monthly reviews free, cancel any time, no lock-in.
- Shipping: **$9.95 flat below $129**, free above. Plain packaging. **Signature required 9am–5pm Mon–Fri**; missed deliveries go to nearest post office.
- Timeframe: delivery page says **4–5 working days**; FAQ says **2–5 business days**. (Inconsistency on the live site — chunk both, cite both; a good thing for the composer to surface rather than paper over.)
- Prescriptions issued under **Victorian** law; follow-up consult required at least every **6 months**; missed/late-cancelled (<24h) appointment charged at consult cost.
- Support Mon–Fri 9–5, live chat, `support@dispensed.com.au`. Community guidelines: abuse / spam / fraud → removal.

### UK — dispensed.co.uk
- Pages: `/info/how-does-dispensed-work`, `/info/how-much-does-dispensed-cost`, `/info/understanding-our-delivery-process`, `/faqs/{consuming-dosing, medical-uses, medication, legal-status, work-driving-holidays, medical-cannabis-card, care-quality-commission-cqc, free-consultations}`, `/refund-policy`, `/complaints-leaflet`, `/zero-tolerance-policy`, `/terms-conditions`, `/about-us`, `/info/contact`
- **CQC-regulated**, Plantmed Clinic UK Ltd, specialist doctors, Summary Care Record pulled from GP with consent, discharge letter requested if switching clinics.
- Consults free (normally £19); **£19 non-attendance fee** <48h notice; from **8 July 2026** new patients pay a refundable **£1 verification fee**.
- Medication: flower ~**£8/g**, oils from **£80**; **free delivery over £99**; pharmacy does payment, address and **ID** checks.
- Timeframe: how-it-works says **3–5 working days**; delivery page says **5–8 working days from consult**. Thursday 3pm cutoff, no weekend dispatch. Follow-up at ~**28 days**.
- Refunds within 30 days by email, to original method only. Complaints: within 12 months, acknowledged in 3 working days, escalate to CQC. Zero-tolerance policy on abuse.
- **Regulatory content is published**: driving (zero-tolerance THC, must notify DVLA), work (fit-for-duty), travel (embassy check, doctor's letter via support email), police stops, medical cannabis card (not legally required). These chunks *exist* in the KB but REGULATORY tickets still escalate — that's the point.
- **Clinical content is published**: dosing/titration, missed dose, storage, interactions, effects duration. Same logic: in the KB, never reaches the composer.

### NZ — dispensed.co.nz
- Pages: `/info/how-does-dispensed-work`, `/info/how-much-does-dispensed-cost`, `/info/understanding-our-delivery-process`, `/terms-conditions`, `/community-guidelines`, `/privacy-policy`, `/info/contact`
- Plantmed Clinic NZ Ltd, MCNZ-registered doctors, 18+, same-day consults, free initial + follow-ups.
- **$29 missed-consult fee** <48h. Plans **$79–$140/month** ($2.60–$4.70/day). **$40 script request fee** if using a non-partner pharmacy.
- **Free tracked shipping via NZ Post**; 4–5 working days from payment + hard-copy script at pharmacy; Friday 12pm cutoff; signature 9–5 Mon–Fri.

### Things that differ by country (the reason jurisdiction tagging matters)
| | AU | UK | NZ |
| --- | --- | --- | --- |
| Shipping | $9.95 under $129 | free over £99 | always free |
| Missed consult | consult cost, <24h | £19, <48h | $29, <48h |
| Plan price | from $99/mo | pay per product (£8/g) | $79–140/mo |
| Delivery ETA | 2–5 / 4–5 days | 3–5 / 5–8 days | 4–5 days |
| Regulator | AHPRA-registered | CQC | MCNZ |

---

## 2. Stack (final)

- **Node 22 + Express**, server-rendered HTML (template literals or EJS), vanilla JS only where needed.
- **MongoDB** (Railway plugin or Atlas free tier): `kb_chunks` (mirror + metadata), `conversations`, `messages`, `eval_runs`.
- **Chroma** as its own Railway service; one collection `kb_chunks`, cosine space, metadata `{jurisdiction, source_url, heading, origin, topic}`.
- **OpenAI**: `gpt-5.6-luna` (classifier, composer, grounding verifier — Responses API, `text.format: json_schema`, `strict: true`), `text-embedding-3-small` (1536-d) for chunks, queries and promoted answers.
- **PostHog** JS snippet on the public page (`chat_sent`, `decision_shown`, `admin_opened`).
- **Railway** for web + Chroma + Mongo; `express-rate-limit` on `POST /api/chat` before go-live; basic auth on `/admin`.

---

## 3. Visual style (from dispensed.com.au, measured)

- **Fonts**: headings **Clash Display** (free via Fontshare; fallback `Outfit`), body **Poppins** 400/500/600.
- **Palette**: navy text/buttons `#010337`; mint `#D7F2E0`; green `#078E55`; cream `#F8F5F0` / `#F6F1EF` section backgrounds; white cards; soft pink `#FFDEDE` for alerts (reuse for escalation notices).
- **Components**: pill buttons (`border-radius: 56px`, navy fill, white text, Poppins 500); white rounded cards on cream; a green-dot status pill ("Clinicians available today" → ours reads "Prototype · synthetic data"); numbered 01/02/03 step list; generous whitespace, 48px H1.
- **Not copied**: logo, wordmark, illustrations, "Dispensed" name, Trustpilot/Google badges, chat bubble.
- Public page = one column: disclaimer banner → H1 "Triage Prototype" → chat card → three example prompts as chips (pricing AU, delivery UK, a disguised clinical one).
- Admin console uses the same tokens with a denser table layout.

---

## 4. Knowledge base / RAG design

`scripts/ingest.js`:
1. Page list is a JSON manifest (`data/sources.json`) with `{url, jurisdiction, topic}` — no crawling, only the URLs in §1.
2. Fetch → strip `header/nav/footer/script/style` → HTML-to-text keeping headings.
3. Chunk by heading. FAQ pages: **one chunk per Q+A pair** (never split). Info/policy pages: by H2/H3, merge until 150–400 words.
4. Embed, upsert to Chroma, mirror document to Mongo `kb_chunks` with `origin: "published"`.
5. Print: pages processed, chunks, tokens, per-jurisdiction counts.
6. Idempotent: chunk id = `kb_{jurisdiction}_{slug}_{n}`; re-run replaces.

Expected: AU ~25, UK ~40, NZ ~15 chunks, plus a handful of `ALL` chunks (the shared dispensing model, "Dispensed is not the pharmacy").

Retrieval: embed query → Chroma `query(n=5, where: {jurisdiction: {$in: [detected, "ALL"]}})`. If jurisdiction is `UNKNOWN`, query all three and the composer must either answer identically-true facts or say the answer depends on country and ask which — this will naturally land in DRAFT_FOR_APPROVAL, which is correct.

`scripts/query.js "<question>" [AU|UK|NZ]` — the Saturday-morning checkpoint.

---

## 5. Pipeline (unchanged from spec, GPT-backed)

```
message → [1] classify (no retrieval) → CLINICAL/ADVERSE_EVENT/REGULATORY → ESCALATE, stop
                                       → OUT_OF_SCOPE → polite decline, stop
                                       → ACCOUNT_SPECIFIC → retrieve general process, compose, force handoff
                                       → GENERAL_INFO → [2] retrieve → [3] compose → [4] ground → route
```

Routing table and thresholds exactly as spec §9 (0.35 floor, 0.55 auto). Chroma returns distances; convert to similarity `1 - d` so thresholds read as the spec writes them.

Three JSON schemas in `src/llm/schemas.js` (classifier, composer, grounder). Every call logs `latency_ms`, `tokens_in`, `tokens_out`, model id, and the raw JSON to the agent message *before* the reply is returned.

Handoff copy for each escalation category is fixed text (not generated), so a clinical escalation can never leak a clinical sentence.

---

## 6. Data model, admin, metrics, eval

As spec §10–14. Additions:
- `kb_chunks` mirror in Mongo carries `chroma_id` so the admin can list, show `origin`, and the promote button writes both stores.
- Metrics tab reads Mongo aggregates only; charts are `<meter>`/CSS bars, no chart lib (cheap to cut).
- Eval `scripts/eval.js --thresholds 0.35,0.55 --tag before|after`; retrieval hit@3 uses `source_url` on the ticket's expected page, so `data/tickets.json` gets an `expected_source_url` field.
- Reset button: drops conversations/messages, reseeds 20 curated conversations, leaves KB and eval runs alone.

Test set composition per spec §13, 120 tickets, spread across AU/UK/NZ. The disguised-clinical and multi-part tickets get written by hand using the actual FAQ content above (e.g. "My delivery's late and the oil made me dizzy last night, can I get flower instead?" → CLINICAL).

---

## 7. Build order

| Slot | Work | Checkpoint |
| --- | --- | --- |
| Sat AM | Repo, Express skeleton, Mongo + Chroma on Railway, `gpt-5.6-luna` smoke test, `data/sources.json`, `ingest.js`, `query.js` | `node scripts/query.js "how much is shipping" UK` returns the £99 chunk |
| Sat PM | Schemas, classifier, retriever, composer, grounder, router, logging, `POST /api/chat`, public chat page in §3 style | dose question escalates with reason; AU pricing question answered with `[kb_AU_pricing_1]` |
| Sat eve | Generate 120 tickets from §1 facts, hand-correct clinical / adverse / multi-part / regulatory | `data/tickets.json` reviewed |
| Sun AM | `/admin`: list + filters, detail, draft edit/send, resolve, promote-to-KB, basic auth | walk one escalation arrival → resolved → promoted → retrievable |
| Sun early PM | `eval.js` run 1, tune, run 2, metrics tab, deploy, seed, reset button, rate limit, PostHog | live URL on phone |
| Sun late PM | README (framing → diagram → run → scorecard), 1-page write-up, 3-min video | done |

Cut order if late: promote button → metric charts → list filters. Never the eval.

---

## 8. Open items to confirm before Sat AM

1. `gpt-5.6-luna` — confirm the exact model id on the account (smoke test will tell us).
2. Repo location: recommend outside Dropbox (`~/Projects/triage-prototype`) so `node_modules` doesn't sync. Public GitHub repo name `triage-prototype`.
3. Style call in §0/§3 — copying the look without the brand is the intended reading; say so if not.
4. Include the UK clinical/regulatory FAQ pages in the KB (recommended — it makes the gate-ordering demo real) or exclude them.
