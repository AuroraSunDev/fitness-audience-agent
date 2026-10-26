import test from 'node:test';
import assert from 'node:assert/strict';

const { RadarMemory } = await import('../src/radar-memory.mjs').catch(() => ({}));
const fakeStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), values };
};

test('legacy S8 subscription migrates to one disabled daily Skill without erasing old key', () => {
  assert.equal(typeof RadarMemory, 'function');
  const storage = fakeStorage();
  storage.setItem('merchant-diagnosis-skill-v1', JSON.stringify({ enabled: true, saved: true, name: '旧巡检' }));
  const memory = new RadarMemory(storage);
  assert.equal(memory.config.enabled, false);
  assert.equal(memory.config.saved, false);
  assert.equal(memory.config.id, 'daily-business-pulse');
  assert.ok(storage.getItem('merchant-diagnosis-skill-v1'));
  assert.match(memory.migrationNotice, /旧/);
});

test('duplicate run key reuses persisted result and does not add a notification', () => {
  const memory = new RadarMemory(fakeStorage());
  const run = { key: 'shop/date/version/hash', date: '2026-11-14', status: 'completed', notifications: [{ mock: true }] };
  assert.equal(memory.addRun(run).reused, false);
  assert.equal(memory.addRun(run).reused, true);
  assert.equal(memory.runs.length, 1);
  assert.equal(memory.runs[0].notifications.length, 1);
});

test('explicit rerun preserves one delivery and never duplicates it', () => {
  const memory = new RadarMemory(fakeStorage());
  memory.addRun({ key: 'same-key', date: '2026-11-14', status: 'completed', notifications: [{ mock: true }] });
  const rerun = memory.addRun({ key: 'same-key', date: '2026-11-14', status: 'partial', notifications: [{ mock: true }] }, { rerun: true });
  assert.equal(rerun.reused, false);
  assert.equal(memory.runs.length, 1);
  assert.equal(memory.runs[0].status, 'partial');
  assert.equal(memory.runs[0].notifications.length, 1);
  assert.equal(memory.deliveries.length, 1);
});

test('a manual report can be delivered once after the subscription is enabled', () => {
  const memory = new RadarMemory(fakeStorage());
  memory.addRun({ key: 'same-key', date: '2026-11-14', status: 'completed', notifications: [] });
  memory.addRun({ key: 'same-key', date: '2026-11-14', status: 'completed', notifications: [{ channel: 'in_app', date: '2026-11-14' }] }, { rerun: true });
  assert.equal(memory.runs[0].notifications.length, 1);
  assert.equal(memory.deliveries.length, 1);
  memory.addRun({ key: 'same-key', date: '2026-11-14', status: 'completed', notifications: [{ channel: 'in_app', date: '2026-11-14' }] }, { rerun: true });
  assert.equal(memory.runs[0].notifications.length, 1);
  assert.equal(memory.deliveries.length, 1);
});

test('a rerun preserves a delivery recorded before the separate delivery ledger existed', () => {
  const memory = new RadarMemory(fakeStorage());
  const notification = { channel: 'in_app', date: '2026-11-14' };
  memory.addRun({ key: 'legacy-key', date: '2026-11-14', status: 'completed', notifications: [notification] });
  memory.deliveries = [];
  memory.addRun({ key: 'legacy-key', date: '2026-11-14', status: 'completed', notifications: [notification] }, { rerun: true });
  assert.equal(memory.runs[0].notifications.length, 1);
});

test('feedback persists separately from alert generation and carries seven-day TTL', () => {
  const storage = fakeStorage();
  const memory = new RadarMemory(storage);
  memory.setFeedback('INC-UV-GAP', 'not_applicable', '本周不处理', '2026-11-14T09:00:00+08:00', 1000);
  const restored = new RadarMemory(storage);
  assert.equal(restored.feedback[0].status, 'not_applicable');
  assert.equal(restored.feedback[0].note, '本周不处理');
  assert.equal(restored.feedback[0].expiresAt, '2026-11-21T01:00:00.000Z');
  assert.equal(restored.feedback[0].shopId, 'demo-fitness-001');
});

test('governance proposal needs shadow comparison and human approval before publish, then can rollback', () => {
  const memory = new RadarMemory(fakeStorage());
  assert.throws(() => memory.propose('threshold', '改为 5%'), /禁止/);
  const proposal = memory.propose('wording', '减少重复提醒', '2026-11-15T09:00:00+08:00');
  assert.equal(memory.governance.version, '1.0.0');
  assert.equal(memory.review(proposal.id, 'approve'), false);
  memory.shadowCompare(proposal.id);
  assert.equal(memory.review(proposal.id, 'approve'), true);
  assert.equal(memory.governance.version, '1.0.1');
  assert.equal(memory.governance.published[0].version, '1.0.1');
  assert.equal(memory.rollback(), true);
  assert.equal(memory.governance.version, '1.0.0');
});

test('clear requires explicit confirmation and preserves assignment-two storage', () => {
  const storage = fakeStorage();
  storage.setItem('merchant-diagnosis-skill-v1', '{"saved":true}');
  const memory = new RadarMemory(storage);
  assert.equal(memory.clear(false), false);
  assert.equal(memory.clear(true), true);
  assert.ok(storage.getItem('merchant-diagnosis-skill-v1'));
});

test('a diagnosis watch preserves its source and does not enable or widen the store subscription',async()=>{
  const { DiagnosticTask }=await import('../src/engine.mjs');
  const { defaultPlan,getFixture }=await import('../src/data.mjs');
  const local=fakeStorage(),memory=new RadarMemory(local),task=new DiagnosticTask(getFixture(),defaultPlan);
  task.start();while(task.status==='running')task.advance();
  assert.equal(typeof memory.subscribeDiagnosis,'function');
  const watch=memory.subscribeDiagnosis(task,{frequency:'daily',hour:9});
  assert.equal(watch.sourceDiagnosisId,task.id);
  assert.deepEqual(watch.domains,['traffic']);
  assert.equal(watch.metricId,'SHOP_UV_001');
  assert.equal(watch.dateRule,'previous_complete_day');
  assert.equal(memory.config.enabled,false);
  memory.subscribeDiagnosis(task,{frequency:'weekly',hour:10});
  assert.equal(memory.focused.length,1);
  assert.equal(new RadarMemory(local).focused[0].question,task.question);
});

test('dated feedback retains revisions but does not leak a later action into an earlier report',()=>{
  const memory=new RadarMemory(fakeStorage());
  assert.equal(typeof memory.feedbackAt,'function');
  memory.setFeedback('INC-PAID-GAP','done','已检查','2026-11-16T09:00:00+08:00',500,'2026-11-15');
  assert.equal(memory.feedbackAt('2026-11-14').length,0);
  assert.equal(memory.feedbackAt('2026-11-15')[0].status,'done');
  memory.setFeedback('INC-PAID-GAP','deferred','继续跟进','2026-11-17T09:00:00+08:00',150,'2026-11-16');
  assert.equal(memory.feedbackAt('2026-11-15')[0].status,'done');
  assert.equal(memory.feedbackAt('2026-11-16')[0].status,'deferred');
  assert.equal(memory.feedbackHistory.length,2);
});

test('editing an older report cannot replace the latest effective feedback',()=>{
  const memory=new RadarMemory(fakeStorage());
  memory.setFeedback('INC-PAID-GAP','done','16 日已处理','2026-11-17T09:00:00+08:00',150,'2026-11-16');
  memory.setFeedback('INC-PAID-GAP','deferred','补记 14 日状态','2026-11-15T09:00:00+08:00',500,'2026-11-14');
  assert.equal(memory.feedbackAt('2026-11-14')[0].status,'deferred');
  assert.equal(memory.feedbackAt('2026-11-16')[0].status,'done');
  assert.equal(memory.feedback[0].status,'done');
});

test('governed sorting changes only after replay and approval, with a usable rollback',()=>{
  const memory=new RadarMemory(fakeStorage());
  assert.deepEqual(memory.governance.policy,{order:'priority',wording:'standard'});
  const proposal=memory.propose('sort','未处理事项优先');
  assert.equal(memory.review(proposal.id,'approve'),false);
  memory.shadowCompare(proposal.id);
  assert.equal(proposal.shadow.samples,3);
  assert.equal(proposal.shadow.metricRulesUnchanged,true);
  assert.equal(memory.governance.policy.order,'priority');
  assert.equal(memory.review(proposal.id,'approve'),true);
  assert.equal(memory.governance.policy.order,'unresolved_first');
  memory.rollback();
  assert.equal(memory.governance.policy.order,'priority');
});
