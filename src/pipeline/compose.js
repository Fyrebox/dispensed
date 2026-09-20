import { structured } from '../llm/openai.js';
import { composerSchema } from '../llm/schemas.js';
import { COMPOSER_SYSTEM } from '../llm/prompts.js';

export function formatChunks(chunks) {
  return chunks
    .map((c) => `<chunk id="${c.id}" jurisdiction="${c.jurisdiction}" source="${c.source_url}">\n${c.heading}\n${c.text}\n</chunk>`)
    .join('\n\n');
}

export async function compose({ text, jurisdiction, chunks }) {
  return structured({
    name: 'composed_reply',
    schema: composerSchema,
    system: COMPOSER_SYSTEM,
    user: `Jurisdiction for this reply: ${jurisdiction}\n\nPatient question:\n"""\n${text}\n"""\n\nPublished chunks:\n${formatChunks(chunks)}`,
  });
}
