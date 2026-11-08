export function normalize(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}
export function tokens(query) {
  return normalize(query)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
export function findQuestions(
  questions,
  query,
  category = 'Tất cả',
  savedOnly = false,
  saved = [],
) {
  const words = tokens(query);
  return questions
    .filter((q) => {
      if (
        category !== 'Tất cả' &&
        (category === 'Đã tải lên' ? !q.uploaded : q.category !== category)
      )
        return false;
      if (savedOnly && !saved.includes(q.id)) return false;
      const haystack = normalize(
        [
          'ETC-OTC',
          'Câu ' + q.id,
          q.question,
          q.category,
          q.rawText || '',
          q.filename || '',
          ...q.options,
        ].join(' '),
      );
      const hayWords = tokens(haystack);
      return words.every((word) =>
        words.length === 1
          ? haystack.includes(word)
          : hayWords.some((part) => part.startsWith(word)),
      );
    })
    .map((q) => ({
      q,
      score: words.reduce(
        (score, word) =>
          score +
          (normalize(q.question).includes(word) ? 2 : 0) +
          (normalize(q.options[q.correct] || '').includes(word) ? 1 : 0),
        0,
      ),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.q.uploaded === b.q.uploaded
          ? String(a.q.id).localeCompare(String(b.q.id), 'vi', { numeric: true })
          : a.q.uploaded
            ? -1
            : 1),
    )
    .map((item) => item.q);
}

export function countCategories(questions, query) {
  const counts = {
    'Tất cả': 0,
    'Liều dùng': 0,
    'Hoạt chất': 0,
    'Dạng bào chế': 0,
    'Đã tải lên': 0,
  };
  for (const question of findQuestions(questions, query)) {
    counts['Tất cả']++;
    const category = question.uploaded ? 'Đã tải lên' : question.category;
    if (category !== 'Tất cả' && Object.hasOwn(counts, category)) counts[category]++;
  }
  return counts;
}
