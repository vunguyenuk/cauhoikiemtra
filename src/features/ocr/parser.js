import { normalize } from '../search/search.js';
const optionPattern = /^\s*[|([\s]*([ABCD])[).:\]）\s]+(.+)$/i;
export function parseOCR(data, greenBands = []) {
  const lines =
    data.blocks?.flatMap((b) => b.paragraphs?.flatMap((p) => p.lines || []) || []) || [];
  const rows = lines.length
    ? lines.map((l) => ({ text: l.text.trim(), y: (l.bbox.y0 + l.bbox.y1) / 2 }))
    : data.text.split('\n').map((text) => ({ text: text.trim(), y: -1 }));
  const useful = rows.filter((r) => r.text);
  let start = useful.findIndex((r) => /ETC\s*[-–]?\s*OTC/i.test(r.text));
  if (start < 0) start = useful.findIndex((r) => /^c[aâ]u\s+\d+/i.test(normalize(r.text)));
  const content = useful.slice(Math.max(0, start));
  const groups = [];
  let group = [];
  for (const row of content) {
    if (
      /^cau\s+\d+/i.test(normalize(row.text)) &&
      group.length &&
      group.some((r) => optionPattern.test(r.text))
    ) {
      groups.push(group);
      group = [];
    }
    group.push(row);
  }
  if (group.length) groups.push(group);
  return groups
    .map((group) => {
      const options = [];
      const ys = [];
      const title = [];
      let current = -1;
      let originalNumber = null;
      let correct = -1;
      if (groups.length === 1) {
        const sourceNumber = normalize(data.text).match(/(?:cau\s*)?(\d+)\s*\/\s*\d+\s*:/);
        if (sourceNumber) originalNumber = Number(sourceNumber[1]);
      }
      for (const row of group) {
        const number = normalize(row.text).match(/^cau\s+(\d+)(?:\s*\/\s*\d+)?\s*[:.]?\s*(.*)/i);
        let text = row.text;
        if (number) {
          originalNumber = Number(number[1]);
          text = row.text
            .replace(/^c[aâ]u\s+\d+(?:\s*\/\s*\d+)?\s*[:.]?\s*/i, '')
            .replace(/\(?\d+\s*\/\s*\d+\s*đi[eể]m\)?/i, '')
            .trim();
        }
        const key = normalize(text).match(/(?:dap an|tra loi dung)\s*[:：-]?\s*([abcd])\b/i);
        if (key) {
          correct = key[1].toUpperCase().charCodeAt(0) - 65;
          continue;
        }
        const match = text.match(optionPattern);
        if (match && match[1].toUpperCase().charCodeAt(0) - 65 === options.length) {
          current = options.length;
          options.push(match[2].trim());
          ys.push(row.y);
          continue;
        }
        if (current >= 0) {
          options[current] += ' ' + text;
        } else if (text) {
          title.push(text.replace(/^ETC\s*[-–]?\s*OTC\s*\/?\s*/i, ''));
        }
      }
      if (correct < 0 && ys.length) {
        const hits = ys
          .map((y, i) => (greenBands.some((b) => y >= b.top && y <= b.bottom) ? i : -1))
          .filter((i) => i >= 0);
        if (hits.length === 1) correct = hits[0];
      }
      if (correct >= options.length) correct = -1;
      const question = title.join(' ').trim();
      const valid = options.length >= 2 && question.length > 5;
      return {
        question: valid ? question : data.text.trim().slice(0, 170) || 'Tài liệu mới',
        options: valid ? options : [],
        correct: valid ? correct : -1,
        originalNumber,
        category: 'Đã tải lên',
        rawText: data.text.trim(),
        isDocument: !valid,
        ocrConfidence: Math.round(data.confidence || 0),
      };
    })
    .filter((q) => q.question);
}
export function detectGreenBands(imageData) {
  const { data, width, height } = imageData;
  const bands = [];
  let top = null;
  for (let y = 0; y < height; y += 3) {
    let n = 0,
      total = 0;
    for (let x = Math.floor(width * 0.06); x < width * 0.94; x += 6) {
      const i = (y * width + x) * 4;
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (r > 155 && g > 175 && b > 150 && g - r > 8 && g - b > 3) n++;
      total++;
    }
    if (n / total > 0.58) {
      if (top === null) top = y;
    } else if (top !== null) {
      if (y - top > 15) bands.push({ top, bottom: y });
      top = null;
    }
  }
  if (top !== null) bands.push({ top, bottom: height });
  return bands;
}
// Full-width rounded answer boxes from the supplied mobile test layout.
export function detectOptionRows({ data, width, height }) {
  const runs = [];
  let top = null;
  for (let y = Math.floor(height * 0.26); y < height; y += 2) {
    let hits = 0,
      total = 0;
    for (let x = Math.floor(width * 0.17); x < width * 0.87; x += 5) {
      const p = (y * width + x) * 4;
      const r = data[p],
        g = data[p + 1],
        b = data[p + 2];
      if (Math.min(r, g, b) < 241) hits++;
      total++;
    }
    if (hits / total > 0.89) {
      if (top === null) top = y;
    } else if (top !== null) {
      if (y - top >= 2) runs.push({ top, bottom: y });
      top = null;
    }
  }
  const boxes = [];
  const green = detectGreenBands({ data, width, height });
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (run.bottom - run.top > height * 0.025) {
      boxes.push({
        ...run,
        selected:
          green.reduce(
            (sum, b) =>
              sum + Math.max(0, Math.min(run.bottom, b.bottom) - Math.max(run.top, b.top)),
            0,
          ) >
          (run.bottom - run.top) * 0.45,
      });
      continue;
    }
    const next = runs[i + 1];
    if (
      next &&
      next.top - run.bottom > height * 0.025 &&
      next.top - run.bottom < height * 0.13 &&
      next.bottom - next.top < height * 0.015
    ) {
      boxes.push({ top: run.top, bottom: next.bottom, selected: false });
      i++;
    }
  }
  if (boxes.length < 2 || boxes.length > 10) return [];
  const heights = boxes.map((b) => b.bottom - b.top).sort((a, b) => a - b),
    median = heights[Math.floor(heights.length / 2)];
  return boxes.every((b) => (b.bottom - b.top) / median > 0.55 && (b.bottom - b.top) / median < 1.9)
    ? boxes
    : [];
}
