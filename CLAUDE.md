# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

น้ำท่วมไหม: a small teaching app for CodePassion Academy's "AI Coding with Claude" course. It shows Bangkok districts and the latest water level of the stations in each one. The station data is made up. The class adds a feature that lets local people report flooded spots. This is **not** an official flood warning service.

**Never send test reports to a live system**, such as the ROOP TAN JAI Flood Watch map (`flood-api.rooptanjai.com`). People make real decisions with it during floods. GET is allowed; POST and DELETE are not. Feature code must not call any external API at all.

## Commands

Node.js 22 or later. There is no build step: `tsx` runs TypeScript directly, and `tsc` only type-checks (`noEmit`).

```bash
npm test                                  # vitest run (all tests)
npx vitest run tests/app.test.ts          # one file
npx vitest run -t "returns 404"           # tests whose name matches
npm run lint                              # tsc --noEmit
npm run dev                               # tsx watch, http://localhost:3000
curl localhost:3000/districts/lat-phrao
```

## Architecture

- `src/app.ts` exports `handle(method, path, body, ctx)` and does all routing as a pure function that returns `{ status, body }`. It never touches `node:http`, so tests call `handle` directly with no server running.
- `src/server.ts` is the only part that uses `node:http`. It reads the body, parses JSON (bad JSON gets a 400 before `handle` runs), and passes `{ now: new Date() }` in as `ctx`.
- **Time is injected.** Code that depends on "now" reads `ctx.now`, never `new Date()`. Tests pass a fixed `now`. `latestReading` ignores readings after `now` for the same reason.
- `src/stations.ts` loads `data/stations.json` once, at import time, through a JSON import attribute (`with { type: "json" }`).
- `src/districts.ts` lists the only 12 valid district ids (out of Bangkok's 50).
- Every response that shows data includes a notice saying it is not an official warning (`NOTICE` in `src/app.ts`).

## Conventions

- Depths and water levels are **integer centimetres**, never floats.
- Times are **stored as UTC `Date`s** and converted to Bangkok time (`+07:00`) only when a response is built, using `toBangkokIso` in `src/time.ts`.
- Relative imports include the `.ts` extension (`./app.ts`), because the project uses `NodeNext` resolution with `allowImportingTsExtensions`.
- `noUncheckedIndexedAccess` is on, so array and regex-match indexing returns `T | undefined` (see `districtMatch[1] ?? ""` in `src/app.ts`).

## Flood-report feature

- The feature's docs are in Thai:
  - `docs/intent/flood-reports.md` covers why the feature exists and what was decided.
  - `docs/specs/flood-reports.md` lists requirements `RPT-REQ-001` to `RPT-REQ-010`, each with testable acceptance criteria, plus the design and the files to change.
  - `docs/plans/flood-reports.md` is the step-by-step build checklist. Work on the next unchecked step, tick items as they land, and record any change of order in its "บันทึกการเปลี่ยนลำดับ" section.
- The spec is the source of truth. Test names reference those requirement IDs, for example `describe("severityFor (RPT-REQ-002)")`.
- Use the domain terms exactly as `GLOSSARY.md` defines them. In particular, a รายงาน (report) is one flooded spot, not one submission. A repeat submission for the same spot is a การยืนยัน (confirmation), and its time is the เวลาที่เห็น (when the person saw the flooding), not when the server received it.
- Before building or reviewing anything that takes public input or personal data, load the `security-baseline` skill (`.claude/skills/security-baseline/`).
- Review diffs with `REVIEW.md` (Logic → Security & PII → Spec, one pass at a time).
- Write special Thai or invisible characters (zero-width space, ำ vs ํา) as `\u` escapes in source and tests, and check the written file afterwards: AI file-editing tools have turned these escapes into raw invisible characters in this repo before.

## Git

- `origin` is the student's fork. `upstream` is the course repo, `codepassion-academy/ai-coding-with-claude`.
- The course's reference solution lives upstream: the `class-demo` branch, with tags `cp1-intent` … `cp8-hooks`. Run `git fetch upstream --tags` to compare against it.
- `.claude/` is gitignored except for `.claude/skills/security-baseline/`. Third-party skills can be restored from `skills-lock.json` with `npx skills experimental_install`.
