# AWP Product Hub — hướng dẫn chạy prototype

Yêu cầu: Node.js ≥ 22.13 (dùng `node:sqlite` có sẵn, không cần cài package).

```bash
npm start          # http://localhost:4310  (PORT=... để đổi cổng)
npm test           # unit + API test cho tiêu chí nghiệm thu
npm run reset-db   # xóa DB, seed lại cấu hình mẫu
AWP_TODAY=2026-11-04 PORT=4311 AWP_DB=/tmp/awp-demo.db npm start   # giả lập "hôm nay" (demo / nghiệm thu)
npm run demo:abc-studio   # kịch bản C: thêm sản phẩm Game C vào ABC Game Studio từ tháng hiện tại (Võ Nam chia đều cho Game A, B, C)
AWP_SCENARIO=A npm run reset-db   # DB kịch bản A thuần (4 nhân sự, chi phí cố định 100.000.000, không có đội game) để kiểm số liệu A1–A5
```

Đăng nhập bằng email (prototype, không mật khẩu). Tài khoản mẫu (đều "Đang hoạt động"): `khanh.mai@abcdigital.io` Khánh Mai (Admin), `huy.tran@abcdigital.io` Huy Trần (Viewer · tất cả dự án & sản phẩm), `quan.do@abcdigital.io` Quân Đỗ (Viewer · chỉ sản phẩm Zen Bell), `thanh.chau@abcdigital.io` Thành Châu (Viewer · dự án Zell App). Lịch sử thay đổi của dữ liệu mẫu ghi tên Khánh Mai. Admin có công tắc "Xem với vai trò…" trong menu tài khoản để xem thử giao diện Viewer.

## Cấu trúc
- `shared/` — công thức thuần dùng chung server/browser/test: `periods.js` (kỳ & hệ số), `cost-calculator.js`, `health-score.js`, `metric-catalog.js`, `format.js` (định dạng vi-VN).
- `shared/cost-timeline.js` — cấu hình chi phí theo ngày hiệu lực (xem mục dưới).
- `server/` — `node:http` + SQLite (`data/awp-hub.db`), REST API (`api-routes.js`: dashboard, chi phí team, nhân sự; `project-routes.js`: quản lý dự án, vòng đời, lịch sử), phân quyền (`auth.js`), mã hóa khóa bí mật AES-256-GCM (`secrets.js`, khóa ở env `AWP_SECRET_KEY` hoặc `data/secret.key`). Phiên đăng nhập = cookie ký HMAC (`AWP_SESSION_SECRET`), không lưu phía server.
- `public/components/` — khối giao diện dùng chung giữa wizard "Thêm dự án" và trang chỉnh sửa dự án (nhân sự, baseline, kết nối, thông tin, xem trước tác động, hộp thoại vòng đời).
- `server/data-sources/` — hợp đồng `DataSource.getMetric(projectId, metricKey, dateFrom, dateTo, platform)`; `MockDataSource` đọc `metric_daily` sinh bởi `mock-data-generator.js` (400 ngày, seed cố định, 30 ngày gần nhất được hiệu chỉnh khớp số nghiệm thu). Thay bằng connector GA4 / App Store Connect / Google Play bằng cách cài một lớp khác cùng interface trong `server/index.js`.
- `public/` — giao diện ES module thuần, không bước build.

## Quy ước tính toán đáng chú ý
- Kỳ cuộn kết thúc ở ngày gần nhất có đủ dữ liệu (mặc định hôm qua): 1/3/7/30/90/365 ngày; so với kỳ liền trước cùng độ dài. Kỳ Năm không có so sánh vì dữ liệu mẫu chỉ có 400 ngày.
- Điểm sức khỏe dùng % đạt chưa làm tròn rồi mới làm tròn điểm (cho ra 99,1% và 71,6%); màu từng baseline dùng % đạt đã làm tròn 1 chữ số.
- Biểu đồ chi phí theo thời gian: chi phí mỗi cột = chi phí tháng × số ngày làm việc trong cột ÷ số ngày làm việc/tháng (cuối tuần không phát sinh).
- Điểm Store gộp iOS/Android = trung bình đơn giản; tỷ lệ D7/crash = trung bình theo ngày.

## Cấu hình theo ngày hiệu lực & vòng đời dự án
- Bảng `config_versions` lưu mọi thay đổi ảnh hưởng chi phí: thiết lập team, chi phí từng nhân sự, phân công (effort + % chi phí chung) của từng dự án, trạng thái dự án. Cấu hình của ngày D = phiên bản mới nhất có ngày hiệu lực ≤ D. Chi phí một kỳ = chi phí tháng trung bình theo ngày trong kỳ × hệ số kỳ (cấu hình không đổi thì ra đúng bảng hệ số cũ).
- Tháng đã chốt sổ = mọi tháng trước tháng hiện tại; không thay đổi nào được có hiệu lực trong đó.
- Chỉ dự án **Đang chạy** nhận effort và chi phí chung. Tạm dừng / Lưu trữ: chi phí = 0, effort được giải phóng. Dashboard hiện dự án Đang chạy + Tạm dừng (Tạm dừng không xếp hạng); Lưu trữ và Nháp bị ẩn.
- Xóa vĩnh viễn (chỉ dự án đã Lưu trữ) xóa dữ liệu chỉ số, kết nối, baseline nhưng giữ các phiên bản chi phí; các kỳ cũ hiển thị dòng "Dự án đã xóa".
- Mọi thay đổi ghi vào `audit_log` (người, thời điểm, giá trị cũ → mới, ngày hiệu lực, lý do) — tab "Lịch sử thay đổi" của từng dự án; thay đổi cấp team xem qua `GET /api/team-history`.

## Chốt sổ & phương án cắt lỗ
- Tháng N chốt sổ vào ngày 3 của tháng N+1 (`shared/closing.js`). Tháng đã chốt không nhận thay đổi nào và là dữ liệu duy nhất dùng để đánh giá cắt lỗ.
- `AWP_TODAY` giả lập ngày hệ thống (`server/clock.js`): dữ liệu mẫu, tháng đã chốt và ngày hiệu lực đều theo ngày này. Dữ liệu mẫu của Mindfulness Bell cho các tháng 05–10/2026 ra đúng lãi/lỗ trong đặc tả cắt lỗ, nhưng chỉ khi tháng đó đã đủ dữ liệu — tháng 10/2026 đủ từ ngày giả lập 04/11/2026.
- Đánh giá (`shared/stop-loss.js`) chạy mỗi khi xem trạng thái; khi chạm ngưỡng chỉ tạo **đề xuất** (badge "Chạm ngưỡng cắt lỗ" trên Dashboard + khối Cắt lỗ ở Tổng quan; không có thông báo). Dự án chỉ thay đổi khi Admin chọn "Thực hiện".
- Bảng: `stoploss_policies`, `stoploss_proposals`, `notifications`, `app_settings` (chính sách mặc định).

## Baseline & điểm sức khỏe
- Mỗi dự án 1–5 baseline, trọng số 1–100%. Điểm chỉ tính trên baseline đã có dữ liệu ("Tính trên 2/3 baseline"); chưa baseline nào có dữ liệu → "Đang thu thập dữ liệu".

## Người dùng & phân quyền
- `users` (tài khoản đăng nhập) tách biệt với `members` (Nhân sự — hồ sơ tính chi phí). Phiên (cookie ký) chỉ chứa id người dùng; vai trò, phạm vi xem, trạng thái đọc lại từ DB mỗi request → đổi vai trò/khóa có hiệu lực ở lần tải trang kế tiếp.
- Viewer chỉ thấy Dashboard / Tổng quan / Marketing của dự án trong phạm vi; mọi API đọc đều lọc theo phạm vi, ngoài phạm vi → 403 "Bạn không có quyền truy cập". Viewer giới hạn dự án chỉ thấy tổng của các dự án đó (không có chi phí chưa phân bổ / tỷ trọng team).
- Luôn còn ≥ 1 Admin đang hoạt động; không tự xóa/khóa/hạ quyền mình. Xóa là xóa mềm: lịch sử giữ "Tên (đã xóa)" (`audit_log.actor_user_id`).
- Thêm người dùng → trạng thái "Đã mời" + link `#/invite/<token>` (prototype không gửi email).

## Dữ liệu không có kết nối sẵn
- Mỗi baseline có **Nguồn**: kết nối gốc của chỉ số (GA4 / Store / YouTube Analytics), **Nhập thủ công** (kỳ ngày/tuần/tháng) hoặc **Tải lên CSV**. Đổi nguồn theo ngày hiệu lực (`baseline_sources`): trước ngày đổi giữ nguồn cũ, từ ngày đổi dùng nguồn mới; biểu đồ trong panel có vạch "Đổi nguồn: …".
- `manual_values` lưu mọi lần nhập (người, thời điểm; bản cũ có `replaced_at`). Baseline thủ công tính theo kỳ của nó; kỳ đã kết thúc mà chưa nhập sau 3 ngày → thẻ baseline xám "Chưa cập nhật", không tính điểm (không có thông báo nhắc).
- CSV: cột `date,metric_key,platform,value`; xem trước báo lỗi từng dòng; chọn ghi đè hoặc bỏ qua dòng trùng (tab Kết nối dữ liệu).
- Loại dự án **Game YouTube Playables**: danh mục baseline riêng; doanh thu cho lãi/lỗ = Doanh thu (phần YouTube Playables); Marketing = kênh YouTube + landing page.
- **Giai đoạn** (`project_phases`): Xây dựng / Ra mắt / Tăng trưởng / Ổn định, đổi theo ngày hiệu lực kèm gợi ý bộ baseline (`shared/phases.js`). Giai đoạn Xây dựng: không xét Lời/Lỗ, hiện "Đang đầu tư · đã dùng X% ngân sách"; chi phí lũy kế lấy từ baseline "Chi phí lũy kế" (nhập thủ công), nếu chưa có thì từ chi phí hệ thống kể từ ngày bắt đầu Xây dựng.
- Dự án mẫu "Game A", "Game B" (YouTube Playables + iOS + Android) và hai dự án không giao nhân sự nội bộ (FTE 0) nên không làm đổi các số chi phí mẫu của Zen Bell / Mindfulness Bell.

## Dự án & Sản phẩm, nền tảng phát hành
- Hai cấp: **Dự án** (cấp trên, `projects.kind = 'folder'`) và **Sản phẩm** (cấp dưới, `kind = 'project'`). Mỗi sản phẩm bắt buộc thuộc đúng 1 dự án ("Thuộc dự án", `config_versions.membership` = `{ parentId }`); chuyển sang dự án khác có ngày hiệu lực → các kỳ trước vẫn cộng cho dự án cũ.
- Dự án không có dữ liệu riêng (không Marketing, baseline, kết nối, giai đoạn); mọi số liệu = tổng các sản phẩm, nền tảng = gộp nền tảng sản phẩm. Trang duy nhất: Trang tổng hợp (`#/projects/:id/overview`; URL Marketing tự chuyển về đây): "1 Tốt · 1 Đang xây dựng", hàng tổng, bảng "Sản phẩm" (sắp xếp được, bấm dòng → Sản phẩm → Tổng quan), biểu đồ doanh thu + chi phí, tỷ trọng chi phí giữa các sản phẩm, nhân sự chung của dự án, khối cắt lỗ (chỉ khi bật).
- Điểm tổng hợp = trung bình điểm các sản phẩm theo chi phí kỳ (tất cả chi phí 0 → trung bình đều), bỏ sản phẩm Xây dựng / Tạm dừng / chưa có điểm; không còn sản phẩm nào → "Chưa có điểm". Ngưỡng màu: tab Thông tin của dự án (mặc định Tốt > 80%, Báo động < 50%).
- Cấu hình → "Quản lý dự án & sản phẩm": bảng cây Dự án → Sản phẩm, nút "Thêm dự án" (`#/config/projects/new`, 4 bước: Thông tin → Nhân sự chung → Mẫu cho sản phẩm mới → Xem lại & kích hoạt) và "Thêm sản phẩm" (`#/config/products/new[?project=ID]`, 5 bước; ô "Thuộc dự án" bắt buộc, có tìm kiếm, tự điền theo "Mẫu cho sản phẩm mới"). Tab sửa dự án: Thông tin · Nhân sự chung · Mẫu cho sản phẩm mới · Phương án cắt lỗ · Lịch sử thay đổi. Dòng dự án: số tổng hợp, cột Kết nối / Giai đoạn "—".
- Nhân sự chung của dự án luôn chia xuống các sản phẩm đang chạy (`parent_split` = `{ method, manualPct }`: Chia đều · Theo FTE trực tiếp · Theo doanh thu · Thủ công %); dự án không giữ chi phí. Chưa có sản phẩm đang chạy → "Dự án chưa có sản phẩm để chia chi phí", chi phí nằm ở "Chưa phân bổ".
- Xóa: sản phẩm phải lưu trữ trước ("Hãy lưu trữ sản phẩm trước khi xóa"); dự án xóa được ở mọi trạng thái khi không còn sản phẩm chưa lưu trữ, nếu còn thì nút Xóa khóa với tooltip "Hãy chuyển hoặc lưu trữ các sản phẩm trước khi xóa dự án".
- Mẫu: dự án Zell App → sản phẩm Zen Bell, Mindfulness Bell; dự án ABC Game Studio → Game A (Xây dựng, ngân sách 150.000.000, ra mắt dự kiến 31/03/2027) và Game B (Tăng trưởng, #6B7F2A, baseline nhập thủ công). Đội game từ 01/04/2026: Võ Nam (Game Developer, 24.000.000) 100% nhân sự chung của ABC Game Studio (chia đều), Đỗ Vy (Game Artist, 18.000.000) Game A 50% · Game B 30%; chi phí cố định team 152.000.000 từ cùng ngày (quỹ chung 30.000.000 → Zell App vẫn 92.000.000). `npm run demo:abc-studio` (kịch bản C) thêm Game C.
- Trạng thái "Nháp" ≠ giai đoạn "Xây dựng": sản phẩm Nháp chưa tính chi phí, không nhận phần chia nhân sự chung, không hiện trên Dashboard; sản phẩm giai đoạn Xây dựng đã kích hoạt nên tính đủ nhân sự trực tiếp + phần chia nhân sự chung + chi phí chung của team, chỉ khác: không hiện Lời/Lỗ ("Đang đầu tư") và không tính vào điểm tổng hợp. Tổng quan sản phẩm liệt kê nhân sự trực tiếp và "Chia từ nhân sự chung của <dự án>"; khối Tài chính có "Chi phí lũy kế từ <ngày bắt đầu tính chi phí>" = Σ chi phí các tháng, tháng hiện tại theo số ngày làm việc đã qua ÷ ngày làm việc/tháng. Thanh ngân sách dùng số "Chi phí lũy kế" nhập thủ công nếu có, nếu không thì số hệ thống.
- Effort của một người trên mọi sản phẩm và nhân sự chung của dự án ≤ 100%.
- Cắt lỗ cấp dự án (mặc định tắt) đánh giá trên lãi/lỗ tháng tổng các sản phẩm; "Thực hiện" áp dụng cho cả sản phẩm. Tạm dừng / lưu trữ / tiếp tục dự án hỏi "Áp dụng cho tất cả N sản phẩm?".
- Viewer: phạm vi chọn theo dự án (gồm mọi sản phẩm, kể cả tạo sau) hoặc từng sản phẩm. Mẫu: `thanh.chau@abcdigital.io` = dự án Zell App; `quan.do@abcdigital.io` = chỉ Zen Bell (menu hiện "Zell App ▸ Zen Bell", tên Zell App không bấm được vì không có quyền xem cả dự án — `lockedParents` trong `/api/meta`).
- Nâng cấp DB: dự án có con → Dự án; dữ liệu riêng của ABC Game Studio mẫu chuyển sang Game B; sản phẩm chưa thuộc dự án nào được đưa vào "Dự án chung"; chữ trong Lịch sử thay đổi đổi sang "dự án / sản phẩm". Sao lưu DB trước khi nâng cấp.
- Nâng cấp từ bản có "Nhóm dự án": mỗi nhóm tự chuyển thành một dự án (trạng thái, nhân sự chung + cách chia, mẫu, cắt lỗ, lịch sử, phạm vi Viewer).
- **Nền tảng phát hành** (iOS · Android · Website · YouTube Playables) thay "Loại sản phẩm" (`shared/release-platforms.js`): quyết định kết nối hiển thị, danh mục baseline (hợp các nền tảng) và chỉ số gộp — Người dùng mới gồm cả Người chơi Playables.
- **Một chỉ số "Doanh thu"** (`revenue`) cho toàn hệ thống, lưu theo nền tảng `ios` / `android` / `playables`: số tiền team thực nhận (đã trừ phí Store / nền tảng), quy ra VND — iOS từ App Store Connect, Android từ Google Play Console (USD × tỷ giá), YouTube Playables nhập thủ công hoặc CSV (`revenue,playables`). Nhãn "Doanh thu" có tooltip giải thích; panel baseline tách "iOS · Android · Playables". Lời/Lỗ = Doanh thu − Chi phí kỳ; gợi ý "Hòa vốn" và điều kiện cắt lỗ "Doanh thu tháng ≥ Z% chi phí tháng" dùng chỉ số này.
- Form "Cập nhật số liệu" của sản phẩm có Playables luôn có ô **Doanh thu – YouTube Playables** (bảng `manual_values` có cột `platform`). Nền tảng iOS/Android chưa cấu hình kết nối Store không chặn tổng Doanh thu (Game B chỉ có phần Playables).
- DB cũ được nâng cấp tự động khi khởi động: chỉ số cũ "Doanh thu chia sẻ quảng cáo" (`ad_revenue_share`) → `revenue` nền tảng `playables` (số liệu, giá trị nhập tay, baseline, nguồn, mục tiêu, mẫu sản phẩm, điều kiện cắt lỗ).

## Trợ lý (trang mặc định)
- Menu **✦ Trợ lý** nằm trên Dashboard và là trang mở ra khi đăng nhập / vào app. Giao diện là khung chat; gõ câu như "Doanh thu Zen Bell hôm nay" thì một mục số liệu hiện phía trên khung chat, mỗi mục có nút ✕ để xóa.
- Câu hỏi được đọc bằng luật từ khóa trong `shared/assistant-intent.js` (không gọi dịch vụ AI): chỉ số (doanh thu, chi phí, lãi/lỗ, điểm sức khỏe, các baseline như DAU, lượt tải…), tên dự án / sản phẩm (có dấu hoặc không) và kỳ (hôm nay = ngày gần nhất có đủ dữ liệu, 3 ngày, tuần, tháng, quý, năm; không nêu kỳ thì theo bộ lọc thời gian đang chọn). Không nêu dự án / sản phẩm = toàn team (Viewer: phạm vi được xem); chỉ nêu tên = tổng quan.
- Số liệu lấy từ `/api/dashboard` nên đúng phân quyền. Trình duyệt chỉ nhớ câu hỏi (localStorage theo người dùng), số liệu được lấy lại mỗi lần mở trang.

## Bộ lọc thời gian, nguồn promote, giao diện
- Bộ lọc thời gian mặc định **Tháng** = 30 ngày gần nhất, kết thúc ở ngày gần nhất có đủ dữ liệu (thường là hôm qua), không phải "từ đầu tháng". Lựa chọn giữ nguyên khi chuyển trang trong cùng phiên đăng nhập; mỗi lần đăng nhập / đăng xuất trở về "Tháng".
- Marketing → Nguồn tải app theo kênh có dòng **Promote từ nền tảng khác** (màu #7A5AF8), mở ▸ để xem từng nguồn con; dòng cha = tổng đúng các nguồn con.
- Quản lý nguồn con: Quản lý dự án → dự án → Kết nối dữ liệu → **Nguồn promote** (Admin; bảng `promo_sources`). Mỗi nguồn (tên + mã, hoặc chọn một dự án khác trong hệ thống → tự lấy tên dự án) có 3 link theo dõi để sao chép: web `utm_source=<mã>&utm_medium=promote`, App Store `ct=<mã>` (kèm `pt=` khi kết nối App Store Connect có Provider token), Google Play `referrer=utm_source=<mã>…`. Nguồn mới tạo hiển thị 0 cho tới khi có dữ liệu.
- Dữ liệu mẫu có phiên bản (`MOCK_DATA_VERSION` trong `server/data-sources/mock-data-generator.js`): đổi generator thì tăng số này, server tự sinh lại dữ liệu mẫu khi khởi động.
- Nút giao diện ở thanh trên cùng (☀ Sáng · ☾ Tối · ◐ Tự động theo máy), mặc định Sáng, nhớ lựa chọn trong trình duyệt.

## Gợi ý mục tiêu/tháng từ dữ liệu lịch sử
- Bước "Baseline & trọng số" (wizard) và tab tương ứng khi sửa sản phẩm: mỗi baseline có khối **Tham chiếu**, mặc định ẩn — link "Xem tham chiếu ▾" dưới ô Mục tiêu/tháng (mở/đóng từng baseline, "Mở tất cả tham chiếu / Ẩn tất cả" ở đầu danh sách, không nhớ trạng thái) — 6 tháng đã chốt gần nhất (cột) + đường nét đứt = mục tiêu đang nhập; Tháng gần nhất · TB 3 / 6 tháng · Thấp nhất / Cao nhất · Tăng trưởng TB/tháng (kép) · Cùng kỳ năm trước (khi có 13 tháng). Chỉ số cộng dồn dùng tổng tháng, chỉ số trung bình/tỷ lệ dùng trung bình tháng; dữ liệu lấy theo nguồn đang chọn cho baseline (`server/services/target-reference-service.js`, công thức ở `shared/target-reference.js`).
- Nút gợi ý: Giữ mức hiện tại (TB 3 tháng) · Tăng/Giảm X% · Theo xu hướng · Hòa vốn (Doanh thu = chi phí tháng theo cấu hình hiện hành; wizard tính từ nhân sự ở bước 3). Làm tròn: tiền đến nghìn đồng, số lượng đến đơn vị, tỷ lệ 1 chữ số thập phân.
- Kiểm tra với 6 tháng qua (đạt 100% ở x/6 · mức Tốt ở y/6) và độ khó so với TB 3 tháng: Dễ < 90% · Vừa sức 90–110% · Thách thức ≤ 130% · Rất khó > 130% (thấp-là-tốt thì đảo chiều).
- Sản phẩm chưa có dữ liệu: "Chưa có dữ liệu của sản phẩm này" + tháng đầu ra mắt (đủ dữ liệu) của các sản phẩm khác cùng dự án.
- Mục tiêu, trọng số, ngưỡng màu lưu theo **Hiệu lực từ tháng** (`baseline_versions`; `baseline_configs` = cấu hình ban đầu): mỗi tháng tính theo mục tiêu có hiệu lực ở tháng đó (cắt lỗ, tham chiếu); kỳ đang xem dùng phiên bản có hiệu lực ở ngày cuối kỳ.
- Không có khối "Việc cần xử lý" và không có thông báo (chuông). Thông tin hiện tại chỗ: badge cắt lỗ trên dòng Dashboard + khối Cắt lỗ ở Tổng quan; baseline quá hạn = thẻ xám "Chưa cập nhật"; kết nối lỗi = icon đỏ ở cột Kết nối (Quản lý dự án & sản phẩm) + dòng "Kết nối … bị lỗi – Xem chi tiết" ở Tổng quan sản phẩm (chỉ Admin, `connectionErrors` trong `/api/projects/:id/overview`).
- Nút mở/thu dự án (menu trái, Dashboard, Quản lý dự án & sản phẩm) dùng chung `branchToggle` / `branchState` (`public/ui.js`): nút riêng 32×32 (44×44 trên điện thoại), chỉ mở/thu; bấm tên dự án mở Trang tổng hợp và mở danh sách sản phẩm. Trạng thái nhớ trong phiên (sessionStorage); xem một sản phẩm thì dự án chứa nó tự mở.
- Dữ liệu mẫu: doanh thu Zen Bell theo tháng T5–T10/2026 = 52.000.000 · 54.500.000 · 56.000.000 · 58.400.000 · 60.100.000 · 62.400.000 (tháng 10 chốt sổ ngày 03/11 — xem đủ 6 tháng với `AWP_TODAY=2026-11-04`).

## Deploy (Vercel)
- `api/index.js` bọc `createApp()` thành một serverless function; `vercel.json` phục vụ `public/` tĩnh và chuyển mọi đường dẫn khác (API, `/shared/*`) vào function.
- DB trên Vercel: SQLite **trong RAM** (`AWP_DB=:memory:`) — dữ liệu mẫu seed lại mỗi lần function khởi động lạnh; chỉnh sửa trên bản deploy không được giữ và có thể khác nhau giữa các instance.
- Biến môi trường: xem `.env.example` (`AWP_DB`, `AWP_SECRET_KEY`, `AWP_SESSION_SECRET`). `npm run build` = kiểm tra server khởi động được trên DB trong RAM.

