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

test('explicit rerun replaces same-key result and never duplicates its mock notification', () => {
  const memory = new RadarMemory(fakeStorage());
  memory.addRun({ key: 'same-key', date: '2026-11-14', status: 'completed', notifications: [{ mock: true }] });
  const rerun = memory.addRun({ key: 'same-key', date: '2026-11-14', status: 'partial', notifications: [{ mock: true }] }, { rerun: true });
  assert.equal(rerun.reused, false);
  assert.equal(memory.runs.length, 1);
  assert.equal(memory.runs[0].status, 'partial');
  assert.equal(memory.runs[0].notifications.length, 0);
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
  assert.equal(memory.governance.version, '1.0.1-mock');
  assert.equal(memory.governance.published[0].version, '1.0.1-mock');
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
