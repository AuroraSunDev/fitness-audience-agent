import test from 'node:test';
import assert from 'node:assert/strict';

const { defaultRadarSkill, editRadarSkill, saveRadarSkill, enableRadarSkill, RadarRun, makeRunKey, nextMockRun } = await import('../src/radar-runtime.mjs').catch(() => ({}));

test('saving permits enabling, but changing a monitored domain revokes the old subscription', () => {
  assert.equal(typeof saveRadarSkill, 'function');
  const saved = saveRadarSkill(defaultRadarSkill);
  assert.equal(enableRadarSkill(saved).enabled, true);
  const edited = editRadarSkill(enableRadarSkill(saved), { domains: ['traffic', 'transaction'] });
  assert.deepEqual(edited.domains, ['traffic', 'transaction']);
  assert.deepEqual([edited.saved, edited.enabled], [false, false]);
  assert.throws(() => enableRadarSkill(edited), /先保存/);
  assert.throws(() => editRadarSkill(saved, { readOnly: false }), /不可修改/);
  assert.throws(() => saveRadarSkill({ ...saved, domains: [] }), /至少/);
});

test('run key includes shop, report date, skill version and editable config', () => {
  const saved = saveRadarSkill(defaultRadarSkill);
  const one = makeRunKey(saved, '2026-11-14');
  assert.equal(one, makeRunKey(saved, '2026-11-14'));
  assert.notEqual(one, makeRunKey(saved, '2026-11-15'));
  assert.notEqual(one, makeRunKey(editRadarSkill(saved, { hour: 10 }), '2026-11-14'));
  assert.match(one, /demo-fitness-001.*2026-11-14.*1\.0\.0/);
});

test('fixed simulated clock calculates the next run without a real background scheduler', () => {
  assert.match(nextMockRun(saveRadarSkill(defaultRadarSkill)), /2026-11-16 09:00/);
  assert.match(nextMockRun(saveRadarSkill(editRadarSkill(defaultRadarSkill, { frequency: 'weekly' }))), /2026-11-21 09:00/);
});

test('normal run has ordered trace and only one mock notification', () => {
  const run = new RadarRun(enableRadarSkill(saveRadarSkill(defaultRadarSkill)), '2026-11-14');
  assert.equal(run.status, 'scheduled_mock');
  run.start();
  while (run.status === 'running') run.advance();
  assert.equal(run.status, 'completed');
  assert.equal(run.trace.length, 11);
  assert.equal(run.notifications.length, 1);
  assert.equal(run.report.metrics.traffic.actual, 6000);
  run.advance();
  assert.equal(run.notifications.length, 1);
});

test('manual report refresh without subscription does not generate a delivery',()=>{
  const run=new RadarRun(saveRadarSkill(defaultRadarSkill),'2026-11-14');
  run.start();while(run.status==='running')run.advance();
  assert.equal(run.report.metrics.traffic.actual,6000);
  assert.equal(run.notifications.length,0);
});

test('missing data is partial; timeout, interrupt and unauthorized never look completed', () => {
  const skill = saveRadarSkill(defaultRadarSkill);
  const missing = new RadarRun(skill, '2026-11-14', 'missing-data');
  missing.start(); while (missing.status === 'running') missing.advance();
  assert.equal(missing.status, 'partial');
  const timeout = new RadarRun(skill, '2026-11-14', 'timeout');
  timeout.start(); while (timeout.status === 'running') timeout.advance();
  assert.equal(timeout.status, 'failed');
  assert.equal(timeout.report, null);
  assert.equal(timeout.trace.at(-1).errorCode, 'MOCK_TIMEOUT');
  const interrupted = new RadarRun(skill, '2026-11-14');
  interrupted.start(); interrupted.advance(); interrupted.interrupt();
  assert.equal(interrupted.status, 'interrupted');
  assert.equal(interrupted.report, null);
  assert.equal(interrupted.trace.length, 1);
  const denied = new RadarRun({ ...skill, shopId: 'other-shop' }, '2026-11-14');
  denied.start(); denied.advance();
  assert.equal(denied.status, 'failed');
  assert.equal(denied.trace[0].errorCode, 'MOCK_UNAUTHORIZED');
  const invalid = new RadarRun({ ...skill, domains: [] }, '2026-11-14');
  invalid.start(); invalid.advance();
  assert.equal(invalid.trace[0].errorCode, 'MOCK_INVALID_CONFIG');
});
