import { randomUUID } from "node:crypto"

const HOUR_MS = 60 * 60 * 1000

/** Same-spot reports whose seen times are at most this far apart count as one report (RPT-REQ-004). */
export const MERGE_WINDOW_MS = 2 * HOUR_MS

/** A report is hidden once its last confirmation is older than this (RPT-REQ-005). */
export const EXPIRY_MS = 6 * HOUR_MS

export const REPORTS_NOTICE = "รายงานจากผู้ใช้ ไม่ใช่ประกาศเตือนภัยทางการ ตรวจสอบประกาศของกรุงเทพมหานครก่อนตัดสินใจ"

export type Severity = 1 | 2 | 3 | 4

/** A report submission that has already passed validation at the API boundary. */
export type ReportInput = { districtId: string; landmark: string; depthCm: number; seenAt: string }

export type Confirmation = { depthCm: number; seenAt: Date; receivedAt: Date }

export type StoredReport = {
  id: string
  districtId: string
  /** Display form of the first submission's landmark. */
  landmark: string
  /** Canonical form used to decide whether two submissions are the same spot. */
  landmarkKey: string
  /** Ordered by seenAt, then receivedAt, so the last one is the last confirmation. */
  confirmations: Confirmation[]
}

export type ReportView = {
  id: string
  districtId: string
  landmarkKey: string
  landmark: string
  depthCm: number
  severity: Severity
  confirmations: number
  firstSeenAt: Date
  lastConfirmedAt: Date
}

/** 1–10 cm = 1, 11–30 = 2, 31–50 = 3, 51+ = 4 (RPT-REQ-002). */
export function severityFor(depthCm: number): Severity {
  if (!Number.isInteger(depthCm) || depthCm < 1) {
    throw new RangeError(`depth must be a whole number of cm, 1 or more, got ${depthCm}`)
  }
  if (depthCm <= 10) return 1
  if (depthCm <= 30) return 2
  if (depthCm <= 50) return 3
  return 4
}

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g

/** The landmark as shown to people: no zero-width characters, NFC, trimmed, single spaces (RPT-REQ-003). */
export function displayLandmark(raw: string): string {
  return raw.replace(ZERO_WIDTH, "").normalize("NFC").trim().replace(/\s+/g, " ")
}

/** The landmark as compared: display form with nikhahit + sara aa folded into sara am, lower-cased (RPT-REQ-003). */
export function landmarkKey(raw: string): string {
  return displayLandmark(raw).replaceAll("\u0E4D\u0E32", "\u0E33").toLowerCase()
}

function compareConfirmations(a: Confirmation, b: Confirmation): number {
  return a.seenAt.getTime() - b.seenAt.getTime() || a.receivedAt.getTime() - b.receivedAt.getTime()
}

function lastConfirmation(report: StoredReport): Confirmation {
  const last = report.confirmations[report.confirmations.length - 1]
  if (!last) throw new Error(`report ${report.id} has no confirmations`)
  return last
}

function toView(report: StoredReport): ReportView {
  const last = lastConfirmation(report)
  return {
    id: report.id,
    districtId: report.districtId,
    landmarkKey: report.landmarkKey,
    landmark: report.landmark,
    depthCm: last.depthCm,
    severity: severityFor(last.depthCm),
    confirmations: report.confirmations.length,
    firstSeenAt: report.confirmations[0]?.seenAt ?? last.seenAt,
    lastConfirmedAt: last.seenAt
  }
}

/** In-memory reports. Expired reports are kept, only hidden from active(). */
export class ReportStore {
  #reports: StoredReport[] = []

  /** Add a submission as a confirmation of a matching report, or as a new report (RPT-REQ-004). */
  submit(input: ReportInput, now: Date): { report: ReportView; merged: boolean } {
    // Reject bad input before touching the store, so one bad submission can't poison a district.
    severityFor(input.depthCm)
    const seenAt = new Date(input.seenAt)
    if (Number.isNaN(seenAt.getTime())) throw new RangeError("seenAt is not a valid time")

    const confirmation: Confirmation = { depthCm: input.depthCm, seenAt, receivedAt: now }
    const key = landmarkKey(input.landmark)

    const target = this.#reports
      .filter(
        (r) =>
          r.districtId === input.districtId &&
          r.landmarkKey === key &&
          Math.abs(confirmation.seenAt.getTime() - lastConfirmation(r).seenAt.getTime()) <= MERGE_WINDOW_MS
      )
      .reduce<StoredReport | undefined>(
        (best, r) => (!best || lastConfirmation(r).seenAt > lastConfirmation(best).seenAt ? r : best),
        undefined
      )

    if (target) {
      target.confirmations.push(confirmation)
      target.confirmations.sort(compareConfirmations)
      return { report: toView(target), merged: true }
    }

    const report: StoredReport = {
      id: `rpt_${randomUUID()}`,
      districtId: input.districtId,
      landmark: displayLandmark(input.landmark),
      landmarkKey: key,
      confirmations: [confirmation]
    }
    this.#reports.push(report)
    return { report: toView(report), merged: false }
  }

  /** Unexpired reports in a district, most severe first, then most recently confirmed (RPT-REQ-005, RPT-REQ-006). */
  active(districtId: string, now: Date): ReportView[] {
    return this.#reports
      .filter((r) => r.districtId === districtId && now.getTime() - lastConfirmation(r).seenAt.getTime() <= EXPIRY_MS)
      .map(toView)
      .sort((a, b) => b.severity - a.severity || b.lastConfirmedAt.getTime() - a.lastConfirmedAt.getTime())
  }

  /** Every report, expired ones included. */
  all(): readonly StoredReport[] {
    return this.#reports
  }
}
