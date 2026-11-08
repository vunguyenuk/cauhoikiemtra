import test from 'node:test';
import assert from 'node:assert/strict';
import { questions } from '../src/data/questions.js';
import { findQuestions, countCategories } from '../src/features/search/search.js';
import { parseOCR, detectGreenBands } from '../src/features/ocr/parser.js';
test('accent-insensitive, case-insensitive, unordered multiword search', () => {
  assert.deepEqual(
    findQuestions(questions, 'XOANG viem').map((q) => q.id),
    [8],
  );
  assert.deepEqual(
    findQuestions(questions, 'tre em').map((q) => q.id),
    [23],
  );
  assert.deepEqual(
    findQuestions(questions, 'dang bao che').map((q) => q.id),
    [11],
  );
});
test('searches answers, partial words, alternatives and unknown text safely', () => {
  assert.equal(findQuestions(questions, 'furoat')[0].id, 2);
  assert.equal(findQuestions(questions, 'bude')[0].id, 2);
  assert.equal(findQuestions(questions, '<script>alert(1)</script>').length, 0);
  assert.equal(findQuestions(questions, 'khong co tu nay').length, 0);
});
test('category and bookmark filters intersect with query', () => {
  assert.equal(findQuestions(questions, '', 'Liều dùng').length, 5);
  assert.deepEqual(
    findQuestions(questions, '', 'Tất cả', true, [2, 11]).map((q) => q.id),
    [2, 11],
  );
});
test('uploaded raw text is searchable even without parsed question or answer', () => {
  const item = {
    id: 'test',
    question: 'Tài liệu',
    rawText: 'Nội dung rất dài có từ khóa alpha beta',
    options: [],
    correct: -1,
    uploaded: true,
    category: 'Đã tải lên',
  };
  assert.equal(findQuestions([item], 'noi dung alpha', 'Đã tải lên')[0], item);
});
test('recognizes explicit answer keys; does not invent answers', () => {
  let q = parseOCR({
    text: 'Câu 1: Hoạt chất là gì?\nA. Một\nB. Hai\nĐáp án: B',
    confidence: 90,
  })[0];
  assert.equal(q.correct, 1);
  assert.equal(q.options[1], 'Hai');
  q = parseOCR({ text: 'Một trang ghi chú cần tìm về sau', confidence: 80 })[0];
  assert.equal(q.correct, -1);
  assert.equal(q.isDocument, true);
});
test('uses highlighted option coordinates conservatively', () => {
  const lines = [
    { text: 'ETC-OTC/Thành phần là gì?', bbox: { y0: 1, y1: 10 } },
    { text: 'A Một', bbox: { y0: 20, y1: 30 } },
    { text: 'B Hai', bbox: { y0: 40, y1: 50 } },
  ];
  const data = { text: 'Thành phần', blocks: [{ paragraphs: [{ lines }] }] };
  assert.equal(parseOCR(data, [{ top: 35, bottom: 55 }])[0].correct, 1);
  assert.equal(parseOCR(data, [{ top: 15, bottom: 55 }])[0].correct, -1);
});
test('splits multiple questions and retains options', () => {
  const data = {
    text: 'Câu 1: Câu hỏi thứ nhất?\nA. Một\nB. Hai\nCâu 2: Câu hỏi thứ hai?\nA. Ba\nB. Bốn\nĐáp án: A',
  };
  const result = parseOCR(data);
  assert.equal(result.length, 2);
  assert.equal(result[1].correct, 0);
});

test('category badges count only matches and include zero-result groups', () => {
  assert.deepEqual(countCategories(questions, 'viem xoang'), {
    'Tất cả': 1,
    'Liều dùng': 1,
    'Hoạt chất': 0,
    'Dạng bào chế': 0,
    'Đã tải lên': 0,
  });
  assert.deepEqual(countCategories(questions, 'furoat'), {
    'Tất cả': 1,
    'Liều dùng': 0,
    'Hoạt chất': 1,
    'Dạng bào chế': 0,
    'Đã tải lên': 0,
  });
  assert.deepEqual(countCategories(questions, 'khong co tu nay'), {
    'Tất cả': 0,
    'Liều dùng': 0,
    'Hoạt chất': 0,
    'Dạng bào chế': 0,
    'Đã tải lên': 0,
  });
  const uploaded = {
    id: 'uploaded',
    question: 'Câu trong ảnh',
    rawText: 'viêm xoang',
    options: [],
    correct: -1,
    uploaded: true,
    category: 'Đã tải lên',
  };
  assert.deepEqual(countCategories([...questions, uploaded], 'viem xoang'), {
    'Tất cả': 2,
    'Liều dùng': 1,
    'Hoạt chất': 0,
    'Dạng bào chế': 0,
    'Đã tải lên': 1,
  });
});
