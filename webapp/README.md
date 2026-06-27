# Task Manager Web App (chạy trong tab Feishu)

Đây KHÔNG phải Mini Program (小程序) — là **Web App** (年trang web thường, nhúng vào tab Feishu), dùng năng lực "Web app" đã có sẵn trong app `cli_aaa0cf1a963a9bc0`. Đơn giản hơn Mini Program vì chạy được bằng browser/JS thường (fetch, localStorage), không cần Feishu Developer Tools riêng, không cần SDK `tt.*`.

## Việc cần làm trước khi chạy thật được
1. Deploy backend lên domain HTTPS công khai (Mini Program/Web app không nhận `localhost`).
2. Trong app Feishu (`Add Features` → `Web app`), khai báo URL trang web (trỏ tới nơi host frontend này) và whitelist domain backend trong `Security Settings` (nếu Feishu yêu cầu).
3. Trong `Permissions & Scopes`, đảm bảo app có quyền lấy thông tin user cơ bản (`contact:user.base:readonly` hoặc tương đương) để OAuth trả về `open_id`/`name`.
4. Set biến môi trường backend: `SESSION_JWT_SECRET`, `MINI_PROGRAM_ORIGIN` (đặt = domain frontend thật để CORS chỉ cho phép đúng origin đó).
5. `npm install` ở thư mục gốc backend để lấy `cors`, `jsonwebtoken`, `multer`, `form-data`.

## Luồng đăng nhập (OAuth chuẩn của Feishu)
1. Trang web load lần đầu, chưa có `sessionToken` trong `localStorage` → redirect sang `https://open.feishu.cn/open-apis/authen/v1/index?app_id=...&redirect_uri=...`.
2. User xác nhận trong Feishu → Feishu redirect lại trang web kèm `?code=xxx`.
3. Trang web gửi `code` đó cho `POST /api/auth/login` → backend đổi `code` lấy `open_id` (qua `authen/v1/access_token`), trả về JWT session token.
4. Token lưu `localStorage`, mọi request sau gắn `Authorization: Bearer <token>`.

## Cấu trúc
- `src/api.js`: wrapper gọi REST API backend + xử lý OAuth redirect (`ensureLoggedIn()`).

## Còn thiếu (làm tiếp sau khi backend đã có domain HTTPS thật để test OAuth)
- UI thật (form tạo/sửa task, list theo role, màn "Task đã làm", upload ảnh/file paste) — viết bằng React/HTML thường, gọi qua `api.js`.
- Build/bundle config (Vite/webpack) tuỳ bạn chọn — chưa thêm vì chưa rõ bạn muốn dùng công cụ build nào.
