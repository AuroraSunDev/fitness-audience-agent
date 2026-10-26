import { DiagnosticTask } from './engine.mjs';
import { defaultPlan, getFixture } from './data.mjs';

const KEY = 'merchant-diagnosis-history-v1';

export class DiagnosisHistory {
  constructor(storage) {
    this.storage = storage;
    try { this.records = JSON.parse(storage.getItem(KEY) || '[]').filter(item => item.plan?.shop === defaultPlan.shop); }
    catch { this.records = []; }
  }

  persist() { this.storage.setItem(KEY, JSON.stringify(this.records)); }

  recordTask(task) {
    if (task.plan.shop !== defaultPlan.shop) throw new Error('无法保存其他店铺的分析。');
    const existing = this.records.find(item => item.id === task.id);
    const record = {
      ...existing, id: task.id, question: task.question, origin: structuredClone(task.origin || null), plan: { ...task.plan }, scenario: task.fixture.scenario,
      status: task.status, stepIndex: task.stepIndex, partialFinding: task.partialFinding,
      result: structuredClone(task.result), evidence: structuredClone(task.evidence),
      trace: structuredClone(task.trace), failure: structuredClone(task.failure),
      createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    if (existing) this.records.splice(this.records.indexOf(existing), 1);
    this.records.unshift(record); this.persist();
    return record;
  }

  requestReview(task) {
    const record = this.recordTask(task);
    if (!record.handoff) record.handoff = task.makeHandoff();
    this.persist();
    return record.handoff;
  }

  saveWatch(task, { frequency, hour }) {
    if (task.status !== 'completed' || task.result?.status !== 'success') throw new Error('请先完成诊断，再保存分析。');
    const record = this.recordTask(task);
    const next = new Date(`${task.plan.date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    if (frequency === 'weekly') while (next.getUTCDay() !== 6) next.setUTCDate(next.getUTCDate() + 1);
    record.watch = {
      name: '大促后流量巡检', metricId: task.plan.metricId, metricVersion: task.fixture.metricVersion,
      baseline: task.plan.baseline, dimension: task.plan.dimension, sourceDate: task.plan.date,
      evidenceIds: task.evidence.map(item => item.id), frequency, hour,
      threshold: { relativeGap: .1, absoluteGap: 200 }, subscriptionId: 'post-campaign-traffic-watch',
      enabled: true, nextRunAt: `${next.toISOString().slice(0,10)} ${String(hour).padStart(2,'0')}:00`
    };
    this.persist(); return record.watch;
  }

  get latestSaved() { return this.records.find(item => item.watch) || null; }

  pauseWatch(id) {
    const record = this.records.find(item => item.id === id && item.watch);
    if (!record) return false;
    record.watch.enabled = false; record.updatedAt = new Date().toISOString(); this.persist(); return true;
  }

  restoreLatest() {
    const record = this.latestSaved;
    if (!record) return null;
    const task = new DiagnosticTask(getFixture(record.scenario), record.plan, record.question);
    for (const field of ['id','status','stepIndex','partialFinding','result','evidence','trace','failure','origin']) task[field] = structuredClone(record[field]);
    return task;
  }

  metrics() {
    const completed = this.records.filter(item => item.status === 'completed');
    const traceable = completed.filter(item => item.evidence?.length && item.evidence.every(card => ['metricId','version','window','source','lineage','fetchedAt'].every(field => card[field]))).length;
    const humanInterventions = this.records.filter(item => item.handoff?.id).length;
    return {
      started: this.records.length, completed: completed.length, traceable, humanInterventions,
      interventionRate: this.records.length ? humanInterventions / this.records.length : null,
      traceabilityRate: completed.length ? traceable / completed.length : null
    };
  }
}
