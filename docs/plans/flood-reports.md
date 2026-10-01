# Plan: ให้คนในพื้นที่รายงานจุดน้ำท่วม

> Status: in progress (ขั้น 2 เสร็จ) · Date: 2026-10-01 · Spec: [docs/specs/flood-reports.md](../specs/flood-reports.md) · Intent: [docs/intent/flood-reports.md](../intent/flood-reports.md)

วิธี: tracer bullet ทำเส้นทางที่บางที่สุดให้วิ่งครบทุกชั้นก่อน (API → logic → store → test) แล้วค่อยเติมกติกา
repo นี้ไม่มีฐานข้อมูล ชั้นเก็บข้อมูลคือ `ReportStore` ในหน่วยความจำตาม spec

กติกาทุกขั้น

- เขียน test ก่อน เห็นมันแดง แล้วค่อยเขียนโค้ดให้เขียว
- ทุก test ที่เกี่ยวกับรายงานส่ง `store` / `limiter` ใหม่เข้าไปเอง และใช้ `now` ที่กำหนดเอง
- จบขั้นเมื่อ `npm test` และ `npm run lint` ผ่าน แล้ว commit หนึ่งครั้ง
- **ห้าม merge เข้า `main` หรือ deploy** จนกว่าขั้น 7 และ RPT-REQ-010 (Later) จะเสร็จ ระหว่างนั้น `POST /reports` ยังไม่มี rate limit หรือจำกัดขนาด body

## บันทึกการเปลี่ยนลำดับ

- 2026-10-01: ผู้ใช้สั่งให้เขียน implementation ให้ test ใน `tests/reports.test.ts` ผ่านก่อน จึงทำ**ขั้น 2 ก่อนขั้น 1**
- ตอนทำขั้น 2 โค้ดของ `src/reports.ts` ครอบคลุมส่วน store ของขั้น 4 (รูปมาตรฐานจุดสังเกต) และขั้น 5 (กรณีขอบของการรวม) ไปด้วย ซึ่งเขียนก่อน test ขัดกับกติกา test ก่อน ผู้ใช้เลือกให้**เก็บโค้ดไว้และเขียน test ตามหลัง** แล้วพิสูจน์ด้วยการทำให้โค้ดผิดทีละจุด (7 แบบ) ว่า test แดงทุกครั้ง
- จากผลรีวิว ขั้น 1 ต้องมีการตรวจข้อมูลขั้นต่ำ เพื่อไม่ให้ `POST /reports` รับอะไรก็ได้ระหว่างขั้น 1–3
- `ReportStore.submit` ปฏิเสธความลึกที่ไม่ใช่จำนวนเต็ม ≥ 1 และ `seenAt` ที่ parse ไม่ได้ ก่อนแตะ store (ด่านที่สองหลัง validation ที่ handler)

## คืนนี้

### 1. Tracer bullet: POST → store → GET

- [ ] test ก่อน ใน `tests/app.test.ts`
  - [ ] `POST /reports` ข้อมูลถูกต้อง → `201`, `merged: false`, มี `reportsNotice` (RPT-REQ-001 กรณีปกติ, RPT-REQ-009)
  - [ ] `GET /districts/lat-phrao` หลัง POST → `reports` มี 1 รายการ **7 key พอดี** เวลาเป็น `+07:00` และมี `reportsNotice` (RPT-REQ-006, RPT-REQ-009)
  - [ ] เขตที่ไม่มีรายงาน → `reports: []` (RPT-REQ-006)
  - [ ] ตรวจขั้นต่ำ: body ไม่ใช่ object, ช่องใดชนิดผิด หรือ `depthCm` ไม่ใช่จำนวนเต็ม 1–300 → `400` และ store ไม่เปลี่ยน (RPT-REQ-001 บางส่วน)
- [ ] `src/app.ts`: route `POST /reports` เรียก `ReportStore` ที่มีอยู่แล้ว, เพิ่ม `reports` / `reportsNotice` ใน `GET /districts/:id`, `toPublicReport`, ขยาย `Context` ให้รับ `store`
- [ ] test เดิมใน `tests/app.test.ts` ผ่านโดยไม่แก้

### 2. กฎหลัก: รวมรายงานและหมดอายุ ✅

- [x] test ก่อน ใน `tests/reports.test.ts`
  - [x] ระดับความรุนแรงตามขอบ 20/21, 50/51 (RPT-REQ-002)
  - [x] ขอบ 1/10/11/30/31/300 และ `severityFor(0)`, `(-1)`, `(10.5)`, `(NaN)` โยน `RangeError` (RPT-REQ-002)
  - [x] รวมภายใน 2 ชม. ใช้ความลึกล่าสุด, ครบ 2 ชม. พอดียังรวม, เกิน 1 วินาทีเป็นรายงานใหม่ (ตรวจความลึกของทั้งสองรายงาน) (RPT-REQ-004)
  - [x] แจ้งจุดเดิม 3 ครั้ง → ประวัติการยืนยัน 3 รายการ เรียงตาม `seenAt` (RPT-REQ-004)
  - [x] ครบ 6 ชม. พอดียังแสดง, เกิน 1 วินาทีไม่แสดง (RPT-REQ-005)
  - [x] หลังหมดอายุ `store.all()` ยังมีรายงานนั้น (RPT-REQ-005)
  - [x] ความลึกผิดหรือ `seenAt` parse ไม่ได้ → `RangeError` และ store ไม่เปลี่ยน
- [x] `src/reports.ts`: `submit` รวมตาม `seenAt` และ `MERGE_WINDOW_MS`, เก็บ `Confirmation[]`, `active` กรองตาม `EXPIRY_MS`, `all()`

### 3. ตรวจข้อมูลที่ handler (ยกเว้นจุดสังเกต)

- [ ] test ก่อน
  - [ ] `depthCm` เป็น `40.5`, `"40"`, `0`, `301`, `-5` → `400` และมี `depthCm` ใน `fields`; `1` และ `300` ผ่าน (RPT-REQ-001)
  - [ ] `seenAt` ไม่มี timezone, ใช้ช่องว่างแทน `T`, offset `+0700`, วันที่ `2026-02-31` → `400` (RPT-REQ-001)
  - [ ] `seenAt` ย้อน 6 ชม. พอดีผ่าน / เกิน 1 วินาทีไม่ผ่าน; ล่วงหน้า 5 นาทีพอดีผ่าน / เกิน 1 วินาทีไม่ผ่าน (RPT-REQ-001)
  - [ ] `districtId` เป็น `"atlantis"` → `400` (RPT-REQ-001)
  - [ ] body เป็น `null`, array, ไม่มี body → `400` (RPT-REQ-001)
  - [ ] หลายช่องผิดพร้อมกัน → `fields` เรียง `districtId`, `landmark`, `depthCm`, `seenAt` (RPT-REQ-001)
  - [ ] body มี `phone` / `name` → ไม่อยู่ใน store และไม่อยู่ใน response (RPT-REQ-008)
- [ ] `src/reports.ts`: `validateReportInput(body, now)`
- [ ] `src/app.ts`: เรียก validation ก่อน `store.submit` ตอบ `400` พร้อม `fields`

### 4. จุดสังเกต: รูปมาตรฐาน + กันเบอร์โทร

- [ ] test ก่อน (ข้อความไทยพิเศษเขียนเป็น `\u` escape)
  - [x] ช่องว่างหัวท้าย/ซ้อน และตัวพิมพ์เล็กใหญ่ → จุดเดิม (RPT-REQ-003) *ทำตอนขั้น 2*
  - [x] มี `\u200B` และ `\u0E33` กับ `\u0E4D\u0E32` → จุดเดิม (RPT-REQ-003) *ทำตอนขั้น 2*
  - [x] `"ซอยลาดพร้าว 71"` กับ `"ซ.ลาดพร้าว 71"` และจุดสังเกตเดียวกันคนละเขต → ไม่ใช่จุดเดิม (RPT-REQ-003) *ทำตอนขั้น 2*
  - [x] รายงานแสดงข้อความแสดงของการแจ้งครั้งแรก (RPT-REQ-003) *ทำตอนขั้น 2*
  - [ ] `"   "`, `"\u200B"`, 101 code point, มี `\n` → `400`; 100 code point พอดีผ่าน (RPT-REQ-001)
  - [ ] `"หน้าบ้าน 081-234-5678"`, `"โทร 081 234 5678"`, `"๐๘๑๒๓๔๕๖๗๘"` → `400`; `"ซอย 12345678"` ผ่าน (RPT-REQ-001, RPT-REQ-008)
- [x] `src/reports.ts`: `displayLandmark`, `landmarkKey` ต่อเข้ากับ `submit` *ทำตอนขั้น 2*
- [ ] `src/reports.ts`: ต่อ `displayLandmark` เข้ากับ validation (ความยาว, อักขระควบคุม, เบอร์โทร)

### 5. กรณีขอบของการรวมรายงาน ✅ (ทำตอนขั้น 2)

- [x] test ใน `tests/reports.test.ts`
  - [x] ส่งช้า: `seenAt` = `t0-1ชม.` หลังจากมี `t0` แล้ว → รวม, `depthCm` ไม่เปลี่ยน, การยืนยันล่าสุดยังเป็น `t0` (RPT-REQ-004, edge case 2)
  - [x] `seenAt` เท่ากัน → ใช้ความลึกของอันที่ได้รับทีหลัง (RPT-REQ-004)
  - [x] สองรายงานของจุดเดิมอยู่ในช่วง 2 ชม. ทั้งคู่ → รวมเข้าอันที่การยืนยันล่าสุดใหม่กว่า (RPT-REQ-004, edge case 4)
  - [x] รายงานที่หมดอายุได้การยืนยันใหม่ → กลับมาแสดง (RPT-REQ-005, edge case 5)
- [x] `src/reports.ts`: เลือกรายงานเป้าหมาย, ใช้ `receivedAt` ตัดสินกรณีเท่ากัน

### 6. API: หนึ่งจุดหนึ่งรายการ + ลำดับ + response ของการยืนยัน

- [ ] test ก่อน ใน `tests/app.test.ts`
  - [ ] จุดเดิมแจ้งที่ `t0` และ `t0+2ชม.+1วินาที` ดูที่ `t0+3ชม.` → `reports` มี 1 รายการ เป็นอันใหม่ (RPT-REQ-006)
  - [ ] เรียงตาม `severity` มากไปน้อย แล้ว `lastConfirmedAt` ใหม่กว่าก่อน ผ่าน API (RPT-REQ-006) *ระดับ store มี test แล้ว*
  - [ ] แจ้งจุดเดิมซ้ำ → `200`, `merged: true` (RPT-REQ-001)
  - [ ] response ของ POST มี `expiresAt` = การยืนยันล่าสุด + 6 ชม. เป็น `+07:00` (RPT-REQ-001)
  - [ ] `GET /reports` → `404` (RPT-REQ-001)
- [ ] `src/app.ts`: ตัดจุดซ้ำด้วย `landmarkKey`, `expiresAt`, status `200` / `201`

### 7. Rate limit + IP

- [ ] test ก่อน ใน `tests/rate-limit.test.ts` (ใหม่) และ `tests/app.test.ts`
  - [ ] คำขอที่ 1–10 ผ่าน, ที่ 11 → `429` `{ error: "too many reports" }` และไม่สร้างรายงาน (RPT-REQ-007)
  - [ ] คำขอที่ได้ `400` ถูกนับ, ที่ได้ `429` ไม่ถูกนับ: ส่ง 20 ครั้งแล้วรอจนครั้งแรกพ้น 10 นาที → ส่งได้อีก (RPT-REQ-007)
  - [ ] อีก IP ไม่โดนผลกระทบ; `::ffff:1.2.3.4` กับ `1.2.3.4` ใช้โควตาเดียวกัน; ไม่มี IP → `"unknown"` (RPT-REQ-007)
  - [ ] IP A ส่งครั้งเดียว แล้ว IP B ส่งหลัง 10 นาที 1 วินาที → `limiter.size()` ไม่มี A (RPT-REQ-007, RPT-REQ-008)
  - [ ] response ไม่มี IP และรายงานไม่เก็บ IP (RPT-REQ-008)
- [ ] `src/rate-limit.ts` ใหม่: `RateLimiter`, `normalizeIp`
- [ ] `src/app.ts`: rate limit ก่อน validation, ขยาย `Context` ให้รับ `ip` / `limiter`
- [ ] `src/server.ts`: ส่ง `ip: req.socket.remoteAddress`

## Later

ต้องทำก่อน merge เข้า `main` หรือเปิดให้คนนอกใช้

- [ ] RPT-REQ-010: `server.ts` นับ body เป็น byte เกิน 10,240 byte ตอบ `413` หยุดอ่านทันที (ทั้ง 3 acceptance criteria)
- [ ] RPT-REQ-009: เปลี่ยนข้อความ `NOTICE` ให้มีคำว่า "สถานี" และ test ว่ามีคำนี้
- [ ] README หัวข้อ "ลองเรียก": เพิ่มตัวอย่าง `POST /reports` ไปที่ `localhost` เท่านั้น
- [ ] ไล่ acceptance criteria ใน spec ทีละข้อ ว่ามี test ครบ
- [ ] พิจารณาให้ `server.ts` ฟังที่ `127.0.0.1` เป็นค่าเริ่มต้น (จากรีวิว Pass 2) ต้องเพิ่มลง spec ก่อนทำ

## ความเสี่ยงและเรื่องที่ยังไม่แน่ใจ

- **state รั่วข้าม test:** `app.ts` มี instance กลางของ store / limiter ถ้า test ไหนลืมส่งของตัวเองเข้าไป state จะรั่วข้าม test และคำขอที่ไม่มี IP จะได้ `429` แบบสุ่ม
- **ข้อความไทยในโค้ดและ test:** ใช้ `\u` escape เสมอ เครื่องมือแก้ไฟล์ของ AI เคยแปลง escape เป็นอักขระจริงที่มองไม่เห็น ต้องตรวจด้วยสคริปต์หลังแก้ไฟล์ที่มีอักขระพวกนี้
- **ตรวจวันที่:** `new Date("2026-02-31T…")` ไม่ error แต่แปลงเป็นวันที่ 3 มี.ค. ต้องเทียบปี/เดือน/วันกลับ
- **hook ใน W8 จะห้าม Claude แก้ไฟล์ test:** test ต้องตรงกับ spec จริง เพราะแก้ทีหลังยาก
- **ยังไม่จำกัดขนาด body จนกว่าจะทำ RPT-REQ-010:** ห้ามเปิด server ให้คนนอกใช้ระหว่างนี้
- **ยังไม่แน่ใจ:** ขั้น 3 และ 4 อาจใหญ่เกินรีวิว 5 นาที ถ้า diff เกินราว 80 บรรทัด ให้แยก commit ตามกลุ่มของ test
