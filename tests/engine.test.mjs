import test from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalFlow, DiagnosticTask } from '../src/engine.mjs';
import { defaultPlan, getFixture } from '../src/data.mjs';

test('the task exposes four ordered steps and completes with evidence', () => {
  const task = new DiagnosticTask(getFixture('normal'), defaultPlan);
  task.start();
  assert.equal(task.status, 'running');
  task.advance();
  assert.equal(task.stepIndex, 1);
  assert.match(task.partialFinding, /4,000/);
  task.advance();
  task.advance();
  task.advance();
  assert.equal(task.status, 'completed');
  assert.equal(task.result.extraGap, 1000);
  assert.equal(task.evidence.length, 2);
  assert.deepEqual(task.trace.map(item => item.tool), ['get_metric_def', 'query_metric', 'drill_dimension', 'run_attribution', 'get_evidence_card', 'propose_action']);
});

test('interrupt freezes the task and resume keeps the completed step', () => {
  const task = new DiagnosticTask(getFixture('normal'), defaultPlan);
  task.start(); task.advance(); task.interrupt();
  assert.equal(task.status, 'interrupted');
  task.advance();
  assert.equal(task.stepIndex, 1);
  assert.equal(task.result, null);
  task.resume(); task.advance();
  assert.equal(task.stepIndex, 2);
});

test('missing data, conflict, timeout and unsupported plan stop before success', () => {
  for (const [scenario, plan, expected] of [
    ['missing-data', defaultPlan, 'low_evidence'],
    ['metric-conflict', defaultPlan, 'metric_conflict'],
    ['timeout', defaultPlan, 'timeout'],
    ['normal', { ...defaultPlan, date: '2026-11-13' }, 'unsupported']
  ]) {
    const task = new DiagnosticTask(getFixture(scenario), plan);
    task.start();
    for (let i = 0; i < 4; i++) task.advance();
    assert.equal(task.status, 'stopped', scenario);
    assert.equal(task.failure.code, expected, scenario);
    assert.equal(task.result, null, scenario);
    assert.ok(task.trace.some(item => item.status !== 'success'), scenario);
  }
});

test('human handoff contains the original question, plan, completed work and specific unknown', () => {
  const task = new DiagnosticTask(getFixture('missing-data'), defaultPlan, '大促后流量掉了，是正常回落还是有问题？');
  task.start(); task.advance(); task.advance();
  const handoff = task.makeHandoff();
  assert.equal(handoff.mock, true);
  assert.equal(handoff.question, '大促后流量掉了，是正常回落还是有问题？');
  assert.equal(handoff.plan.metricId, 'SHOP_UV_001');
  assert.equal(handoff.completedSteps.length, 1);
  assert.match(handoff.todo, /广告/);
});

test('budget request cannot become pending without a second confirmation', () => {
  const flow = new ApprovalFlow();
  assert.equal(flow.submit(), false);
  assert.equal(flow.status, 'draft');
  flow.openConfirmation();
  assert.equal(flow.status, 'confirming');
  assert.equal(flow.submit(), true);
  assert.equal(flow.status, 'pending');
  assert.match(flow.approvalId, /^APP-/);
  assert.equal(flow.executed, false);
  flow.approveDemo();
  assert.equal(flow.status, 'approved_mock');
  assert.equal(flow.executed, false);
});

test('cancelled and rejected approval requests never execute', () => {
  const cancelled = new ApprovalFlow();
  cancelled.openConfirmation(); cancelled.submit(); cancelled.cancel();
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.executed, false);
  const rejected = new ApprovalFlow();
  rejected.openConfirmation(); rejected.submit(); rejected.rejectDemo();
  assert.equal(rejected.status, 'rejected_mock');
  assert.equal(rejected.executed, false);
  assert.notEqual(cancelled.approvalId, rejected.approvalId);
});
