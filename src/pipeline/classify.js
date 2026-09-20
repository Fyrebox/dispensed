import { structured } from '../llm/openai.js';
import { classifierSchema } from '../llm/schemas.js';
import { CLASSIFIER_SYSTEM } from '../llm/prompts.js';

export async function classify(text) {
  return structured({
    name: 'risk_classification',
    schema: classifierSchema,
    system: CLASSIFIER_SYSTEM,
    user: `Patient message:\n"""\n${text}\n"""`,
  });
}
