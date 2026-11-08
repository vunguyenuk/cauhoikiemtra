# Kiến trúc và giới hạn

## Luồng dữ liệu

1. Vercel phục vụ HTML/CSS/JavaScript đã build bằng Vite.
2. Tài khoản Supabase Auth xác định người sở hữu dữ liệu; không có secret key ở frontend.
3. Tesseract.js chạy trong Web Worker trên trình duyệt. Bộ WASM và ngôn ngữ Việt được tải từ CDN của Tesseract khi cần.
4. Frontend cập nhật dữ liệu đã lưu và so khớp câu hỏi trước khi tải ảnh lên Storage.
5. PostgreSQL RPC kiểm tra lại nội dung. Khóa giao dịch theo người dùng và unique fingerprint ngăn hai lần upload đồng thời tạo câu trùng.
6. Chỉ câu mới được ghi vào bảng `questions`. Nếu không có câu mới, bản ghi `documents` được bỏ trong giao dịch và client dọn ảnh vừa tải lên.
7. Khi đọc dữ liệu, RLS chỉ trả về dữ liệu thuộc tài khoản đăng nhập. Ảnh dùng signed URL có thời hạn 2 giờ, cập nhật lại khi tải trang hoặc bấm Cập nhật dữ liệu.

## Bảng và quyền truy cập

- `builtin_questions`: 8 câu gốc, chỉ đọc qua client. Dùng để kiểm tra trùng ở máy chủ.
- `documents`: metadata ảnh, đường dẫn Storage, SHA-256 file, toàn bộ văn bản OCR.
- `questions`: mỗi câu là một hàng, liên kết document + owner và có fingerprint duy nhất theo owner.
- `test-images`: bucket riêng tư, tối đa 15 MB, chỉ chấp nhận JPG/PNG/WebP. Mỗi tài khoản chỉ được đọc/ghi/xóa dưới tiền tố UUID của mình.

Client chỉ được SELECT các bảng thuộc tài khoản. Thay đổi bản ghi phải qua RPC có kiểm tra `auth.uid()`, quyền sở hữu, cấu trúc dữ liệu và nội dung trùng. Không dùng khóa `service_role` trong ứng dụng.

## Khi mạng lỗi

Upload nhiều ảnh được xử lý tuần tự để hạn chế bộ nhớ trên điện thoại. Một ảnh lỗi không chặn ảnh tiếp theo. Nút Thử lại giữ bản OCR trong bộ nhớ trong khi trang còn mở.

Nếu kết nối mất sau khi server đã commit, client kiểm tra ID bản ghi trước khi dọn ảnh. Trường hợp mạng mất hoàn toàn ở ranh giới Storage/DB có thể còn ảnh mồ côi; PostgreSQL và Storage không có giao dịch chung. Quản trị có thể đối chiếu các object không được `documents.image_path` tham chiếu và dọn thủ công. Không dọn hàng loạt ảnh đang upload.

Xóa ảnh thực hiện xóa Storage trước, rồi xóa bản ghi thông qua RPC (cascade các câu). Nếu phần sau lỗi, bản ghi còn để người dùng thử lại. Đây là xóa vĩnh viễn, có nút xác nhận hai lần trong giao diện.

## Kiểm tra và triển khai

- Logic frontend và SQL thực được kiểm tra tự động bằng Node test runner + PGlite.
- PGlite tạo phiên bản tối thiểu của các schema nền tảng `auth` và `storage` để kiểm tra migration, quyền tài khoản và RLS. Nó không giả lập mạng, Supabase Auth hay Storage HTTP.
- Build không cần biến Supabase. Khi chưa cấu hình backend, dữ liệu gốc vẫn đọc được; ứng dụng thông báo rõ phần chưa kết nối.
- Trước khi dùng dữ liệu thật, cần chạy migration trên Supabase, tạo tài khoản, thêm biến môi trường rồi xác nhận upload → lưu → tải lại trên hai thiết bị.
- Không có `.env.local`, token, dữ liệu phiên đăng nhập, `.vercel`, `node_modules`, output build hay lịch sử Git của bản Sites trong mã nguồn bàn giao.

## Phạm vi chống trùng

Hai câu có cùng nội dung chuẩn hóa được coi là trùng kể cả khác thứ tự đáp án. Đáp án cũ được giữ nguyên, xung đột hiển thị cho người dùng kiểm tra. Hai câu có câu hỏi khác nhưng đáp án giống nhau không bị gộp. Tài liệu không tách được câu hỏi dùng toàn bộ raw text làm định danh thay vì tiêu đề rút gọn.

## Kết quả kiểm tra bản bàn giao

- `npm run check`: 24 kiểm tra tự động đã qua, định dạng nhất quán và build Vite thành công.
- Build đã kiểm tra ở cả hai trường hợp: chưa có biến Supabase và có cấu hình URL/key mẫu (không gọi tài khoản thật).
- HTTP cục bộ trả 200 cho trang, font và ảnh gốc.
- Chưa chạy kiểm tra giao diện trong trình duyệt ở lần bàn giao này vì điều khiển trình duyệt đang bị tắt trong Work settings.
- Chưa thiết lập Supabase cloud hay kiểm tra Auth/Storage HTTP thực tế; các bước thiết lập và kiểm tra sau deploy nằm trong README.
