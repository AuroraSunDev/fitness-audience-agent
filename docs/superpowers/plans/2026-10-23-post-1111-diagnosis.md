# Post-11.11 Diagnosis Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old audience-opportunity display with one mobile-first, eight-state, data-consistent diagnosis prototype and assignment artifacts.

**Architecture:** Native ES modules separate fixtures/calculation, deterministic mock tools/state, and DOM rendering. GitHub Pages serves static files; no backend or real write operations.

**Tech Stack:** HTML, CSS, JavaScript ES modules, Node `--test`, Playwright for browser QA.

**Spec:** `docs/superpowers/specs/2026-10-23-post-1111-diagnosis-design.md`

## Global Constraints

- One store, one post-11.11 traffic question, 2026-11-14 Asia/Shanghai.
- All metrics and advice derive from one Mock fixture; unsupported plans return an explicit error.
- Eight reachable states; mobile 375–430px is primary.
- No real LLM, store API, budget write, approval or scheduler.
- Do not add a second audience-analysis application.

## Review Focus

- Missing paid-channel data must not be inferred as a complete attribution.
- Metric conflict must not silently select one source and show a complete conclusion.
- Interrupted/expired jobs must not transition to S4 later through a stale timer.
- Switching to product-detail UV must not preserve store-UV values.
- Approval request must require an explicit second confirmation; “pending” must never equal executed.

### Task 1: Unified fixture and diagnosis functions

**Files:** Create `src/data.mjs`, `tests/data.test.mjs`.

- [ ] Write tests for channel sums, 40% decline, 75%/25% decomposition, 500/250/200/50 gaps, and unsupported/partial/conflicting scenarios.
- [ ] Run `node --test tests/data.test.mjs`; expect missing-module failure.
- [ ] Implement a single fixture and pure calculation/result contracts.
- [ ] Run the same test; expect all pass.

### Task 2: Deterministic task and approval state

**Files:** Create `src/engine.mjs`, `tests/engine.test.mjs`.

- [ ] Write tests for step order/Trace, interruption, timeout/low-evidence stop, unsupported plan, and confirm-before-approval.
- [ ] Run `node --test tests/engine.test.mjs`; expect missing-module failure.
- [ ] Implement the finite-state engine and mock tool outcomes.
- [ ] Run `node --test`; expect all pass.

### Task 3: Mobile UI and eight-state path

**Files:** Replace `index.html`; create `src/app.mjs`, `src/styles.css`.

- [ ] Write browser acceptance checks for reachable S1–S8, plan changes, interruption, S6 exits, and S7 second confirmation.
- [ ] Observe the checks fail on the old page.
- [ ] Implement the accepted compact mobile visual system and state-driven rendering.
- [ ] Run browser checks and inspect 390px and desktop layouts.

### Task 4: Assignment handoff and publication

**Files:** Create `README.md`, `docs/设计说明.md`, `docs/走查记录.md`, `screenshots/S1–S8.png`.

- [ ] Produce eight screenshots from the running UI at one mobile viewport.
- [ ] Document the four required design topics and three genuine QA observations with disposition.
- [ ] Run full tests, browser QA, screenshot inspection, and repository diff review.
- [ ] Push to the requested repository and verify the GitHub Pages URL serves the new app.
