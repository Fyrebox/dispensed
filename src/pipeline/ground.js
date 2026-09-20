import { structured } from '../llm/openai.js';
import { grounderSchema } from '../llm/schemas.js';
import { GROUNDER_SYSTEM } from '../llm/prompts.js';
import { formatChunks } from './compose.js';

export async function ground({ answer, chunks }) {
  return structured({
    name: 'grounding_check',
    schema: grounderSchema,
    system: GROUNDER_SYSTEM,
    user: `Drafted reply:\n"""\n${answer}\n"""\n\nCited passages:\n${formatChunks(chunks)}`,
  });
}
