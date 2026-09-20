// JSON schema for the composer call. Strict mode: every property required, no
// additional properties, nulls expressed as type unions.

export const DECISIONS = ['ANSWERED', 'PARTIAL', 'NOT_COVERED'];

export const composerSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'cited_chunk_ids', 'fully_answered', 'unanswered_part', 'confidence'],
  properties: {
    answer: { type: 'string', description: 'plain text with inline [chunk_id] citations' },
    cited_chunk_ids: { type: 'array', items: { type: 'string' } },
    fully_answered: { type: 'boolean' },
    unanswered_part: { type: ['string', 'null'] },
    confidence: { type: 'number', description: '0 to 1' },
  },
};
