import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveJurisdiction, decide } from '../src/pipeline/run.js';

test('jurisdiction precedence: toggle > cf-ipcountry header > UNKNOWN', () => {
  assert.deepEqual(resolveJurisdiction({ override: 'AU', cfCountry: 'GB' }), { jurisdiction: 'AU', source: 'override' });
  assert.deepEqual(resolveJurisdiction({ cfCountry: 'GB' }), { jurisdiction: 'UK', source: 'header' });
  assert.deepEqual(resolveJurisdiction({ cfCountry: 'nz' }), { jurisdiction: 'NZ', source: 'header' });
  assert.deepEqual(resolveJurisdiction({ cfCountry: 'US' }), { jurisdiction: 'UNKNOWN', source: 'none' });
  assert.deepEqual(resolveJurisdiction({ override: 'FR' }), { jurisdiction: 'UNKNOWN', source: 'none' });
});

test('decision from the composed reply', () => {
  assert.equal(decide(null).decision, 'NOT_COVERED');
  assert.equal(decide({ cited_chunk_ids: [], fully_answered: false }).decision, 'NOT_COVERED');
  assert.equal(decide({ cited_chunk_ids: ['kb_1'], fully_answered: true }).decision, 'ANSWERED');
  assert.equal(decide({ cited_chunk_ids: ['kb_1'], fully_answered: false, unanswered_part: 'courier' }).decision, 'PARTIAL');
});
