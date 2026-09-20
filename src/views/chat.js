import { layout, esc } from './layout.js';

export function chatPage({ posthog, detected }) {
  const body = `
<section class="hero">
  <h1>Ask your question.</h1>
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
    <div class="msg agent"><div class="bubble">Hi. Ask me about pricing, delivery, eligibility, appointments, prescriptions or policies. Everything I say comes from the published pages, with a link to the source.</div></div>
  </div>
  <form class="composer" id="form">
    <textarea id="input" rows="2" placeholder="Type a message…" required maxlength="2000"></textarea>
    <button class="btn" type="submit" id="send">Send</button>
  </form>
  <div class="chips">
    <button type="button" class="chip" data-q="How much does delivery cost and how long does it take?">Delivery cost and time</button>
    <button type="button" class="chip" data-q="What happens if I miss my appointment?">Missed appointment</button>
    <button type="button" class="chip" data-q="Is the first consultation free?">Is the first consult free?</button>
    <button type="button" class="chip" data-q="Who actually dispenses the medication, is it you or a pharmacy?">Who dispenses it?</button>
    <button type="button" class="chip" data-q="Can I drive after taking my medication?">Can I drive?</button>
  </div>
</section>

<div class="banner">
  <strong>Prototype built for a job application.</strong> Not affiliated with any healthcare provider. Answers are drawn from publicly published pages, conversations are synthetic, and nothing here is medical advice.
</div>

<section class="steps" id="how">
  <h2>How it works</h2>
  <ol>
    <li><span class="num">01</span><div><strong>Published pages only.</strong> The FAQ, how-it-works, pricing, delivery, terms and policy pages of three country sites (AU, UK, NZ) are chunked and embedded into a vector store. Nothing behind a login.</div></li>
    <li><span class="num">02</span><div><strong>Retrieve for your country, then answer from that.</strong> The country comes from the request (Cloudflare header) or the toggle above. The top passages are retrieved and the reply is written only from them, with a citation on every fact. If they don't cover the question, it says so.</div></li>
    <li><span class="num">03</span><div><strong>Everything is logged.</strong> Each conversation, the passages retrieved with their scores, and the reply are reviewable in the <a href="/admin">admin console</a>. Questions the pages can't answer show up as gaps; a human answer can be promoted into the knowledge base in one click.</div></li>
  </ol>
  <p class="muted" style="font-size:13px;margin-top:16px">Production note: a risk classifier that routes clinical, adverse-event and regulatory questions to a human before retrieval was built and measured for this prototype (100% clinical recall, 0 unsafe auto-answers on a 120-ticket set) and then removed from the demo because it was too conservative to show the retrieval working. It goes back in front of this pipeline before anything touches a real patient.</p>
</section>
<script src="/chat.js"></script>`;
  return layout({ title: 'Support chat', body, posthog });
}
