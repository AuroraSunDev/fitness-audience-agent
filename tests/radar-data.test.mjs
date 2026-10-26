import test from 'node:test';
import assert from 'node:assert/strict';

const { getRadarDay, radarMetricDictionary } = await import('../src/radar-data.mjs').catch(() => ({}));

test('11-14 keeps the assignment-two store UV and mutually exclusive source totals', () => {
  assert.equal(typeof getRadarDay, 'function');
  const day = getRadarDay('2026-11-14');
  assert.deepEqual([day.traffic.actual, day.traffic.expected, day.traffic.peak], [6000, 7000, 10000]);
  assert.equal(Object.values(day.traffic.channels).reduce((sum, row) => sum + row.actual, 0), 6000);
  assert.equal(Object.values(day.traffic.channels).reduce((sum, row) => sum + row.expected, 0), 7000);
  assert.deepEqual([day.traffic.channels.paid.actual, day.traffic.channels.paid.expected], [800, 1300]);
});

test('11-15 source breakdown conserves the dated store total', () => {
  const day = getRadarDay('2026-11-15');
  assert.deepEqual([day.traffic.actual, day.traffic.expected], [6500, 6900]);
  assert.equal(Object.values(day.traffic.channels).reduce((sum, row) => sum + row.actual, 0), 6500);
  assert.equal(Object.values(day.traffic.channels).reduce((sum, row) => sum + row.expected, 0), 6900);
});

test('audience and transaction dimensions do not conflate returning visitors with source attribution', () => {
  const day = getRadarDay('2026-11-14');
  assert.equal(day.audience.newVisitors + day.audience.returningVisitors, 6000);
  assert.equal(day.traffic.channels.returning_source.actual, 1100);
  assert.equal(day.transaction.buyers / day.traffic.actual, .03);
  assert.equal(day.transaction.orders * day.transaction.aov, day.transaction.gmv);
});

test('uncovered detail and dates stay absent, while metric provenance is explicit', () => {
  assert.equal(getRadarDay('2026-11-17').traffic.channels, null);
  assert.equal(getRadarDay('2026-11-17').audience, null);
  assert.equal(getRadarDay('2026-11-18'), null);
  for (const field of ['metricId', 'version', 'unit', 'definition', 'timeWindow', 'source', 'lineage', 'fetchedAt', 'qualityStatus']) assert.ok(radarMetricDictionary.SHOP_UV_001[field]);
  assert.equal(radarMetricDictionary.SHOP_UV_001.version, 'v1.0');
});
