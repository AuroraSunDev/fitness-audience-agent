import { analyzeTraffic, buildEvidence, validatePlan } from './data.mjs';

export const steps = [
  '查询指标定义与数据', '分渠道下钻', '计算预期缺口与贡献', '校验证据并生成结论'
];

export class DiagnosticTask {
  constructor(fixture, plan, question = '大促后流量掉了，是正常回落还是有问题？') {
    this.fixture = fixture;
    this.plan = { ...plan };
    this.question = question;
    this.status = 'idle';
    this.stepIndex = 0;
    this.partialFinding = '';
    this.result = null;
    this.evidence = [];
    this.failure = null;
    this.trace = [];
    this.id = `DEMO-${fixture.scenario.toUpperCase()}-20261114`;
  }

  start() {
    if (this.status !== 'idle') return false;
    this.status = 'running';
    return true;
  }

  resume() {
    if (this.status !== 'interrupted') return false;
    this.status = 'running';
    return true;
  }

  interrupt() {
    if (this.status !== 'running') return false;
    this.status = 'interrupted';
    return true;
  }

  record(tool, status, errorCode = null) {
    this.trace.push({
      session: 'DEMO-SESSION-01', task: this.id, step: this.stepIndex + 1,
      tool, status, errorCode, metricVersion: this.fixture.metricVersion,
      mockLatencyMs: 180 + this.trace.length * 70,
      input: { metricId: this.plan.metricId, date: this.plan.date, dimension: this.plan.dimension }
    });
  }

  stop(code, reason, known = '', uncertain = '') {
    this.failure = { code, reason, known, uncertain };
    this.status = 'stopped';
  }

  advance() {
    if (this.status !== 'running') return false;
    if (this.stepIndex === 0) {
      const unsupported = validatePlan(this.plan);
      if (unsupported) {
        this.record('get_metric_def', 'error', 'unsupported');
        this.stop('unsupported', unsupported, '查询尚未执行。', '当前条件暂无可用数据。');
        return false;
      }
      this.record('get_metric_def', 'success');
      const first = analyzeTraffic(this.fixture, this.plan);
      if (first.status === 'metric_conflict') {
        this.record('query_metric', 'metric_conflict', 'metric_conflict');
        this.stop('metric_conflict', first.reason, first.known, first.uncertain);
        return false;
      }
      if (first.status === 'low_evidence' && this.plan.metricId !== 'SHOP_UV_001') {
        this.record('query_metric', 'empty', 'insufficient_metric_data');
        this.stop('low_evidence', first.reason, first.known, first.uncertain);
        return false;
      }
      this.record('query_metric', 'success');
      this.partialFinding = `店铺 UV 较 11.11 峰值减少 ${(this.fixture.peak - this.fixture.actual).toLocaleString('zh-CN')} 人；仍需核对渠道和参考基线。`;
      this.stepIndex = 1;
      return true;
    }
    if (this.stepIndex === 1) {
      const analysis = analyzeTraffic(this.fixture, this.plan);
      if (analysis.status === 'low_evidence') {
        this.record('drill_dimension', 'empty', 'paid_channel_missing');
        this.stop('low_evidence', analysis.reason, analysis.known, analysis.uncertain);
        return false;
      }
      this.record('drill_dimension', 'success');
      this.partialFinding = this.plan.dimension === 'paid_only'
        ? '付费广告 UV 为 800，低于参考预期 500；其他渠道未下钻。'
        : '付费广告低于参考预期 500 人，值得优先排查，但尚不能推断原因。';
      this.stepIndex = 2;
      return true;
    }
    if (this.stepIndex === 2) {
      if (this.fixture.scenario === 'timeout') {
        this.record('run_attribution', 'timeout', 'mock_timeout');
        this.stop('timeout', '渠道贡献计算超时，任务已停止。',
          '已确认店铺 UV 下降 4,000 人，且付费广告低于参考预期 500 人。',
          '完整渠道贡献与证据校验尚未完成，不能输出最终排序。');
        return false;
      }
      const analysis = analyzeTraffic(this.fixture, this.plan);
      this.record('run_attribution', 'success');
      this.partialFinding = `相对参考预期额外少 ${analysis.extraGap.toLocaleString('zh-CN')} 人；渠道缺口是结构贡献，不是因果。`;
      this.stepIndex = 3;
      return true;
    }
    if (this.stepIndex === 3) {
      this.evidence = buildEvidence(this.fixture, this.plan);
      this.record('get_evidence_card', 'success');
      this.result = analyzeTraffic(this.fixture, this.plan);
      this.record('propose_action', 'success');
      this.stepIndex = 4;
      this.status = 'completed';
      return true;
    }
    return false;
  }

  makeHandoff() {
    if (this.status !== 'stopped') return null;
    return {
      mock: true, id: `DEMO-HANDOFF-${this.id}`, question: this.question,
      plan: { ...this.plan }, completedSteps: steps.slice(0, this.stepIndex),
      evidenceIds: this.trace.filter(item => item.status === 'success').map((_, index) => `T-${index + 1}`),
      reason: this.failure.reason,
      todo: this.failure.code === 'metric_conflict' ? '请数据负责人确认权威 UV 口径与版本。'
        : this.failure.code === 'timeout' ? '请复核未完成的渠道贡献计算与证据。'
          : '请补齐广告渠道数据并复核归因完整性。'
    };
  }
}

export class ApprovalFlow {
  constructor() {
    this.status = 'draft';
    this.approvalId = null;
    this.executed = false;
    this.currentDaily = 300;
    this.proposedDaily = 350;
    this.days = 2;
  }

  get extraCap() { return (this.proposedDaily - this.currentDaily) * this.days; }

  openConfirmation() {
    if (this.status !== 'draft') return false;
    this.status = 'confirming';
    return true;
  }

  submit() {
    if (this.status !== 'confirming') return false;
    this.approvalId = 'DEMO-APP-20261114-001';
    this.status = 'pending';
    return true;
  }

  cancel() {
    if (!['draft', 'confirming', 'pending'].includes(this.status)) return false;
    this.status = 'cancelled';
    return true;
  }

  approveDemo() {
    if (this.status !== 'pending') return false;
    this.status = 'approved_mock';
    return true;
  }

  rejectDemo() {
    if (this.status !== 'pending') return false;
    this.status = 'rejected_mock';
    return true;
  }
}
