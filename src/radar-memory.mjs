import { defaultRadarSkill, validateRadarSkill } from './radar-runtime.mjs';
import { RADAR_SHOP_ID } from './radar-data.mjs';

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
    this.incidents = (memory.incidents || []).filter(item => item.shopId === RADAR_SHOP_ID);
    this.audit = (memory.audit || []).filter(item => item.shopId === RADAR_SHOP_ID);
    this.governance = memory.governance?.shopId === RADAR_SHOP_ID ? memory.governance : record({ version: '1.0.0', proposals: [], published: [], previousVersion: null });
    if (this.migrationNotice) this.config = { ...defaultRadarSkill, domains: [...defaultRadarSkill.domains], enabled: false, saved: false };
  }

  persist() {
    this.storage.setItem(RADAR_SKILL_KEY, JSON.stringify(record({ value: this.config })));
    this.storage.setItem(RADAR_MEMORY_KEY, JSON.stringify({ runs: this.runs, feedback: this.feedback, incidents: this.incidents, audit: this.audit, governance: this.governance }));
  }

  saveConfig(config) { validateRadarSkill(config); this.config = { ...config, domains: [...config.domains] }; this.persist(); return this.config; }

  addRun(run, { rerun = false } = {}) {
    const existing = this.runs.find(item => item.key === run.key);
    if (existing && !rerun) return { reused: true, run: existing };
    if (existing) this.runs.splice(this.runs.indexOf(existing), 1);
    const item = record({ ...run, notifications: rerun ? [] : run.notifications }, run.report?.simulatedRunAt || MOCK_NOW);
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

  setFeedback(incidentId, status, note = '', at = MOCK_NOW, gapAtFeedback = 0) {
    if (!['pending', 'done', 'deferred', 'not_applicable'].includes(status)) throw new Error('不支持的处理状态。');
    const previous = this.feedback.find(item => item.incidentId === incidentId);
    const expiresAt = status === 'not_applicable' ? new Date(Date.parse(at) + 7 * 86400000).toISOString() : null;
    const item = record({ incidentId, status, note: String(note).slice(0, 300), gapAtFeedback, expiresAt }, at, 'merchant_demo_feedback');
    if (previous) { item.createdAt = previous.createdAt; this.feedback.splice(this.feedback.indexOf(previous), 1); }
    this.feedback.unshift(item);
    const incident = this.incidents.find(row => row.incidentId === incidentId);
    if (incident) { incident.status = status; incident.updatedAt = at; }
    this.persist();
    return item;
  }

  addAudit(action, details = '', at = MOCK_NOW) {
    this.audit.unshift(record({ action, details }, at));
    this.persist();
  }

  propose(kind, description, at = MOCK_NOW) {
    if (!allowedProposals.has(kind)) throw new Error('禁止修改指标口径、权限、阈值、资金动作或评测标准。');
    const item = record({ id: `GOV-${this.governance.proposals.length + 1}`, kind, description, status: 'pending_shadow', shadow: null }, at, 'merchant_feedback_mock');
    this.governance.proposals.unshift(item);
    this.addAudit('proposal_created', `${kind}: ${description}`, at);
    return item;
  }

  shadowCompare(id) {
    const item = this.governance.proposals.find(row => row.id === id);
    if (!item || item.status !== 'pending_shadow') return false;
    item.status = 'pending_review';
    item.shadow = { mock: true, before: '原提醒文案/顺序', after: '候选提醒文案/顺序', metricRulesUnchanged: true, result: '可进入人工审核；未发布' };
    item.updatedAt = MOCK_NOW;
    this.addAudit('shadow_compared', id);
    return true;
  }

  review(id, decision) {
    const item = this.governance.proposals.find(row => row.id === id);
    if (!item || item.status !== 'pending_review' || !['approve', 'reject'].includes(decision)) return false;
    if (decision === 'approve') {
      this.governance.previousVersion = this.governance.version;
      const patch = this.governance.published.length + 1;
      this.governance.version = `1.0.${patch}-mock`;
      this.governance.published.unshift(record({ proposalId: id, version: this.governance.version, humanApproved: true }));
      item.status = 'approved_mock';
    } else item.status = 'rejected_mock';
    item.updatedAt = MOCK_NOW;
    this.addAudit(`human_${decision}`, id);
    return true;
  }

  rollback() {
    if (!this.governance.previousVersion) return false;
    this.governance.version = this.governance.previousVersion;
    this.governance.previousVersion = null;
    this.addAudit('human_rollback', this.governance.version);
    return true;
  }

  clear(confirmed) {
    if (confirmed !== true) return false;
    this.storage.removeItem(RADAR_SKILL_KEY);
    this.storage.removeItem(RADAR_MEMORY_KEY);
    this.config = { ...defaultRadarSkill, domains: [...defaultRadarSkill.domains] };
    this.runs = []; this.feedback = []; this.incidents = []; this.audit = [];
    this.governance = record({ version: '1.0.0', proposals: [], published: [], previousVersion: null });
    return true;
  }
}
