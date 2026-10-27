import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRadarReport } from '../src/radar-rules.mjs';
const {createReportHtml,getReportMetricSeries,selectReportFeedback}=await import('../src/report-export.mjs').catch(()=>({}));

test('standalone report embeds three dated snapshots, interactivity and no external dependencies',()=>{
  assert.equal(typeof createReportHtml,'function');
  const html=createReportHtml(['2026-11-14','2026-11-15','2026-11-16'].map(date=>buildRadarReport(date)));
  assert.match(html,/2026-11-16/);
  assert.match(html,/localStorage/);
  assert.match(html,/data-feedback/);
  assert.match(html,/查看指标口径与数据来源/);
  assert.doesNotMatch(html,/<script[^>]+src=|<link[^>]+href=/);
});

test('embedded merchant feedback cannot close the data script or inject executable HTML',()=>{
  assert.equal(typeof createReportHtml,'function');
  const html=createReportHtml([buildRadarReport('2026-11-14')],[{note:'</script><script>alert(1)</script>'}]);
  assert.doesNotMatch(html,/<script>alert\(1\)<\/script>/);
  assert.match(html,/\\u003c\/script>/);
});

test('unknown metric values are omitted from trend data instead of becoming zero',()=>{
  const reports=['2026-11-14','2026-11-15','2026-11-16'].map(date=>buildRadarReport(date,{scenario:'missing-data'}));
  assert.deepEqual(getReportMetricSeries(reports,'audience'),[]);
  reports[1].metrics.audience.value=0;
  assert.deepEqual(getReportMetricSeries(reports,'audience').map(point=>point.value),[0]);
});

test('export opens the requested report date and selects feedback by effective date',()=>{
  const reports=['2026-11-14','2026-11-15','2026-11-16'].map(date=>buildRadarReport(date));
  const html=createReportHtml(reports,[],{selectedDate:'2026-11-16'});
  const payload=JSON.parse(html.match(/<script type="application\/json" id="report-data">(.*?)<\/script>/s)[1]);
  assert.equal(payload.selectedDate,'2026-11-16');
  const feedback=[
    {incidentId:'INC-PAID-GAP',status:'done',sourceDate:'2026-11-16',revision:1},
    {incidentId:'INC-PAID-GAP',status:'deferred',sourceDate:'2026-11-14',revision:2}
  ];
  assert.equal(selectReportFeedback(feedback,'2026-11-14')[0].status,'deferred');
  assert.equal(selectReportFeedback(feedback,'2026-11-16')[0].status,'done');
});

test('a selected date only charts that day and the preceding two days',()=>{
  const reports=['2026-11-12','2026-11-13','2026-11-14','2026-11-15','2026-11-16'].map(date=>buildRadarReport(date));
  assert.deepEqual(getReportMetricSeries(reports,'traffic','2026-11-14').map(point=>point.date),['2026-11-12','2026-11-13','2026-11-14']);
  const html=createReportHtml(reports,[],{selectedDate:'2026-11-14'});
  const payload=JSON.parse(html.match(/<script type="application\/json" id="report-data">(.*?)<\/script>/s)[1]);
  assert.deepEqual(payload.reports.map(report=>report.date),['2026-11-12','2026-11-13','2026-11-14']);
  assert.match(html,/date-calendar/);
});
