import { layout, esc } from './layout.js';

export function chatPage({ posthog, detected }) {
  const body = `
<div class="banner">
  <strong>Prototype built for a job application.</strong> Not affiliated with any healthcare provider. Answers are drawn from publicly published pages, conversations are synthetic, and nothing here is medical advice.
</div>

<section class="hero">
  <span class="pill"><span class="dot"></span>Prototype · synthetic data · published pages only</span>
  <h1>Ask a question about the service.</h1>
  <p class="lede">A patient-support triage agent. It answers what published pages can answer, with citations, and hands everything else to a human — every clinical question, every time.</p>
</section>

<section class="card chat" id="chat">
  <div class="chat-head">
    <div>
      <div class="chat-title">Support chat</div>
      <div class="chat-sub">Country <span class="muted">(detected: ${esc(detected || 'unknown')} · override for testing)</span></div>
    </div>
    <div class="seg" role="radiogroup" aria-label="Country">
      <button type="button" data-jur="" class="on">Auto</button>
      <button type="button" data-jur="AU">AU</button>
      <button type="button" data-jur="UK">UK</button>
      <button type="button" data-jur="NZ">NZ</button>
    </div>
  </div>
  <div class="thread" id="thread">
    <div class="msg agent"><div class="bubble">Hi. Ask me about pricing, delivery, eligibility, appointments or policies. If your question is about your treatment, your symptoms, or your own order, I'll pass it straight to a person.</div></div>
  </div>
  <form class="composer" id="form">
    <textarea id="input" rows="2" placeholder="Type a message…" required maxlength="2000"></textarea>
    <button class="btn" type="submit" id="send">Send</button>
  </form>
  <div class="chips">
    <button type="button" class="chip" data-q="How much does delivery cost and how long does it take?">Delivery cost and time</button>
    <button type="button" class="chip" data-q="What happens if I miss my appointment?">Missed appointment</button>
    <button type="button" class="chip" data-q="Is the first consultation free?">Is the first consult free?</button>
    <button type="button" class="chip warn" data-q="My last order made me drowsy at work, can I get a different one?">A disguised clinical one</button>
  </div>
</section>

<section class="steps" id="how">
  <h2>How it decides</h2>
  <ol>
    <li><span class="num">01</span><div><strong>Risk gate first.</strong> Before anything is looked up, a classifier reads the message. Clinical, adverse-event and regulatory questions stop here and go to a human — even if a published page happens to contain something that looks like an answer.</div></li>
    <li><span class="num">02</span><div><strong>Retrieve and compose.</strong> Safe questions pull the top published passages for your country, and a reply is written only from those passages, with a citation on every fact.</div></li>
    <li><span class="num">03</span><div><strong>Grounding gate second.</strong> A separate check verifies each claim against the cited passages. Fully grounded and confident: sent. Partial: drafted for a human. Unsupported: escalated. Every decision is logged and reviewable in the <a href="/admin">admin console</a>.</div></li>
  </ol>
</section>
<script src="/chat.js"></script>`;
  return layout({ title: 'Support chat', body, posthog });
}
