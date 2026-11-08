import { $, esc, icon } from '../../lib/dom.js';
import { findQuestions, countCategories } from '../search/search.js';
import { highlight as highlightText } from '../search/highlight.js';
export function renderQuestions({ all, query, category, savedOnly, saved, loading }) {
  const highlight = (text) => highlightText(text, query);
  const found = findQuestions(all, query, category, savedOnly, saved);
  const counts = countCategories(all, query);
  $('#clear-search').hidden = !query;
  $('#saved-count').textContent = saved.filter((id) => all.some((q) => q.id === id)).length;
  document.querySelectorAll('[data-category]').forEach((b) => {
    const c = b.dataset.category;
    const count = counts[c] ?? 0;
    b.querySelector('span').textContent = count;
    b.classList.toggle('active', category === c);
    b.setAttribute('aria-pressed', category === c);
  });
  const title = savedOnly
    ? 'Câu hỏi đã lưu'
    : query
      ? 'Kết quả tìm kiếm'
      : category === 'Tất cả'
        ? 'Tất cả câu hỏi'
        : category === 'Đã tải lên'
          ? 'Ảnh đã thêm'
          : category;
  $('#results-title').innerHTML = esc(title) + ' <span>' + String(found.length) + '</span>';
  $('#result-announcement').textContent = 'Tìm thấy ' + found.length + ' câu hỏi.';
  $('#all-view').classList.toggle('active', !savedOnly && category === 'Tất cả');
  $('#all-view').setAttribute('aria-pressed', !savedOnly && category === 'Tất cả');
  $('#saved-view').classList.toggle('active', savedOnly);
  $('#saved-view').setAttribute('aria-pressed', savedOnly);
  if (!found.length && loading) {
    $('#results').innerHTML =
      '<div class="empty"><h3>Đang tải dữ liệu của bạn…</h3><p>Đang lấy các ảnh và câu hỏi đã lưu trên website.</p></div>';
    return;
  }
  if (!found.length) {
    $('#results').innerHTML =
      '<div class="empty">' +
      icon(savedOnly ? 'bookmark' : 'search') +
      '<h3>' +
      (savedOnly ? 'Chưa có câu hỏi phù hợp trong mục đã lưu' : 'Chưa tìm thấy nội dung phù hợp') +
      '</h3><p>' +
      (savedOnly
        ? 'Bấm nút Lưu ở câu hỏi bạn muốn xem lại.'
        : 'Thử một từ ngắn hơn như “xoang”, “trẻ em”, hoặc tải thêm ảnh vào sổ tay.') +
      '</p><button class="button" data-action="' +
      (query && category === 'Tất cả' && !savedOnly ? 'clear-query' : 'reset') +
      '">' +
      (query
        ? category === 'Tất cả' && !savedOnly
          ? 'Xóa từ khóa'
          : 'Tìm trong tất cả nhóm'
        : 'Xem tất cả câu hỏi') +
      '</button></div>';
    return;
  }
  $('#results').innerHTML = found
    .map((q) => {
      const known = q.correct >= 0 && q.correct < q.options.length,
        letter = String.fromCharCode(65 + q.correct);
      const label = q.uploaded
        ? q.originalNumber
          ? 'Câu ' + q.originalNumber
          : 'Ảnh đã thêm'
        : 'Câu ' + String(q.id).padStart(2, '0');
      const image = q.uploaded ? q.source : './assets/' + q.source;
      return (
        '<article class="question-card" data-id="' +
        esc(q.id) +
        '"><div class="card-top"><div class="card-meta"><span class="question-number">' +
        esc(label) +
        '</span>' +
        (!q.uploaded ? '<span class="meta-dot"></span><span>' + esc(q.category) + '</span>' : '') +
        '</div><button class="icon-button ' +
        (saved.includes(q.id) ? 'selected' : '') +
        '" data-action="save" aria-label="' +
        (saved.includes(q.id) ? 'Bỏ lưu' : 'Lưu') +
        ' câu hỏi" aria-pressed="' +
        saved.includes(q.id) +
        '">' +
        icon('bookmark') +
        '<span>' +
        (saved.includes(q.id) ? 'Đã lưu' : 'Lưu') +
        '</span></button></div><h3>' +
        highlight(q.question) +
        '</h3>' +
        (known
          ? '<div class="answer"><span class="answer-letter">' +
            letter +
            '</span><div><span class="answer-label">' +
            icon('check') +
            ' Đáp án ' +
            (q.uploaded ? (q.edited ? 'đã sửa' : 'trong ảnh') : 'theo tài liệu') +
            '</span><p class="answer-text">' +
            highlight(q.options[q.correct]) +
            '</p></div></div>'
          : '<div class="unknown">' +
            (q.isDocument
              ? 'Đã lưu văn bản nhận dạng để tìm kiếm.'
              : 'Đáp án: Chưa xác định từ ảnh.') +
            ' Bạn có thể mở phần sửa để bổ sung.</div>') +
        '<div class="card-actions">' +
        (q.options.length
          ? '<details><summary>Xem các lựa chọn</summary><ol class="options">' +
            q.options
              .map(
                (o, i) =>
                  '<li class="' +
                  (i === q.correct ? 'correct' : '') +
                  '"><span>' +
                  String.fromCharCode(65 + i) +
                  '</span><span>' +
                  highlight(o) +
                  (i === q.correct ? ' ✓' : '') +
                  '</span></li>',
              )
              .join('') +
            '</ol></details>'
          : '<span class="source-caption">Văn bản từ ảnh</span>') +
        '<button class="text-button" data-action="copy">' +
        icon('copy') +
        ' Sao chép</button></div>' +
        (q.uploaded
          ? '<details class="source"><summary>Xem chữ đã đọc từ ảnh</summary><pre class="raw-text">' +
            highlight(q.rawText) +
            '</pre></details>'
          : '') +
        '<details class="source"><summary>Xem ảnh gốc</summary><p class="source-caption">' +
        esc(q.uploaded ? q.filename : q.source) +
        '</p><img src="' +
        esc(image) +
        '" alt="Ảnh gốc của ' +
        esc(label) +
        '" loading="lazy" decoding="async"><a href="' +
        esc(image) +
        '" target="_blank" rel="noopener">Mở ảnh đầy đủ ↗</a></details>' +
        (q.uploaded
          ? '<details class="source edit-section"><summary>Sửa nội dung</summary>' +
            editForm(q) +
            '</details>'
          : '') +
        '</article>'
      );
    })
    .join('');
}
function editForm(q) {
  return (
    '<form class="edit-form" data-doc="' +
    q.docId +
    '" data-index="' +
    q.index +
    '"><label>Câu hỏi<textarea name="question" required maxlength="10000">' +
    esc(q.question) +
    '</textarea></label><label>Các lựa chọn (mỗi dòng một ý, không cần A/B/C/D)<textarea name="options">' +
    esc(q.options.join('\n')) +
    '</textarea></label><label>Đáp án<select name="correct"><option value="-1">Chưa xác định</option>' +
    q.options
      .map(
        (o, i) =>
          '<option value="' +
          i +
          '" ' +
          (i === q.correct ? 'selected' : '') +
          '>' +
          String.fromCharCode(65 + i) +
          '. ' +
          esc(o.slice(0, 70)) +
          '</option>',
      )
      .join('') +
    '</select></label><label>Chữ đọc được từ ảnh<textarea name="rawText" required maxlength="100000">' +
    esc(q.rawText) +
    '</textarea></label><button class="button primary" type="submit">Lưu thay đổi</button><span class="edit-status" role="status"></span><button class="text-button delete-button" type="button" data-action="delete">Xóa ảnh và dữ liệu</button></form>'
  );
}
