import { buildRadarReport, shouldSuppressRecommendation } from './radar-rules.mjs';
import { RADAR_DOMAINS } from './radar-data.mjs';
import { editRadarSkill, enableRadarSkill, makeRunKey, RadarRun, saveRadarSkill } from './radar-runtime.mjs';
import { RadarMemory } from './radar-memory.mjs';
import { recordActionFeedback } from './radar-tools.mjs';
import { createReportHtml } from './report-export.mjs';
import { renderDateCalendar } from './date-calendar.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const num = value => Number(value).toLocaleString('zh-CN');
const percent = ratio => `${Number((ratio * 100).toFixed(1))}%`;
const domains = { traffic: '流量', audience: '用户', transaction: '交易', ranking: '搜索排名' };
const statuses = { pending: '待处理', done: '已处理', deferred: '暂缓', not_applicable: '不适用' };
const dates = ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16'];
const btn = (label, action, secondary = false, attrs = '') => `<button class="radar-btn ${secondary ? 'is-secondary' : ''}" data-radar="${action}" ${attrs}>${label}</button>`;
const line = (label, value) => `<div class="radar-line"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
const scrollPosition = () => typeof window === 'undefined' ? 0 : window.scrollY;
const qualityLabel = quality => ({ complete: '口径一致', conflict: '待确认', incomparable: '采样不可比', missing: '待更新', unavailable: '暂无数据' })[quality] || '待确认';

export class RadarUI {
  constructor(storage, onRender, onContinueDiagnosis) {
    this.memory = new RadarMemory(storage);
    this.onRender = onRender; this.onContinueDiagnosis = onContinueDiagnosis;
    this.page = 'report'; this.date = '2026-11-14'; this.scenario = 'normal';
    this.selectedMetric = 'traffic'; this.selectedAlert = null; this.notice = ''; this.calendarOpen = false;
    this.activeRun = null; this.timer = null; this.navigation = []; this.restoreScroll = null;
  }

  open(page, changes = {}) {
    page = ({ home: 'report', skill: 'settings' })[page] || page;
    if (this.page !== page || Object.keys(changes).length) {
      this.navigation.push({ page: this.page, date: this.date, selectedMetric: this.selectedMetric, selectedAlert: this.selectedAlert, scroll: scrollPosition() });
      Object.assign(this, changes, { page }); this.restoreScroll = 0;
    }
    this.notice = ''; this.onRender();
  }

  back() {
    if (this.page === 'run' && this.activeRun?.status === 'running') { clearTimeout(this.timer); this.activeRun.interrupt(); this.finishRun(); }
    const previous = this.navigation.pop();
    if (!previous) return false;
    this.page = previous.page; this.date = previous.date;
    this.selectedMetric = previous.selectedMetric; this.selectedAlert = previous.selectedAlert;
    this.restoreScroll = previous.scroll; this.notice = ''; this.onRender(); return true;
  }

  selectDate(date) { if (dates.includes(date)) { this.calendarOpen = false; this.open('report', { date, selectedMetric: 'traffic', selectedAlert: null }); } }
  selectMetric(metric) { if (RADAR_DOMAINS.includes(metric)) this.open('metric', { selectedMetric: metric, selectedAlert: null }); }
  selectAlert(id) { this.open('alert', { selectedAlert: id }); }

  captureRoute() {
    return { page: this.page, date: this.date, selectedMetric: this.selectedMetric, selectedAlert: this.selectedAlert, scroll: scrollPosition(), navigation: structuredClone(this.navigation) };
  }

  restoreRoute(route) {
    if (!route) return false;
    this.page = route.page; this.date = route.date; this.selectedMetric = route.selectedMetric;
    this.selectedAlert = route.selectedAlert; this.navigation = structuredClone(route.navigation || []);
    this.restoreScroll = route.scroll || 0; this.notice = ''; this.onRender(); return true;
  }

  persistedReport(date) {
    const key = makeRunKey({ ...this.memory.config, version: this.memory.governance.version }, date);
    const valid = item => item.scenario === this.scenario && ['completed','partial'].includes(item.status);
    return this.memory.runs.find(item => item.key === key && valid(item)) || this.memory.runs.find(item => item.date === date && valid(item) && JSON.stringify(item.report?.selectedDomains) === JSON.stringify(this.memory.config.domains));
  }

  reportsForExport() {
    const first = new Date(Date.parse(`${this.date}T00:00:00Z`) - 2 * 86400000).toISOString().slice(0, 10);
    return dates.filter(date => date >= first && date <= this.date).map(date => this.persistedReport(date)?.report || buildRadarReport(date, { scenario: this.scenario, domains: this.memory.config.domains, feedback: this.memory.feedbackAt(date), policy: this.memory.governance.policy, version: this.memory.governance.version }));
  }

  get report() {
    if (this.scenario === 'timeout' || this.scenario === 'unauthorized') return { data: { status: 'unavailable', reason: this.scenario === 'timeout' ? '数据查询超时，请稍后重试。' : '当前账号没有查看该店铺数据的权限。' }, run: null };
    const persisted = this.persistedReport(this.date);
    const feedback = this.memory.feedbackAt(this.date);
    const data = persisted?.report || buildRadarReport(this.date, { scenario: this.scenario, domains: this.memory.config.domains, feedback, policy: this.memory.governance.policy, version: this.memory.governance.version });
    const tasks = data.tasks?.filter(task => !feedback.some(item => shouldSuppressRecommendation(item, { incidentId: task.incidentId, gap: task.gap }, this.date)));
    const followups = data.followups?.map(item => ({ ...item, processingStatus: feedback.find(row => row.incidentId === item.incidentId)?.status || 'pending' }));
    return { data: tasks ? { ...data, tasks, followups } : data, run: persisted };
  }

  render() {
    const pages = { report: () => this.renderReport(), settings: () => this.renderSettings(), history: () => this.renderHistory(), tasks: () => this.renderTasks(), metric: () => this.renderMetricDetail(this.report.data), alert: () => this.renderAlertPage(), run: () => this.renderRun() };
    const active = ['metric', 'alert', 'run'].includes(this.page) ? 'report' : this.page;
    return `<section class="radar-screen" data-screen="radar" data-radar-page="${this.page}">${this.notice ? `<p class="radar-notice" role="status">${esc(this.notice)}</p>` : ''}${(pages[this.page] || pages.report)()}<nav class="radar-bottom-nav" aria-label="每日巡检导航">${[['report','日报'],['tasks','今日待办'],['history','历史报告'],['settings','巡检设置']].map(([id,label]) => `<button data-radar="page-${id}" class="${active === id ? 'active' : ''}">${label}</button>`).join('')}</nav></section>`;
  }

  renderReport() {
    const { data: report } = this.report;
    if (!report.metrics) return `<h1>日报暂不可用</h1><p class="radar-sub">${esc(report.reason)}</p>${btn('重新加载', 'refresh-report')}`;
    const c = this.memory.config;
    const cards = [
      ['traffic','店铺访客', report.metrics.traffic?.value, report.metrics.traffic?.gapRatio != null ? `较参考预期 -${percent(report.metrics.traffic.gapRatio)}` : '口径待确认'],
      ['audience','新访客', report.metrics.audience?.value, report.metrics.audience?.value == null ? '数据待更新' : `回访访客 ${num(report.metrics.audience.returningVisitors)}`],
      ['transaction','支付金额', report.metrics.transaction?.value, report.metrics.transaction?.value == null ? '数据待更新' : `支付买家 ${num(report.metrics.transaction.buyers)} 人`],
      ['ranking','搜索排名', report.metrics.ranking?.value, report.metrics.ranking?.value == null ? '数据待更新' : report.metrics.ranking.delta == null ? '采样条件待核对' : `较上次${report.metrics.ranking.delta >= 0 ? '下降' : '上升'} ${Math.abs(report.metrics.ranking.delta)} 位`]
    ].filter(([id]) => report.selectedDomains.includes(id));
    const feedback = this.memory.feedbackAt(this.date);
    const pending = report.tasks.filter(task => !['done','not_applicable'].includes(feedback.find(item => item.incidentId === task.incidentId)?.status)).length;
    const traffic = report.metrics.traffic;
    const first = report.alerts[0];
    const headline = first?.kind === 'paid' ? '优先检查付费广告计划' : first?.kind === 'traffic' ? '店铺访客低于参考预期' : first?.kind === 'ranking' ? '搜索排名有下降，建议核查' : traffic?.quality === 'conflict' ? '流量数据需要核对' : report.followup ? '流量差距正在收窄' : '关注最新经营表现';
    const summary = traffic?.gap != null ? `店铺访客 ${num(traffic.actual)}，较参考预期少 ${num(traffic.gap)}（${percent(traffic.gapRatio)}）。${traffic.paid ? `其中付费渠道少 ${num(traffic.paid.gap)}，占总缺口 ${percent(traffic.paid.contribution)}。` : ''}` : report.summary;
    return `<div class="radar-report-heading"><p class="radar-shop">${esc(report.shopName)}</p><h1>经营巡检日报</h1><div class="radar-report-meta"><button class="radar-date-button" data-radar="toggle-calendar" aria-expanded="${this.calendarOpen}">${report.date.slice(5).replace('-', '月')}日 <span>▾</span></button><span>${report.simulatedRunAt.slice(5,16)} 更新</span><button class="radar-refresh" data-radar="refresh-report" aria-label="更新日报">↻</button></div>${this.calendarOpen ? renderDateCalendar(this.date, dates, 'data-radar', 'calendar-') : ''}</div>
      <div class="radar-data-scope"><strong>数据范围 ${report.date} · 00:00–24:00</strong><span>本店已授权数据 · ${report.completeness} 项已覆盖 · ${report.simulatedRunAt.slice(5,16)} 更新</span></div>
      <div class="radar-subscription-strip"><div><strong>${c.enabled ? '每日巡检已开启' : '每天开店前，先看清经营重点'}</strong><small>${c.enabled ? `${c.frequency === 'daily' ? '每天' : '每周六'} ${String(c.hour).padStart(2,'0')}:00 · ${c.domains.map(id => domains[id]).join('、')}` : '默认每天 09:00 检查昨日四维数据，重要变化时提醒'}</small></div><button data-radar="${c.enabled ? 'page-settings' : 'enable-default'}">${c.enabled ? '巡检设置' : '开启每日巡检'} →</button></div>
      <div class="radar-summary"><span>今日重点</span><h2>${headline}</h2><p>${esc(summary)}</p></div>${report.missing.length ? `<div class="radar-warning">${report.missing.map(esc).join('、')}数据待补充，相关变化暂无法判断。</div>` : ''}
      <div class="radar-section-head"><h2>经营概况</h2><span>点击查看详情</span></div><div class="radar-kpis">${cards.map(([id,label,value,hint]) => `<button class="radar-kpi" data-radar="metric-${id}"><span>${label}</span><strong>${value == null ? '暂无数据' : `${id === 'transaction' ? '¥' : id === 'ranking' ? '第 ' : ''}${num(value)}${id === 'ranking' ? ' 名' : ''}`}</strong><small>${esc(hint)}</small></button>`).join('')}</div>
      <div class="radar-section-head"><h2>优先关注</h2><span>${report.alerts.length} 项</span></div>${report.alerts.length ? report.alerts.map((alert,i) => `<article class="radar-alert"><button data-radar="alert-${alert.incidentId}"><span class="radar-alert-rank">0${i+1}</span><div><strong>${esc(alert.title)}</strong><small>${alert.kind === 'ranking' ? `排名下降 ${alert.delta} 位，需核验曝光与点击` : `低于参考预期 ${num(alert.gap)} 人${alert.kind === 'paid' ? ` · 占总缺口 ${percent(alert.evidence.contribution)}` : ''}`}</small></div><b>查看 ›</b></button></article>`).join('') : '<div class="radar-panel radar-muted">已更新的指标中，暂未发现需要优先处理的异常。</div>'}
      <button class="radar-todo-entry" data-radar="page-tasks"><span><strong>今日待办</strong><small>${pending ? `${pending} 项建议待处理` : '查看已处理记录'}</small></span><b>去处理 →</b></button>${this.renderFollowups(report)}
      <button class="radar-export" data-radar="export-report">下载交互式报告 ↓</button>`;
  }

  renderFollowups(report) {
    if (!report.followups?.length) return '';
    return `<div class="radar-section-head"><h2>上次问题的后续变化</h2><span>处理与恢复分别跟进</span></div>${report.followups.map(item => `<article class="radar-followup"><strong>${esc(item.title)} · ${statuses[item.processingStatus]}</strong><p>缺口 ${num(item.previousGap)} → ${num(item.currentGap)} 人</p><small>${item.recoveryStatus === 'ongoing' ? '仍达到提醒条件，继续关注' : '已低于提醒阈值，继续观察'} · ${item.processingStatus === 'done' ? '已记录处理，改善原因仍需核验' : '待核实处理进展'}</small><button class="radar-text-link" data-radar="page-tasks">查看处理记录 →</button></article>`).join('')}`;
  }

  renderSettings() {
    const c = this.memory.config;
    return `<p class="radar-eyebrow">动燃健身旗舰店</p><h1>每日巡检设置</h1><p class="radar-sub">选择关注的经营变化和提醒方式。</p><div class="radar-panel radar-form"><fieldset><legend>关注哪些变化</legend>${RADAR_DOMAINS.map(id => `<label class="radar-check"><input type="checkbox" name="radar-domain" value="${id}" ${c.domains.includes(id) ? 'checked' : ''}> ${domains[id]}</label>`).join('')}</fieldset>
      <div class="radar-form-grid"><label class="radar-label">巡检频率<select name="radar-frequency"><option value="daily" ${c.frequency === 'daily' ? 'selected' : ''}>每天</option><option value="weekly" ${c.frequency === 'weekly' ? 'selected' : ''}>每周六</option></select></label><label class="radar-label">巡检时间<select name="radar-hour">${[8,9,10].map(hour => `<option value="${hour}" ${c.hour === hour ? 'selected' : ''}>${String(hour).padStart(2,'0')}:00</option>`).join('')}</select></label></div>
      <label class="radar-label">提醒方式<select name="radar-notification"><option value="important_only" ${c.notification === 'important_only' ? 'selected' : ''}>仅重要异常时提醒</option><option value="every_run" ${c.notification === 'every_run' ? 'selected' : ''}>每次巡检后提醒</option><option value="none" ${c.notification === 'none' ? 'selected' : ''}>不提醒，主动查看日报</option></select></label>${btn(c.enabled ? '保存设置' : '开启每日经营巡检', 'save-settings')}${c.enabled ? '<button class="radar-text-link radar-pause" data-radar="pause-inspection">暂停每日巡检</button>' : ''}</div>
      <div class="radar-section-head"><h2>专项关注</h2><span>来自你保存的诊断</span></div>${this.memory.focused.length ? this.memory.focused.map(item => `<article class="radar-panel"><strong>${esc(item.question)}</strong><p>${esc(item.metricId)} · ${item.frequency === 'daily' ? '每天' : '每周六'} ${item.hour}:00 · ${item.enabled ? '关注中' : '已暂停'}</p><small>仅检查原诊断范围 · ${esc(item.sourceDate)}</small><button class="radar-text-link" data-radar="focus-${esc(item.id)}">${item.enabled ? '暂停关注' : '恢复关注'}</button></article>`).join('') : '<p class="radar-sub">保存诊断后，可在这里持续关注同一个问题。</p>'}`;
  }

  renderMetricDetail(report) {
    const metric = report.metrics?.[this.selectedMetric];
    if (!metric) return '<h1>暂无指标数据</h1><p class="radar-sub">请返回日报查看已更新的指标。</p>';
    const note = { audience: '新访客与回访访客按访问历史区分，与主来源渠道中的老客来源不同。', transaction: '支付金额按当日支付订单统计，未扣除退款。' }[this.selectedMetric] || metric.note;
    return `<p class="radar-eyebrow">${report.date} · 动燃健身旗舰店</p><h1>${domains[this.selectedMetric]}详情</h1><p class="radar-sub">${esc(note)}</p><div class="radar-detail">
      ${this.selectedMetric === 'traffic' && metric.gap != null ? `${line('店铺访客 / 参考预期', `${num(metric.actual)} / ${num(metric.expected)}`)}${line('额外访客缺口', `${num(metric.gap)} 人 · ${percent(metric.gapRatio)}`)}${metric.paid ? `${line('付费访客 / 参考预期', `${num(metric.paid.actual)} / ${num(metric.paid.expected)}`)}${line('付费渠道降幅', `${num(metric.paid.gap)} / ${num(metric.paid.expected)} = ${percent(metric.paid.gapRatio)}`)}${line('付费占总缺口', `${num(metric.paid.gap)} / ${num(metric.gap)} = ${percent(metric.paid.contribution)}`)}` : ''}${metric.channels ? `<div class="radar-channel-list">${Object.entries(metric.channels).map(([id,row]) => `<div><span>${{paid:'付费广告',campaign:'活动流量',organic:'自然流量',returning_source:'老客来源'}[id]}</span><strong>${num(row.actual)} / ${num(row.expected)}</strong></div>`).join('')}</div>` : ''}` : ''}
      ${this.selectedMetric === 'audience' && metric.value != null ? `${line('新访客', `${num(metric.newVisitors)} 人`)}${line('回访访客', `${num(metric.returningVisitors)} 人`)}${line('对比基线', '暂无可比基线，暂不判断构成变化')}` : ''}
      ${this.selectedMetric === 'transaction' && metric.value != null ? `${line('支付金额', `¥${num(metric.value)}`)}${line('支付买家 / 订单', `${num(metric.buyers)} 人 / ${num(metric.orders)} 单`)}${line('买家转化率', metric.conversion == null ? '访客口径待确认，暂不计算' : percent(metric.conversion))}${line('订单客单价', `¥${num(metric.aov)}`)}${line('对比基线', '暂无可比基线，暂不判断交易变化')}` : ''}
      ${this.selectedMetric === 'ranking' && metric.value != null ? `${line('关键词', metric.keyword)}${line('排名变化', metric.delta == null ? '采样不可比，暂不判断变化' : `第 ${metric.previous} → ${metric.value} 名，${metric.delta >= 0 ? '下降' : '上升'} ${Math.abs(metric.delta)} 位`)}` : ''}
      ${metric.evidence ? `<details class="radar-evidence"><summary>查看数据口径与来源</summary>${this.renderEvidence(metric.evidence)}</details>` : '<p>该指标数据尚未更新。</p>'}</div>${this.selectedMetric === 'traffic' ? this.diagnosisLink(report) : ''}`;
  }

  renderEvidence(card) {
    const display = value => typeof value === 'number' ? num(value) : value;
    const source = card.metricId.includes('UV') ? '店铺流量日报' : card.metricId.includes('VISITORS') ? '店铺用户分析' : card.metricId.includes('RANK') ? '搜索排名快照' : '店铺交易明细';
    return `${line('指标 / 口径版本', `${card.metricId} / ${card.version}`)}${line('指标定义', card.definition)}${line('分子 / 分母', `${display(card.numerator)} / ${display(card.denominator)}`)}${line('统计时间', card.timeWindow.replace('Asia/Shanghai','北京时间'))}${line('数据来源', source)}${line('数据血缘', card.lineage)}${line('取数时间', card.fetchedAt.replace('Asia/Shanghai','北京时间'))}${line('数据状态', qualityLabel(card.qualityStatus))}${card.conditions ? line('采样条件', card.conditions) : ''}`;
  }

  diagnosisLink(report, alertId = 'INC-UV-GAP') {
    return report.date === '2026-11-14' ? btn('继续分析流量异常', 'continue-diagnosis', false, `data-alert-id="${esc(alertId)}"`) : '<p class="radar-sub">该日期的渠道数据尚不足以继续诊断。</p>';
  }

  renderAlertPage() {
    const report = this.report.data, alert = report.alerts?.find(item => item.incidentId === this.selectedAlert);
    if (!alert) return '<h1>暂无异常详情</h1><p class="radar-sub">请返回日报查看最新变化。</p>';
    return `<p class="radar-eyebrow">${report.date} · 异常详情</p><h1>${esc(alert.title)}</h1><div class="radar-summary"><span>建议先做什么</span><p>${esc(alert.action)}</p></div><div class="radar-panel">${line('影响范围', alert.impact)}${line('变化幅度', `${num(alert.gap)} ${alert.kind === 'ranking' ? '位' : '人'}`)}${line('关注条件', alert.threshold)}${line('仍需核验', alert.exclusion)}<details class="radar-evidence"><summary>查看判断依据</summary>${this.renderEvidence(alert.evidence)}</details></div><div class="radar-actions">${btn('记录处理情况', 'page-tasks', true)}${alert.kind !== 'ranking' ? this.diagnosisLink(report, alert.alertInstanceId) : ''}</div>`;
  }

  renderTasks() {
    const report = this.report.data;
    return `<p class="radar-eyebrow">${this.date} · 动燃健身旗舰店</p><h1>今日待办</h1><p class="radar-sub">处理重要变化，记录进展，方便明天跟进。</p>${report.tasks?.length ? report.tasks.map(task => this.renderTask(task)).join('') : '<div class="radar-panel radar-muted">暂无新的处理建议。</div>'}`;
  }

  renderTask(task) {
    const feedback = this.memory.feedbackAt(this.date).find(item => item.incidentId === task.incidentId);
    return `<div class="radar-task"><strong>${esc(task.title)}</strong><div class="radar-task-form"><select data-task-status="${task.incidentId}" aria-label="处理状态">${Object.entries(statuses).map(([id,label]) => `<option value="${id}" ${(feedback?.status || 'pending') === id ? 'selected' : ''}>${label}</option>`).join('')}</select><input data-task-note="${task.incidentId}" aria-label="处理备注" maxlength="300" placeholder="补充处理情况" value="${esc(feedback?.note || '')}"></div><button data-radar="feedback-${task.incidentId}" class="radar-mini-btn">保存处理记录</button>${feedback ? `<p>${statuses[feedback.status]} · ${feedback.updatedAt.slice(5,16).replace('T',' ')}</p>` : ''}</div>`;
  }

  renderHistory() {
    return `<p class="radar-eyebrow">动燃健身旗舰店</p><h1>历史巡检日报</h1><p class="radar-sub">查看每天的变化与处理进展。</p>${dates.map(date => {
      const report = this.persistedReport(date)?.report || buildRadarReport(date, { scenario: this.scenario, domains: this.memory.config.domains, feedback: this.memory.feedbackAt(date), policy: this.memory.governance.policy, version: this.memory.governance.version });
      const traffic = report.metrics?.traffic;
      return `<button class="radar-history-item" data-radar="history-${date}"><span>${date}</span><strong>${traffic?.actual == null ? '已更新经营数据' : `店铺访客 ${num(traffic.actual)} 人`}</strong><small>已覆盖 ${report.completeness || '0/4'} 项 · ${traffic?.expected == null ? '查看当日已更新数据' : `参考预期 ${num(traffic.expected)} 人`} · ${report.alerts?.length ? `${report.alerts.length} 项需关注` : '已更新指标未触发异常'}</small><b>查看日报 →</b></button>`;
    }).join('')}`;
  }

  renderRun() {
    const run = this.activeRun;
    if (!run) return '<h1>暂无更新任务</h1>';
    const groups = [['更新经营数据',6],['核对指标变化',7],['整理日报与建议',9],['完成更新',11]];
    return `<p class="radar-eyebrow">${this.date} · 经营巡检</p><h1>${this.statusLabel(run.status)}</h1><p class="radar-sub">正在核对流量、用户、交易和搜索表现。</p><ol class="radar-steps">${groups.map(([label,end],i) => `<li class="${run.stepIndex >= end ? 'done' : run.status === 'running' && (i === 0 || run.stepIndex >= groups[i-1][1]) ? 'active' : ''}"><span>${run.stepIndex >= end ? '✓' : i+1}</span><div><strong>${label}</strong><small>${run.stepIndex >= end ? '已完成' : '待完成'}</small></div></li>`).join('')}</ol>${run.report ? `<p class="radar-sub">${esc(run.report.summary)}</p>${btn('查看日报','page-report')}` : run.status === 'running' ? btn('取消更新','interrupt-run',true) : `<p class="radar-sub">${run.status === 'interrupted' ? '更新已取消，已有日报仍可查看。' : '本次更新暂未完成，请稍后重试。'}</p>${btn('返回日报','page-report',true)}`}`;
  }

  statusLabel(status) { return { scheduled_mock: '等待更新', running: '正在更新日报…', completed: '日报已更新', partial: '部分数据已更新', failed: '日报更新未完成', interrupted: '已取消更新' }[status] || '尚未更新'; }

  saveSettings(patch) {
    try {
      const enabled = this.memory.config.enabled;
      this.memory.saveConfig(enableRadarSkill(saveRadarSkill(editRadarSkill(this.memory.config, patch))));
      this.notice = enabled ? '巡检设置已保存' : '每日巡检已开启'; this.onRender(); return true;
    } catch (error) { this.notice = error.message.replace('Skill 名称','巡检名称'); this.onRender(); return false; }
  }

  startRun() {
    if (this.activeRun?.status === 'running') return;
    this.activeRun = new RadarRun({ ...this.memory.config, version: this.memory.governance.version, saved: true }, this.date, this.scenario, { feedback: this.memory.feedbackAt(this.date), policy: this.memory.governance.policy, version: this.memory.governance.version });
    this.activeRun.start(); this.open('run'); this.tick();
  }

  tick() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const run = this.activeRun;
      if (!run || run.status !== 'running') return;
      run.advance();
      if (run.status === 'running') this.tick(); else this.finishRun();
      this.onRender();
    }, 320);
  }

  finishRun() {
    if (!this.activeRun) return;
    this.memory.addRun(this.activeRun.snapshot(), { rerun: this.memory.runs.some(item => item.key === this.activeRun.key) });
    if (['completed','partial'].includes(this.activeRun.status)) { this.page = 'report'; this.restoreScroll = 0; this.notice = this.activeRun.status === 'partial' ? '日报已更新，部分数据待补充' : '日报已更新'; }
  }

  handle(action, root, element) {
    this.notice = '';
    if (action === 'toggle-calendar') { this.calendarOpen = !this.calendarOpen; this.onRender(); return true; }
    if (action.startsWith('calendar-')) { this.selectDate(action.slice(9)); return true; }
    if (action.startsWith('page-')) { this.open(action.slice(5)); return true; }
    if (action.startsWith('history-')) { this.selectDate(action.slice(8)); return true; }
    if (action.startsWith('metric-')) { this.selectMetric(action.slice(7)); return true; }
    if (action.startsWith('alert-')) { this.selectAlert(action.slice(6)); return true; }
    if (action === 'save-settings') {
      this.saveSettings({ domains: [...root.querySelectorAll('[name="radar-domain"]:checked')].map(input => input.value), frequency: root.querySelector('[name="radar-frequency"]').value, hour: Number(root.querySelector('[name="radar-hour"]').value), notification: root.querySelector('[name="radar-notification"]').value }); return true;
    }
    if (action === 'enable-default') { if (this.saveSettings({})) this.startRun(); return true; }
    if (action === 'pause-inspection') { this.memory.saveConfig({ ...this.memory.config, enabled: false }); this.notice = '每日巡检已暂停'; }
    else if (action === 'export-report') {
      const url = URL.createObjectURL(new Blob([createReportHtml(this.reportsForExport(), this.memory.feedbackHistory, { selectedDate: this.date })], { type: 'text/html;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `经营巡检日报-${this.date}.html`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return true;
    }
    else if (action.startsWith('focus-')) { this.memory.toggleFocus(action.slice(6)); this.notice = '专项关注已更新'; }
    else if (action === 'refresh-report') { this.startRun(); return true; }
    else if (action === 'interrupt-run') { clearTimeout(this.timer); this.activeRun?.interrupt(); this.finishRun(); }
    else if (action === 'continue-diagnosis') {
      if (this.date === '2026-11-14') {
        const report = this.report.data, alert = report.alerts.find(item => element.dataset.alertId?.startsWith(item.incidentId));
        this.onContinueDiagnosis({ date: this.date, reportId: report.reportId, alertId: element.dataset.alertId || 'INC-UV-GAP', metricId: 'SHOP_UV_001', metricVersion: report.metrics.traffic.evidence.version,
          evidenceIds: [alert?.evidence.id || report.metrics.traffic.evidence.id], route: this.captureRoute(), question: alert?.kind === 'paid' ? '付费渠道流量低于参考预期，应该先检查什么？' : '大促后流量掉了，是正常回落还是有问题？' });
      } return true;
    } else if (action.startsWith('feedback-')) {
      const id = action.slice(9), alert = this.report.data.alerts.find(item => item.incidentId === id);
      recordActionFeedback(this.memory, { incidentId: id, status: root.querySelector(`[data-task-status="${id}"]`).value, note: root.querySelector(`[data-task-note="${id}"]`).value, gap: alert?.gap || this.report.data.tasks.find(item => item.incidentId === id)?.gap || 0 }, { shopId: this.memory.config.shopId, at: `${this.report.data.simulatedRunAt.slice(0,10)}T09:00:00+08:00`, reportDate: this.date });
      this.notice = '处理记录已保存';
    } else return false;
    this.onRender(); return true;
  }
}
