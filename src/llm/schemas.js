// JSON schemas for the three structured calls. Strict mode: every property required,
// no additional properties, nulls expressed as type unions.

export const CATEGORIES = ['CLINICAL', 'ADVERSE_EVENT', 'REGULATORY', 'ACCOUNT_SPECIFIC', 'GENERAL_INFO', 'OUT_OF_SCOPE'];
export const ESCALATE_ALWAYS = new Set(['CLINICAL', 'ADVERSE_EVENT', 'REGULATORY']);
export const DECISIONS = ['AUTO_ANSWER', 'DRAFT_FOR_APPROVAL', 'ESCALATE'];

export const classifierSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'jurisdiction', 'jurisdiction_evidence', 'urgency', 'reason'],
  properties: {
    category: { type: 'string', enum: CATEGORIES },
    jurisdiction: { type: 'string', enum: ['AU', 'UK', 'NZ', 'UNKNOWN'] },
    jurisdiction_evidence: {
      type: 'string',
      enum: ['explicit', 'inferred', 'none'],
      description: 'explicit = the message names a country/city/currency; inferred = spelling or phrasing hints only; none = nothing to go on',
    },
    urgency: { type: 'string', enum: ['normal', 'urgent'] },
    reason: { type: 'string', description: 'one short sentence' },
  },
};

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

export const grounderSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['grounded', 'unsupported_claims'],
  properties: {
    grounded: { type: 'boolean' },
    unsupported_claims: { type: 'array', items: { type: 'string' } },
  },
};
