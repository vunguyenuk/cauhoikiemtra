import { normalize, tokens } from './search.js';
import { esc } from '../../lib/dom.js';
export function highlight(text, query) {
  const words = tokens(query);
  if (!words.length) return esc(text);
  const chars = Array.from(String(text));
  let folded = '',
    mapping = [];
  chars.forEach((c, i) => {
    const v = normalize(c);
    folded += v;
    for (let j = 0; j < v.length; j++) mapping.push(i);
  });
  const ranges = [];
  for (const word of words) {
    let p = 0;
    while ((p = folded.indexOf(word, p)) >= 0) {
      ranges.push([mapping[p], mapping[p + word.length - 1] + 1]);
      p += word.length;
    }
  }
  if (!ranges.length) return esc(text);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push(r);
  }
  let out = '',
    pos = 0;
  for (const [a, b] of merged) {
    out +=
      esc(chars.slice(pos, a).join('')) + '<mark>' + esc(chars.slice(a, b).join('')) + '</mark>';
    pos = b;
  }
  return out + esc(chars.slice(pos).join(''));
}
