# Spec: ให้คนในพื้นที่รายงานจุดน้ำท่วม

> Status: ready to build · Date: 2026-10-01 · ที่มา: [docs/intent/flood-reports.md](../intent/flood-reports.md) · ข้อกำหนดความปลอดภัย: Skill `security-baseline`

คำที่ใช้ในเอกสารนี้ (รายงาน การยืนยัน จุดสังเกต เวลาที่เห็น การยืนยันล่าสุด รายงานหมดอายุ ระดับความรุนแรง) มีความหมายตาม [GLOSSARY.md](../../GLOSSARY.md)

## ค่าคงที่

| ชื่อ | ค่า | ใช้ใน |
| ---- | --- | ----- |
| `MERGE_WINDOW_MS` | 2 ชั่วโมง | RPT-REQ-004 |
| `EXPIRY_MS` | 6 ชั่วโมง | RPT-REQ-005 |
| `DEPTH_MIN_CM` / `DEPTH_MAX_CM` | 1 / 300 | RPT-REQ-001 |
| `LANDMARK_MAX_CHARS` | 100 | RPT-REQ-001 |
| `PHONE_LIKE_DIGITS` | 9 | RPT-REQ-001, 008 |
| `SEEN_AT_MAX_PAST` | 6 ชั่วโมง | RPT-REQ-001 |
| `SEEN_AT_MAX_FUTURE` | 5 นาที | RPT-REQ-001 |
| `RATE_LIMIT` | 10 คำขอ ต่อ IP ต่อ 10 นาที | RPT-REQ-007 |
| `MAX_BODY_BYTES` | 10,240 byte | RPT-REQ-010 |

ทุกขอบเขตในเอกสารนี้**รวมค่าที่ขอบ** (ครบพอดียังผ่าน เกินแม้ 1 หน่วยไม่ผ่าน)

## Requirements

### RPT-REQ-001 ส่งรายงานผ่าน API และตรวจข้อมูลที่ handler

`POST /reports` รับ JSON `{ districtId, landmark, depthCm, seenAt }` ตรวจข้อมูลทุกตัวใน handler ก่อนส่งต่อให้ store
method อื่นบน `/reports` ตอบ `404` เหมือน route อื่นที่ไม่มีในแอป

- `districtId`: string ที่มีอยู่ใน `src/districts.ts` (12 เขต)
- `landmark`: string ที่
  - ไม่มีอักขระควบคุม (U+0000–U+001F, U+007F–U+009F) รวมถึงขึ้นบรรทัดใหม่และ tab
  - หลังทำเป็น**ข้อความแสดง** (RPT-REQ-003) แล้วยาว 1–100 code point
  - ไม่มีลักษณะเป็นเบอร์โทร: หลังลบช่องว่าง `-` และ `.` ออกแล้ว ต้องไม่มีตัวเลข (`0–9` หรือ `๐–๙`) ติดกันตั้งแต่ 9 ตัวขึ้นไป
- `depthCm`: number ที่เป็นจำนวนเต็ม 1–300
- `seenAt`: string ที่ตรงกับ `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$` เป็นวันเวลาที่มีจริง และอยู่ในช่วง `now - 6 ชม.` ถึง `now + 5 นาที`

Acceptance criteria
- ข้อมูลถูกต้องทุกช่อง → `201` และ body เป็น `{ report, merged: false, reportsNotice }` เมื่อเป็นรายงานใหม่ หรือ `200` กับ `merged: true` เมื่อนับเป็นการยืนยันของรายงานเดิม; `report` มีช่องตาม RPT-REQ-006 บวก `expiresAt` (= การยืนยันล่าสุด + 6 ชม. เป็นเวลากรุงเทพฯ)
- ช่องใดไม่ผ่าน → `400` และ body เป็น `{ error: "invalid report", fields: [...] }` โดย `fields` เรียงตามลำดับ `districtId`, `landmark`, `depthCm`, `seenAt` และไม่สร้างหรือแก้รายงาน
- `depthCm` เป็น `40.5`, `"40"`, `0`, `301`, `-5` → `400` และมี `depthCm` ใน `fields`
- `depthCm` เป็น `1` และ `300` → ผ่าน
- `landmark` เป็น `"   "`, `"\u200B"`, หรือยาว 101 code point หลังทำเป็นข้อความแสดง → `400`; ยาว 100 code point พอดี → ผ่าน
- `landmark` เป็น `"ซอย 5\nหน้าร้าน"` → `400`
- `landmark` เป็น `"หน้าบ้าน 081-234-5678"`, `"โทร 081 234 5678"`, `"๐๘๑๒๓๔๕๖๗๘"` → `400`
- `landmark` เป็น `"ซอยลาดพร้าว 71"` และ `"ซอย 12345678"` (8 หลัก) → ผ่าน
- `seenAt` เป็น `"2026-09-30T12:00:00"` (ไม่มี timezone), `"2026-09-30 12:00:00Z"`, `"2026-09-30T12:00:00+0700"`, `"2026-02-31T12:00:00Z"` → `400`
- `seenAt` ย้อนหลัง 6 ชม. พอดี → ผ่าน; 6 ชม. 1 วินาที → `400`
- `seenAt` ล่วงหน้า 5 นาทีพอดี → ผ่าน; 5 นาที 1 วินาที → `400`
- `districtId` เป็น `"atlantis"` → `400` (ไม่ใช่ 404 เพราะเป็นข้อมูลใน body)
- body ไม่ใช่ object (เช่น `null`, array, ไม่มี body) → `400`
- `GET /reports` → `404`

### RPT-REQ-002 ระดับความรุนแรง

คำนวณจากความลึกที่แสดงอยู่ของรายงาน (RPT-REQ-004)

| ระดับ | ความลึก |
| ----- | ------- |
| 1 | 1–10 ซม. |
| 2 | 11–30 ซม. |
| 3 | 31–50 ซม. |
| 4 | 51 ซม. ขึ้นไป |

Acceptance criteria
- `severityFor(1)` = 1, `severityFor(10)` = 1, `severityFor(11)` = 2
- `severityFor(20)` = 2 และ `severityFor(21)` = 2
- `severityFor(30)` = 2, `severityFor(31)` = 3
- `severityFor(50)` = 3, `severityFor(51)` = 4, `severityFor(300)` = 4
- `severityFor(0)`, `severityFor(-1)`, `severityFor(10.5)`, `severityFor(NaN)` → โยน `RangeError`

### RPT-REQ-003 จุดเดิม

จุดสังเกตมีสองรูป

- **ข้อความแสดง**: ลบ zero-width (U+200B, U+200C, U+200D, U+FEFF) → ทำ Unicode NFC → ตัดช่องว่างหัวท้าย → ยุบช่องว่างที่ติดกันเหลือหนึ่งช่อง
- **รูปมาตรฐาน** (ใช้เทียบจุดเดิม): ข้อความแสดง → แทน `ํา` (U+0E4D U+0E32) ด้วย `ำ` (U+0E33) → แปลงเป็นตัวพิมพ์เล็ก

สองการแจ้งเป็น**จุดเดิม**เมื่อ `districtId` เท่ากัน และรูปมาตรฐานของจุดสังเกตเท่ากัน

Acceptance criteria
- `"ซอยลาดพร้าว 71"` กับ `"  ซอยลาดพร้าว   71 "` เป็นจุดเดิม
- `"Central Ladprao"` กับ `"central ladprao"` เป็นจุดเดิม
- `"ซอยลาดพร้าว\u200B 71"` กับ `"ซอยลาดพร้าว 71"` เป็นจุดเดิม
- `"หน้าตลาดน\u0E33"` กับ `"หน้าตลาดน\u0E4D\u0E32"` เป็นจุดเดิม
- `"ซอยลาดพร้าว 71"` กับ `"ซ.ลาดพร้าว 71"` **ไม่**เป็นจุดเดิม (ยอมให้ซ้ำ ดีกว่ารวมผิดจุด)
- จุดสังเกตเดียวกันคนละเขตไม่เป็นจุดเดิม
- รายงานแสดงข้อความแสดงของการแจ้งครั้งแรก (ไม่แปลงตัวพิมพ์ ไม่แทน `ํา`)

### RPT-REQ-004 รวมการแจ้งจุดเดิมเป็นการยืนยัน

เวลาของการยืนยันคือ `seenAt` ของการแจ้งนั้น ไม่ใช่เวลาที่ server ได้รับ
การแจ้งจุดเดิมที่ `seenAt` ห่างจาก**การยืนยันล่าสุด**ของรายงานไม่เกิน 2 ชั่วโมง (ทั้งก่อนและหลัง) นับเป็นการยืนยันของรายงานนั้น ไม่เช่นนั้นสร้างรายงานใหม่

- **การยืนยันล่าสุด** = การยืนยันที่ `seenAt` มากที่สุด ถ้า `seenAt` เท่ากัน ใช้อันที่ server ได้รับทีหลัง
- **ความลึกที่แสดง** = ความลึกของการยืนยันล่าสุด
- เก็บความลึกและ `seenAt` ของ**ทุกการยืนยัน**ไว้ใน store (ไม่ส่งออกทาง API ในรอบนี้)
- ถ้ามีหลายรายงานของจุดเดิมอยู่ในช่วง 2 ชั่วโมง (รวมรายงานที่หมดอายุแล้ว) ให้รวมเข้ารายงานที่การยืนยันล่าสุดใหม่ที่สุด
- `confirmations` คือจำนวนการแจ้ง ไม่ใช่จำนวนคน คนเดียวยืนยันซ้ำได้ (ความเสี่ยงที่ยอมรับใน intent)

Acceptance criteria
- แจ้ง 40 ซม. ที่ `t0` แล้วแจ้ง 15 ซม. ที่ `t0+1ชม.` → 1 รายงาน, `depthCm` 15, `confirmations` 2
- แจ้งครั้งที่สองที่ `t0+2ชม.` พอดี → ยังรวม, `confirmations` 2
- แจ้งครั้งที่สองที่ `t0+2ชม.+1วินาที` → `store.active()` คืน 2 รายงาน แต่ละอัน `confirmations` 1
- แจ้ง 40 ซม. `seenAt` = `t0` แล้วแจ้ง 25 ซม. `seenAt` = `t0-1ชม.` (ส่งมาช้า) → รวมเป็น 1 รายงาน, `confirmations` 2, `depthCm` ยังเป็น 40, การยืนยันล่าสุดยังเป็น `t0`
- store เก็บประวัติการยืนยันครบ: หลังแจ้ง 3 ครั้งในจุดเดิม ประวัติมี 3 รายการ เรียงตาม `seenAt`

### RPT-REQ-005 รายงานหมดอายุ

รายงานหมดอายุเมื่อ `now - การยืนยันล่าสุด > 6 ชั่วโมง` รายงานที่หมดอายุไม่แสดงใน API และไม่อยู่ในผลของ `store.active()` แต่ยังเก็บไว้ใน store

Acceptance criteria
- แจ้งที่ `t0` แล้วดูที่ `t0+6ชม.` → ยังแสดง
- ดูที่ `t0+6ชม.+1วินาที` → ไม่แสดง
- หลังหมดอายุ `store.all()` ยังมีรายงานนั้นอยู่
- รายงานที่หมดอายุแล้ว ถ้าได้การยืนยันใหม่ตาม RPT-REQ-004 จะกลับมาแสดง (ดู Edge case 5)

### RPT-REQ-006 แสดงรายงานในเขต

`GET /districts/:id` เพิ่มช่อง `reports` และ `reportsNotice` ในคำตอบเดิม โดยไม่เปลี่ยนชื่อช่องที่มีอยู่ (`notice`, `district`, `stations`)

แต่ละรายงานมี 7 ช่องนี้เท่านั้น (ไม่มี `districtId`, ไม่มีประวัติการยืนยัน)

```json
{
  "id": "rpt_...",
  "landmark": "ซอยลาดพร้าว 71",
  "depthCm": 15,
  "severity": 2,
  "confirmations": 2,
  "firstSeenAt": "2026-09-30T19:00:00+07:00",
  "lastConfirmedAt": "2026-09-30T20:00:00+07:00"
}
```

**หนึ่งจุดหนึ่งรายการ:** ถ้าจุดเดิมมีหลายรายงานที่ยังไม่หมดอายุ API แสดงเฉพาะรายงานที่การยืนยันล่าสุดใหม่ที่สุด การตัดนี้ทำที่ชั้น API เท่านั้น `store.active()` ยังคืนทุกรายงาน

Acceptance criteria
- แสดงเฉพาะรายงานที่ยังไม่หมดอายุของเขตนั้น
- แจ้งจุดเดิมที่ `t0` (40 ซม.) และ `t0+2ชม.+1วินาที` (15 ซม.) แล้วดูที่ `t0+3ชม.` → `reports` มี 1 รายการ `depthCm` 15
- เรียงตาม `severity` จากมากไปน้อย ถ้าเท่ากัน `lastConfirmedAt` ใหม่กว่าขึ้นก่อน
- เวลาแสดงเป็นเวลากรุงเทพฯ (`+07:00`) ผ่าน `toBangkokIso`
- เขตที่ไม่มีรายงาน → `reports: []`
- เขตที่ไม่มีอยู่ → `404` เหมือนเดิม
- test เดิมใน `tests/app.test.ts` ยังผ่านทั้งหมดโดยไม่แก้

### RPT-REQ-007 จำกัดจำนวนคำขอต่อ IP

`POST /reports` รับได้ไม่เกิน 10 คำขอต่อ IP ในช่วง 10 นาทีที่เลื่อนตามเวลา (sliding window)

- นับทุกคำขอที่ถึง `handle` รวมที่ตอบ `400` แต่**ไม่นับ**คำขอที่ตอบ `429`
- คำขอที่ `server.ts` ตอบไปก่อนถึง `handle` (JSON พัง, `413`) ไม่นับ
- key คือ IP หลังตัด prefix `::ffff:` ออก ถ้าไม่รู้ IP ใช้ key `"unknown"`
- ทุกครั้งที่เรียก `allow()` limiter ตัด timestamp ที่เก่ากว่า 10 นาทีของ**ทุก key** และลบ key ที่ไม่เหลือ timestamp
- แอปรันตรงโดยไม่ผ่าน proxy

Acceptance criteria
- คำขอที่ 1–10 จาก IP เดียวกันภายใน 10 นาที → ประมวลผลตามปกติ
- คำขอที่ 11 → `429` และ body `{ error: "too many reports" }` โดยไม่สร้างหรือแก้รายงาน
- ส่งต่อเนื่อง 20 ครั้ง (10 ครั้งหลังได้ `429`) แล้วรอจนคำขอแรกเก่ากว่า 10 นาที → คำขอถัดไปผ่าน
- คำขอจากอีก IP หนึ่งในเวลาเดียวกัน → ไม่โดนผลกระทบ
- `::ffff:1.2.3.4` กับ `1.2.3.4` ใช้โควตาเดียวกัน
- `ip` เป็น undefined → นับรวมในกลุ่ม `"unknown"` ไม่ปล่อยผ่าน
- IP A ส่งครั้งเดียวที่ `t0` แล้ว IP B ส่งที่ `t0+10นาที+1วินาที` → limiter ไม่มี key ของ A เหลืออยู่

### RPT-REQ-008 ไม่เก็บ ไม่ log และไม่ส่งกลับข้อมูลส่วนบุคคล

ไม่รับเบอร์โทร ชื่อ หรือที่อยู่ละเอียดของผู้รายงาน

Acceptance criteria
- body ที่มีช่องอื่นนอกจาก 4 ช่องใน RPT-REQ-001 (เช่น `phone`, `name`) → ช่องเหล่านั้นถูกทิ้ง ไม่เก็บใน store ไม่อยู่ใน response
- จุดสังเกตที่มีลักษณะเป็นเบอร์โทรถูกปฏิเสธตาม RPT-REQ-001 ก่อนถึง store
- ตัวรายงานและประวัติการยืนยันไม่เก็บ IP ผู้ส่ง (IP อยู่แค่ในตัวนับของ rate limit และถูกลบตาม RPT-REQ-007)
- ถ้ามีการ log ที่เกี่ยวกับรายงาน ให้ log แค่ `id` ของรายงาน ห้าม log body, IP หรือจุดสังเกต
- response ของทุก endpoint ไม่มี IP

ชื่อคนและบ้านเลขที่ในจุดสังเกตตรวจด้วย pattern ไม่ได้ ยอมรับเป็นความเสี่ยงที่เหลืออยู่ และใช้ `reportsNotice` เป็นตัวกันอีกชั้น

### RPT-REQ-009 บอกว่าเป็นข้อมูลจากผู้ใช้

ทุก response ที่มีรายงานต้องมี `reportsNotice` บอกว่าเป็นข้อมูลที่ผู้ใช้แจ้ง ไม่ใช่ประกาศเตือนภัยทางการ

- `REPORTS_NOTICE` = `"รายงานจากผู้ใช้ ไม่ใช่ประกาศเตือนภัยทางการ ตรวจสอบประกาศของกรุงเทพมหานครก่อนตัดสินใจ"`
- เปลี่ยน `NOTICE` เดิมเป็น `"ตัวอย่างเพื่อการเรียนเท่านั้น ไม่ใช่ประกาศเตือนภัยทางการ ข้อมูลระดับน้ำจากสถานีเป็นข้อมูลสมมติ"` ให้ชัดว่าพูดถึงข้อมูลสถานี ไม่ใช่รายงาน

Acceptance criteria
- `GET /districts/:id` มี `reportsNotice` เท่ากับ `REPORTS_NOTICE` แม้ `reports` จะว่าง
- คำตอบ `201` / `200` ของ `POST /reports` มี `reportsNotice`
- `REPORTS_NOTICE` มีคำว่า "ผู้ใช้" และ "ไม่ใช่ประกาศเตือนภัยทางการ"
- `NOTICE` มีคำว่า "สถานี"

### RPT-REQ-010 จำกัดขนาด body

`server.ts` นับขนาด body เป็น byte (ไม่ใช่จำนวนตัวอักษร) และไม่รับ body ที่ใหญ่เกิน 10,240 byte

Acceptance criteria
- body 10,241 byte → `413` และ `{ error: "body too large" }` หยุดอ่าน body ทันทีที่เกิน ไม่ parse และไม่เรียก `handle`
- body 10,240 byte พอดีที่เป็น JSON ถูกต้อง → ส่งต่อให้ `handle` ตามปกติ
- body ภาษาไทย 4,000 ตัวอักษร (ประมาณ 12,000 byte ใน UTF-8) → `413`

## Design

### Data model (`src/reports.ts`)

```ts
type ReportInput = { districtId: string; landmark: string; depthCm: number; seenAt: string } // ผ่านการตรวจแล้ว

type Confirmation = { depthCm: number; seenAt: Date; receivedAt: Date }

type StoredReport = {
  id: string                 // "rpt_" + crypto.randomUUID()
  districtId: string
  landmark: string           // ข้อความแสดงของการแจ้งครั้งแรก (RPT-REQ-003)
  landmarkKey: string        // รูปมาตรฐาน (RPT-REQ-003) ใช้เทียบจุดเดิม
  confirmations: Confirmation[] // เรียงตาม seenAt
}

type ReportView = {           // ที่ store.submit() / store.active() คืน
  id: string
  districtId: string
  landmarkKey: string
  landmark: string
  depthCm: number
  severity: 1 | 2 | 3 | 4
  confirmations: number
  firstSeenAt: Date
  lastConfirmedAt: Date
}
```

ทุกเวลาเก็บเป็น `Date` (UTC) แปลงเป็นเวลากรุงเทพฯ ตอนสร้าง response เท่านั้น

ฟังก์ชันและคลาสที่ export

- `severityFor(depthCm: number): 1 | 2 | 3 | 4` (โยน `RangeError` ตาม RPT-REQ-002)
- `displayLandmark(raw: string): string` และ `landmarkKey(raw: string): string` (RPT-REQ-003)
- `validateReportInput(body: unknown, now: Date): { ok: true; value: ReportInput } | { ok: false; fields: string[] }`
- `class ReportStore`
  - `submit(input: ReportInput, now: Date): { report: ReportView; merged: boolean }`
  - `active(districtId: string, now: Date): ReportView[]` คืนทุกรายงานที่ยังไม่หมดอายุ เรียงตาม RPT-REQ-006 **ไม่**ตัดจุดซ้ำ
  - `all(): readonly StoredReport[]` รวมที่หมดอายุ ใช้ใน test เท่านั้น ห้ามใช้ใน route สาธารณะ
  - `submit` โยน `RangeError` ก่อนแตะ store ถ้า `depthCm` ไม่ใช่จำนวนเต็ม ≥ 1 หรือ `seenAt` parse ไม่ได้ (ด่านที่สองหลัง `validateReportInput`)
- `MERGE_WINDOW_MS`, `EXPIRY_MS`
- `REPORTS_NOTICE`

signature ของ `submit` และ `active` ตรงกับที่ `tests/reports.test.ts` ใช้อยู่แล้ว

### Rate limit (`src/rate-limit.ts`)

- `class RateLimiter(limit: number, windowMs: number)`
  - `allow(key: string, now: Date): boolean` ตัด timestamp เก่าของทุก key ลบ key ที่ว่าง แล้วตัดสิน ถ้าเกิน limit คืน `false` และ**ไม่**บันทึกคำขอนี้
  - `size(): number` จำนวน key ที่เหลือ ใช้ใน test
- `normalizeIp(ip: string | undefined): string` ตัด `::ffff:` และคืน `"unknown"` เมื่อไม่มีค่า

### API

| Method | Path | เปลี่ยนอะไร |
| ------ | ---- | ----------- |
| `POST` | `/reports` | ใหม่ ตาม RPT-REQ-001, 007, 008, 009 |
| `GET` | `/districts/:id` | เพิ่ม `reports` และ `reportsNotice` (RPT-REQ-006, 009) |
| `GET` | `/districts` | ไม่เปลี่ยน (ข้อความ `NOTICE` เปลี่ยนตาม RPT-REQ-009) |

ลำดับใน handler ของ `POST /reports`: rate limit → ตรวจข้อมูล → `store.submit` → แปลงเป็น public view → สร้าง response

`toPublicReport(view: ReportView)` ใน `src/app.ts` เลือกเฉพาะ 7 ช่องของ RPT-REQ-006 และแปลงเวลาเป็นเวลากรุงเทพฯ ส่วน `POST` เพิ่ม `expiresAt`
`GET /districts/:id` เรียก `store.active()` แล้วตัดจุดซ้ำด้วย `landmarkKey` ก่อนแปลง

### ไฟล์ที่ต้องแก้

| ไฟล์ | สิ่งที่ทำ |
| ---- | -------- |
| `src/reports.ts` | **ใหม่** data model, `severityFor`, `displayLandmark`, `landmarkKey`, `validateReportInput`, `ReportStore`, `REPORTS_NOTICE` |
| `src/rate-limit.ts` | **ใหม่** `RateLimiter`, `normalizeIp` |
| `src/app.ts` | เพิ่ม route `POST /reports`, เพิ่ม `reports` / `reportsNotice` ใน `GET /districts/:id`, `toPublicReport`, เปลี่ยนข้อความ `NOTICE`, ขยาย `Context` เป็น `{ now: Date; ip?: string; store?: ReportStore; limiter?: RateLimiter }` (ถ้าไม่ส่งมา ใช้ instance กลางของ module) |
| `src/server.ts` | ส่ง `ip: req.socket.remoteAddress` ใน `Context`, นับ body เป็น byte และตอบ `413` เมื่อเกิน 10,240 byte |
| `tests/reports.test.ts` | มีอยู่แล้ว เพิ่ม test ตาม acceptance criteria ของ RPT-REQ-001 ถึง 005 |
| `tests/app.test.ts` | เพิ่ม test ของ API ตาม RPT-REQ-001, 006 ถึง 009; test เดิมต้องผ่านโดยไม่แก้ |
| `tests/rate-limit.test.ts` | **ใหม่** test ของ RPT-REQ-007 |

### กติกาของ test

- test ของ API ที่เกี่ยวกับรายงานต้องส่ง `store: new ReportStore()` และ `limiter: new RateLimiter(10, 10 * 60 * 1000)` ใหม่ทุก test ห้ามพึ่ง instance กลางของ module ไม่งั้น state จะรั่วข้าม test และคำขอที่ไม่มี IP จะได้ `429` แบบสุ่ม
- ใช้ `now` ที่กำหนดเองทุกครั้ง ห้ามใช้เวลาจริง

## Edge cases

1. **ส่งช้า**: เห็นน้ำ 10:00 แต่ส่ง 11:30 การยืนยันนับที่ 10:00 (RPT-REQ-004) รายงานจะหมดอายุ 16:00 ไม่ใช่ 17:30 และ `expiresAt` ใน response บอกเวลานี้
2. **ส่งสลับลำดับ**: การแจ้งที่ `seenAt` เก่ากว่าการยืนยันล่าสุดแต่ห่างไม่เกิน 2 ชม. นับเป็นการยืนยัน แต่ไม่เปลี่ยนความลึกที่แสดงและไม่เลื่อนเวลาหมดอายุ
3. **ขอบพอดี**: ห่าง 2 ชม. พอดียังรวม, ผ่านไป 6 ชม. พอดียังแสดง, `seenAt` ย้อน 6 ชม. พอดียังรับ (แต่ `expiresAt` = `now` รายงานแสดงอยู่ถึงวินาทีนั้นเท่านั้น), ความลึก 300 พอดียังรับ
4. **สองรายงานของจุดเดิมอยู่พร้อมกัน**: A ยืนยันล่าสุด 10:00, B สร้าง 12:00:01 (เกิน 2 ชม. จาก A) → API แสดงแค่ B ถ้ามีแจ้ง `seenAt` 11:59 ซึ่งอยู่ในช่วงของทั้งคู่ → รวมเข้า B (การยืนยันล่าสุดใหม่กว่า)
5. **รายงานที่หมดอายุกลับมา**: A ยืนยันล่าสุด `now-7ชม.` (หมดอายุแล้ว) มีแจ้ง `seenAt` = `now-5.5ชม.` ห่างจาก A 1.5 ชม. → รวมเข้า A และ A กลับมาแสดง เพราะการยืนยันล่าสุดเลื่อนเป็น `now-5.5ชม.`
6. **ความลึกที่หน้าตาเหมือนตัวเลข**: `"40"` (string) และ `40.5` → `400`; `40.0` และ `1e1` ใน JSON parse ได้ `40` และ `10` จึงผ่าน (แยกจากเลขปกติไม่ได้หลัง parse)
7. **เวลาที่รูปแบบไม่ตรง**: ไม่มี timezone, ใช้ช่องว่างแทน `T`, offset ไม่มี `:`, วันที่ไม่มีจริง → `400` แทนที่จะเดา
8. **ข้อความไทยที่หน้าตาเหมือนกัน**: `ำ` กับ `ํา` และข้อความที่มี zero-width space ที่ติดมาจากการ copy → เป็นจุดเดิม (RPT-REQ-003)
9. **ข้อมูลส่วนบุคคลในจุดสังเกต**: `"หน้าบ้าน 081-234-5678"` หรือเลขไทย `"๐๘๑๒๓๔๕๖๗๘"` → `400`; `"บ้านนายสมชาย"` → ผ่าน (ความเสี่ยงที่ยอมรับ)
10. **แอบส่งข้อมูลส่วนบุคคลเป็นช่องแยก**: body มี `phone: "081..."` → ทิ้ง ไม่เก็บ ไม่ log ไม่ส่งกลับ
11. **หลายคนใช้ IP เดียวกัน** (Wi-Fi ร้านกาแฟ หรือ NAT ของเครือข่ายมือถือ) → ใช้โควตาร่วมกัน; ผู้ใช้ IPv6 เปลี่ยนที่อยู่หลบ limit ได้ ยอมรับในรอบนี้
12. **ยืนยันตัวเอง**: คนเดียวส่งจุดเดิม 10 ครั้งใน 10 นาที → `confirmations` 10 ยอมรับในรอบนี้ (ดู RPT-REQ-004)
13. **หน่วยความจำโต**: รายงานที่หมดอายุยังเก็บไว้และไม่มีการล้าง ที่โควตา 10 ครั้ง / 10 นาที IP หนึ่งสร้างได้ถึงวันละ 1,440 รายงาน ข้อมูลหายเมื่อรีสตาร์ต ยอมรับในรอบนี้เพราะยังไม่มีฐานข้อมูล

## Out of scope

- ฐานข้อมูลหรือเก็บข้อมูลข้ามการรีสตาร์ต (เมื่อมีแล้วต้องมีกฎล้างรายงานที่หมดอายุ ดู Open question 4 ใน intent)
- login หรือการระบุตัวผู้รายงาน
- เก็บเบอร์โทร ชื่อ หรือข้อมูลติดต่อผู้รายงาน
- ตรวจหาชื่อคนหรือบ้านเลขที่ในจุดสังเกต
- กันการยืนยันซ้ำจากคนเดียวกัน
- จับคู่จุดสังเกตที่สะกดต่างกัน พิกัด GPS หรือแผนที่
- แก้ไข ลบ หรือรายงานว่ารายงานไหนผิด (moderation) นอกจาก rate limit
- endpoint ที่ส่งประวัติการยืนยันออกไป
- ล้างรายงานที่หมดอายุออกจากหน่วยความจำ
- รองรับการรันหลัง proxy (`X-Forwarded-For`)
- หน้าเว็บหรือ UI
- เขตอื่นนอกจาก 12 เขตใน `src/districts.ts`
- ส่งข้อมูลไปหรือดึงข้อมูลจากระบบจริง เช่น ROOP TAN JAI Flood Watch หรือเรียก API ภายนอกใดๆ
- เพิ่ม dependency ตอน runtime
- เก็บสถิติเพื่อวัดผลการใช้งานจริง (รอบนี้วัดผลด้วย test และ demo ตาม Proposed outcome ใน intent)
