import { RADAR_DOMAINS, RADAR_SHOP_ID } from './radar-data.mjs';
import { buildRadarReport } from './radar-rules.mjs';

export const defaultRadarSkill = Object.freeze({
  id: 'daily-business-pulse', version: '1.0.0', shopId: RADAR_SHOP_ID,
  name: '每日经营巡检', domains: RADAR_DOMAINS, timezone: 'Asia/Shanghai',
  frequency: 'daily', hour: 9, notification: 'important_only', readOnly: true,
  saved: false, enabled: false
});

const editable = new Set(['name', 'domains', 'frequency', 'hour', 'notification']);
const allowedHours = [8, 9, 10];
const steps = [
  ['validate_config', '校验配置和店铺只读权限'],
  ['check_data_readiness', '检查昨日数据就绪'],
  ['query_four_domains', '查询已选择的经营维度'],
  ['evaluate_anomalies', '执行确定性异常规则'],
  ['attach_evidence', '附加指标证据与来源'],
  ['build_report', '生成交互式日报'],
  ['record_log', '保存本机模拟执行记录'],
  ['mock_notify', '按策略记录模拟站内提醒']
];
export const radarRunSteps = steps.map(([id, label]) => ({ id, label }));

export function validateRadarSkill(config) {
  if (config.id !== defaultRadarSkill.id || config.shopId !== RADAR_SHOP_ID || config.readOnly !== true || config.timezone !== 'Asia/Shanghai') throw new Error('不可修改店铺、权限、时区或 Skill 身份。');
  if (!config.name?.trim() || [...config.name.trim()].length > 36) throw new Error('Skill 名称需为 1–36 字。');
  if (!Array.isArray(config.domains) || config.domains.length < 1 || config.domains.some(domain => !RADAR_DOMAINS.includes(domain))) throw new Error('至少选择一个有效监控维度。');
  if (!['daily', 'weekly'].includes(config.frequency) || !allowedHours.includes(Number(config.hour))) throw new Error('请选择允许的频率和固定小时。');
  if (!['important_only', 'every_run', 'none'].includes(config.notification)) throw new Error('通知策略不受支持。');
}

export function editRadarSkill(config, patch) {
  if (Object.keys(patch).some(key => !editable.has(key))) throw new Error('不可修改店铺、只读权限或内部版本。');
  const updated = { ...config, ...patch, domains: patch.domains ? [...patch.domains] : [...config.domains], saved: false, enabled: false };
  validateRadarSkill(updated);
  return updated;
}

export function saveRadarSkill(config) {
  validateRadarSkill(config);
  return { ...config, name: config.name.trim(), domains: [...new Set(config.domains)], saved: true, enabled: false };
}

export function enableRadarSkill(config) {
  validateRadarSkill(config);
  if (!config.saved) throw new Error('请先保存 Skill，再开启模拟订阅。');
  return { ...config, enabled: true };
}

export function nextMockRun(config, clock = '2026-11-15T09:00:00+08:00') {
  const now = new Date(clock);
  const shanghai = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const date = new Date(Date.UTC(shanghai.getUTCFullYear(), shanghai.getUTCMonth(), shanghai.getUTCDate(), Number(config.hour)));
  if (date <= shanghai) date.setUTCDate(date.getUTCDate() + 1);
  if (config.frequency === 'weekly') while (date.getUTCDay() !== 6) date.setUTCDate(date.getUTCDate() + 1);
  return `${date.toISOString().slice(0, 10)} ${String(config.hour).padStart(2, '0')}:00 Asia/Shanghai（教学 Mock）`;
}

export function makeRunKey(config, date) {
  const configString = JSON.stringify([config.name, [...config.domains].sort(), config.frequency, Number(config.hour), config.notification]);
  let hash = 2166136261;
  for (const char of configString) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `${config.shopId}/${date}/${config.version}/${(hash >>> 0).toString(16)}`;
}

export class RadarRun {
  constructor(config, date, scenario = 'normal') {
    this.config = { ...config, domains: [...config.domains] };
    this.date = date;
    this.scenario = scenario;
    this.key = makeRunKey(config, date);
    this.status = 'scheduled_mock';
    this.stepIndex = 0;
    this.trace = [];
    this.report = null;
    this.notifications = [];
    this.mock = true;
  }

  start() { if (this.status === 'scheduled_mock') this.status = 'running'; return this; }

  advance() {
    if (this.status !== 'running') return this;
    const [id, label] = steps[this.stepIndex];
    const entry = { step: id, label, status: 'success', mockLatencyMs: 90 + this.stepIndex * 35, metricVersion: 'SHOP_UV_001@v1.0', errorCode: null };
    if (id === 'validate_config') {
      try { validateRadarSkill(this.config); } catch {
        const denied = this.config.shopId !== RADAR_SHOP_ID || this.config.readOnly !== true;
        entry.status = denied ? 'denied' : 'failed';
        entry.errorCode = denied ? 'MOCK_UNAUTHORIZED' : 'MOCK_INVALID_CONFIG';
        this.status = 'failed';
      }
    }
    if (id === 'query_four_domains' && this.scenario === 'timeout') {
      entry.status = 'failed'; entry.errorCode = 'MOCK_TIMEOUT'; this.status = 'failed';
    }
    if (id === 'build_report') {
      this.report = buildRadarReport(this.date, { scenario: this.scenario, domains: this.config.domains });
      if (this.report.status === 'unsupported') { entry.status = 'failed'; entry.errorCode = 'MOCK_UNSUPPORTED_DATE'; this.status = 'failed'; this.report = null; }
    }
    if (id === 'mock_notify' && this.report && this.config.notification !== 'none') {
      if (this.config.notification === 'every_run' || this.report.alerts.length) this.notifications.push({ mock: true, channel: 'in_app_mock', date: this.date, message: `教学模拟提醒：${this.report.alerts.length} 项需查看` });
    }
    this.trace.push(entry);
    this.stepIndex++;
    if (this.status === 'running' && this.stepIndex === steps.length) this.status = this.report?.status === 'partial' ? 'partial' : 'completed';
    return this;
  }

  interrupt() { if (this.status === 'running') this.status = 'interrupted'; return this; }

  snapshot() {
    return { key: this.key, date: this.date, scenario: this.scenario, status: this.status, trace: this.trace, report: this.report, notifications: this.notifications, mock: true };
  }
}
