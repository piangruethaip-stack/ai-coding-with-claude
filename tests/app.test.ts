import { beforeEach, describe, expect, it } from "vitest"
import { handle, NOTICE } from "../src/app.ts"
import { REPORTS_NOTICE, ReportStore } from "../src/reports.ts"

const now = new Date("2026-09-30T12:30:00Z")

describe("GET /districts", () => {
  it("lists districts with the teaching notice", () => {
    const res = handle("GET", "/districts", undefined, { now })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ notice: NOTICE })
    expect((res.body as { districts: unknown[] }).districts.length).toBe(12)
  })
})

describe("GET /districts/:id", () => {
  it("shows the latest station reading in Bangkok time", () => {
    const res = handle("GET", "/districts/lat-phrao", undefined, { now })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      district: { id: "lat-phrao", nameTh: "ลาดพร้าว" },
      stations: [{ id: "st-ladprao-01", latest: { at: "2026-09-30T19:00:00+07:00", levelCm: 104 } }]
    })
  })

  it("ignores readings after now", () => {
    const res = handle("GET", "/districts/lat-phrao", undefined, { now: new Date("2026-09-30T10:30:00Z") })
    expect(res.body).toMatchObject({ stations: [{ latest: { levelCm: 88 } }] })
  })

  it("returns an empty station list for a district with no stations", () => {
    const res = handle("GET", "/districts/sai-mai", undefined, { now })
    expect(res.body).toMatchObject({ stations: [] })
  })

  it("returns 404 for an unknown district", () => {
    expect(handle("GET", "/districts/atlantis", undefined, { now }).status).toBe(404)
  })
})

describe("flood reports API", () => {
  let store: ReportStore
  const report = {
    districtId: "lat-phrao",
    landmark: "ซอยลาดพร้าว 71",
    depthCm: 40,
    seenAt: "2026-09-30T12:00:00Z"
  }

  beforeEach(() => {
    store = new ReportStore()
  })

  const post = (body: unknown) => handle("POST", "/reports", body, { now, store })
  const district = (id: string) =>
    handle("GET", `/districts/${id}`, undefined, { now, store }).body as { reports: unknown[]; reportsNotice: string }

  describe("POST /reports then GET /districts/:id (RPT-REQ-001, RPT-REQ-006, RPT-REQ-009)", () => {
    it("creates a report and says it is user-reported", () => {
      const res = post(report)
      expect(res.status).toBe(201)
      expect(res.body).toMatchObject({ merged: false, reportsNotice: REPORTS_NOTICE, report: { depthCm: 40 } })
    })

    it("lists the report in its district with exactly the public fields, in Bangkok time", () => {
      post(report)
      const body = district("lat-phrao")

      expect(body.reportsNotice).toBe(REPORTS_NOTICE)
      expect(body.reports).toHaveLength(1)
      expect(Object.keys(body.reports[0] as object).sort()).toEqual(
        ["confirmations", "depthCm", "firstSeenAt", "id", "landmark", "lastConfirmedAt", "severity"].sort()
      )
      expect(body.reports[0]).toMatchObject({
        landmark: "ซอยลาดพร้าว 71",
        depthCm: 40,
        severity: 3,
        confirmations: 1,
        firstSeenAt: "2026-09-30T19:00:00+07:00",
        lastConfirmedAt: "2026-09-30T19:00:00+07:00"
      })
    })

    it("answers 200 with merged: true when the same spot is reported again", () => {
      post(report)
      const res = post({ ...report, depthCm: 15 })
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ merged: true, report: { depthCm: 15, confirmations: 2 } })
    })

    it("lists no reports, but still the notice, for a district nobody reported in", () => {
      post(report)
      expect(district("sai-mai")).toMatchObject({ reports: [], reportsNotice: REPORTS_NOTICE })
    })
  })

  describe("minimum input checks (RPT-REQ-001, RPT-REQ-008)", () => {
    it.each([
      ["no body", undefined],
      ["null", null],
      ["an array", [report]],
      ["a string", "ซอยลาดพร้าว 71"]
    ])("rejects %s as the body", (_why, body) => {
      expect(post(body)).toMatchObject({ status: 400, body: { error: "invalid report" } })
      expect(store.all()).toEqual([])
    })

    it.each([
      ["depthCm", { depthCm: 40.5 }],
      ["depthCm", { depthCm: "40" }],
      ["depthCm", { depthCm: 0 }],
      ["depthCm", { depthCm: 301 }],
      ["landmark", { landmark: 71 }],
      ["landmark", { landmark: "   " }],
      ["districtId", { districtId: 1 }],
      ["seenAt", { seenAt: "not a time" }]
    ])("rejects a bad %s (%o) without storing anything", (field, change) => {
      expect(post({ ...report, ...change })).toEqual({ status: 400, body: { error: "invalid report", fields: [field] } })
      expect(store.all()).toEqual([])
    })

    it("accepts depths of 1 and 300 cm", () => {
      expect(post({ ...report, depthCm: 1 }).status).toBe(201)
      expect(post({ ...report, landmark: "หน้าตลาด", depthCm: 300 }).status).toBe(201)
    })

    it("lists bad fields in a fixed order", () => {
      const res = post({ seenAt: 5, depthCm: "x", landmark: null, districtId: false })
      expect(res.body).toEqual({ error: "invalid report", fields: ["districtId", "landmark", "depthCm", "seenAt"] })
    })

    it("drops fields it did not ask for, such as a phone number", () => {
      const res = post({ ...report, phone: "0812345678", name: "สมชาย" })
      expect(JSON.stringify(res.body)).not.toMatch(/0812345678|สมชาย/)
      expect(JSON.stringify(store.all())).not.toMatch(/0812345678|สมชาย/)
    })
  })
})

describe("unknown routes", () => {
  it("returns 404", () => {
    expect(handle("GET", "/nope", undefined, { now }).status).toBe(404)
  })
})
