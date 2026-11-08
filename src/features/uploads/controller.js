import { $, esc } from '../../lib/dom.js';
import { createRecognizer, validateImage } from '../ocr/recognizer.js';
import { partitionQuestions } from './deduplicate.js';
import { renderDuplicates } from './duplicates-view.js';

export function mountUploads({ getQuestions, refresh, saveDocument, onSaved, onShowQuestion }) {
  const recognizer = createRecognizer();
  let busy = false;

  async function processFile(file, row, cachedDraft) {
    const message = row.querySelector('.upload-message');
    const bar = row.querySelector('progress');
    let draft = cachedDraft;
    row
      .querySelectorAll('.retry, .duplicate-results, .show-saved')
      .forEach((element) => element.remove());
    row.classList.remove('error');
    bar.hidden = false;
    try {
      validateImage(file);
      draft ||= await recognizer.recognize(file, ({ message: text, progress }) => {
        message.textContent = text;
        bar.value = progress;
      });
      message.textContent = 'Đang kiểm tra câu hỏi đã có…';
      let partition = partitionQuestions(draft.questions, getQuestions());
      if (partition.unique.length) {
        await refresh(false);
        partition = partitionQuestions(draft.questions, getQuestions());
      }
      const { unique, duplicates } = partition;
      renderDuplicates(row, duplicates, onShowQuestion);
      if (!unique.length) {
        bar.value = 100;
        message.textContent =
          'Tất cả câu hỏi đã có trong dữ liệu. Không lưu thêm ảnh hoặc câu hỏi.';
        return;
      }
      message.textContent = 'Đang lưu ' + unique.length + ' câu mới…';
      bar.value = 90;
      const result = await saveDocument(file, { ...draft, questions: unique });
      await onSaved(result.document);
      renderDuplicates(row, result.duplicates || [], onShowQuestion);
      bar.value = 100;
      const saved = result.document?.questions.length || 0;
      message.textContent = saved
        ? 'Đã lưu ' + saved + ' câu mới.'
        : 'Câu hỏi đã có trong dữ liệu. Không lưu lại.';
      if (result.document) {
        const show = document.createElement('button');
        show.type = 'button';
        show.className = 'text-button show-saved';
        show.textContent = 'Xem câu hỏi vừa lưu';
        show.onclick = () => onShowQuestion({ question: result.document.questions[0].question });
        row.appendChild(show);
      }
    } catch (error) {
      row.classList.add('error');
      bar.hidden = true;
      message.textContent = error.message || 'Chưa xử lý được ảnh. Vui lòng thử lại.';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'text-button retry';
      retry.textContent = 'Thử lại';
      retry.onclick = async () => {
        if (busy) return;
        busy = true;
        $('#image-input').disabled = true;
        try {
          await processFile(file, row, draft);
        } finally {
          busy = false;
          $('#image-input').disabled = false;
          await recognizer.close();
        }
      };
      row.appendChild(retry);
    }
  }

  async function upload(files) {
    if (busy || !files.length) return;
    busy = true;
    $('#image-input').disabled = true;
    try {
      for (const file of files) {
        const row = document.createElement('div');
        row.className = 'upload-row';
        row.innerHTML =
          '<strong>' +
          esc(file.name) +
          '</strong><span class="upload-message">Đang chờ xử lý…</span><progress max="100" value="0" aria-label="Tiến độ nhận dạng"></progress>';
        $('#upload-progress').appendChild(row);
        await processFile(file, row);
      }
    } finally {
      busy = false;
      $('#image-input').disabled = false;
      $('#image-input').value = '';
      await recognizer.close();
    }
  }

  $('#image-input').addEventListener('change', (event) => upload([...event.target.files]));
  const zone = $('#dropzone');
  for (const name of ['dragenter', 'dragover'])
    zone.addEventListener(name, (event) => {
      event.preventDefault();
      zone.classList.add('dragging');
    });
  for (const name of ['dragleave', 'drop'])
    zone.addEventListener(name, (event) => {
      event.preventDefault();
      zone.classList.remove('dragging');
    });
  zone.addEventListener('drop', (event) => upload([...event.dataTransfer.files]));
  return { isBusy: () => busy };
}
