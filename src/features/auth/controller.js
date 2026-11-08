import { $ } from '../../lib/dom.js';
import { getSupabase, isConfigured } from '../../services/supabase.js';

export async function mountAuth({ onSession }) {
  if (!isConfigured) {
    $('#account-status').textContent =
      'Bản xem thử: chưa kết nối kho lưu trữ. Các câu hỏi có sẵn vẫn dùng được.';
    $('#open-auth').hidden = true;
    await onSession(null);
    return;
  }
  const client = getSupabase();
  let currentUserId;
  const showSession = (session) => {
    const user = session?.user;
    $('#account-status').textContent = user
      ? 'Đã đăng nhập: ' + user.email
      : 'Đăng nhập để thêm ảnh và dùng chung dữ liệu giữa các thiết bị.';
    $('#open-auth').hidden = !!user;
    $('#sign-out').hidden = !user;
    if (user) $('#auth-panel').hidden = true;
    if (currentUserId !== (user?.id || null)) {
      currentUserId = user?.id || null;
      // Avoid awaiting other Supabase operations inside onAuthStateChange's lock.
      queueMicrotask(() =>
        onSession(session).catch((error) =>
          console.error('Session refresh failed:', error.message),
        ),
      );
    }
  };
  $('#open-auth').onclick = () => {
    $('#auth-panel').hidden = false;
    $('#auth-email').focus();
  };
  $('#close-auth').onclick = () => {
    $('#auth-panel').hidden = true;
  };
  $('#sign-out').onclick = async () => {
    $('#sign-out').disabled = true;
    const { error } = await client.auth.signOut();
    $('#sign-out').disabled = false;
    if (error) $('#account-status').textContent = 'Chưa đăng xuất được. Vui lòng thử lại.';
  };
  $('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('#auth-submit');
    button.disabled = true;
    $('#auth-status').textContent = 'Đang đăng nhập…';
    try {
      const { error } = await client.auth.signInWithPassword({
        email: $('#auth-email').value.trim(),
        password: $('#auth-password').value,
      });
      $('#auth-password').value = '';
      if (error) throw error;
      $('#auth-status').textContent = '';
      $('#auth-panel').hidden = true;
    } catch {
      $('#auth-status').textContent =
        'Email hoặc mật khẩu chưa đúng, hoặc chưa kết nối được. Kiểm tra rồi thử lại.';
    } finally {
      button.disabled = false;
    }
  });
  client.auth.onAuthStateChange((_event, session) => showSession(session));
  const { data, error } = await client.auth.getSession();
  if (error) $('#account-status').textContent = 'Không đọc được phiên đăng nhập. Vui lòng thử lại.';
  showSession(data.session);
}
