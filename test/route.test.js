import test from 'node:test';
import assert from 'node:assert/strict';
import { route, handoffText } from '../src/pipeline/route.js';
import { resolveJurisdiction } from '../src/pipeline/run.js';

const T = { floor: 0.35, auto: 0.55 };

test('unsafe categories escalate before anything else is considered', () => {
  for (const category of ['CLINICAL', 'ADVERSE_EVENT', 'REGULATORY']) {
    const r = route({ category, topScore: 0.99, grounded: true, fullyAnswered: true }, T);
    assert.equal(r.decision, 'ESCALATE');
  }
});

test('no relevant chunk escalates', () => {
  assert.equal(route({ category: 'GENERAL_INFO', topScore: 0.2 }, T).decision, 'ESCALATE');
  assert.equal(route({ category: 'GENERAL_INFO', topScore: null }, T).decision, 'ESCALATE');
});

test('ungrounded answer escalates', () => {
  assert.equal(route({ category: 'GENERAL_INFO', topScore: 0.9, grounded: false, fullyAnswered: true }, T).decision, 'ESCALATE');
});

test('grounded, complete, confident auto answers; otherwise draft', () => {
  assert.equal(route({ category: 'GENERAL_INFO', topScore: 0.7, grounded: true, fullyAnswered: true }, T).decision, 'AUTO_ANSWER');
  assert.equal(route({ category: 'GENERAL_INFO', topScore: 0.7, grounded: true, fullyAnswered: false }, T).decision, 'DRAFT_FOR_APPROVAL');
  assert.equal(route({ category: 'GENERAL_INFO', topScore: 0.45, grounded: true, fullyAnswered: true }, T).decision, 'DRAFT_FOR_APPROVAL');
});

test('account specific always hands off even when grounded', () => {
  assert.equal(route({ category: 'ACCOUNT_SPECIFIC', topScore: 0.9, grounded: true, fullyAnswered: true }, T).decision, 'ESCALATE');
});

test('handoff copy is fixed and carries the right emergency number', () => {
  assert.match(handoffText('ADVERSE_EVENT', 'UK'), /999/);
  assert.match(handoffText('CLINICAL', 'AU'), /000/);
  assert.match(handoffText('ADVERSE_EVENT', 'UNKNOWN'), /000.*999.*111/);
});

test('jurisdiction precedence: override > explicit text > header > inferred', () => {
  const explicit = { jurisdiction: 'NZ', jurisdiction_evidence: 'explicit' };
  const inferred = { jurisdiction: 'NZ', jurisdiction_evidence: 'inferred' };
  const none = { jurisdiction: 'UNKNOWN', jurisdiction_evidence: 'none' };
  assert.deepEqual(resolveJurisdiction({ override: 'AU', cfCountry: 'GB', classified: explicit }), { jurisdiction: 'AU', source: 'override' });
  assert.deepEqual(resolveJurisdiction({ cfCountry: 'GB', classified: explicit }), { jurisdiction: 'NZ', source: 'explicit' });
  assert.deepEqual(resolveJurisdiction({ cfCountry: 'GB', classified: inferred }), { jurisdiction: 'UK', source: 'header' });
  assert.deepEqual(resolveJurisdiction({ classified: inferred }), { jurisdiction: 'NZ', source: 'inferred' });
  assert.deepEqual(resolveJurisdiction({ cfCountry: 'US', classified: none }), { jurisdiction: 'UNKNOWN', source: 'none' });
});
