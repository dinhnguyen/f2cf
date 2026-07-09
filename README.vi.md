[English](README.md) | Tiếng Việt

# F2CF (Framer to Cloudflare)

Công cụ chạy trên máy của bạn để quản lý nhiều website Framer: sao chép (clone) site về, kiểm tra khi Framer có bản mới, xem thử, và đăng (publish) lên Cloudflare Pages - tất cả qua một trang dashboard trong trình duyệt.

Hướng dẫn này viết cho người chưa biết gì. Làm lần lượt từng bước là chạy được.

---

## 1. Nó dùng để làm gì

Bạn thiết kế website trên Framer. Framer cho bạn một địa chỉ dạng `https://tên.framer.website/`. F2CF giúp bạn:

- Tải toàn bộ site đó về máy.
- Đưa site lên Cloudflare Pages (hosting miễn phí, nhanh) dưới địa chỉ `https://tên.pages.dev`.
- Khi bạn sửa lại trên Framer, bấm một nút để cập nhật bản trên Cloudflare.
- Tự động gỡ mã theo dõi (tracking) và ẩn logo "Made in Framer".

Nguồn gốc nội dung luôn là Framer. Bạn sửa trên Framer, rồi đồng bộ về và đăng lại. Công cụ này không sửa nội dung.

---

## 2. Chuẩn bị (cài một lần)

### 2.1. Cài Node.js

Đây là phần mềm để chạy công cụ. Cần bản 18 trở lên.

- Vào https://nodejs.org, tải bản "LTS", cài như phần mềm bình thường.
- Kiểm tra: mở Terminal (trên Mac: bấm `Cmd + dấu cách`, gõ "Terminal", Enter) rồi gõ:

```bash
node --version
```

Nếu hiện ra số kiểu `v20.x.x` hoặc cao hơn là được. Nếu báo "command not found" thì Node chưa cài xong.

Sau đó vào thư mục công cụ chạy `npm install` một lần để cài thư viện (trong đó có `playwright`, dùng cho bước dò quét tự động).

### 2.2. Có một tài khoản Cloudflare

Miễn phí. Đăng ký tại https://dash.cloudflare.com/sign-up nếu chưa có.

### 2.3. Đăng nhập Cloudflare trên máy

Mở Terminal, đi vào thư mục công cụ rồi đăng nhập.

Lưu ý: `đường-dẫn/tới/f2cf` là chỗ giữ chỗ - thay bằng đường dẫn thật tới thư mục `f2cf` trên máy bạn (nơi bạn giải nén / lưu nó). Mẹo trên Mac: gõ `cd ` (có dấu cách ở cuối), rồi kéo thả thư mục `f2cf` từ Finder vào cửa sổ Terminal - nó tự điền đường dẫn đúng, xong bấm Enter.

```bash
cd đường-dẫn/tới/f2cf
npx wrangler login
```

- Lần đầu chạy `npx wrangler` nó sẽ tự tải công cụ Cloudflare về (chờ một chút).
- Trình duyệt sẽ mở ra, bấm "Allow" để cho phép.
- Thấy dòng "Successfully logged in" là xong.

Kiểm tra đã đăng nhập đúng chưa:

```bash
npx wrangler whoami
```

Nó hiện email và tên tài khoản của bạn.

---

## 3. Khởi động dashboard

Mỗi lần muốn dùng, mở Terminal và chạy:

```bash
cd đường-dẫn/tới/f2cf
npm start
```

Thấy dòng:

```
F2CF: http://127.0.0.1:4599
```

Mở trình duyệt, vào địa chỉ **http://127.0.0.1:4599**

Cứ để cửa sổ Terminal đó chạy. Muốn tắt công cụ thì quay lại Terminal bấm `Ctrl + C`.

Ghi chú: lúc mới mở, dashboard có thể trống khoảng 1-3 giây (đang kiểm tra đăng nhập Cloudflare) rồi mới hiện danh sách. Bình thường.

---

## 4. Dùng dashboard

Trên cùng là ô đăng nhập Cloudflare (dấu tích xanh + email nếu đã đăng nhập), ô thêm site, và bảng danh sách các site.

### 4.1. Thêm một site mới

1. Dán địa chỉ Framer vào ô đầu (ví dụ `https://tensite.framer.website/`).
2. Ô thứ hai "cloudflare project" để trống cũng được - nó tự đặt tên theo địa chỉ. Muốn tên khác thì gõ vào.
3. Bấm **+ Thêm site**.

Công cụ sẽ tạo project trên Cloudflare (nếu chưa có), tải site về, và hiện nó trong bảng. Khu vực log phía dưới chạy chữ cho biết tiến trình.

### 4.2. Các nút trên mỗi site

| Nút | Việc nó làm |
|-----|-------------|
| **Check** | Hỏi Framer xem site đã đổi chưa. Nếu đổi, nhãn chuyển thành "có bản mới". |
| **Sync** | Tải lại bản mới nhất từ Framer về máy (chưa đăng lên mạng). |
| **Preview** | Mở một tab mới xem thử bản đã tải về (chạy trên máy bạn). Phải Sync trước thì mới có gì để xem. |
| **Publish** | Đăng bản đã tải lên Cloudflare Pages. Sau bước này địa chỉ `.pages.dev` mới cập nhật. |
| **✕** | Xoá site khỏi danh sách và xoá bản tải về trên máy. KHÔNG xoá project bên Cloudflare. |

### 4.3. Quy trình thường dùng

1. Sửa nội dung trên Framer, bấm Publish bên Framer.
2. Về dashboard bấm **Check** - thấy "có bản mới".
3. Bấm **Sync** để tải bản mới về.
4. Bấm **Preview** xem lại cho chắc.
5. Bấm **Publish** để đưa lên mạng.

Nhãn trạng thái:

- **chưa sync**: mới thêm, chưa tải về.
- **up to date**: bản trên máy khớp với Framer.
- **có bản mới**: Framer đã đổi, nên Sync lại.

Nút **Publish** bị mờ (không bấm được) nếu bạn chưa đăng nhập Cloudflare. Chạy lại `npx wrangler login` là bấm được.

---

## 5. Cách dùng bằng dòng lệnh (không bắt buộc)

Nếu chỉ muốn tải nhanh một site ra thư mục mà không cần dashboard:

```bash
node cli.mjs --from-url https://tensite.framer.website/ --out thu-muc-dich
```

Các tuỳ chọn thêm:

| Cờ | Ý nghĩa |
|----|---------|
| `--out <thư mục>` | Nơi lưu kết quả (mặc định `dist`). |
| `--origin <url>` | Địa chỉ site sẽ được deploy (ví dụ `https://tensite.pages.dev`). Có cờ này thì tải về **toàn bộ** font, ảnh, module, dữ liệu CMS - site không còn gọi về máy chủ Framer nữa. |
| `--keep-cdn` | Không tải asset về, để load từ CDN Framer. |
| `--keep-tracking` | Giữ mã theo dõi và thanh editor của Framer. |
| `--keep-badge` | Giữ logo "Made in Framer". |

Mặc định (không thêm cờ) là bản sạch: gỡ tracking, ẩn badge, tải ảnh trong HTML về. Dashboard luôn dùng chế độ `--origin` (tự lấy địa chỉ `*.pages.dev` của project) nên site tải qua dashboard là bản tách hoàn toàn khỏi Framer.

---

## 6. Dữ liệu lưu ở đâu

Nằm trong thư mục `f2cf`:

- `registry.json` - danh sách các site bạn quản lý (địa chỉ, tên project, thời gian sync/publish).
- `sites/<tên>/dist/` - bản site đã tải về của từng site.

Hai thứ này chỉ nằm trên máy bạn, không đưa lên git. Xoá `registry.json` là mất danh sách (nhưng site trên Cloudflare vẫn còn).

Muốn nạp sẵn một site mẫu để thử (sửa danh sách site trong `seed.mjs`):

```bash
node seed.mjs
```

---

## 7. Điều quan trọng cần biết

- **Site được tách hoàn toàn khỏi hạ tầng Framer.** Font, ảnh, module JS, icon và dữ liệu CMS đều được tải về và phục vụ từ Cloudflare; thanh editor của Framer (vốn gọi về `framer.com` với mọi khách truy cập) bị vô hiệu. Còn lại trên máy chủ ngoài chỉ có Google Fonts (giữ nguyên vì CDN Google nhanh) và các embed bên thứ ba như Google Maps, YouTube - những thứ này là dịch vụ chạy trực tiếp, không tải về được.
- **Ảnh phục vụ ở kích thước gốc.** CDN Framer có tính năng resize ảnh theo tham số (`?width=...`); bản tự host trả đúng file gốc cho mọi kích thước nên trang có thể nặng hơn chút trên màn hình nhỏ.
- **Cần cài `playwright`** (đã nằm trong `package.json`, `npm install` là đủ) để bước dò quét tự động tìm các file mà site chỉ nạp lúc chạy (icon, dữ liệu CMS). Thiếu nó công cụ vẫn chạy nhưng vài icon/section động có thể bị thiếu.
- **Mỗi lần chỉ tải một trang** - đúng trang ở địa chỉ bạn đưa. Chưa tự đi theo các trang con.
- **Một chiều Framer -> máy.** Đừng sửa file đã tải về; sửa trên Framer rồi Sync lại.
- Công cụ chỉ chạy nội bộ (`127.0.0.1`), người ngoài mạng không vào được dashboard của bạn.

---

## 8. Gặp sự cố

| Hiện tượng | Cách xử lý |
|-----------|-----------|
| `node: command not found` | Chưa cài Node.js (mục 2.1). |
| Dashboard không mở được | Kiểm tra Terminal còn chạy `npm start` không; đúng địa chỉ `http://127.0.0.1:4599`. |
| Nút Publish mờ | Chưa đăng nhập Cloudflare. Chạy `npx wrangler login`. |
| Preview báo trắng / lỗi | Bấm **Sync** cho site đó trước, rồi Preview lại. |
| Cổng 4599 đang bận | Chạy `PORT=4600 npm start` rồi vào `http://127.0.0.1:4600`. |
| Site tải về bị lỗi vài ảnh | Bình thường nếu Framer chặn tạm; công cụ tự thử lại. Ảnh lỗi vẫn để trên CDN Framer, site vẫn chạy. |

Muốn kiểm tra công cụ còn hoạt động đúng:

```bash
npm test
```
