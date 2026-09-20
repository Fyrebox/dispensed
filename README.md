# Triage Prototype — a support assistant for Dispensed

> Built for a job application. Not affiliated with Dispensed or any healthcare provider. Answers come from Dispensed's publicly published pages only, the conversations are made up, and nothing here is medical advice.

**Try it:** https://dispensed.up.railway.app — the admin console is at `/admin` (password in the cover letter).

**Take-down.** This repository and the live demo exist for one job application. They will be deleted 60 days after submission regardless. If Dispensed would like them removed sooner, say so (reply to the application email) and they will be gone the same day.

## What it is

A chat box a patient could use to ask the questions that land in support every day: how much is delivery, is the first consult free, what happens if I miss my appointment, who actually sends my medication, can I use my own pharmacy.

It answers from Dispensed's own published pages — the FAQ, how-it-works, pricing, delivery, terms, refund and complaints pages of the Australian, UK and New Zealand sites — and puts a link to the source next to every fact. If the pages don't cover something, it says so instead of guessing. It knows the answers differ by country (shipping is $9.95 under $129 in Australia, free over £99 in the UK, always free in New Zealand) and picks the right one from where the visitor is, or from the country toggle on the page.

Behind it is an admin console. Every conversation is recorded with what was looked up and why the reply came out the way it did. Questions the pages couldn't answer show up as a list of gaps. A person can write the real answer and, with one click, add it to what the assistant knows — so the next patient who asks gets it straight away. That's the loop that makes it better every week rather than something that decays.

## The only technical bit you need

It's a RAG (retrieval-augmented generation) assistant over public data: the published pages are chunked and indexed, the most relevant passages are found for each question, and a language model writes a short reply using only those passages, with citations. There's a small test set of 54 questions each tagged with the page that answers it; the current build finds the right page in its top three results 91% of the time and fully answers 89% of them, at about two seconds and a third of a cent per message.

A first version also had a safety gate in front: anything clinical, anything that sounded like a bad reaction, and anything about driving or travelling with medication was sent to a human before the assistant looked anything up. It worked (it never let a clinical question through in testing) but it was so cautious it made the chat feel useless for a demo, so it's switched off here. For real patients it would go back in — in a regulated business the refusal path is the product.

## Where this goes next

The assistant only knows what's public. The useful version knows the patient. In rough order of value:

1. **Your own account, safely.** Verify the patient with a one-time code to their phone, then answer "where's my order", "has my script been approved", "when's my next appointment" from their actual record, instead of handing off.
2. **Subscriptions.** Check whether a plan is active, when it was last renewed and when the next charge is, pause it, resume it, or renew it — the account questions that make up a large share of support volume.
3. **Repeats and follow-ups.** Book or move the monthly review, request a repeat, and get a nudge before a script runs out, all in the chat.
4. **Privacy requests, in the chat.** Dispensed operates under the Australian Privacy Act, UK GDPR and the NZ Privacy Act, and the privacy policies already promise patients access to their data and erasure on request. Once the patient is verified (same one-time code as above), the assistant can take those requests directly: "send me everything you hold about me" produces the export; "delete my records" opens an erasure request with a confirmation step, a clear note on what must be kept for clinical and legal retention, and a ticket the privacy officer signs off. Every request is logged with who asked, how they were verified, and what was done — the audit trail regulators ask for. Ordinary conversations get a retention limit too, so the assistant isn't quietly building a store of patient messages.
5. **The safety gate, for real.** Put the clinical / adverse-event / regulatory triage back in front, tuned on real ticket history rather than made-up questions, with a human approval queue for anything borderline.
6. **A phone app.** Dispensed doesn't have an iPhone or Android app yet. The same assistant, plus order tracking, appointment reminders and a repeat-request button, is most of what a patient app needs to be.
7. **Other channels.** The same brain behind the website live chat, email and SMS, so a patient gets one consistent answer wherever they ask.
8. **Learning from the humans.** Every answer a support agent writes for a gap becomes something the assistant can answer next time — that's already built; the next step is measuring how much of the volume it takes over month by month.

## Running it yourself

```bash
cp .env.example .env      # add OPENAI_API_KEY, set ADMIN_PASS
npm install
npm run ingest            # fetch the published pages, index them
npm run dev               # http://localhost:3000
```

Needs Node 22, MongoDB and a Chroma server (both run locally with one command each; see `.env.example`). Hosted on Railway. Stack: Node/Express, MongoDB, Chroma, OpenAI.
