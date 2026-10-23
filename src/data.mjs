export const defaultPlan = Object.freeze({
  shop: '动燃健身旗舰店', metricId: 'SHOP_UV_001', date: '2026-11-14',
  peakDate: '2026-11-11', baseline: 'similar_campaign', dimension: 'primary_source', readOnly: true
});

export const metricDefinitions = Object.freeze({
  SHOP_UV_001: {
    name: '店铺去重访客 UV', version: 'v1.0',
    definition: '北京时间自然日内访问店铺的去重访客；按互斥主来源渠道归属，同一访客仅计入一个渠道。',
    source: 'mock_store_traffic_daily',
    lineage: '渠道明细 → 主来源归因 → 店铺日去重 UV'
  },
  PRODUCT_DETAIL_UV_002: {
    name: '商品详情页去重访客 UV', version: 'v1.0',
    definition: '北京时间自然日内访问商品详情页的去重访客；统计范围是详情页，不等于店铺访客。',
    source: 'mock_product_detail_definition',
    lineage: '商品详情页访问 → 页面级去重 UV；演示数据未提供完整渠道下钻'
  }
});

const channelRows = [
  { id: 'paid', name: '付费广告', peak: 3000, actual: 800, expected: 1300 },
  { id: 'campaign', name: '活动流量', peak: 3000, actual: 2050, expected: 2100 },
  { id: 'organic', name: '自然流量', peak: 2500, actual: 2050, expected: 2300 },
  { id: 'returning', name: '老客回访', peak: 1500, actual: 1100, expected: 1300 }
];

const base = {
  shop: defaultPlan.shop,
  peak: 10000, actual: 6000, expected: 7000,
  channels: channelRows,
  channelCoverageComplete: true,
  fetchedAt: '2026-11-14 10:32:00 Asia/Shanghai',
  baselineNote: '历史相似活动后的示例预期基线，并非真实预测',
  metricVersion: 'v1.0'
};

const fixtures = {
  normal: { ...base, scenario: 'normal' },
  'missing-data': {
    ...base, scenario: 'missing-data', channelCoverageComplete: false,
    channels: channelRows.map(row => row.id === 'paid' ? { ...row, actual: null } : row)
  },
  'metric-conflict': { ...base, scenario: 'metric-conflict', conflictingActual: 6180, conflictingVersion: 'v0.9' },
  timeout: { ...base, scenario: 'timeout' }
};

export function getFixture(name = 'normal') {
  return fixtures[name] ?? fixtures.normal;
}

export function getSuggestedQuestions(fixture) {
  const expectedGap = fixture.expected - fixture.actual;
  const gapQuestion = fixture.scenario === 'metric-conflict'
    ? '哪些渠道造成了大促后超出预期的流量下降？先核对 UV 口径。'
    : `哪些渠道造成了大促后超出预期的 ${expectedGap.toLocaleString('zh-CN')} 名访客缺口？`;
  return [
    '大促后流量掉了，是正常回落还是有问题？',
    '付费广告流量低于参考预期，需要重点检查什么？',
    gapQuestion
  ];
}

export function validatePlan(plan) {
  if (plan.shop !== defaultPlan.shop) return '当前演示只支持动燃健身旗舰店。';
  if (plan.date !== defaultPlan.date || plan.peakDate !== defaultPlan.peakDate) return '当前演示数据仅覆盖 2026-11-14 与 11.11 峰值对比。';
  if (plan.baseline !== 'similar_campaign') return '当前演示仅提供历史相似活动参考基线。';
  if (!['primary_source', 'paid_only'].includes(plan.dimension)) return '当前演示仅支持主来源渠道或仅看付费广告。';
  if (!metricDefinitions[plan.metricId]) return '当前演示不支持这个指标。';
  if (plan.readOnly !== true) return '诊断查询只能以只读方式执行。';
  return null;
}

export function analyzeTraffic(fixture, plan) {
  const unsupported = validatePlan(plan);
  if (unsupported) return { status: 'unsupported', reason: unsupported };
  if (plan.metricId !== 'SHOP_UV_001') return {
    status: 'low_evidence', reason: '当前演示只有商品详情页 UV 的口径定义，没有可比的日值与渠道下钻。',
    known: '商品详情页 UV 与店铺 UV 统计范围不同，不能直接沿用店铺的 6,000 人。',
    uncertain: '该口径的实际值、历史预期及渠道贡献均未提供。'
  };
  if (fixture.scenario === 'metric-conflict') return {
    status: 'metric_conflict', reason: '两个来源的店铺 UV 口径版本不同，不能直接合并。',
    known: '主来源 v1.0 显示 6,000，另一来源 v0.9 显示 6,180。',
    uncertain: '11.14 店铺去重访客的权威口径及渠道缺口尚待数据负责人确认。',
    conflictingValues: [fixture.actual, fixture.conflictingActual]
  };
  const totalDrop = fixture.peak - fixture.actual;
  const expectedDrop = fixture.peak - fixture.expected;
  const extraGap = fixture.expected - fixture.actual;
  const common = {
    peak: fixture.peak, actual: fixture.actual, expected: fixture.expected,
    totalDrop, expectedDrop, extraGap,
    dropPct: Math.round(totalDrop / fixture.peak * 100),
    normalShare: Math.round(expectedDrop / totalDrop * 100),
    extraShare: Math.round(extraGap / totalDrop * 100)
  };
  if (!fixture.channelCoverageComplete || fixture.channels.some(row => row.actual === null)) return {
    ...common, status: 'low_evidence',
    reason: '付费广告主来源数据缺失，渠道分类尚未完成，不能推算其缺口贡献。',
    known: `店铺汇总 UV 为 ${fixture.actual.toLocaleString('zh-CN')}，相对参考预期少 ${extraGap.toLocaleString('zh-CN')}。`,
    uncertain: '付费广告的准确 UV 与各渠道贡献比例不确定；已知渠道不能作为完整拆解。'
  };
  const channels = fixture.channels.map(row => ({
    ...row, gap: row.expected - row.actual,
    contribution: Math.round((row.expected - row.actual) / extraGap * 100)
  })).sort((a, b) => b.gap - a.gap);
  const visibleChannels = plan.dimension === 'paid_only' ? channels.filter(row => row.id === 'paid') : channels;
  return {
    ...common, status: 'success', channels: visibleChannels,
    scopeNote: plan.dimension === 'paid_only' ? '当前仅展示付费广告渠道；其他渠道未下钻。' : '四个互斥主来源渠道之和等于店铺 UV。',
    actions: [
      { id: 'paid', title: '核查付费广告计划、预算与曝光', impact: '高', cost: '低', reason: `贡献 ${channels[0].contribution}% 的额外缺口，优先排查；尚不能确定成因。` },
      { id: 'organic', title: '检查自然搜索主要 SKU 的曝光和商品状态', impact: '中', cost: '中', reason: '自然渠道额外缺口 250 人，先核实曝光与商品可售状态。' },
      { id: 'returning', title: '为老客回访设计小规模召回测试', impact: '中', cost: '中', reason: '老客回访额外缺口 200 人，测试后再评估增量。' }
    ].filter(action => plan.dimension !== 'paid_only' || action.id === 'paid')
  };
}

export function buildEvidence(fixture, plan) {
  return ['SHOP_UV_001', 'PRODUCT_DETAIL_UV_002'].map((metricId, index) => {
    const metric = metricDefinitions[metricId];
    return {
      id: `E-${index + 1}`, metricId, name: metric.name,
      version: metric.version, definition: metric.definition,
      window: `${plan.date} 00:00–24:00 Asia/Shanghai`,
      source: metric.source, lineage: metric.lineage,
      fetchedAt: metricId === 'SHOP_UV_001' ? fixture.fetchedAt : '未取数（仅口径定义）',
      sample: metricId === 'SHOP_UV_001' && fixture.scenario === 'normal' ? `${fixture.actual.toLocaleString('zh-CN')} 名店铺去重访客` : '无可用样本'
    };
  });
}
