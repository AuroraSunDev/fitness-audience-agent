import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTraffic, buildEvidence, defaultPlan, getFixture, getSuggestedQuestions } from '../src/data.mjs';

test('normal fixture reconciles totals and decomposes the 4,000 UV drop', () => {
  const fixture = getFixture('normal');
  assert.equal(fixture.channels.reduce((sum, channel) => sum + channel.peak, 0), 10000);
  assert.equal(fixture.channels.reduce((sum, channel) => sum + channel.actual, 0), 6000);
  assert.equal(fixture.channels.reduce((sum, channel) => sum + channel.expected, 0), 7000);
  const result = analyzeTraffic(fixture, defaultPlan);
  assert.equal(result.status, 'success');
  assert.deepEqual([result.totalDrop, result.dropPct, result.expectedDrop, result.extraGap], [4000, 40, 3000, 1000]);
  assert.deepEqual([result.normalShare, result.extraShare], [75, 25]);
  assert.deepEqual(result.channels.map(({ id, gap, contribution }) => [id, gap, contribution]), [
    ['paid', 500, 50], ['organic', 250, 25], ['returning', 200, 20], ['campaign', 50, 5]
  ]);
});

test('missing paid source keeps known total but withholds channel attribution', () => {
  const result = analyzeTraffic(getFixture('missing-data'), defaultPlan);
  assert.equal(result.status, 'low_evidence');
  assert.equal(result.extraGap, 1000);
  assert.equal(result.channels, undefined);
  assert.match(result.uncertain, /付费广告/);
});

test('conflicting UV definitions never silently select a complete conclusion', () => {
  const result = analyzeTraffic(getFixture('metric-conflict'), defaultPlan);
  assert.equal(result.status, 'metric_conflict');
  assert.equal(result.channels, undefined);
  assert.deepEqual(result.conflictingValues, [6000, 6180]);
});

test('unsupported date is explicit and product-detail UV does not reuse store UV values', () => {
  const unsupported = analyzeTraffic(getFixture('normal'), { ...defaultPlan, date: '2026-11-13' });
  assert.equal(unsupported.status, 'unsupported');
  const otherMetric = analyzeTraffic(getFixture('normal'), { ...defaultPlan, metricId: 'PRODUCT_DETAIL_UV_002' });
  assert.equal(otherMetric.status, 'low_evidence');
  assert.equal(otherMetric.actual, undefined);
  assert.equal(otherMetric.extraGap, undefined);
});

test('evidence preserves six provenance fields and distinguishes the two scopes', () => {
  const cards = buildEvidence(getFixture('normal'), defaultPlan);
  assert.equal(cards[0].metricId, 'SHOP_UV_001');
  for (const field of ['version', 'window', 'source', 'lineage', 'fetchedAt']) assert.ok(cards[0][field]);
  assert.equal(cards[1].metricId, 'PRODUCT_DETAIL_UV_002');
  assert.notEqual(cards[0].definition, cards[1].definition);
});

test('entry suggestions are tied to the current store data', () => {
  const questions = getSuggestedQuestions(getFixture('normal'));
  assert.equal(questions.length, 3);
  assert.ok(questions.some(question => question.includes('付费广告')));
  assert.ok(questions.some(question => question.includes('超出预期')));
});

test('conflicting source does not advertise an unverified exact gap on entry', () => {
  const questions = getSuggestedQuestions(getFixture('metric-conflict'));
  assert.ok(questions.some(question => question.includes('超出预期')));
  assert.ok(questions.every(question => !question.includes('1,000')));
});
