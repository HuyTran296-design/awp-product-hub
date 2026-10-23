# AWP Product Hub

> **Prototype – toàn bộ số liệu là dữ liệu mẫu.**

Web app quản trị hiệu quả và chi phí các dự án của team AWP (ABC Digital): Trợ lý, Dashboard tổng hợp,
quản lý dự án, chi phí team (lương + Tools/AI) và nhân sự, baseline & điểm sức khỏe, phương án cắt lỗ, người dùng & phân quyền.

- Node.js 24 (`node:http` + `node:sqlite`), **không có dependency** — không cần `npm install`.
- Frontend: ES modules thuần trong `public/`, logic dùng chung trong `shared/`.

## Chạy local

```bash
# 1. Node.js 24.x
node -v

# 2. (Tùy chọn) biến môi trường
cp .env.example .env    # sửa giá trị nếu cần; khi chạy local có thể bỏ trống hết

# 3. Chạy
npm start               # http://localhost:4310  (PORT=... để đổi cổng)
npm run build           # kiểm tra server khởi động được trên DB trong RAM
npm test                # unit + API test
npm run reset-db        # xóa DB local (data/awp-hub.db) và seed lại dữ liệu demo (Game A, Game B)
```

`npm start` không tự đọc file `.env`; để dùng các biến trong đó, chạy `node --env-file=.env server/index.js`
hoặc đặt biến trực tiếp, ví dụ `AWP_DB=:memory: npm start`.

### Biến môi trường

| Biến | Ý nghĩa | Mặc định khi để trống |
|------|---------|-----------------------|
| `AWP_DB` | File SQLite, hoặc `:memory:` (không lưu, seed lại mỗi lần khởi động) | `data/awp-hub.db` |
| `AWP_SECRET_KEY` | 64 ký tự hex, khóa AES-256-GCM mã hóa khóa kết nối (.p8, service account JSON) | sinh vào `data/secret.key` |
| `AWP_SESSION_SECRET` | Chuỗi ngẫu nhiên ký cookie đăng nhập | ngẫu nhiên mỗi lần khởi động |
| `PORT` | Cổng HTTP (local) | `4310` |
| `AWP_TODAY` | Giả lập "hôm nay" (YYYY-MM-DD) cho demo / nghiệm thu | ngày thật |

## Tài khoản mẫu

Đăng nhập bằng email, không mật khẩu (prototype). Màn đăng nhập có nút "bấm để điền".

| Họ tên | Email | Vai trò | Phạm vi xem |
|--------|-------|---------|-------------|
| Khánh Mai | khanh.mai@abcdigital.io | Admin | Toàn bộ |
| Huy Trần | huy.tran@abcdigital.io | Viewer | Tất cả dự án |
| Quân Đỗ | quan.do@abcdigital.io | Viewer | Game B |
| Thành Châu | thanh.chau@abcdigital.io | Viewer | Game A |

## Dữ liệu demo

Hai dự án Game A (Xây dựng, ngân sách 150.000.000) và Game B (Tăng trưởng); nhân sự Võ Nam, Đỗ Vy (lương 42.000.000)
và 6 tool Tools/AI có chi phí theo tháng (tháng 10/2026: 30.200.000) → tổng chi phí team 10/2026 = 72.200.000.
DB local của mô hình dữ liệu cũ được tự sao lưu vào `data/backups/` và tạo lại khi khởi động.

## Deploy (Vercel)

- `api/index.js` là serverless function chạy toàn bộ app; `vercel.json` phục vụ `public/` tĩnh và chuyển mọi đường dẫn khác vào function.
- Database trên Vercel là SQLite **trong RAM** (`AWP_DB=:memory:`): dữ liệu mẫu được seed tự động mỗi lần function khởi động,
  nên chỉnh sửa trên bản deploy **không được lưu lâu dài**.
- Khai báo trên Vercel các biến trong `.env.example`: `AWP_DB`, `AWP_SECRET_KEY`, `AWP_SESSION_SECRET`.

## Tài liệu

Hướng dẫn chi tiết và ghi chú tính năng: [`docs/huong-dan-chay.md`](docs/huong-dan-chay.md).
