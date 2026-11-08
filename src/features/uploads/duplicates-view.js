import { esc } from '../../lib/dom.js';

export function renderDuplicates(container, duplicates, onShowQuestion) {
  if (!duplicates.length) return;
  const section = document.createElement('section');
  section.className = 'duplicate-results';
  section.setAttribute('aria-label', 'Câu hỏi đã có trong dữ liệu');
  section.innerHTML =
    '<p class="duplicate-heading">' + duplicates.length + ' câu đã có — không lưu lại</p>';
  for (const { existing, conflictingAnswer } of duplicates) {
    const card = document.createElement('div');
    card.className = 'duplicate-card';
    const answer = existing.options?.[existing.correct];
    card.innerHTML =
      '<h4>' +
      esc(existing.question) +
      '</h4><p><strong>Đáp án đang lưu:</strong> ' +
      (answer ? esc(String.fromCharCode(65 + existing.correct) + '. ' + answer) : 'Chưa xác định') +
      '</p>' +
      (conflictingAnswer
        ? '<p class="error-text">Ảnh mới có đáp án khác. Nội dung đang lưu được giữ nguyên.</p>'
        : '');
    const show = document.createElement('button');
    show.type = 'button';
    show.className = 'text-button';
    show.textContent = 'Xem câu hỏi trong dữ liệu';
    show.onclick = () => onShowQuestion(existing);
    card.appendChild(show);
    section.appendChild(card);
  }
  container.appendChild(section);
}
