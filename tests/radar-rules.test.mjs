import test from 'node:test';
import assert from 'node:assert/strict';

const { buildRadarReport, shouldSuppressRecommendation } = await import('../src/radar-rules.mjs').catch(() => ({}));

test('11-14 total and paid gaps use different denominators and never double-count', () => {
  assert.equal(typeof buildRadarReport, 'function');
  const report = buildRadarReport('2026-11-14');
  assert.equal(report.status, 'complete');
  assert.equal(report.metrics.traffic.gap, 1000);
  assert.ok(Math.abs(report.metrics.traffic.gapRatio - 1000 / 7000) < 1e-9);
  assert.equal(report.metrics.traffic.paid.gap, 500);
  assert.ok(Math.abs(report.metrics.traffic.paid.gapRatio - 500 / 1300) < 1e-9);
  assert.equal(report.metrics.traffic.paid.contribution, .5);
  assert.match(report.summary, /1,000/);
  assert.match(report.summary, /50%/);
  assert.doesNotMatch(report.summary, /1,500/);
});

test('11-14 rank alert is a lead only, and incomparable snapshots do not alert', () => {
  const report = buildRadarReport('2026-11-14');
  assert.equal(report.alerts.find(alert => alert.kind === 'ranking').delta, 6);
  assert.equal(report.alerts.find(alert => alert.kind === 'ranking').certainty, '待核验');
  const bad = buildRadarReport('2026-11-14', { scenario: 'rank-incomparable' });
  assert.equal(bad.alerts.some(alert => alert.kind === 'ranking'), false);
  assert.match(bad.metrics.ranking.note, /不可比/);
  assert.equal(bad.status, 'partial');
  assert.equal(bad.completeness, '3/4');
});

test('missing audience and metric conflict degrade only supported conclusions', () => {
  const missing = buildRadarReport('2026-11-14', { scenario: 'missing-data' });
  assert.equal(missing.status, 'partial');
  assert.equal(missing.metrics.audience.value, null);
  assert.equal(missing.alerts.some(alert => alert.kind === 'audience'), false);
  const conflict = buildRadarReport('2026-11-14', { scenario: 'metric-conflict' });
  assert.equal(conflict.status, 'partial');
  assert.equal(conflict.metrics.traffic.gap, null);
  assert.equal(conflict.alerts.some(alert => alert.kind === 'traffic' || alert.kind === 'paid'), false);
  assert.match(conflict.summary, /口径冲突/);
});

test('unsupported dates and unavailable comparison baselines never inherit 11-14 facts', () => {
  assert.equal(buildRadarReport('2026-11-18').status, 'unsupported');
  const day16 = buildRadarReport('2026-11-17');
  assert.equal(day16.metrics.traffic.actual, 7000);
  assert.equal(day16.metrics.traffic.paid, null);
  assert.equal(day16.metrics.transaction.value, null);
  assert.equal(day16.alerts.length, 0);
});

test('next-day follow-up retains incident identity but states observation, not cause', () => {
  const first = buildRadarReport('2026-11-14');
  const next = buildRadarReport('2026-11-15');
  assert.equal(next.followup.incidentId, first.alerts.find(alert => alert.kind === 'traffic').incidentId);
  assert.deepEqual([next.followup.previousGap, next.followup.currentGap], [1000, 400]);
  assert.match(next.followup.disclaimer, /不等于证明/);
});

test('evidence includes metric version, denominator, date, lineage and retrieval time', () => {
  const paid = buildRadarReport('2026-11-14').alerts.find(alert => alert.kind === 'paid');
  assert.equal(paid.evidence.metricId, 'SHOP_UV_001');
  assert.equal(paid.evidence.version, 'v1.0');
  assert.equal(paid.evidence.denominator, 1300);
  assert.match(paid.evidence.timeWindow, /2026-11-14/);
  assert.ok(paid.evidence.source && paid.evidence.lineage && paid.evidence.fetchedAt);
});

test('not-applicable feedback suppresses repeat recommendation for seven days but not a new major gap', () => {
  const feedback = { incidentId: 'INC-UV-GAP', status: 'not_applicable', createdAt: '2026-11-14T09:00:00+08:00', expiresAt: '2026-11-21T09:00:00+08:00', gapAtFeedback: 1000 };
  assert.equal(shouldSuppressRecommendation(feedback, { incidentId: 'INC-UV-GAP', gap: 1000 }, '2026-11-15'), true);
  assert.equal(shouldSuppressRecommendation(feedback, { incidentId: 'INC-UV-GAP', gap: 1600 }, '2026-11-15'), false);
  assert.equal(shouldSuppressRecommendation(feedback, { incidentId: 'INC-UV-GAP', gap: 1000 }, '2026-11-22'), false);
});

test('processing done never changes an abnormal metric into a recovered metric',()=>{
  const feedback=[{incidentId:'INC-PAID-GAP',status:'done',sourceDate:'2026-11-14',createdAt:'2026-11-15T09:00:00+08:00'}];
  const report=buildRadarReport('2026-11-14',{feedback});
  assert.equal(report.alerts.find(row=>row.kind==='paid').gap,500);
  const next=buildRadarReport('2026-11-15',{feedback});
  assert.equal(next.followups.find(row=>row.incidentId==='INC-PAID-GAP').processingStatus,'done');
  assert.equal(next.followups.find(row=>row.incidentId==='INC-PAID-GAP').currentGap,150);
});

test('approved sorting can move a handled issue without changing numeric evidence',()=>{
  const feedback=[{incidentId:'INC-PAID-GAP',status:'done',sourceDate:'2026-11-14'}];
  const before=buildRadarReport('2026-11-14',{feedback});
  const after=buildRadarReport('2026-11-14',{feedback,policy:{order:'unresolved_first'}});
  assert.equal(before.alerts[0].kind,'paid');
  assert.equal(after.alerts[0].kind,'traffic');
  assert.deepEqual(before.metrics,after.metrics);
});

test('conflicting visitor definitions cannot produce a trusted conversion rate',()=>{
  assert.equal(buildRadarReport('2026-11-14',{scenario:'metric-conflict'}).metrics.transaction.conversion,null);
});
