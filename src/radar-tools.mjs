import { getRadarDay, radarMetricDictionary, RADAR_SHOP_ID } from './radar-data.mjs';

// Shared validation is private; callers receive one domain, never a free-form analysis API.
function read(domain, input, context = {}) {
  if (context.shopId && context.shopId !== RADAR_SHOP_ID) return { status: 'denied', reason: '当前账号没有该店铺的数据权限。' };
  if (!input || Object.keys(input).some(key => key !== 'date') || !/^\d{4}-\d{2}-\d{2}$/.test(input.date || '')) return { status: 'invalid', reason: '请提供有效的数据日期。' };
  const day = getRadarDay(input.date, context.scenario);
  if (!day) return { status: 'unavailable', date: input.date, reason: '该日期暂无可用数据。' };
  const data = day[domain] ? structuredClone(day[domain]) : null;
  if (domain === 'transaction' && data) { data.visitors = day.traffic?.actual ?? null; data.visitorsQuality = day.quality.traffic; }
  if (domain === 'audience' && data) data.totalVisitors = day.traffic?.actual ?? null;
  const quality = domain === 'ranking' && data && data.previousConditions !== data.currentConditions ? 'incomparable' : day.quality[domain];
  return { status: data ? 'success' : 'missing', domain, date: day.date, shopId: day.shopId, shopName: day.shopName, fetchedAt: day.fetchedAt, quality, data };
}

export const queryTraffic = (input, context) => read('traffic', input, context);
export const queryCustomers = (input, context) => read('audience', input, context);
export const queryTransactions = (input, context) => read('transaction', input, context);
export const queryRanking = (input, context) => read('ranking', input, context);

export function getEvidence({ date, metricId }, context = {}) {
  if (context.shopId && context.shopId !== RADAR_SHOP_ID) return { status: 'denied' };
  const definition = radarMetricDictionary[metricId], day = getRadarDay(date, context.scenario);
  if (!definition || !day) return { status: 'unavailable' };
  return { status: 'success', evidence: { ...definition, timeWindow: `${date} 00:00–24:00 Asia/Shanghai`, fetchedAt: day.fetchedAt } };
}

export function recordActionFeedback(memory, { incidentId, status, note = '', gap = 0 }, context) {
  if (context.shopId !== RADAR_SHOP_ID) return { status: 'denied' };
  const feedback = memory.setFeedback(incidentId, status, note, context.at, gap, context.reportDate);
  return { status: 'success', feedback };
}
