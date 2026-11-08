# Sổ tay bài kiểm tra

Website tiếng Việt tối ưu cho điện thoại: tìm câu hỏi và đáp án bằng từ khóa, đọc chữ từ ảnh và lưu để tìm lại sau.

## Chạy thử

Cần **Node.js 22.12 trở lên** (hoặc Node.js 24 LTS) và npm.

```sh
npm ci
npm run dev
```

Mở `http://127.0.0.1:5173`.

Chưa cấu hình Supabase vẫn xem và tìm kiếm được **8 câu hỏi gốc**. Muốn lưu ảnh và đồng bộ giữa điện thoại/máy tính, làm bước thiết lập bên dưới. Ứng dụng không giả lập lưu thành công khi chưa có backend.

## Thiết lập Supabase một lần

1. Tạo project Supabase miễn phí tại [Supabase Dashboard](https://supabase.com/dashboard). Có thể dùng tích hợp Supabase trong Vercel Marketplace.
2. Mở **SQL Editor**, chạy lần lượt **toàn bộ nội dung**:
   - `supabase/migrations/0001_schema.sql` — bảng, hàm lưu/chống trùng, phân quyền và kho ảnh riêng tư.
   - `supabase/migrations/0002_builtin_questions.sql` — 8 câu gốc để cơ sở dữ liệu cũng nhận biết câu trùng.
3. Mở **Authentication → Users → Add user**, tạo tài khoản email/mật khẩu cho người sử dụng. Tắt đăng ký công khai nếu chỉ dùng cá nhân. Người dùng đăng nhập bằng cùng tài khoản trên các thiết bị để đồng bộ.
4. Trong **Project Settings → API**, lấy Project URL và **publishable/anon key**. Không dùng secret key hoặc `service_role` ở frontend.
5. Sao chép `.env.example` thành `.env.local`, điền hai giá trị:

   ```dotenv
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
   ```

6. Chạy lại `npm run dev`, bấm **Đăng nhập**, rồi thử **Thêm ảnh**.

Nếu dùng Supabase CLI, chạy `supabase init`, liên kết đúng project bằng `supabase link --project-ref <project-ref>` rồi áp dụng hai file trong `supabase/migrations/` bằng `supabase db push`. Không chạy migration khởi tạo lại trên cơ sở dữ liệu đã có các bảng này.

## Đẩy GitHub → deploy Vercel

Thư mục này đã có Git remote do bạn thiết lập. Kiểm tra bằng `git remote -v` rồi:

```sh
git add .
git commit -m "Prepare mobile question lookup for Vercel"
git push -u origin main
```

Sau đó vào [Vercel → New Project](https://vercel.com/new), import repository GitHub:

| Thiết lập        | Giá trị                |
| ---------------- | ---------------------- |
| Root Directory   | Thư mục gốc repository |
| Framework Preset | Vite                   |
| Install Command  | `npm ci`               |
| Build Command    | `npm run build`        |
| Output Directory | `dist`                 |
| Node.js          | 24.x                   |

Thêm **hai biến môi trường** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` vào Vercel trước khi deploy. Vite đọc biến lúc build; sửa biến xong phải redeploy. `vercel.json` đã khai báo framework, build và thư mục output.

Bản Vercel không cần Cloudflare Worker, D1, R2, API key AI hoặc máy chủ riêng. Frontend gọi Supabase trực tiếp với tài khoản đăng nhập; ảnh tải thẳng vào Storage, không đi qua giới hạn request body của Vercel Functions.

**Chưa cấu hình Supabase:** Vercel vẫn build được và có chức năng tra cứu 8 câu gốc; tính năng lưu dữ liệu yêu cầu hoàn tất các bước Supabase.

## Chức năng

- Tìm tiếng Việt có hoặc không dấu trong câu hỏi và đáp án.
- Đổi tab, kể cả **Tất cả**, vẫn giữ từ khóa; số trên tab chỉ đếm kết quả phù hợp, nhóm không có hiển thị **0**.
- Đọc ảnh JPG/PNG/WebP, tối đa 15 MB/ảnh, chọn được nhiều ảnh.
- OCR chạy trên thiết bị với Tesseract.js; ảnh dạng bài kiểm tra đã cung cấp được đọc riêng từng lựa chọn và ô tô xanh. Ảnh khác được lưu thành văn bản nếu chưa tách được câu hỏi.
- Câu hỏi trùng theo nội dung đã chuẩn hóa sẽ **không lưu thêm**; hiển thị câu hỏi và đáp án đang lưu. Không tự ghi đè đáp án cũ khi ảnh mới có đáp án khác.
- Ảnh chứa cả câu mới lẫn câu trùng chỉ lưu câu mới. Nếu toàn bộ trùng thì không giữ thêm bản ghi hoặc ảnh.
- Có thể sửa nội dung OCR, xem ảnh gốc, sao chép, xóa ảnh và dữ liệu.
- Dữ liệu và ảnh riêng tư theo tài khoản; đánh dấu “Đã lưu” lưu trong trình duyệt theo tài khoản hiện tại.

Chống trùng dùng nội dung câu hỏi sau khi bỏ dấu tiếng Việt, ký hiệu và tiền tố số câu/ETC–OTC. Không dùng so khớp mờ: ảnh nhận dạng sai chữ đáng kể hoặc câu hỏi được viết lại có thể cần kiểm tra, hiệu chỉnh thủ công. Cùng một đáp án nhưng câu hỏi khác vẫn được coi là câu riêng.

## Cấu trúc mã

```text
index.html                      Trang giao diện
src/
  main.js                       Ghép trạng thái, tìm kiếm, đăng nhập và upload
  data/questions.js             8 câu gốc
  features/
    auth/controller.js          Đăng nhập, đăng xuất
    search/                     Tìm kiếm và tô từ khóa
    questions/                  Hiển thị, lưu, sao chép, sửa/xóa câu hỏi
    ocr/                        Đọc ảnh, tách câu và nhận diện lựa chọn
    uploads/                    Upload nhiều ảnh, lọc và hiển thị câu trùng
  lib/dom.js                    Tiện ích HTML và thông báo
  services/                     Kết nối Supabase, lưu/đọc/sửa/xóa dữ liệu
  styles/main.css               Giao diện responsive
public/assets/                  Font tiếng Việt, ảnh gốc và favicon
supabase/migrations/            Schema, RLS, Storage và dữ liệu gốc
scripts/generate-seed.js        Tạo SQL 8 câu gốc từ dữ liệu frontend
tests/                          Search, OCR, dedup và kiểm tra SQL PostgreSQL
vercel.json                     Cấu hình triển khai Vercel
.env.example                    Mẫu biến môi trường; không chứa thông tin thật
```

## Kiểm tra

```sh
npm test
npm run build
npm run format:check
# hoặc tất cả:
npm run check
```

`npm test` chạy kiểm tra logic tìm kiếm/OCR/chống trùng và thực thi migration bằng PostgreSQL WASM (PGlite) trong bộ nhớ. Không cần tài khoản cloud, không đụng dữ liệu thật. Kiểm tra SQL bao gồm phân quyền giữa hai người dùng, từ chối ghi trực tiếp, chống trùng và sửa/xóa dữ liệu.

Khi thêm/sửa các câu gốc trước khi triển khai lần đầu, chạy `npm run db:seed:generate` để cập nhật file seed. Nếu project đã áp dụng migration, thêm migration mới thay vì sửa file SQL đã áp dụng.

## Dữ liệu từ website cũ

Thư mục này chứa toàn bộ mã nguồn, font và 8 ảnh/câu hỏi gốc. **Các ảnh tải lên trên bản `chatgpt.site` đang nằm trong D1/R2 của bản cũ, chưa được sao chép vào Supabase.** Bản cũ không bị thay đổi. Đăng nhập bản Vercel rồi tải lại các ảnh cần chuyển; chức năng chống trùng sẽ lọc với 8 câu gốc và dữ liệu đã thêm.

Xem thêm [kiến trúc và giới hạn kiểm tra](docs/architecture.md).
