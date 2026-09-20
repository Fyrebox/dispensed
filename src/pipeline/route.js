import { config } from '../config.js';
import { ESCALATE_ALWAYS } from '../llm/schemas.js';

/**
 * The routing table from the spec, as a pure function so the eval can replay it
 * with different thresholds without calling any model.
 */
export function route({ category, topScore, grounded, fullyAnswered }, thresholds = config.thresholds) {
  if (ESCALATE_ALWAYS.has(category)) {
    return { decision: 'ESCALATE', reason: `${category.toLowerCase().replace('_', ' ')}: always routed to a human` };
  }
  if (category === 'OUT_OF_SCOPE') {
    return { decision: 'AUTO_ANSWER', reason: 'out of scope: fixed response, no model-generated content' };
  }
  if (topScore === null || topScore === undefined || topScore < thresholds.floor) {
    return { decision: 'ESCALATE', reason: 'no relevant published answer' };
  }
  if (grounded === false) {
    return { decision: 'ESCALATE', reason: 'answer could not be grounded' };
  }
  if (category === 'ACCOUNT_SPECIFIC') {
    return { decision: 'ESCALATE', reason: 'account specific: no account data available to the agent' };
  }
  if (grounded && fullyAnswered && topScore > thresholds.auto) {
    return { decision: 'AUTO_ANSWER', reason: `grounded, fully answered, top score ${topScore.toFixed(2)} > ${thresholds.auto}` };
  }
  const why = !fullyAnswered ? 'partially answered' : `top score ${topScore.toFixed(2)} ≤ ${thresholds.auto}`;
  return { decision: 'DRAFT_FOR_APPROVAL', reason: `${why}: human to confirm before sending` };
}

const EMERGENCY = { AU: '000', UK: '999', NZ: '111' };

/** Fixed, non-generated handoff copy. A clinical escalation can never contain a clinical sentence. */
export function handoffText(category, jurisdiction, reason) {
  const emergency = EMERGENCY[jurisdiction] || '000 in Australia, 999 in the UK or 111 in New Zealand';
  switch (category) {
    case 'ADVERSE_EVENT':
      return `I'm sorry you're going through this. I've flagged your message as urgent and a member of the care team will contact you directly. If you feel seriously unwell or are in immediate danger, please call emergency services now (${emergency}).`;
    case 'CLINICAL':
      return `Thanks for your message. Questions about doses, symptoms, side effects, or whether a treatment suits you need to come from a clinician, so I've passed this to the care team rather than answer it myself. They'll come back to you directly. If you feel unwell in the meantime, contact your doctor or emergency services (${emergency}).`;
    case 'REGULATORY':
      return `Questions about driving, travelling, work testing or the law depend on where you are and can carry legal consequences, so I've passed this to the team to answer properly rather than guess. They'll reply to you directly.`;
    case 'ACCOUNT_SPECIFIC':
      return `I can't see your account or order from here, so I've passed this to the support team, who can look it up and reply to you directly.`;
    case 'OUT_OF_SCOPE':
      return `This assistant can only help with questions about the service: how it works, pricing, delivery, appointments and policies. If you have a question about any of those, I'm happy to help.`;
    default:
      if (/no relevant/.test(reason || '')) {
        return `I couldn't find a published answer to that, so I've passed it to the support team. They'll reply to you directly.`;
      }
      return `Thanks for your message. I've passed this to the support team to confirm the details, and they'll reply to you shortly.`;
  }
}
