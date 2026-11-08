import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionQuestions, questionKey } from '../src/features/uploads/deduplicate.js';
const original = {
  id: 2,
  question: 'Thành phần hoạt chất trong Zentason là gì?',
  options: ['Budesonid', 'Mometason furoat'],
  correct: 1,
};

test('matches the same question across accents, prefixes, punctuation and reordered answers', () => {
  const incoming = {
    question: 'ETC-OTC/ Thanh phan hoat chat trong Zentason la gi !!!',
    options: ['Mometason furoat', 'Budesonid'],
    correct: 0,
  };
  const result = partitionQuestions([incoming], [original]);
  assert.equal(result.unique.length, 0);
  assert.equal(result.duplicates[0].existing.id, 2);
  assert.equal(result.duplicates[0].conflictingAnswer, false);
});
test('does not discard different questions that share the same answer', () => {
  const incoming = { ...original, question: 'Hoạt chất trong thuốc khác là gì?' };
  assert.equal(partitionQuestions([incoming], [original]).unique.length, 1);
});
test('shows the stored answer when the incoming duplicate disagrees', () => {
  const result = partitionQuestions([{ ...original, correct: 0 }], [original]);
  assert.equal(result.unique.length, 0);
  assert.equal(result.duplicates[0].conflictingAnswer, true);
  assert.equal(result.duplicates[0].existing.options[1], 'Mometason furoat');
});
test('saves only new questions and removes duplicates within the same image', () => {
  const fresh = { ...original, question: 'Câu hỏi mới là gì?' };
  const result = partitionQuestions([original, fresh, { ...fresh }], [original]);
  assert.deepEqual(result.unique, [fresh]);
  assert.equal(result.duplicates.length, 2);
});
test('unstructured documents compare their entire text, not the truncated title', () => {
  const first = { question: 'Same title', rawText: 'First full page', isDocument: true };
  const other = { ...first, rawText: 'Second full page' };
  assert.notEqual(questionKey(first), questionKey(other));
});
