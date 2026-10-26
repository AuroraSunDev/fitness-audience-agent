import test from 'node:test';
import assert from 'node:assert/strict';
import { DiagnosticTask } from '../src/engine.mjs';
import { defaultPlan, getFixture } from '../src/data.mjs';

const { DiagnosisHistory } = await import('../src/diagnosis-history.mjs').catch(() => ({}));
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const complete = () => {
  const task = new DiagnosticTask(getFixture(), defaultPlan);
  task.start(); while (task.status === 'running') task.advance();
  return task;
};

test('repeated diagnoses have separate identities and saving preserves the analysis context', () => {
  assert.equal(typeof DiagnosisHistory, 'function');
  const memory = new DiagnosisHistory(storage());
  const task = complete();
  assert.notEqual(task.id, complete().id);
  memory.saveWatch(task, { frequency: 'daily', hour: 9 });
  const record = memory.latestSaved;
  assert.equal(record.watch.metricId, 'SHOP_UV_001');
  assert.equal(record.watch.baseline, 'similar_campaign');
  assert.equal(record.watch.sourceDate, '2026-11-14');
  assert.equal(record.watch.subscriptionId, 'post-campaign-traffic-watch');
  assert.equal(record.watch.evidenceIds.length, 2);
  assert.equal(record.watch.nextRunAt, '2026-11-15 09:00');
  memory.pauseWatch(task.id);
  assert.equal(memory.latestSaved.watch.enabled, false);
});

test('saved result is restored after reload with its original evidence instead of rerunning', () => {
  const local = storage(), memory = new DiagnosisHistory(local), task = complete();
  memory.saveWatch(task, { frequency: 'daily', hour: 9 });
  const restored = new DiagnosisHistory(local).restoreLatest();
  assert.equal(restored.id, task.id);
  assert.equal(restored.status, 'completed');
  assert.equal(restored.result.extraGap, 1000);
  assert.equal(restored.evidence[0].metricId, 'SHOP_UV_001');
  assert.equal(restored.question, '大促后流量掉了，是正常回落还是有问题？');
});

test('only an explicit human-review request counts as intervention, once per diagnosis', () => {
  const memory = new DiagnosisHistory(storage());
  const success = complete(); memory.recordTask(success);
  const failed = new DiagnosticTask(getFixture(), { ...defaultPlan, metricId: 'PRODUCT_DETAIL_UV_002' });
  failed.start(); failed.advance(); memory.recordTask(failed);
  assert.equal(memory.metrics().humanInterventions, 0);
  const first = memory.requestReview(failed), second = memory.requestReview(failed);
  assert.equal(first.id, second.id);
  assert.equal(first.status, 'pending');
  assert.match(first.todo, /商品详情页/);
  assert.deepEqual(memory.metrics(), { started: 2, completed: 1, traceable: 1, humanInterventions: 1, interventionRate: .5, traceabilityRate: 1 });
});

test('an unfinished diagnosis cannot be saved as a reusable conclusion', () => {
  const memory = new DiagnosisHistory(storage());
  const task = new DiagnosticTask(getFixture(), defaultPlan);
  task.start(); task.advance();
  assert.throws(() => memory.saveWatch(task, { frequency: 'daily', hour: 9 }), /完成/);
  assert.equal(memory.latestSaved, null);
});
