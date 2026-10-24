import { getRadarDay, radarMetricDictionary, RADAR_DOMAINS } from './radar-data.mjs';

const fmt = value => Number(value).toLocaleString('zh-CN');
const pct = ratio => `${Number((ratio * 100).toFixed(1))}%`;
const nextDate = date => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

function evidence(day, metricId, numerator, denominator, extra = {}) {
  const definition = radarMetricDictionary[metricId];
  return {
    id: `EV-${day.date}-${metricId}${extra.dimension ? `-${extra.dimension}` : ''}`,
    ...definition, timeWindow: `${day.date} 00:00–24:00 Asia/Shanghai`, fetchedAt: day.fetchedAt,
    numerator, denominator, qualityStatus: day.quality[extra.domain || 'traffic'], ...extra
  };
}

function makeAlert(day, kind, priority, title, gap, threshold, evidenceCard, action, certainty = '待排查') {
  const incidentId = kind === 'paid' ? 'INC-PAID-GAP' : kind === 'traffic' ? 'INC-UV-GAP' : 'INC-RANK-DROP';
  return {
    incidentId, alertInstanceId: `${incidentId}-${day.date}`, kind, priority, title, gap,
    delta: kind === 'ranking' ? gap : undefined,
    threshold, certainty, status: '待处理', impact: kind === 'paid' ? '付费渠道，是店铺 UV 额外缺口的一部分' : kind === 'traffic' ? '店铺整体访客' : '单个搜索词的排名线索',
    evidence: evidenceCard, action,
    exclusion: kind === 'ranking' ? '未证明排名变化导致 UV 下降' : '渠道结构贡献不等于成因；需核查广告计划、曝光及其他因素'
  };
}

export function shouldSuppressRecommendation(feedback, alert, reportDate) {
  if (!feedback || feedback.status !== 'not_applicable' || feedback.incidentId !== alert.incidentId) return false;
  if (Date.parse(`${reportDate}T09:00:00+08:00`) >= Date.parse(feedback.expiresAt)) return false;
  return alert.gap <= (feedback.gapAtFeedback || 0) * 1.25;
}

export function buildRadarReport(date, { scenario = 'normal', domains = RADAR_DOMAINS, feedback = [] } = {}) {
  const day = getRadarDay(date, scenario);
  if (!day) return { status: 'unsupported', date, reason: '该日期暂无可用数据，请选择其他日期。' };
  const selected = [...new Set(domains)].filter(domain => RADAR_DOMAINS.includes(domain));
  if (!selected.length) return { status: 'unsupported', date, reason: '至少选择一个巡检维度。' };
  const metrics = {};
  const alerts = [];
  const missing = [];

  if (selected.includes('traffic')) {
    const traffic = day.traffic;
    const conflict = day.quality.traffic === 'conflict';
    const gap = conflict || traffic.expected == null ? null : traffic.expected - traffic.actual;
    const channels = traffic.channels;
    const reconciled = channels && Object.values(channels).every(row => Number.isFinite(row.actual) && Number.isFinite(row.expected))
      && Object.values(channels).reduce((sum, row) => sum + row.actual, 0) === traffic.actual
      && Object.values(channels).reduce((sum, row) => sum + row.expected, 0) === traffic.expected;
    const paid = !conflict && reconciled && gap > 0 ? {
      actual: channels.paid.actual, expected: channels.paid.expected,
      gap: channels.paid.expected - channels.paid.actual,
      gapRatio: (channels.paid.expected - channels.paid.actual) / channels.paid.expected,
      contribution: (channels.paid.expected - channels.paid.actual) / gap
    } : null;
    metrics.traffic = {
      actual: conflict ? null : traffic.actual, expected: traffic.expected, peak: traffic.peak,
      value: conflict ? null : traffic.actual, gap, gapRatio: gap == null || traffic.expected === 0 ? null : gap / traffic.expected,
      paid, channels: reconciled && !conflict ? channels : null,
      quality: conflict ? 'conflict' : 'complete',
      note: conflict ? `口径冲突：SHOP_UV_001@v1.0 为 ${fmt(traffic.actual)}，另一来源 @${traffic.conflictingVersion} 为 ${fmt(traffic.conflictingActual)}；待人工确认。` : channels && !reconciled ? '渠道明细不完整，不能下钻贡献。' : channels ? '主来源四渠道互斥、合计为店铺 UV。' : '渠道明细未覆盖，只有店铺汇总。',
      evidence: evidence(day, 'SHOP_UV_001', conflict ? `${traffic.actual} / ${traffic.conflictingActual}` : traffic.actual, traffic.expected)
    };
    if (conflict) missing.push('流量口径冲突');
    if (!conflict && gap >= 200 && gap / traffic.expected >= .1) alerts.push(makeAlert(day, 'traffic', 2, '店铺 UV 低于参考预期', gap, '相对下降 ≥10% 且绝对缺口 ≥200 人', evidence(day, 'SHOP_UV_001', traffic.actual, traffic.expected), '核查主要来源变化，先分清正常回落与额外缺口。'));
    if (paid && paid.gap >= 200 && paid.gapRatio >= .15) alerts.push(makeAlert(day, 'paid', 1, '付费渠道流量需优先排查', paid.gap, '相对下降 ≥15% 且绝对缺口 ≥200 人', evidence(day, 'SHOP_UV_001', paid.actual, paid.expected, { dimension: 'paid', domain: 'traffic', contribution: paid.contribution }), '先检查广告计划状态、预算受限与曝光；不要直接调预算。'));
  }

  if (selected.includes('audience')) {
    const audience = day.audience;
    metrics.audience = audience ? {
      value: audience.newVisitors, newVisitors: audience.newVisitors, returningVisitors: audience.returningVisitors,
      quality: 'complete', note: '新访客与回访访客互斥；与老客主来源渠道是不同维度。暂无可比基线，不判异常。',
      evidence: evidence(day, 'NEW_VISITORS_001', audience.newVisitors, day.traffic.actual, { domain: 'audience' })
    } : { value: null, quality: day.quality.audience, note: '当日用户分层未覆盖；不可判断结构变化。', evidence: null };
    if (!audience) missing.push('用户');
  }

  if (selected.includes('transaction')) {
    const tx = day.transaction;
    metrics.transaction = tx ? {
      value: tx.gmv, buyers: tx.buyers, orders: tx.orders, aov: tx.aov, conversion: tx.buyers / day.traffic.actual,
      quality: 'complete', note: '教学设定每位买家一单；暂无交易可比基线，不判异常。',
      evidence: evidence(day, 'PAID_GMV_001', tx.gmv, tx.orders, { domain: 'transaction' })
    } : { value: null, quality: 'unavailable', note: '当日交易明细未覆盖；不可判断变化。', evidence: null };
    if (!tx) missing.push('交易');
  }

  if (selected.includes('ranking')) {
    const rank = day.ranking;
    const comparable = rank && rank.previousConditions === rank.currentConditions;
    const delta = comparable ? rank.current - rank.previous : null;
    metrics.ranking = rank ? {
      value: rank.current, previous: comparable ? rank.previous : null, delta, keyword: rank.keyword,
      quality: comparable ? 'complete' : 'incomparable',
      note: comparable ? '采样条件一致；排名下降是线索，不是流量因果证明。' : '前后快照采集条件不可比，不计算排名变化或告警。',
      evidence: evidence(day, 'SEARCH_RANK_001', rank.current, comparable ? rank.previous : '不可比', { domain: 'ranking', previousAt: rank.previousAt, conditions: `${rank.previousConditions} / ${rank.currentConditions}` })
    } : { value: null, quality: 'unavailable', note: '当日关键词排名未覆盖。', evidence: null };
    if (!rank) missing.push('排名');
    else if (!comparable) missing.push('排名采样不可比');
    if (comparable && delta >= 5) alerts.push(makeAlert(day, 'ranking', 3, '关键词排名下降，待核验', delta, '同条件排名下降 ≥5 位', metrics.ranking.evidence, '核验搜索曝光、点击与商品可售状态。', '待核验'));
  }

  alerts.sort((a, b) => a.priority - b.priority);
  const tasks = alerts.filter(alert => !feedback.some(item => shouldSuppressRecommendation(item, alert, date))).map(alert => ({
    taskId: `TASK-${alert.alertInstanceId}`, incidentId: alert.incidentId, alertInstanceId: alert.alertInstanceId,
    title: alert.action, status: 'pending', gap: alert.gap
  }));
  const traffic = metrics.traffic;
  let summary = `本日报告已覆盖 ${selected.length - missing.length}/${selected.length} 个维度；缺失项不推断。`;
  if (traffic?.quality === 'conflict') summary = '店铺 UV 口径冲突，流量缺口和渠道贡献待人工确认；其他已覆盖维度仅作观察。';
  else if (traffic?.gap != null && traffic.gap > 0) summary = `${date.slice(5)} 店铺 UV 比参考预期少 ${fmt(traffic.gap)}（-${pct(traffic.gapRatio)}）${traffic.paid ? `，付费渠道缺口 ${fmt(traffic.paid.gap)}、占总缺口 ${pct(traffic.paid.contribution)}` : ''}；正常回落和额外缺口要区分，尚不能断言因果。`;
  else if (traffic?.gap != null) summary = `${date.slice(5)} 店铺 UV ${fmt(traffic.actual)}，参考预期 ${fmt(traffic.expected)}；未达到流量异常阈值。`;
  const previousGap = date === '2026-11-15' ? 1000 : date === '2026-11-16' ? 400 : null;
  const followup = previousGap == null ? null : {
    incidentId: 'INC-UV-GAP', previousDate: date === '2026-11-15' ? '2026-11-14' : '2026-11-15',
    previousGap, currentGap: day.traffic.expected - day.traffic.actual,
    disclaimer: '观察到差距收窄不等于证明处理动作造成恢复；仍需独立验证。'
  };
  return {
    shopId: day.shopId, shopName: day.shopName, date, simulatedRunAt: `${nextDate(date)} 09:00 Asia/Shanghai`, mock: true,
    status: missing.length ? 'partial' : 'complete', completeness: `${selected.length - missing.length}/${selected.length}`,
    selectedDomains: selected, missing, metrics, alerts, tasks, followup, summary
  };
}
