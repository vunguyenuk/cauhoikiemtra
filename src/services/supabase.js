import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && key);
let client;

export function getSupabase() {
  if (!isConfigured) {
    throw new Error('Chưa thiết lập kho dữ liệu. Xem hướng dẫn Supabase trong README.md.');
  }
  client ||= createClient(url, key);
  return client;
}

export function readableError(error) {
  if (error?.code === '23505')
    return new Error('Câu hỏi này đã có trong dữ liệu. Hãy tải lại danh sách.');
  if (error?.code === 'PGRST202' || error?.code === '42P01') {
    return new Error('Kho dữ liệu chưa được khởi tạo. Chạy các migration Supabase theo README.md.');
  }
  if (/JWT|not authenticated|session/i.test(error?.message || '')) {
    return new Error('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.');
  }
  return new Error(
    error?.message || 'Không kết nối được kho dữ liệu. Vui lòng kiểm tra mạng và thử lại.',
  );
}
