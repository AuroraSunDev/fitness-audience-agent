import test from 'node:test';
import assert from 'node:assert/strict';
import { RadarUI } from '../src/radar-ui.mjs';
import { buildRadarReport } from '../src/radar-rules.mjs';
import { editRadarSkill, makeRunKey } from '../src/radar-runtime.mjs';

const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
const createUI = () => new RadarUI(storage(), () => {}, () => {});
const visibleText = html => html.replace(/<[^>]*>/g, ' ');

test('merchant entry opens the store report directly without internal demo controls', () => {
  const ui = createUI();
  assert.equal(ui.page, 'report');
  assert.match(ui.render(), /动燃健身旗舰店/);
  assert.match(ui.render(), /经营巡检日报/);
  assert.match(ui.render(), /6,000/);
  assert.doesNotMatch(visibleText(ui.render()), /教学|Mock|模拟|作业|Skill|本机|契约|Asia\/Shanghai/);
  assert.doesNotMatch(ui.render(), /name="radar-scenario"/);
});

test('default inspection can be enabled in one action and invalid empty scope leaves settings intact', () => {
  const ui = createUI();
  assert.equal(ui.memory.config.enabled, false);
  assert.equal(ui.saveSettings({ domains: ['traffic','audience','transaction','ranking'], frequency: 'daily', hour: 9, notification: 'important_only' }), true);
  assert.equal(ui.memory.config.enabled, true);
  assert.equal(ui.memory.config.saved, true);
  assert.equal(ui.saveSettings({ domains: [] }), false);
  assert.equal(ui.memory.config.domains.length, 4);
  assert.equal(ui.memory.config.enabled, true);
});

test('back returns through detail, report and history while preserving the selected date', () => {
  const ui = createUI();
  ui.open('history');
  ui.selectDate('2026-11-15');
  ui.selectMetric('traffic');
  assert.equal(ui.page, 'metric');
  assert.equal(ui.back(), true);
  assert.equal(ui.page, 'report');
  assert.equal(ui.date, '2026-11-15');
  assert.equal(ui.back(), true);
  assert.equal(ui.page, 'history');
  assert.equal(ui.back(), true);
  assert.equal(ui.page, 'report');
  assert.equal(ui.date, '2026-11-14');
  assert.equal(ui.back(), false);
});

test('changing dates updates the report and never offers unsupported diagnostic data', () => {
  const ui = createUI();
  ui.selectDate('2026-11-15');
  assert.match(ui.render(), /6,500/);
  assert.doesNotMatch(ui.render(), /6,000/);
  ui.selectMetric('traffic');
  assert.match(ui.render(), /6,900/);
  assert.doesNotMatch(ui.render(), /data-radar="continue-diagnosis"/);
});

test('date selection opens a calendar and export stops at the selected day',()=>{
  const ui=createUI();
  assert.deepEqual(ui.reportsForExport().map(report=>report.date),['2026-11-12','2026-11-13','2026-11-14']);
  assert.match(ui.render(),/data-radar="toggle-calendar"/);
  ui.handle('toggle-calendar');
  assert.match(ui.render(),/date-calendar/);
  assert.match(ui.render(),/data-radar="calendar-2026-11-13"/);
});

test('all metric and alert details retain evidence in merchant language', () => {
  const ui = createUI();
  for (const id of ['traffic','audience','transaction','ranking']) {
    ui.selectMetric(id);
    assert.match(ui.render(), /查看数据口径与来源/);
    assert.doesNotMatch(visibleText(ui.render()), /教学|Mock|模拟|作业|Skill|本机|契约|Asia\/Shanghai/);
    ui.back();
  }
  ui.selectAlert('INC-PAID-GAP');
  assert.match(ui.render(), /SHOP_UV_001/);
  assert.match(ui.render(), /1,300/);
  assert.match(ui.render(), /数据血缘/);
  assert.match(ui.render(), /继续分析流量异常/);
});

test('not-applicable feedback suppresses the repeat task while preserving the alert', () => {
  const ui = createUI();
  const key = makeRunKey(ui.memory.config, '2026-11-14');
  ui.memory.addRun({ key, date: '2026-11-14', scenario: 'normal', status: 'completed', report: buildRadarReport('2026-11-14'), trace: [], notifications: [] });
  ui.memory.setFeedback('INC-UV-GAP', 'not_applicable', '不适用', '2026-11-15T09:00:00+08:00', 1000, '2026-11-14');
  assert.match(ui.render(), /店铺 UV 低于参考预期/);
  ui.open('tasks');
  assert.doesNotMatch(ui.render(), /data-task-status="INC-UV-GAP"/);
});

test('failed queries offer recovery without a full report or internal scenario copy', () => {
  const ui = createUI();
  for (const [scenario, message] of [['timeout', /超时/], ['unauthorized', /权限/]]) {
    ui.scenario = scenario;
    assert.match(ui.render(), message);
    assert.doesNotMatch(ui.render(), /radar-kpis/);
    assert.doesNotMatch(visibleText(ui.render()), /教学|Mock|模拟|Trace/);
  }
});

test('changing monitored domains uses the matching report configuration', () => {
  const ui = createUI();
  const key = makeRunKey(ui.memory.config, '2026-11-14');
  ui.memory.addRun({ key, date: '2026-11-14', scenario: 'normal', status: 'completed', report: buildRadarReport('2026-11-14'), trace: [], notifications: [] });
  ui.memory.saveConfig(editRadarSkill(ui.memory.config, { domains: ['traffic'] }));
  assert.match(ui.render(), /店铺访客/);
  assert.doesNotMatch(ui.render(), /data-radar="metric-audience"/);
  ui.open('history');
  assert.match(ui.render(), /已覆盖 1\/1 项/);
});

test('report offers direct default enablement, explicit coverage and prior issue followup',()=>{
  const ui=createUI();
  assert.match(ui.render(),/data-radar="enable-default"/);
  assert.match(ui.render(),/数据范围/);
  assert.match(ui.render(),/4\/4/);
  ui.memory.setFeedback('INC-PAID-GAP','done','已检查广告计划','2026-11-15T09:00:00+08:00',500,'2026-11-14');
  ui.selectDate('2026-11-15');
  assert.match(ui.render(),/已处理/);
  assert.match(ui.render(),/150/);
  assert.match(ui.render(),/上次问题/);
});

test('diagnosis handoff carries original report, scope and evidence context',()=>{
  let captured;
  const ui=new RadarUI(storage(),()=>{},context=>captured=context);
  ui.handle('continue-diagnosis',null,{dataset:{alertId:'INC-PAID-GAP-2026-11-14'}});
  assert.equal(captured.date,'2026-11-14');
  assert.ok(captured.reportId);
  assert.ok(captured.evidenceIds.length);
  assert.match(captured.question,/付费/);
  assert.equal(captured.metricVersion,'v1.0');
  assert.equal(captured.route.page,'report');
  assert.equal(captured.route.date,'2026-11-14');
});

test('a diagnosis handoff can restore the exact source report route',()=>{
  const ui=createUI();
  ui.selectAlert('INC-PAID-GAP');
  const route=ui.captureRoute();
  ui.selectDate('2026-11-16');
  assert.equal(ui.date,'2026-11-16');
  assert.equal(ui.restoreRoute(route),true);
  assert.equal(ui.page,'alert');
  assert.equal(ui.date,'2026-11-14');
  assert.equal(ui.selectedAlert,'INC-PAID-GAP');
});

test('export prefers saved historical snapshots and keeps the selected date separate',()=>{
  const ui=createUI();
  const historical=buildRadarReport('2026-11-14',{version:'1.0.0'});
  historical.summary='保留的历史结论';
  ui.memory.addRun({key:makeRunKey(ui.memory.config,'2026-11-14'),date:'2026-11-14',scenario:'normal',status:'completed',report:historical,notifications:[]});
  const proposal=ui.memory.propose('wording','行动建议前置');
  ui.memory.shadowCompare(proposal.id);ui.memory.review(proposal.id,'approve');
  ui.date='2026-11-16';
  const reports=ui.reportsForExport();
  assert.equal(reports.find(report=>report.date==='2026-11-14').summary,'保留的历史结论');
  assert.equal(reports.find(report=>report.date==='2026-11-14').version,'1.0.0');
  assert.equal(reports.at(-1).date,'2026-11-16');
});

test('a new governed run gets a distinct version key and does not overwrite the old report',()=>{
  const ui=createUI();
  const report=buildRadarReport('2026-11-14');
  ui.memory.addRun({key:makeRunKey(ui.memory.config,'2026-11-14'),date:'2026-11-14',scenario:'normal',status:'completed',report,notifications:[]});
  const proposal=ui.memory.propose('sort','未处理事项优先');
  ui.memory.shadowCompare(proposal.id);ui.memory.review(proposal.id,'approve');
  assert.equal(ui.report.data.version,'1.0.0');
  ui.startRun();clearTimeout(ui.timer);
  assert.match(ui.activeRun.key,/1\.0\.1/);
  assert.equal(ui.memory.runs[0].report.version,'1.0.0');
});
