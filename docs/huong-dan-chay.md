# AWP Product Hub — hướng dẫn chạy prototype

Yêu cầu: Node.js ≥ 22.13 (dùng `node:sqlite` có sẵn, không cần cài package).

```bash
npm start          # http://localhost:4310  (PORT=... để đổi cổng)
npm test           # unit + API test cho tiêu chí nghiệm thu
npm run reset-db   # xóa DB, seed lại dữ liệu demo (Game A, Game B)
AWP_TODAY=2026-11-04 PORT=4311 AWP_DB=/tmp/awp-demo.db npm start   # giả lập "hôm nay" (demo / nghiệm thu)
```

Đăng nhập bằng email (prototype, không mật khẩu). Tài khoản mẫu (đều "Đang hoạt động", màn đăng nhập có nút "bấm để điền"):
`khanh.mai@abcdigital.io` Khánh Mai (Admin), `huy.tran@abcdigital.io` Huy Trần (Viewer · tất cả dự án),
`quan.do@abcdigital.io` Quân Đỗ (Viewer · Game B), `thanh.chau@abcdigital.io` Thành Châu (Viewer · Game A).
Lịch sử thay đổi của dữ liệu mẫu ghi tên Khánh Mai. Admin có công tắc "Xem với vai trò…" trong menu tài khoản để xem thử giao diện Viewer.

## Cấu trúc
- `shared/` — công thức thuần dùng chung server/browser/test: `periods.js` (kỳ & hệ số), `cost-calculator.js`, `health-score.js`, `metric-catalog.js`, `format.js` (định dạng vi-VN), `system-config.js` (hằng số hệ thống).
- `shared/cost-timeline.js` — cấu hình chi phí theo ngày hiệu lực (xem mục dưới).
- `server/` — `node:http` + SQLite (`data/awp-hub.db`), REST API (`api-routes.js`: dashboard, chi phí team, nhân sự; `project-routes.js`: quản lý dự án, vòng đời, lịch sử), phân quyền (`auth.js`), mã hóa khóa bí mật AES-256-GCM (`secrets.js`, khóa ở env `AWP_SECRET_KEY` hoặc `data/secret.key`). Phiên đăng nhập = cookie ký HMAC (`AWP_SESSION_SECRET`), không lưu phía server.
- `public/components/` — khối giao diện dùng chung giữa wizard "Thêm dự án" và trang chỉnh sửa dự án (nhân sự, baseline, kết nối, thông tin, xem trước tác động, hộp thoại vòng đời).
- `server/data-sources/` — hợp đồng `DataSource.getMetric(projectId, metricKey, dateFrom, dateTo, platform)`; `MockDataSource` đọc `metric_daily` sinh bởi `mock-data-generator.js` (400 ngày, seed cố định). Thay bằng connector GA4 / App Store Connect / Google Play bằng cách cài một lớp khác cùng interface trong `server/index.js`.
- `public/` — giao diện ES module thuần, không bước build.

## Mô hình: một cấp "Dự án"
- Toàn hệ thống chỉ có **Dự án**. Mỗi dự án có đủ: Tổng quan, Marketing, nền tảng phát hành, giai đoạn, kết nối dữ liệu, nhân sự & chi phí, baseline & trọng số, phương án cắt lỗ, lịch sử thay đổi. Không có cấp cha–con, trang tổng hợp, nhân sự chung hay mẫu cho dự án mới.
- Menu trái "DỰ ÁN": danh sách phẳng theo tên (chấm màu + tên); dự án đang mở hiện "Tổng quan · Marketing". Breadcrumb: `Dashboard / Game B`.
- Dashboard: mỗi dòng một dự án, nhóm "Đang xây dựng" tách riêng (không xếp hạng lời/lỗ); các thẻ tổng cộng dồn các dự án trong phạm vi xem.
- Cấu hình → **Quản lý dự án**: bảng phẳng (tab trạng thái, tìm kiếm, sắp xếp), một nút "Thêm dự án".
- Wizard **Thêm dự án** (`#/config/projects/new`, 5 bước): Thông tin → Kết nối dữ liệu → Nhân sự & chi phí → Baseline & trọng số → Xem lại & kích hoạt. Bước 1 có **Sao chép cấu hình từ dự án…** (`GET /api/projects/:id/copy-config`): nền tảng, baseline, trọng số, mục tiêu, ngưỡng màu, phương án cắt lỗ — không sao chép nhân sự và kết nối. Không sao chép thì phương án cắt lỗ mặc định tắt.
- Xóa: dự án phải lưu trữ trước ("Hãy lưu trữ dự án trước khi xóa"); dự án nháp xóa ngay.
- DB của mô hình dữ liệu cũ không được chuyển đổi: khi khởi động, file cũ được sao lưu vào `data/backups/<tên>-<thời điểm>-truoc-<mô hình mới>.db` (hiện tại `truoc-tools-theo-thang`) rồi tạo lại với dữ liệu demo (khóa `app_settings.data_model`).

## Dữ liệu demo
- **Game A** (#8A6D1F, YouTube Playables + iOS + Android): giai đoạn Xây dựng, ngân sách 150.000.000, ra mắt dự kiến 31/03/2027, baseline nhập thủ công; chi phí lũy kế 96.000.000 → "Đang đầu tư · đã dùng 64% ngân sách" (không hiện Lời/Lỗ).
- **Game B** (#6B7F2A, YouTube Playables + iOS + Android): Tăng trưởng, baseline nhập thủ công Doanh thu 100% – 5.000.000 · Lượt chơi 60% – 100.000 · Người chơi 80% – 50.000 · Thời gian chơi TB 40% – 8 phút; doanh thu tháng 9/2026: 2.900.000; tháng 10/2026: 3.200.000 (64,0%) · 120.000 (120,0%) · 45.000 (90,0%) · 6,5 (81,3%) → 85,9% "Tốt".
- Nhân sự: Võ Nam (Game Developer, 24.000.000 · Game A 50%, Game B 50%), Đỗ Vy (Game Artist, 18.000.000 · Game A 50%, Game B 30%).
- Tools/AI (tất cả dự án nếu không ghi):
  - Claude & ChatGPT — Theo mức dùng, ước tính 12.000.000; thực tế 8/2026 11.200.000 · 9/2026 10.500.000 · 10/2026 14.200.000.
  - Google Workspace & Slack — Hằng tháng 6.000.000; Tài khoản App Store & Google Play — Hằng tháng 4.000.000.
  - Unity & asset game — Hằng năm 72.000.000 từ 1/2026 (→ 6.000.000/tháng), Game A, Game B.
  - Figma — Hằng tháng 45 USD (= 1.170.000 ₫) từ 11/2026.
  - Bộ asset nhân vật — Một lần 18.000.000 tháng 11/2026, chia đều 6 tháng (3.000.000/tháng đến 4/2027), Game A.
  - → **tháng 10/2026: Tools/AI 30.200.000, tổng chi phí team 42.000.000 + 30.200.000 = 72.200.000**.
- Nguồn promote của Game B: Từ game Game A · Từ TikTok · Từ kênh YouTube · Từ đối tác / website khác.
- Các test tính toán dùng một cấu hình riêng (kịch bản A: "Dự án Test 1", "Dự án Test 2", 4 nhân sự, 1 tool "Tools & AI" 20.000.000) — `startTestServer({ scenario: 'A' })`; cấu hình này không có trong dữ liệu demo và không hiện trên giao diện.

## Quy ước tính toán đáng chú ý
- Kỳ cuộn kết thúc ở ngày gần nhất có đủ dữ liệu (mặc định hôm qua): 1/3/7/30/90/365 ngày; so với kỳ liền trước cùng độ dài. Kỳ Năm không có so sánh vì dữ liệu mẫu chỉ có 400 ngày.
- Điểm sức khỏe dùng % đạt chưa làm tròn rồi mới làm tròn điểm; màu từng baseline dùng % đạt đã làm tròn 1 chữ số.
- Biểu đồ chi phí theo thời gian: chi phí mỗi cột = chi phí tháng × số ngày làm việc trong cột ÷ 21 (cuối tuần không phát sinh).
- Điểm Store gộp iOS/Android = trung bình đơn giản; tỷ lệ D7/crash = trung bình theo ngày.

## Cấu hình theo ngày hiệu lực & vòng đời dự án
- Bảng `config_versions` lưu chi phí từng nhân sự (`member_cost`), phân công effort của từng dự án (`staffing`), trạng thái (`status`). Cấu hình của ngày D = phiên bản mới nhất có ngày hiệu lực ≤ D. Tools/AI không theo phiên bản mà tính theo tháng dương lịch (bảng `tools`, `tool_actuals`, xem mục Chi phí team).
- Chi phí một kỳ = chi phí tháng trung bình có trọng số theo ngày trong kỳ (kỳ đi qua 2 tháng dương lịch: trọng số = số ngày của kỳ trong từng tháng) × hệ số kỳ. Chi phí không đổi giữa các tháng → kết quả như trước.
- Tháng đã chốt sổ = mọi tháng trước tháng hiện tại; không thay đổi nào được có hiệu lực trong đó.
- Chỉ dự án **Đang chạy** (kể cả giai đoạn Xây dựng) nhận effort và Tools/AI. Tạm dừng / Lưu trữ: chi phí = 0, effort được giải phóng. Dashboard hiện dự án Đang chạy + Tạm dừng (Tạm dừng không xếp hạng); Lưu trữ và Nháp bị ẩn.
- Tổng effort của một người trên mọi dự án ≤ 100% (lỗi ví dụ: "Vượt 10% (Nam đã dùng 100%: Game A 50%, Game B 50%)").
- Xóa vĩnh viễn (chỉ dự án đã Lưu trữ) xóa dữ liệu chỉ số, kết nối, baseline nhưng giữ các phiên bản chi phí; các kỳ cũ hiển thị dòng "Dự án đã xóa".
- Mọi thay đổi ghi vào `audit_log` (người, thời điểm, giá trị cũ → mới, ngày hiệu lực, lý do) — tab "Lịch sử thay đổi" của từng dự án; thay đổi cấp team xem qua `GET /api/team-history`.

## Chi phí team (Cấu hình → Chi phí team)
- **Tổng chi phí team/tháng = Lương nhân sự + Tools/AI.** Không có "chi phí cố định của team", quỹ / cách phân bổ chi phí chung, ô số ngày làm việc và tỷ giá.
- Hằng số hệ thống (`shared/system-config.js`): 21 ngày làm việc/tháng (/ngày = /tháng ÷ 21), tỷ giá 26.000 ₫/USD (tooltip Doanh thu ghi "Quy đổi theo tỷ giá 26.000 ₫/USD").
- Thiết lập chung: Lương nhân sự (chỉ xem, Σ chi phí nhân sự/tháng, link "Quản lý nhân sự") và **Chi phí Tools/AI** với 2 tab:
  - **Cấu hình**: mỗi tool có Tên · Kiểu chi phí · Số tiền + Tiền tệ (VND | USD, hiện số VND quy đổi) · Áp dụng cho · Từ tháng – Đến tháng.
    - Hằng tháng: số tiền/tháng. Theo mức dùng: ước tính/tháng, mỗi tháng nhập số thực tế.
    - Hằng năm: số tiền năm + tháng bắt đầu → mỗi tháng = ÷ 12, tự gia hạn đến khi có "Đến tháng".
    - Một lần: số tiền + tháng phát sinh + "Chia đều trong N tháng" (mặc định 1).
    - "Áp dụng cho" chọn nhiều, có tìm kiếm: Tất cả dự án (mặc định) | từng dự án.
    - Đổi giá tool Hằng tháng / Theo mức dùng: "Đổi giá từ tháng…" (chỉ tháng chưa chốt sổ), các tháng trước giữ giá cũ; "Lịch sử giá" dưới ô số tiền.
    - Ngừng dùng → nhập "Đến tháng". Tool đã có chi phí trong tháng đã chốt không xóa được (server trả 422).
  - **Theo tháng**: hàng = tool, cột = 6 tháng trước + tháng hiện tại + tháng sau, dòng cuối "Tổng Tools/AI".
    - Ô "Dự kiến" (xám nghiêng) tính từ cấu hình; "Thực tế" (chữ thường) = số Admin nhập theo hóa đơn.
    - Bấm ô → nhập (theo tiền tệ của tool), Enter lưu, Esc hủy; "Xóa số thực tế" quay về số dự kiến.
    - Tool Theo mức dùng chưa có số thực tế của tháng đã qua (từ ngày 4 tháng sau) → "Ước tính" + chấm cam, và một dòng nhắc ở đầu trang ("N khoản chưa nhập số thực tế tháng … – Nhập ngay"). Kiểm tra từ tháng có số thực tế đầu tiên của tool (không có thì từ "Từ tháng", hoặc cột đầu của bảng).
  - Sửa số thực tế của tháng đã qua là sửa dữ liệu: chi phí, lời/lỗ, % chi phí team, cắt lỗ của tháng đó tính lại; ghi "Lịch sử thay đổi Tools/AI" (ai, lúc nào, cũ → mới).
  - Lưu trữ: bảng `tools` (JSON `{ name, kind, currency, amount, prices, startMonth, endMonth, spreadMonths, appliesTo }`) và `tool_actuals` (tool, tháng, số tiền, tiền tệ, người nhập). Tính toán: `shared/tool-costs.js`. API: `PUT /api/team-costs` (danh sách), `POST /api/team-costs/tools/:id/prices`, `PUT /api/team-costs/actuals` (`amount: null` = xóa).
- Công thức tháng m: chi phí tool = Thực tế nếu có, không thì Dự kiến. Lương 1 người cho dự án = chi phí nhân sự/tháng × % effort; FTE dự án = Σ % effort. Mỗi tool của tháng m chia cho các dự án đang chạy trong "Áp dụng cho" theo tỷ lệ FTE; không có dự án nào đang chạy → "Tools/AI chưa phân bổ". Chi phí dự án tháng m = Lương + Tools/AI được chia; theo ngày = ÷ 21; % chi phí team = chi phí dự án ÷ tổng chi phí team.
- "Phân bổ chi phí": công tắc Theo tháng | Theo ngày + chọn tháng (dùng đúng số của tháng dương lịch đó).
  - Cột: Dự án · Lương · Tools/AI · Tổng chi phí · % chi phí team ‖ Doanh thu · Lãi/Lỗ (vạch ngăn giữa nhóm chi phí và nhóm kết quả). Sắp xếp được theo mọi cột số; các dòng "chưa phân bổ" và "Tổng" luôn ở cuối. Màn hình hẹp: cuộn ngang trong khung, cột "Dự án" cố định.
  - Doanh thu = chỉ số Doanh thu của dự án trong tháng. Lãi/Lỗ = Doanh thu − Tổng chi phí: dương xanh "+… Lời", âm đỏ "−… Lỗ"; dự án giai đoạn Xây dựng âm → xám "Đang đầu tư". Dòng chưa phân bổ: Doanh thu "—", Lãi/Lỗ = −số tiền (xám). Dòng "Tổng chi phí team": Σ doanh thu, Lãi/Lỗ team = Σ doanh thu − tổng chi phí team (= tổng cột Lãi/Lỗ). Phía trên bảng: Tổng chi phí · Tổng doanh thu · Lãi/Lỗ team.
  - Theo ngày: mọi cột (kể cả Doanh thu, Lãi/Lỗ) = số tháng ÷ 21 ("Trung bình mỗi ngày làm việc (÷ 21)").
  - Badge cạnh ô chọn tháng: tháng hiện tại "Tạm tính đến dd/mm/yyyy" (doanh thu đến ngày có dữ liệu gần nhất; chi phí = chi phí tháng × số ngày thứ 2–6 đã qua đến ngày đó ÷ 21); tháng đã qua nhưng chưa tới ngày chốt sổ hoặc còn tool Theo mức dùng chưa có số thực tế → "Chưa chốt"; còn lại "Đã chốt sổ". Tháng tương lai: chi phí dự kiến, chưa có doanh thu ("—").
  - Cột Tools/AI ghi "gồm số dự kiến" khi tháng đó còn tool chưa có số thực tế. Bấm một dự án → chi tiết từng nhân sự và từng tool; thanh tỷ trọng theo dự án + "Chưa phân bổ".
- Demo 9/2026 (đã chốt): Game A 21.000.000 + 14.722.222 = 35.722.222, doanh thu 0 → −35.722.222 Đang đầu tư; Game B 17.400.000 + 11.777.778 = 29.177.778, doanh thu 2.900.000 → −26.277.778 Lỗ; Lương chưa phân bổ 3.600.000; team 68.500.000, Lãi/Lỗ −65.600.000. Kịch bản M1–M3: `test/cost-allocation-profit.test.js`.
- Demo 10/2026: Game A lương 21.000.000 + Tools/AI 16.777.778; Game B 17.400.000 + 13.422.222; Lương chưa phân bổ = Vy 20% = 3.600.000; tổng 72.200.000/tháng = 3.438.095/ngày. Kịch bản L1–L9: `test/tool-months.test.js`.

## Chốt sổ & phương án cắt lỗ
- Tháng N chốt sổ vào ngày 3 của tháng N+1 (`shared/closing.js`). Tháng đã chốt không nhận thay đổi nào và là dữ liệu duy nhất dùng để đánh giá cắt lỗ.
- `AWP_TODAY` giả lập ngày hệ thống (`server/clock.js`): dữ liệu mẫu, tháng đã chốt và ngày hiệu lực đều theo ngày này.
- Đánh giá (`shared/stop-loss.js`) chạy mỗi khi xem trạng thái; khi chạm ngưỡng chỉ tạo **đề xuất** (badge "Chạm ngưỡng cắt lỗ" trên Dashboard + khối Cắt lỗ ở Tổng quan; không có thông báo). Dự án chỉ thay đổi khi Admin chọn "Thực hiện".
- Bảng: `stoploss_policies`, `stoploss_proposals`. Dự án mới: phương án cắt lỗ sao chép từ dự án được chọn ở wizard, không sao chép thì tắt.

## Baseline & điểm sức khỏe
- Mỗi dự án 1–5 baseline, trọng số 1–100%. Điểm chỉ tính trên baseline đã có dữ liệu ("Tính trên 2/3 baseline"); chưa baseline nào có dữ liệu → "Đang thu thập dữ liệu".

## Người dùng & phân quyền
- `users` (tài khoản đăng nhập) tách biệt với `members` (Nhân sự — hồ sơ tính chi phí). Phiên (cookie ký) chỉ chứa id người dùng; vai trò, phạm vi xem, trạng thái đọc lại từ DB mỗi request → đổi vai trò/khóa có hiệu lực ở lần tải trang kế tiếp.
- Phạm vi xem của Viewer: Tất cả dự án | chọn từng dự án (chọn nhiều). Viewer chỉ thấy Dashboard / Tổng quan / Marketing của dự án trong phạm vi; mọi API đọc đều lọc theo phạm vi, ngoài phạm vi → 403 "Bạn không có quyền truy cập". Dashboard của Viewer giới hạn chỉ cộng các dự án đó (không có chi phí chưa phân bổ / tỷ trọng team).
- Luôn còn ≥ 1 Admin đang hoạt động; không tự xóa/khóa/hạ quyền mình. Xóa là xóa mềm: lịch sử giữ "Tên (đã xóa)" (`audit_log.actor_user_id`).
- Thêm người dùng → trạng thái "Đã mời" + link `#/invite/<token>` (prototype không gửi email).

## Dữ liệu không có kết nối sẵn
- Mỗi baseline có **Nguồn**: kết nối gốc của chỉ số (GA4 / Store / YouTube Analytics), **Nhập thủ công** (kỳ ngày/tuần/tháng) hoặc **Tải lên CSV**. Đổi nguồn theo ngày hiệu lực (`baseline_sources`): trước ngày đổi giữ nguồn cũ, từ ngày đổi dùng nguồn mới; biểu đồ trong panel có vạch "Đổi nguồn: …".
- `manual_values` lưu mọi lần nhập (người, thời điểm; bản cũ có `replaced_at`). Baseline thủ công tính theo kỳ của nó; kỳ đã kết thúc mà chưa nhập sau 3 ngày → thẻ baseline xám "Chưa cập nhật", không tính điểm (không có thông báo nhắc).
- CSV: cột `date,metric_key,platform,value`; xem trước báo lỗi từng dòng; chọn ghi đè hoặc bỏ qua dòng trùng (tab Kết nối dữ liệu).
- **Giai đoạn** (`project_phases`): Xây dựng / Ra mắt / Tăng trưởng / Ổn định, đổi theo ngày hiệu lực kèm gợi ý bộ baseline (`shared/phases.js`). Giai đoạn Xây dựng: không xét Lời/Lỗ, hiện "Đang đầu tư · đã dùng X% ngân sách"; chi phí lũy kế lấy từ baseline "Chi phí lũy kế" (nhập thủ công), nếu chưa có thì từ chi phí hệ thống kể từ ngày bắt đầu Xây dựng.
- **Nền tảng phát hành** (iOS · Android · Website · YouTube Playables) (`shared/release-platforms.js`): quyết định kết nối hiển thị, danh mục baseline (hợp các nền tảng) và chỉ số gộp — Người dùng mới gồm cả Người chơi Playables.
- **Một chỉ số "Doanh thu"** (`revenue`) cho toàn hệ thống, lưu theo nền tảng `ios` / `android` / `playables`: số tiền team thực nhận (đã trừ phí Store / nền tảng), quy ra VND — iOS từ App Store Connect, Android từ Google Play Console (USD × tỷ giá), YouTube Playables nhập thủ công hoặc CSV (`revenue,playables`). Lời/Lỗ = Doanh thu − Chi phí kỳ.
- Form "Cập nhật số liệu" của dự án có Playables luôn có ô **Doanh thu – YouTube Playables** (bảng `manual_values` có cột `platform`). Nền tảng iOS/Android chưa cấu hình kết nối Store không chặn tổng Doanh thu (Game B chỉ có phần Playables).

## Trợ lý (trang mặc định)
- Menu **✦ Trợ lý** nằm trên Dashboard và là trang mở ra khi đăng nhập / vào app. Giao diện là khung chat; gõ câu như "Doanh thu Game B hôm nay" thì một mục số liệu hiện phía trên khung chat, mỗi mục có nút ✕ để xóa.
- Câu hỏi được đọc bằng luật từ khóa trong `shared/assistant-intent.js` (không gọi dịch vụ AI): chỉ số (doanh thu, chi phí, lãi/lỗ, điểm sức khỏe, các baseline như DAU, lượt tải…), tên dự án (có dấu hoặc không) và kỳ (hôm nay = ngày gần nhất có đủ dữ liệu, 3 ngày, tuần, tháng, quý, năm; không nêu kỳ thì theo bộ lọc thời gian đang chọn). Không nêu dự án = toàn team (Viewer: phạm vi được xem); chỉ nêu tên = tổng quan.
- Số liệu lấy từ `/api/dashboard` nên đúng phân quyền. Trình duyệt chỉ nhớ câu hỏi (localStorage theo người dùng), số liệu được lấy lại mỗi lần mở trang.

## Bộ lọc thời gian, nguồn promote, giao diện
- Bộ lọc thời gian mặc định **Tháng** = 30 ngày gần nhất, kết thúc ở ngày gần nhất có đủ dữ liệu (thường là hôm qua), không phải "từ đầu tháng". Lựa chọn giữ nguyên khi chuyển trang trong cùng phiên đăng nhập; mỗi lần đăng nhập / đăng xuất trở về "Tháng".
- Marketing → Nguồn tải app theo kênh có dòng **Promote từ nền tảng khác** (màu #7A5AF8), mở ▸ để xem từng nguồn con; dòng cha = tổng đúng các nguồn con.
- Quản lý nguồn con: Quản lý dự án → dự án → Kết nối dữ liệu → **Nguồn promote** (Admin; bảng `promo_sources`). Mỗi nguồn (tên + mã, hoặc chọn một dự án khác trong hệ thống → tự lấy tên dự án) có 3 link theo dõi để sao chép: web `utm_source=<mã>&utm_medium=promote`, App Store `ct=<mã>` (kèm `pt=` khi kết nối App Store Connect có Provider token), Google Play `referrer=utm_source=<mã>…`. Nguồn mới tạo hiển thị 0 cho tới khi có dữ liệu.
- Dữ liệu mẫu có phiên bản (`MOCK_DATA_VERSION` trong `server/data-sources/mock-data-generator.js`): đổi generator thì tăng số này, server tự sinh lại dữ liệu mẫu khi khởi động.
- Nút giao diện ở thanh trên cùng (☀ Sáng · ☾ Tối · ◐ Tự động theo máy), mặc định Sáng, nhớ lựa chọn trong trình duyệt.

## Gợi ý mục tiêu/tháng từ dữ liệu lịch sử
- Bước "Baseline & trọng số" (wizard) và tab tương ứng khi sửa dự án: mỗi baseline có khối **Tham chiếu**, mặc định ẩn — link "Xem tham chiếu ▾" dưới ô Mục tiêu/tháng — 6 tháng đã chốt gần nhất + đường nét đứt = mục tiêu đang nhập; Tháng gần nhất · TB 3 / 6 tháng · Thấp nhất / Cao nhất · Tăng trưởng TB/tháng · Cùng kỳ năm trước (khi có 13 tháng). Dữ liệu lấy theo nguồn đang chọn cho baseline (`server/services/target-reference-service.js`, công thức ở `shared/target-reference.js`).
- Nút gợi ý: Giữ mức hiện tại (TB 3 tháng) · Tăng/Giảm X% · Theo xu hướng · Hòa vốn (Doanh thu = chi phí tháng theo cấu hình hiện hành; wizard tính từ nhân sự ở bước 3). Làm tròn: tiền đến nghìn đồng, số lượng đến đơn vị, tỷ lệ 1 chữ số thập phân.
- Kiểm tra với 6 tháng qua (đạt 100% ở x/6 · mức Tốt ở y/6) và độ khó so với TB 3 tháng: Dễ < 90% · Vừa sức 90–110% · Thách thức ≤ 130% · Rất khó > 130% (thấp-là-tốt thì đảo chiều).
- Dự án chưa có dữ liệu: "Chưa có dữ liệu của dự án này" + tháng đầu ra mắt (đủ dữ liệu) của các dự án khác.
- Mục tiêu, trọng số, ngưỡng màu lưu theo **Hiệu lực từ tháng** (`baseline_versions`; `baseline_configs` = cấu hình ban đầu): mỗi tháng tính theo mục tiêu có hiệu lực ở tháng đó (cắt lỗ, tham chiếu); kỳ đang xem dùng phiên bản có hiệu lực ở ngày cuối kỳ.
- Không có khối "Việc cần xử lý" và không có thông báo (chuông). Thông tin hiện tại chỗ: badge cắt lỗ trên dòng Dashboard + khối Cắt lỗ ở Tổng quan; baseline quá hạn = thẻ xám "Chưa cập nhật"; kết nối lỗi = icon đỏ ở cột Kết nối (Quản lý dự án) + dòng "Kết nối … bị lỗi – Xem chi tiết" ở Tổng quan dự án (chỉ Admin, `connectionErrors` trong `/api/projects/:id/overview`).

## Deploy (Vercel)
- `api/index.js` bọc `createApp()` thành một serverless function; `vercel.json` phục vụ `public/` tĩnh và chuyển mọi đường dẫn khác (API, `/shared/*`) vào function.
- DB trên Vercel: SQLite **trong RAM** (`AWP_DB=:memory:`) — dữ liệu demo seed lại mỗi lần function khởi động lạnh; chỉnh sửa trên bản deploy không được giữ và có thể khác nhau giữa các instance.
- Biến môi trường: xem `.env.example` (`AWP_DB`, `AWP_SECRET_KEY`, `AWP_SESSION_SECRET`). `npm run build` = kiểm tra server khởi động được trên DB trong RAM.
