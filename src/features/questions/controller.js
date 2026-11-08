import { $, esc, toast } from '../../lib/dom.js';
import { partitionQuestions } from '../uploads/deduplicate.js';
import { updateDocument, deleteDocument } from '../../services/documents.js';

export function mountQuestionActions({ state, allQuestions, render, setQuery, bookmarkKey }) {
  $('#results').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'reset') {
      state.category = 'Tất cả';
      state.savedOnly = false;
      render();
      return;
    }
    if (action === 'clear-query') {
      setQuery('');
      return;
    }
    const question = allQuestions().find(
      (item) => String(item.id) === button.closest('[data-id]')?.dataset.id,
    );
    if (!question) return;
    if (action === 'save') {
      state.saved = state.saved.includes(question.id)
        ? state.saved.filter((id) => id !== question.id)
        : [...state.saved, question.id];
      try {
        localStorage.setItem(bookmarkKey(), JSON.stringify(state.saved));
      } catch {
        toast('Trình duyệt không cho lưu đánh dấu lâu dài.');
      }
      render();
    }
    if (action === 'copy') {
      const text =
        question.question +
        '\n' +
        (question.correct >= 0
          ? 'Đáp án ' +
            String.fromCharCode(65 + question.correct) +
            ': ' +
            question.options[question.correct]
          : question.rawText || 'Chưa xác định đáp án');
      try {
        await navigator.clipboard.writeText(text);
        toast('Đã sao chép câu hỏi và đáp án.');
      } catch {
        toast('Chưa sao chép được. Bạn có thể nhấn giữ để chọn chữ.');
      }
    }
    if (action === 'delete') {
      if (button.dataset.confirm !== 'yes') {
        button.dataset.confirm = 'yes';
        button.textContent = 'Nhấn lần nữa để xóa ảnh và toàn bộ dữ liệu của ảnh';
        setTimeout(() => {
          if (button.isConnected) {
            button.dataset.confirm = '';
            button.textContent = 'Xóa ảnh và dữ liệu';
          }
        }, 6000);
        return;
      }
      button.disabled = true;
      try {
        await deleteDocument(question.docId);
        state.documents = state.documents.filter((document) => document.id !== question.docId);
        render();
        toast('Đã xóa ảnh và dữ liệu.');
      } catch (error) {
        button.disabled = false;
        toast(error.message);
      }
    }
  });
  $('#results').addEventListener('input', (event) => {
    if (!event.target.matches('.edit-form textarea[name="options"]')) return;
    const select = event.target.closest('form').querySelector('select');
    const selected = Number(select.value);
    select.innerHTML =
      '<option value="-1">Chưa xác định</option>' +
      event.target.value
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 10)
        .map(
          (text, index) =>
            '<option value="' +
            index +
            '" ' +
            (index === selected ? 'selected' : '') +
            '>' +
            String.fromCharCode(65 + index) +
            '. ' +
            esc(text.slice(0, 70)) +
            '</option>',
        )
        .join('');
  });
  $('#results').addEventListener('submit', async (event) => {
    const form = event.target.closest('.edit-form');
    if (!form) return;
    event.preventDefault();
    const document = state.documents.find((item) => item.id === form.dataset.doc);
    if (!document) return;
    const index = Number(form.dataset.index);
    const values = new FormData(form);
    const options = String(values.get('options'))
      .split('\n')
      .map((text) => text.trim())
      .filter(Boolean);
    const correct = Number(values.get('correct'));
    const status = form.querySelector('.edit-status');
    if (options.length > 10 || correct >= options.length) {
      status.textContent = 'Tối đa 10 lựa chọn. Đáp án phải có trong các lựa chọn.';
      return;
    }
    const updated = {
      ...document.questions[index],
      question: String(values.get('question')).trim(),
      options,
      correct,
      isDocument: !options.length,
      edited: true,
      rawText: String(values.get('rawText')),
    };
    const otherQuestions = allQuestions().filter((question) => question.id !== updated.id);
    if (partitionQuestions([updated], otherQuestions).duplicates.length) {
      status.textContent = 'Câu hỏi này đã có trong dữ liệu. Không lưu thêm bản trùng.';
      return;
    }
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    status.textContent = 'Đang lưu…';
    try {
      const questions = document.questions.map((question, current) =>
        current === index ? updated : question,
      );
      const result = await updateDocument(document.id, questions, String(values.get('rawText')));
      if (result.ownerId !== state.session?.user.id) return;
      state.documents = state.documents.map((item) => (item.id === result.id ? result : item));
      render();
      toast('Đã lưu thay đổi.');
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  });
}
