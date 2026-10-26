import test from 'node:test';
import assert from 'node:assert/strict';
import { getRadarDay } from '../src/radar-data.mjs';
import { buildRadarReport } from '../src/radar-rules.mjs';
const tools = await import('../src/radar-tools.mjs').catch(()=>({}));

test('four narrow readers return only their own domain and reject expanded input',()=>{
  assert.equal(typeof tools.queryTraffic,'function');
  const traffic=tools.queryTraffic({date:'2026-11-14'});
  assert.equal(traffic.data.actual,6000);
  assert.equal(traffic.domain,'traffic');
  assert.equal('transaction' in traffic.data,false);
  assert.equal(tools.queryTraffic({date:'2026-11-14',prompt:'分析全部'}).status,'invalid');
  assert.equal(tools.queryTraffic({date:'2026-11-14'},{shopId:'other'}).status,'denied');
  assert.equal(tools.queryCustomers({date:'2026-11-14'}).data.newVisitors,4200);
  assert.equal(tools.queryTransactions({date:'2026-11-14'}).data.gmv,33300);
  assert.equal(tools.queryRanking({date:'2026-11-14'}).data.current,12);
});

test('missing, unsupported and incomparable tool outputs preserve their specific status',()=>{
  assert.equal(typeof tools.queryCustomers,'function');
  assert.equal(tools.queryCustomers({date:'2026-11-14'},{scenario:'missing-data'}).status,'missing');
  assert.equal(tools.queryRanking({date:'2026-11-14'},{scenario:'rank-incomparable'}).quality,'incomparable');
  assert.equal(tools.queryTraffic({date:'2026-11-18'}).status,'unavailable');
});

test('three daily reports contain independent complete four-domain data and consistent amounts',()=>{
  for(const date of ['2026-11-14','2026-11-15','2026-11-16']){
    const day=getRadarDay(date),report=buildRadarReport(date);
    assert.equal(report.completeness,'4/4');
    assert.equal(day.audience.newVisitors+day.audience.returningVisitors,day.traffic.actual);
    assert.equal(day.transaction.orders*day.transaction.aov,day.transaction.gmv);
    assert.equal(Object.values(day.traffic.channels).reduce((n,row)=>n+row.actual,0),day.traffic.actual);
  }
});

test('report orchestration calls only selected domain readers',()=>{
  const calls=[];
  const reader={traffic:()=>{calls.push('traffic');return tools.queryTraffic({date:'2026-11-14'});}};
  const report=buildRadarReport('2026-11-14',{domains:['traffic'],readers:reader});
  assert.deepEqual(calls,['traffic']);
  assert.deepEqual(Object.keys(report.metrics),['traffic']);
});

test('missing traffic preserves other domains and withholds dependent conversion',()=>{
  const report=buildRadarReport('2026-11-14',{scenario:'missing-traffic'});
  assert.equal(report.status,'partial');
  assert.equal(report.completeness,'3/4');
  assert.equal(report.metrics.traffic.value,null);
  assert.equal(report.metrics.transaction.conversion,null);
  assert.equal(report.metrics.transaction.value,33300);
  assert.equal(report.alerts.some(row=>['traffic','paid'].includes(row.kind)),false);
});
