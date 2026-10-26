import { getFixture } from './data.mjs';

export const RADAR_SHOP_ID = 'demo-fitness-001';
export const RADAR_SHOP_NAME = '动燃健身旗舰店';
export const RADAR_DOMAINS = ['traffic', 'audience', 'transaction', 'ranking'];

const metric = (metricId, unit, definition, numerator, denominator, source, lineage) => ({
  metricId, version: 'v1.0', unit, definition, numerator, denominator,
  timeWindow: '报告日期 00:00–24:00 Asia/Shanghai', source, lineage,
  fetchedAt: '以当日报告的模拟取数时间为准', qualityStatus: '教学 Mock；按当日覆盖情况判断'
});

export const radarMetricDictionary = Object.freeze({
  SHOP_UV_001: metric('SHOP_UV_001', '人', '北京时间自然日店铺去重访客；四个互斥主来源渠道合计为店铺 UV。', '当日去重访客数', '不适用', 'mock_store_traffic_daily', '主来源归因明细 → 店铺日去重 UV'),
  NEW_VISITORS_001: metric('NEW_VISITORS_001', '人', '当日首次访问店铺的去重访客。', '当日首次访问访客数', '不适用', 'mock_store_audience_daily', '访客历史访问状态 → 新访客'),
  RETURNING_VISITORS_001: metric('RETURNING_VISITORS_001', '人', '当日曾访问过店铺的去重访客；不是老客来源渠道。', '当日回访访客数', '不适用', 'mock_store_audience_daily', '访客历史访问状态 → 回访访客'),
  PAID_BUYERS_001: metric('PAID_BUYERS_001', '人', '当日完成支付的去重买家。', '去重支付买家数', '不适用', 'mock_store_transaction_daily', '支付订单 → 去重买家'),
  PAID_ORDERS_001: metric('PAID_ORDERS_001', '单', '当日完成支付的订单数。', '已支付订单数', '不适用', 'mock_store_transaction_daily', '支付明细 → 订单数'),
  PAID_GMV_001: metric('PAID_GMV_001', '元', '当日已支付订单成交金额；未扣退款。', '已支付订单金额之和', '不适用', 'mock_store_transaction_daily', '支付订单金额 → GMV'),
  BUYER_CVR_001: metric('BUYER_CVR_001', '%', '当日支付买家占店铺去重访客比例。', '支付买家数', '店铺 UV', 'mock_store_transaction_daily + mock_store_traffic_daily', '支付买家 ÷ 店铺 UV'),
  SEARCH_RANK_001: metric('SEARCH_RANK_001', '名', '固定搜索词在相同设备、地域、采样时点下的搜索排名；越小越靠前。', '当前名次', '前一可比快照名次', 'mock_search_rank_snapshot', '关键词采样条件 → 可比排名快照')
});

const base14 = getFixture('normal');
const channel14 = Object.fromEntries(base14.channels.map(row => [row.id === 'returning' ? 'returning_source' : row.id, { actual: row.actual, expected: row.expected }]));
const days = {
  '2026-11-11': { actual: 10000, expected: null },
  '2026-11-12': { actual: 7600, expected: 7800 },
  '2026-11-13': { actual: 6800, expected: 7200 },
  '2026-11-14': {
    actual: base14.actual, expected: base14.expected, channels: channel14,
    audience: { newVisitors: 4200, returningVisitors: 1800 },
    transaction: { buyers: 180, orders: 180, gmv: 33300, aov: 185, oneOrderPerBuyer: true },
    ranking: {
      keyword: '普拉提弹力带', previous: 6, current: 12,
      previousAt: '2026-11-13 10:00 Asia/Shanghai', currentAt: '2026-11-14 10:00 Asia/Shanghai',
      previousConditions: '移动端·北京·自然搜索·10:00', currentConditions: '移动端·北京·自然搜索·10:00'
    }
  },
  '2026-11-15': { actual: 6500, expected: 6900,
    audience: { newVisitors: 4480, returningVisitors: 2020 },
    transaction: { buyers: 208, orders: 208, gmv: 39520, aov: 190 },
    ranking: { keyword: '普拉提弹力带', previous: 12, current: 10, previousAt: '2026-11-14 10:00 Asia/Shanghai', currentAt: '2026-11-15 10:00 Asia/Shanghai', previousConditions: '移动端·北京·自然搜索·10:00', currentConditions: '移动端·北京·自然搜索·10:00' },
    channels: {
    paid: { actual: 1100, expected: 1250 }, campaign: { actual: 2050, expected: 2100 },
    organic: { actual: 2200, expected: 2300 }, returning_source: { actual: 1150, expected: 1250 }
  } },
  '2026-11-16': { actual: 6800, expected: 6900,
    audience: { newVisitors: 4620, returningVisitors: 2180 },
    transaction: { buyers: 231, orders: 231, gmv: 45045, aov: 195 },
    ranking: { keyword: '普拉提弹力带', previous: 10, current: 8, previousAt: '2026-11-15 10:00 Asia/Shanghai', currentAt: '2026-11-16 10:00 Asia/Shanghai', previousConditions: '移动端·北京·自然搜索·10:00', currentConditions: '移动端·北京·自然搜索·10:00' },
    channels: { paid: { actual: 1220, expected: 1250 }, campaign: { actual: 2090, expected: 2100 }, organic: { actual: 2260, expected: 2300 }, returning_source: { actual: 1230, expected: 1250 } }
  },
  '2026-11-17': { actual: 7000, expected: 6900 }
};

export function getRadarDay(date, scenario = 'normal') {
  const row = days[date];
  if (!row) return null;
  const day = {
    shopId: RADAR_SHOP_ID, shopName: RADAR_SHOP_NAME, date,
    timezone: 'Asia/Shanghai', fetchedAt: `${date} 10:32:00 Asia/Shanghai`, mock: true,
    traffic: { actual: row.actual, expected: row.expected, peak: 10000, channels: row.channels ? structuredClone(row.channels) : null },
    audience: row.audience ? { ...row.audience } : null,
    transaction: row.transaction ? { ...row.transaction } : null,
    ranking: row.ranking ? { ...row.ranking } : null,
    quality: { traffic: 'complete', audience: row.audience ? 'complete' : 'unavailable', transaction: row.transaction ? 'complete' : 'unavailable', ranking: row.ranking ? 'complete' : 'unavailable' }
  };
  if (scenario === 'missing-data') { day.audience = null; day.quality.audience = 'missing'; }
  if (scenario === 'missing-traffic') { day.traffic = null; day.quality.traffic = 'missing'; }
  if (scenario === 'metric-conflict') { day.quality.traffic = 'conflict'; day.traffic.conflictingActual = 6180; day.traffic.conflictingVersion = 'v0.9'; }
  if (scenario === 'rank-incomparable' && day.ranking) day.ranking.currentConditions = '桌面端·上海·自然搜索·10:00';
  return day;
}
