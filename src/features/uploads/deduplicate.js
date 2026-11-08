import { normalize } from '../search/search.js';

/** Stable content identity. Image names, accents and option ordering do not matter. */
export function questionKey(question) {
  const content = question.isDocument ? question.rawText || question.question : question.question;
  const text = normalize(content || '')
    .replace(/^\s*etc\s*[-–]?\s*otc\s*\/?\s*/i, '')
    .replace(/^\s*cau\s+\d+(?:\s*\/\s*\d+)?\s*[:.)-]\s*/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return (question.isDocument ? 'text:' : 'question:') + text;
}

export function partitionQuestions(incoming, existing) {
  const byKey = new Map(existing.map((question) => [questionKey(question), question]));
  const unique = [];
  const duplicates = [];
  for (const question of incoming) {
    const key = questionKey(question);
    const match = byKey.get(key);
    if (match) {
      const originalAnswer = match.options?.[match.correct];
      const incomingAnswer = question.options?.[question.correct];
      duplicates.push({
        existing: match,
        incoming: question,
        conflictingAnswer:
          !!originalAnswer &&
          !!incomingAnswer &&
          normalize(originalAnswer) !== normalize(incomingAnswer),
      });
    } else {
      unique.push(question);
      byKey.set(key, question);
    }
  }
  return { unique, duplicates };
}
