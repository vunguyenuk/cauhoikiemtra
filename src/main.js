import { questions as original } from './data/questions.js';
import { $, toast } from './lib/dom.js';
import { renderQuestions } from './features/questions/render.js';
import { mountUploads } from './features/uploads/controller.js';
import { mountAuth } from './features/auth/controller.js';
import { mountQuestionActions } from './features/questions/controller.js';
import { isConfigured } from './services/supabase.js';
import { listDocuments, saveDocument } from './services/documents.js';

const state = {
  documents: [],
  category: 'Tất cả',
  savedOnly: false,
  saved: [],
  loading: false,
  query: new URL(location.href).searchParams.get('q') || '',
  session: null,
};
const bookmarkKey = () => 'so-tay-saved:' + (state.session?.user.id || 'guest');
function loadBookmarks() {
  try {
    const saved = JSON.parse(localStorage.getItem(bookmarkKey()) || '[]');
    state.saved = Array.isArray(saved) ? saved : [];
  } catch {
    state.saved = [];
  }
}

function allQuestions() {
  return [
    ...original,
    ...state.documents.flatMap((document) =>
      document.questions.map((question, index) => ({
        ...question,
        id: question.id,
        docId: document.id,
        index,
        category: 'Đã tải lên',
        uploaded: true,
        filename: document.filename,
        source: document.imageUrl,
        rawText: question.isDocument ? document.rawText : question.rawText || '',
        createdAt: document.createdAt,
      })),
    ),
  ];
}
function render() {
  renderQuestions({ all: allQuestions(), ...state });
}
function setQuery(value) {
  state.query = value;
  $('#search').value = value;
  const url = new URL(location.href);
  value ? url.searchParams.set('q', value) : url.searchParams.delete('q');
  history.replaceState(null, '', url);
  render();
}
function showQuestion(question) {
  state.savedOnly = false;
  state.category = 'Tất cả';
  setQuery(question.question);
  $('#upload-panel').hidden = true;
  $('#search').scrollIntoView({ block: 'start', behavior: 'instant' });
}

let refreshPromise;
async function refresh(showToast = false) {
  if (!isConfigured || !state.session) {
    const message = !isConfigured
      ? 'Chưa thiết lập kho dữ liệu. Xem README.md để kết nối Supabase.'
      : 'Đăng nhập để thêm ảnh và xem dữ liệu đã lưu.';
    $('#sync-status').textContent = message;
    throw new Error(message);
  }
  if (refreshPromise) return refreshPromise;
  const userId = state.session.user.id;
  $('#refresh-data').disabled = true;
  $('#sync-status').textContent = 'Đang cập nhật dữ liệu…';
  refreshPromise = (async () => {
    try {
      const documents = await listDocuments();
      if (state.session?.user.id !== userId) return;
      state.documents = documents;
      $('#data-notice').hidden = true;
      $('#sync-status').classList.remove('error-text');
      $('#sync-status').textContent =
        'Đã cập nhật ' + documents.length + ' ảnh. Dùng chung trên các thiết bị.';
      if (showToast) toast('Đã cập nhật dữ liệu mới nhất.');
    } catch (error) {
      if (state.session?.user.id === userId) {
        $('#data-notice').hidden = false;
        $('#data-notice').textContent = 'Chưa tải được ảnh đã thêm. ' + error.message;
        $('#sync-status').textContent = error.message;
        $('#sync-status').classList.add('error-text');
      }
      throw error;
    } finally {
      state.loading = false;
      $('#refresh-data').disabled = false;
      refreshPromise = null;
      render();
    }
  })();
  return refreshPromise;
}

$('#search').value = state.query;
$('#search').addEventListener('input', (event) => setQuery(event.target.value));
$('#search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  $('#search').blur();
});
$('#clear-search').onclick = () => {
  setQuery('');
  $('#search').focus();
};
document.querySelectorAll('[data-category]').forEach((button) => {
  button.onclick = () => {
    state.category = button.dataset.category;
    state.savedOnly = false;
    render();
  };
});
$('#saved-view').onclick = () => {
  state.savedOnly = true;
  state.category = 'Tất cả';
  render();
};
$('#open-upload').onclick = () => {
  $('#upload-panel').hidden = false;
  $('#upload-panel').scrollIntoView({ block: 'start', behavior: 'instant' });
};
$('#close-upload').onclick = () => {
  $('#upload-panel').hidden = true;
  $('#open-upload').focus();
};
$('#refresh-data').onclick = () => refresh(true).catch((error) => toast(error.message));
document.addEventListener('keydown', (event) => {
  if (
    event.key === '/' &&
    !event.ctrlKey &&
    !event.metaKey &&
    !['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)
  ) {
    event.preventDefault();
    $('#search').focus();
  }
});

mountQuestionActions({ state, allQuestions, render, setQuery, bookmarkKey });

const uploads = mountUploads({
  getQuestions: allQuestions,
  refresh,
  saveDocument,
  onShowQuestion: showQuestion,
  onSaved: async (document) => {
    if (document && document.ownerId === state.session?.user.id) {
      state.documents = [document, ...state.documents.filter((item) => item.id !== document.id)];
      render();
    }
  },
});
let lastRefresh = Date.now();
window.addEventListener('focus', () => {
  if (
    state.session &&
    !uploads.isBusy() &&
    !document.querySelector('.edit-section[open]') &&
    Date.now() - lastRefresh > 30_000
  ) {
    lastRefresh = Date.now();
    refresh().catch(() => {});
  }
});
loadBookmarks();
render();
mountAuth({
  onSession: async (session) => {
    state.session = session;
    state.documents = [];
    $('#upload-progress').replaceChildren();
    state.loading = !!session;
    loadBookmarks();
    render();
    if (session) {
      if (refreshPromise) await refreshPromise.catch(() => {});
      await refresh().catch(() => {});
    } else {
      $('#data-notice').hidden = true;
      $('#sync-status').textContent = isConfigured
        ? 'Đăng nhập để thêm ảnh và lưu dữ liệu.'
        : 'Chưa kết nối Supabase. Xem README.md để thiết lập.';
    }
  },
}).catch((error) => {
  $('#account-status').textContent = error.message;
});
