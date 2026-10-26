import { defaultRadarSkill, validateRadarSkill } from './radar-runtime.mjs';
import { RADAR_SHOP_ID } from './radar-data.mjs';
import { buildRadarReport } from './radar-rules.mjs';

export const RADAR_SKILL_KEY = 'merchant-daily-radar-skill-v1';
export const RADAR_MEMORY_KEY = 'merchant-daily-radar-memory-v1';
const LEGACY_KEY = 'merchant-diagnosis-skill-v1';
const MOCK_NOW = '2026-11-15T09:00:00+08:00';
const allowedProposals = new Set(['wording', 'sort', 'faq']);

function read(storage, key) {
  try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; }
}

function record(value, at = MOCK_NOW, source = 'teaching_mock') {
  return { ...value, shopId: RADAR_SHOP_ID, createdAt: at, updatedAt: at, source, version: value.version || '1.0.0' };
}

export class RadarMemory {
  constructor(storage) {
    this.storage = storage;
    const stored = read(storage, RADAR_SKILL_KEY);
    const legacy = read(storage, LEGACY_KEY);
    this.migrationNotice = !stored && legacy ? '检测到旧版 S8 本机巡检；监控范围已扩展，旧模拟订阅未自动开启，请重新确认并保存。旧数据仍保留。' : '';
    this.config = { ...defaultRadarSkill, ...(stored?.value || {}), domains: [...(stored?.value?.domains || defaultRadarSkill.domains)] };
    try { validateRadarSkill(this.config); } catch { this.config = { ...defaultRadarSkill, domains: [...defaultRadarSkill.domains] }; }
    const memory = read(storage, RADAR_MEMORY_KEY) || {};
    this.runs = (memory.runs || []).filter(item => item.shopId === RADAR_SHOP_ID);
    this.feedback = (memory.feedback || []).filter(item => item.shopId === RADAR_SHOP_ID);
    this.feedbackHistory = (memory.feedbackHistory || this.feedback).filter(item => item.shopId === RADAR_SHOP_ID);
    this.deliveries = (memory.deliveries || []).filter(item => item.shopId === RADAR_SHOP_ID);
    this.focused = (memory.focused || []).filter(item => item.shopId === RADAR_SHOP_ID);
    this.incidents = (memory.incidents || []).filter(item => item.shopId === RADAR_SHOP_ID);
    this.audit = (memory.audit || []).filter(item => item.shopId === RADAR_SHOP_ID);
    this.governance = memory.governance?.shopId === RADAR_SHOP_ID ? memory.governance : record({ version: '1.0.0', proposals: [], published: [], previousVersion: null });
    this.governance.policy ||= { order: 'priority', wording: 'standard' };
    if (this.migrationNotice) this.config = { ...defaultRadarSkill, domains: [...defaultRadarSkill.domains], enabled: false, saved: false };
  }

  persist() {
    this.storage.setItem(RADAR_SKILL_KEY, JSON.stringify(record({ value: this.config })));
    this.storage.setItem(RADAR_MEMORY_KEY, JSON.stringify({ runs: this.runs, feedback: this.feedback, feedbackHistory: this.feedbackHistory, deliveries: this.deliveries, focused: this.focused, incidents: this.incidents, audit: this.audit, governance: this.governance }));
  }

  saveConfig(config) { validateRadarSkill(config); this.config = { ...config, domains: [...config.domains] }; this.persist(); return this.config; }

  addRun(run, { rerun = false } = {}) {
    const existing = this.runs.find(item => item.key === run.key);
    if (existing && !rerun) return { reused: true, run: existing };
    if (existing) this.runs.splice(this.runs.indexOf(existing), 1);
    const notifications = [...(existing?.notifications || [])];
    for (const notification of run.notifications || []) {
      const deliveryId = `${run.key}/${notification.channel}/${notification.date}`;
      const previouslySent = notifications.some(item => item.channel === notification.channel && item.date === notification.date);
      if (!this.deliveries.some(item => item.deliveryId === deliveryId) && !previouslySent) {
        this.deliveries.unshift(record({ deliveryId, runKey: run.key, notification }, run.report?.simulatedRunAt || MOCK_NOW, 'report_delivery'));
        notifications.push(notification);
      }
    }
    const item = record({ ...run, notifications }, run.report?.simulatedRunAt || MOCK_NOW);
    if (existing) item.createdAt = existing.createdAt;
    this.runs.unshift(item);
    if (run.report?.alerts) for (const alert of run.report.alerts) {
      const incident = this.incidents.find(row => row.incidentId === alert.incidentId);
      if (incident) { incident.updatedAt = item.createdAt; incident.lastAlertInstanceId = alert.alertInstanceId; }
      else this.incidents.push(record({ incidentId: alert.incidentId, lastAlertInstanceId: alert.alertInstanceId, status: 'open' }, item.createdAt));
    }
    this.persist();
    return { reused: false, run: item };
  }

  setFeedback(incidentId, status, note = '', at = MOCK_NOW, gapAtFeedback = 0, sourceDate = at.slice(0,10)) {
    if (!['pending', 'done', 'deferred', 'not_applicable'].includes(status)) throw new Error('不支持的处理状态。');
    const expiresAt = status === 'not_applicable' ? new Date(Date.parse(at) + 7 * 86400000).toISOString() : null;
    const revision = 1 + Math.max(0, ...this.feedbackHistory.filter(item => item.incidentId === incidentId).map(item => item.revision || 0));
    const item = record({ incidentId, status, note: String(note).slice(0, 300), gapAtFeedback, expiresAt, sourceDate, revision }, at, 'merchant_feedback');
    this.feedbackHistory.unshift(structuredClone(item));
    this.feedback = this.feedbackAt('9999-12-31');
    const incident = this.incidents.find(row => row.incidentId === incidentId);
    const current = this.feedback.find(row => row.incidentId === incidentId);
    if (incident && current) { incident.status = current.status; incident.updatedAt = current.updatedAt; }
    this.persist();
    return item;
  }

  feedbackAt(date) {
    const seen = new Set();
    return [...this.feedbackHistory].sort((left, right) => {
      const bySourceDate = (right.sourceDate || right.updatedAt.slice(0,10)).localeCompare(left.sourceDate || left.updatedAt.slice(0,10));
      if (bySourceDate) return bySourceDate;
      return (right.revision || 0) - (left.revision || 0) || right.updatedAt.localeCompare(left.updatedAt);
    }).filter(item => {
      if ((item.sourceDate || item.updatedAt.slice(0,10)) > date || seen.has(item.incidentId)) return false;
      seen.add(item.incidentId); return true;
    });
  }

  subscribeDiagnosis(task, { frequency, hour }) {
    if (task.status !== 'completed' || task.plan.shop !== '动燃健身旗舰店') throw new Error('请先完成本店诊断。');
    const existing = this.focused.find(item => item.sourceDiagnosisId === task.id);
    const item = record({ id: existing?.id || `WATCH-${task.id}`, sourceDiagnosisId: task.id, question: task.question,
      domains: ['traffic'], metricId: task.plan.metricId, metricVersion: task.evidence[0].version,
      baseline: task.plan.baseline, dimension: task.plan.dimension, dateRule: 'previous_complete_day',
      sourceDate: task.plan.date, evidenceIds: task.evidence.map(card => card.id), frequency, hour, enabled: true });
    if (existing) this.focused.splice(this.focused.indexOf(existing),1);
    this.focused.unshift(item); this.persist(); return item;
  }

  toggleFocus(id) {
    const item = this.focused.find(row => row.id === id);
    if (!item) return false;
    item.enabled = !item.enabled; this.persist(); return true;
  }

  addAudit(action, details = '', at = MOCK_NOW) {
    this.audit.unshift(record({ action, details }, at));
    this.persist();
  }

  propose(kind, description, at = MOCK_NOW) {
    if (!allowedProposals.has(kind)) throw new Error('禁止修改指标口径、权限、阈值、资金动作或评测标准。');
    const policy = { ...this.governance.policy, ...(kind === 'sort' ? { order: 'unresolved_first' } : { wording: 'action_first' }) };
    const item = record({ id: `GOV-${this.governance.proposals.length + 1}`, kind, description, baseVersion: this.governance.version, policy, status: 'pending_shadow', shadow: null }, at, 'merchant_feedback');
    this.governance.proposals.unshift(item);
    this.addAudit('proposal_created', `${kind}: ${description}`, at);
    return item;
  }

  shadowCompare(id) {
    const item = this.governance.proposals.find(row => row.id === id);
    if (!item || item.status !== 'pending_shadow') return false;
    item.status = 'pending_review';
    const comparisons = ['2026-11-14','2026-11-15','2026-11-16'].map(date => {
      const feedback = this.feedbackAt(date);
      const before = buildRadarReport(date, { feedback, policy: this.governance.policy });
      const after = buildRadarReport(date, { feedback, policy: item.policy });
      return { date, before: before.alerts.map(row => row.incidentId), after: after.alerts.map(row => row.incidentId),
        metricsUnchanged: JSON.stringify(before.metrics) === JSON.stringify(after.metrics),
        evidenceUnchanged: JSON.stringify(before.alerts.map(row => row.evidence.id).sort()) === JSON.stringify(after.alerts.map(row => row.evidence.id).sort()) };
    });
    item.shadow = { samples: comparisons.length, comparisons, metricRulesUnchanged: comparisons.every(row => row.metricsUnchanged && row.evidenceUnchanged), result: '对照已完成，等待审核' };
    item.updatedAt = MOCK_NOW;
    this.addAudit('shadow_compared', id);
    return true;
  }

  review(id, decision) {
    const item = this.governance.proposals.find(row => row.id === id);
    if (!item || item.status !== 'pending_review' || !['approve', 'reject'].includes(decision) || item.baseVersion !== this.governance.version || !item.shadow.metricRulesUnchanged) return false;
    if (decision === 'approve') {
      this.governance.previousVersion = this.governance.version;
      this.governance.previousPolicy = { ...this.governance.policy };
      const patch = this.governance.published.length + 1;
      this.governance.version = `1.0.${patch}`;
      this.governance.policy = { ...item.policy };
      this.governance.published.unshift(record({ proposalId: id, version: this.governance.version, humanApproved: true }));
      item.status = 'approved';
    } else item.status = 'rejected';
    item.updatedAt = MOCK_NOW;
    this.addAudit(`human_${decision}`, id);
    return true;
  }

  rollback() {
    if (!this.governance.previousVersion) return false;
    this.governance.version = this.governance.previousVersion;
    this.governance.policy = this.governance.previousPolicy || { order: 'priority', wording: 'standard' };
    this.governance.previousVersion = null;
    this.addAudit('human_rollback', this.governance.version);
    return true;
  }

  clear(confirmed) {
    if (confirmed !== true) return false;
    this.storage.removeItem(RADAR_SKILL_KEY);
    this.storage.removeItem(RADAR_MEMORY_KEY);
    this.config = { ...defaultRadarSkill, domains: [...defaultRadarSkill.domains] };
    this.runs = []; this.feedback = []; this.feedbackHistory = []; this.deliveries = []; this.focused = []; this.incidents = []; this.audit = [];
    this.governance = record({ version: '1.0.0', policy: { order: 'priority', wording: 'standard' }, proposals: [], published: [], previousVersion: null });
    return true;
  }
}
