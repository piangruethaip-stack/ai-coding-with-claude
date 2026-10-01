import { beforeEach, describe, expect, it } from "vitest"
import { ReportStore, severityFor } from "../src/reports.ts"

const HOUR = 60 * 60 * 1000
const SECOND = 1000

const t0 = new Date("2026-09-30T12:00:00Z")
const at = (ms: number) => new Date(t0.getTime() + ms)

function input(depthCm: number, seenAt: Date, overrides: Record<string, unknown> = {}) {
  return { districtId: "lat-phrao", landmark: "ซอยลาดพร้าว 71", depthCm, seenAt: seenAt.toISOString(), ...overrides }
}

describe("severityFor (RPT-REQ-002)", () => {
  // คำขอเดิมบอกว่า 20 กับ 21 อยู่คนละระดับ แต่ spec กำหนด 11–30 = ระดับ 2 จึงเขียนตาม spec
  it("puts 20 and 21 cm in the same level (both 11–30)", () => {
    expect(severityFor(20)).toBe(2)
    expect(severityFor(21)).toBe(2)
  })

  it("puts 50 and 51 cm in different levels", () => {
    expect(severityFor(50)).toBe(3)
    expect(severityFor(51)).toBe(4)
  })

  it.each([
    [1, 1],
    [10, 1],
    [11, 2],
    [30, 2],
    [31, 3],
    [300, 4]
  ])("puts %i cm in level %i", (depthCm, level) => {
    expect(severityFor(depthCm)).toBe(level)
  })

  it.each([0, -1, 10.5, Number.NaN])("throws a RangeError for %s cm", (depthCm) => {
    expect(() => severityFor(depthCm)).toThrow(RangeError)
  })
})

describe("ReportStore", () => {
  let store: ReportStore

  beforeEach(() => {
    store = new ReportStore()
  })

  describe("merging duplicates (RPT-REQ-004)", () => {
    it("merges the same landmark in the same district within 2 hours and keeps the latest depth", () => {
      store.submit(input(40, t0), t0)
      store.submit(input(15, at(1 * HOUR)), at(1 * HOUR))

      const reports = store.active("lat-phrao", at(1 * HOUR))
      expect(reports).toHaveLength(1)
      expect(reports[0]).toMatchObject({ depthCm: 15, confirmations: 2 })
    })

    it("still merges at exactly 2 hours after the last confirmation", () => {
      store.submit(input(40, t0), t0)
      store.submit(input(25, at(2 * HOUR)), at(2 * HOUR))

      const reports = store.active("lat-phrao", at(2 * HOUR))
      expect(reports).toHaveLength(1)
      expect(reports[0]).toMatchObject({ depthCm: 25, confirmations: 2 })
    })

    it("creates a new report when even one second past 2 hours", () => {
      store.submit(input(40, t0), t0)
      const later = at(2 * HOUR + 1 * SECOND)
      store.submit(input(25, later), later)

      const reports = store.active("lat-phrao", later)
      expect(reports).toHaveLength(2)
      expect(reports.map((r) => [r.depthCm, r.confirmations])).toEqual([
        [40, 1],
        [25, 1]
      ])
    })
  })

  describe("expiry (RPT-REQ-005)", () => {
    it("still lists a report exactly 6 hours after the last confirmation", () => {
      store.submit(input(40, t0), t0)
      expect(store.active("lat-phrao", at(6 * HOUR))).toHaveLength(1)
    })

    it("drops a report from the list once the last confirmation is over 6 hours old", () => {
      store.submit(input(40, t0), t0)
      expect(store.active("lat-phrao", at(6 * HOUR + 1 * SECOND))).toEqual([])
    })

    it("keeps an expired report in the store", () => {
      store.submit(input(40, t0), t0)
      store.active("lat-phrao", at(7 * HOUR))
      expect(store.all()).toHaveLength(1)
    })

    it("shows an expired report again when a late confirmation lands within 2 hours of it", () => {
      store.submit(input(40, t0), t0)
      const now = at(7 * HOUR)
      expect(store.active("lat-phrao", now)).toEqual([])

      store.submit(input(25, at(1.5 * HOUR)), now)

      const reports = store.active("lat-phrao", now)
      expect(reports).toHaveLength(1)
      expect(reports[0]).toMatchObject({ confirmations: 2, depthCm: 25, lastConfirmedAt: at(1.5 * HOUR) })
    })
  })

  describe("confirmation history and late arrivals (RPT-REQ-004)", () => {
    it("keeps every confirmation, ordered by seen time", () => {
      store.submit(input(40, t0), t0)
      store.submit(input(30, at(1 * HOUR)), at(1 * HOUR))
      store.submit(input(35, at(0.5 * HOUR)), at(1 * HOUR))

      const [report] = store.all()
      expect(report?.confirmations.map((c) => [c.depthCm, c.seenAt])).toEqual([
        [40, t0],
        [35, at(0.5 * HOUR)],
        [30, at(1 * HOUR)]
      ])
    })

    it("counts a late arrival as a confirmation without changing the shown depth", () => {
      store.submit(input(40, t0), t0)
      store.submit(input(25, at(-1 * HOUR)), t0)

      const [report] = store.active("lat-phrao", t0)
      expect(report).toMatchObject({ confirmations: 2, depthCm: 40, lastConfirmedAt: t0, firstSeenAt: at(-1 * HOUR) })
    })

    it("uses the later-received depth when two confirmations have the same seen time", () => {
      store.submit(input(40, t0), t0)
      store.submit(input(25, t0), at(1 * SECOND))

      expect(store.active("lat-phrao", at(1 * SECOND))[0]).toMatchObject({ confirmations: 2, depthCm: 25 })
    })

    it("merges into the most recently confirmed report when two reports of the spot are within 2 hours", () => {
      const a = store.submit(input(40, t0), t0).report
      const bAt = at(2 * HOUR + 1 * SECOND)
      const b = store.submit(input(25, bAt), bAt).report

      const between = at(2 * HOUR - 1 * SECOND)
      const { report, merged } = store.submit(input(30, between), bAt)

      expect(merged).toBe(true)
      expect(report.id).toBe(b.id)
      expect(store.all().find((r) => r.id === a.id)?.confirmations).toHaveLength(1)
    })

    it("does not merge the same landmark in different districts", () => {
      store.submit(input(40, t0), t0)
      const { merged } = store.submit(input(40, t0, { districtId: "chatuchak" }), t0)

      expect(merged).toBe(false)
      expect(store.all()).toHaveLength(2)
    })
  })

  describe("same spot (RPT-REQ-003)", () => {
    it.each([
      ["extra and surrounding spaces", "  ซอยลาดพร้าว   71 "],
      ["upper and lower case", "SOI Ladprao 71"],
      ["a zero-width space", "ซอยลาดพร้าว\u200B 71"]
    ])("treats a landmark with %s as the same spot", (_why, variant) => {
      const base = variant.startsWith("SOI") ? "soi ladprao 71" : "ซอยลาดพร้าว 71"
      store.submit(input(40, t0, { landmark: base }), t0)
      expect(store.submit(input(30, t0, { landmark: variant }), t0).merged).toBe(true)
    })

    it("treats sara am typed as nikhahit + sara aa as the same spot", () => {
      store.submit(input(40, t0, { landmark: "หน้าตลาดน\u0E33" }), t0)
      expect(store.submit(input(30, t0, { landmark: "หน้าตลาดน\u0E4D\u0E32" }), t0).merged).toBe(true)
    })

    it("does not treat an abbreviated landmark as the same spot", () => {
      store.submit(input(40, t0, { landmark: "ซอยลาดพร้าว 71" }), t0)
      expect(store.submit(input(30, t0, { landmark: "ซ.ลาดพร้าว 71" }), t0).merged).toBe(false)
    })

    it("shows the first submission's landmark, trimmed and with single spaces, case kept", () => {
      store.submit(input(40, t0, { landmark: "  Central   Ladprao\u200B " }), t0)
      store.submit(input(30, t0, { landmark: "central ladprao" }), t0)

      expect(store.active("lat-phrao", t0)[0]?.landmark).toBe("Central Ladprao")
    })
  })

  describe("bad input never reaches the store", () => {
    it.each([0, 40.5])("rejects a depth of %s cm without changing existing reports", (depthCm) => {
      store.submit(input(40, t0), t0)

      expect(() => store.submit(input(depthCm, t0), t0)).toThrow(RangeError)
      expect(store.active("lat-phrao", t0)).toMatchObject([{ confirmations: 1, depthCm: 40 }])
    })

    it("rejects a seen time that is not a valid time without storing anything", () => {
      expect(() => store.submit(input(40, t0, { seenAt: "not a time" }), t0)).toThrow(RangeError)
      expect(store.all()).toEqual([])
    })
  })

  describe("ordering (RPT-REQ-006)", () => {
    it("lists the most severe first, then the most recently confirmed", () => {
      store.submit(input(15, t0, { landmark: "A" }), t0)
      store.submit(input(60, at(1 * HOUR), { landmark: "B" }), at(1 * HOUR))
      store.submit(input(20, at(2 * HOUR), { landmark: "C" }), at(2 * HOUR))

      expect(store.active("lat-phrao", at(2 * HOUR)).map((r) => r.landmark)).toEqual(["B", "C", "A"])
    })
  })
})
