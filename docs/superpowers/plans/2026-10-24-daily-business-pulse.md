# Daily Business Pulse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one configurable, traceable, read-only daily business pulse Skill to the existing 商策 prototype.

**Architecture:** Fixed Mock fixtures and a metric dictionary feed pure deterministic rules. A local simulation state machine and namespaced browser memory feed one additional section inside the existing app; S8 links to the same Skill. No backend or build system.

**Tech Stack:** Native ESM JavaScript, CSS, Node test runner, static HTML.

**Spec:** `docs/superpowers/specs/2026-10-24-daily-business-pulse-design.md` plus the two user-provided `docs/作业三_*.md` files.

## Global Constraints

- Feature branch only; preserve S1–S8 and `src/data.mjs` anchors.
- Every run, notification, approval and 2026-11 value is labelled 教学 Mock.
- Supported report dates are 2026-11-14/15/16; unsupported dates never reuse another day's result.
- Browser storage is one-shop demo only; no real scheduler, APIs, budget writes or self-evolving model.
- Mobile target 390×844, plus 375px and desktop.

## Review Focus

- Missing domain must yield partial coverage, not estimated domain data (Task 1, 2).
- Conflicting metric version must block the impacted conclusion (Task 2).
- Duplicate run must not create a second notification (Task 3).
- Migrated old enabled subscription must become disabled (Task 3).
- Existing S2 must never show 11-14 data for another report date (Task 4).

### Task 1: Fixed fixtures and dictionary

**Files:** create `src/radar-data.mjs`, `tests/radar-data.test.mjs`.

**Interfaces:** `getRadarDay(date, scenario='normal')` returns a dated fixture or `null`; `radarMetricDictionary` contains required provenance fields.

- [x] Write failing tests for 11-14 anchors, 11-15 channel conservation, 11-16 unavailable detail, 11-14 audience/transaction arithmetic, and unknown date.
- [x] Run `node --test tests/radar-data.test.mjs` and observe expected failure.
- [x] Implement minimal fixed fixtures and dictionary.
- [x] Run `node --test tests/*.test.mjs` and verify all pass.

### Task 2: Deterministic report and alert rules

**Files:** create `src/radar-rules.mjs`, `tests/radar-rules.test.mjs`.

**Interfaces:** `buildRadarReport(date,{scenario,domains,feedback})` returns report status, summary, KPI values, evidence, alerts, tasks and follow-up. `getRadarDay` from Task 1 is its sole data source.

- [x] Write failing tests for the 1000/500 gaps and distinct ratios, rank comparison, missing/conflict/incomparable degradation, incident linkage and next-day observation.
- [x] Run targeted test and observe failure.
- [x] Implement the rules with no invented baselines or additive overlap.
- [x] Run full Node suite.

### Task 3: Skill, runtime, local memory and governance

**Files:** create `src/radar-runtime.mjs`, `src/radar-memory.mjs`, `tests/radar-runtime.test.mjs`, `tests/radar-memory.test.mjs`.

**Interfaces:** runtime exposes config normalization/save/enable, `RadarRun` step state and a deterministic run key; memory exposes load/save/clear and feedback/governance transitions.

- [x] Write failing tests for save→enable, edit invalidation, old S8 migration disabled, duplicate notification, interrupted/failed Trace, feedback TTL, approval and rollback.
- [x] Run targeted test and observe failure.
- [x] Implement minimal local simulation and memory transitions.
- [x] Run full Node suite.

### Task 4: Unified UI and browser flow

**Files:** create `src/radar-ui.mjs`, `src/radar.css`; modify `src/app.mjs`, `index.html`; add browser smoke tests if existing tool supports.

**Interfaces:** radar UI mounts inside existing `.phone-surface`; uses Task 2 reports and Task 3 state. S8 opens radar Skill; 11-14 report passes alert provenance to existing S2 only.

- [x] Write failing UI contract tests before implementation; run a separate browser smoke path after the preview server was available.
- [x] Wire unified navigation and all required UI states; add responsive CSS.
- [x] Run Node suite and browser checks at 390×844, 375px and desktop; correct observed layout/interaction defects.

### Task 5: Delivery evidence

**Files:** modify `README.md`; create `docs/assignment-3/设计说明.md`, `mock-data-dictionary.md`, `走查记录.md`, screenshots.

- [x] Recheck both user docs against implemented flows and record limits honestly.
- [x] Capture actual browser screenshots and at least three genuine observations/fixes.
- [x] Run full test command, browser smoke path and `git diff --check`.
- [x] Commit only requested feature files on `feat/daily-business-pulse`; do not push `main`.
