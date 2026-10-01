import { districts } from "./districts.ts"
import { REPORTS_NOTICE, ReportStore, validateReportInput, type ReportView } from "./reports.ts"
import { latestReading, stationsIn } from "./stations.ts"
import { toBangkokIso } from "./time.ts"

export type Response = { status: number; body: unknown }

export type Context = { now: Date; store?: ReportStore }

export const NOTICE = "ตัวอย่างเพื่อการเรียนเท่านั้น ไม่ใช่ประกาศเตือนภัยทางการ ข้อมูลเป็นข้อมูลสมมติ"

/** Shared store for the running server. Tests pass their own through ctx.store. */
const defaultStore = new ReportStore()

/** The only report fields the public sees (RPT-REQ-006). */
function toPublicReport(report: ReportView) {
  return {
    id: report.id,
    landmark: report.landmark,
    depthCm: report.depthCm,
    severity: report.severity,
    confirmations: report.confirmations,
    firstSeenAt: toBangkokIso(report.firstSeenAt),
    lastConfirmedAt: toBangkokIso(report.lastConfirmedAt)
  }
}

/** Route one request. Kept free of node:http so it is easy to test. */
export function handle(method: string, path: string, body: unknown, ctx: Context = { now: new Date() }): Response {
  const store = ctx.store ?? defaultStore

  if (method === "GET" && path === "/districts") {
    return { status: 200, body: { notice: NOTICE, districts: [...districts.values()] } }
  }

  const districtMatch = path.match(/^\/districts\/([a-z-]+)$/)
  if (method === "GET" && districtMatch) {
    const district = districts.get(districtMatch[1] ?? "")
    if (!district) return { status: 404, body: { error: "unknown district" } }
    const stations = stationsIn(district.id).map((s) => {
      const latest = latestReading(s, ctx.now)
      return {
        id: s.id,
        nameTh: s.nameTh,
        latest: latest ? { at: toBangkokIso(latest.at), levelCm: latest.levelCm } : null
      }
    })
    const reports = store.active(district.id, ctx.now).map(toPublicReport)
    return { status: 200, body: { notice: NOTICE, district, stations, reports, reportsNotice: REPORTS_NOTICE } }
  }

  if (method === "POST" && path === "/reports") {
    const input = validateReportInput(body)
    if (!input.ok) return { status: 400, body: { error: "invalid report", fields: input.fields } }
    const { report, merged } = store.submit(input.value, ctx.now)
    return {
      status: merged ? 200 : 201,
      body: { report: toPublicReport(report), merged, reportsNotice: REPORTS_NOTICE }
    }
  }

  return { status: 404, body: { error: "not found" } }
}
