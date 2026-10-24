import test from 'node:test';
import assert from 'node:assert/strict';

const { RadarUI } = await import('../src/radar-ui.mjs').catch(() => ({}));
const { buildRadarReport } = await import('../src/radar-rules.mjs');
const { editRadarSkill, makeRunKey } = await import('../src/radar-runtime.mjs');
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};

test('one radar surface starts with a clear Skill and simulated report entry', () => {
  assert.equal(typeof RadarUI, 'function');
  const ui = new RadarUI(storage(), () => {}, () => {});
  assert.match(ui.render(), /每日经营巡检/);
  assert.match(ui.render(), /教学 Mock/);
  assert.match(ui.render(), /模拟执行/);
  assert.match(ui.render(), /关闭浏览器/);
});

test('report date changes actual KPI values and unsupported diagnosis date is explicit', () => {
  const ui = new RadarUI(storage(), () => {}, () => {});
  ui.open('report');
  assert.match(ui.render(), /6,000/);
  assert.match(ui.render(), /7,000/);
  ui.selectDate('2026-11-15');
  assert.match(ui.render(), /6,500/);
  assert.match(ui.render(), /6,900/);
  assert.doesNotMatch(ui.render(), /6,000/);
  assert.match(ui.render(), /仅支持 11-14/);
});

test('four KPI details and alert evidence are available without fabricating baselines', () => {
  const ui = new RadarUI(storage(), () => {}, () => {});
  ui.open('report');
  for (const label of ['流量', '用户', '交易', '排名']) assert.match(ui.render(), new RegExp(label));
  ui.selectMetric('transaction');
  assert.match(ui.render(), /33,300/);
  assert.match(ui.render(), /暂无可比基线/);
  ui.selectAlert('INC-PAID-GAP');
  assert.match(ui.render(), /SHOP_UV_001/);
  assert.match(ui.render(), /1,300/);
  assert.match(ui.render(), /数据血缘/);
});

test('not-applicable feedback hides the repeat task but preserves its evidence alert', () => {
  const ui = new RadarUI(storage(), () => {}, () => {});
  ui.memory.addRun({ key: 'run-original', date: '2026-11-14', scenario: 'normal', status: 'completed', report: buildRadarReport('2026-11-14'), trace: [], notifications: [] });
  ui.memory.setFeedback('INC-UV-GAP', 'not_applicable', '不适用', '2026-11-15T09:00:00+08:00', 1000);
  ui.open('report');
  const html = ui.render();
  assert.match(html, /店铺 UV 低于参考预期/);
  assert.doesNotMatch(html, /data-task-status="INC-UV-GAP"/);
});

test('timeout and unauthorized demo scenarios never display a full preloaded report', () => {
  const ui = new RadarUI(storage(), () => {}, () => {});
  ui.open('report');
  ui.scenario = 'timeout';
  assert.match(ui.render(), /模拟超时/);
  assert.doesNotMatch(ui.render(), /四维经营指标/);
  ui.scenario = 'unauthorized';
  assert.match(ui.render(), /无权限/);
  assert.doesNotMatch(ui.render(), /四维经营指标/);
});

test('fixed simulated due clock cannot execute a future selected report date', () => {
  const ui = new RadarUI(storage(), () => {}, () => {});
  ui.memory.config = { ...ui.memory.config, saved: true, enabled: true };
  ui.selectDate('2026-11-15');
  ui.startRun('due');
  assert.equal(ui.activeRun, null);
  assert.match(ui.notice, /11-14/);
});

test('editing Skill domains does not show an old four-domain run as the current report', () => {
  const ui = new RadarUI(storage(), () => {}, () => {});
  const oldKey = makeRunKey(ui.memory.config, '2026-11-14');
  ui.memory.addRun({ key: oldKey, date: '2026-11-14', scenario: 'normal', status: 'completed', report: buildRadarReport('2026-11-14'), trace: [], notifications: [] });
  ui.memory.saveConfig(editRadarSkill(ui.memory.config, { domains: ['traffic'] }));
  ui.open('report');
  assert.match(ui.render(), /仅预载数据 · 未执行/);
  assert.match(ui.render(), /完整度 1\/1/);
  assert.doesNotMatch(ui.render(), /用户 · 新访客/);
});
