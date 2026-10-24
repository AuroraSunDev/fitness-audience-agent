import { buildRadarReport, shouldSuppressRecommendation } from './radar-rules.mjs';
import { RADAR_DOMAINS } from './radar-data.mjs';
import { editRadarSkill, enableRadarSkill, makeRunKey, nextMockRun, radarRunSteps, RadarRun, saveRadarSkill } from './radar-runtime.mjs';
import { RadarMemory } from './radar-memory.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const num = value => Number(value).toLocaleString('zh-CN');
const percent = ratio => `${Number((ratio * 100).toFixed(1))}%`;
const domains = { traffic: '流量', audience: '用户', transaction: '交易', ranking: '排名' };
const statuses = { pending: '待处理', done: '已处理', deferred: '暂缓', not_applicable: '不适用' };
const dates = ['2026-11-14', '2026-11-15', '2026-11-16'];
const btn = (label, action, secondary = false, attrs = '') => `<button class="radar-btn ${secondary ? 'is-secondary' : ''}" data-radar="${action}" ${attrs}>${label}</button>`;
const line = (label, value) => `<div class="radar-line"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;

export class RadarUI {
  constructor(storage, onRender, onContinueDiagnosis) {
    this.memory = new RadarMemory(storage);
    this.onRender = onRender;
    this.onContinueDiagnosis = onContinueDiagnosis;
    this.page = 'home';
    this.date = '2026-11-14';
    this.scenario = 'normal';
    this.selectedMetric = 'traffic';
    this.selectedAlert = null;
    this.notice = this.memory.migrationNotice;
    this.activeRun = null;
    this.timer = null;
    this.confirmClear = false;
    this.rerun = false;
  }

  open(page) { this.page = page; this.onRender(); }
  selectDate(date) { if (dates.includes(date)) { this.date = date; this.selectedAlert = null; this.selectedMetric = 'traffic'; this.onRender(); } }
  selectMetric(metric) { if (RADAR_DOMAINS.includes(metric)) { this.selectedMetric = metric; this.selectedAlert = null; this.onRender(); } }
  selectAlert(id) { this.selectedAlert = id; this.onRender(); }
  get report() {
    if (this.scenario === 'timeout' || this.scenario === 'unauthorized') return {
      data: { status: 'unavailable', reason: this.scenario === 'timeout' ? '模拟超时：没有完整日报；请查看本机执行 Trace 后显式重跑。' : '模拟无权限：请求已拒绝并记录审计，不生成日报。' }, run: null
    };
    const currentKey = makeRunKey(this.memory.config, this.date);
    const persisted = this.memory.runs.find(item => item.key === currentKey && item.scenario === this.scenario && ['completed', 'partial'].includes(item.status));
    const data = persisted?.report || buildRadarReport(this.date, { scenario: this.scenario, domains: this.memory.config.domains, feedback: this.memory.feedback });
    const tasks = data.tasks?.filter(task => !this.memory.feedback.some(item => shouldSuppressRecommendation(item, { incidentId: task.incidentId, gap: task.gap }, this.date)));
    return { data: tasks ? { ...data, tasks } : data, run: persisted };
  }

  render() {
    const pages = { home: () => this.renderHome(), skill: () => this.renderSkill(), run: () => this.renderRun(), report: () => this.renderReport(), history: () => this.renderHistory(), governance: () => this.renderGovernance() };
    return `<section class="radar-screen" data-screen="radar"><div class="radar-kicker">商策 / 每日经营巡检 <span>教学 Mock</span></div>
      ${this.notice ? `<p class="radar-notice" role="status">${esc(this.notice)}</p>` : ''}
      ${(pages[this.page] || pages.home)()}
      <nav class="radar-bottom-nav" aria-label="每日巡检导航">
        ${[['home', '总览'], ['skill', 'Skill'], ['history', '历史'], ['governance', '治理']].map(([id, label]) => `<button data-radar="page-${id}" class="${this.page === id ? 'active' : ''}">${label}</button>`).join('')}
      </nav></section>`;
  }

  renderHome() {
    const config = this.memory.config;
    const latest = this.memory.runs[0];
    return `<div class="radar-hero"><p>店长的早间经营清单</p><h1>每天先看重要变化，<br><span>再决定怎么处理。</span></h1><div class="radar-hero-foot">一店 · 四维 · 一项只读 Skill</div></div>
      <div class="radar-disclaimer">固定教学模拟时钟：2026-11-15 09:00 Asia/Shanghai。关闭浏览器不会继续运行；不会推送真实通知。</div>
      <div class="radar-section-head"><h2>每日经营巡检</h2><button data-radar="page-skill">配置 Skill →</button></div>
      <div class="radar-panel"><div class="radar-panel-top"><strong>${esc(config.name)}</strong><span class="radar-pill">${config.enabled ? '模拟订阅已开' : config.saved ? '已保存 · 未启用' : '草稿 · 未启用'}</span></div>
        <p>监控 ${config.domains.map(id => domains[id]).join(' / ')} · 只读 · ${config.frequency === 'daily' ? '每日' : '每周六'} ${String(config.hour).padStart(2, '0')}:00</p>
        <small>下次模拟时间：${config.enabled ? esc(nextMockRun(config)) : '未启用，无后台计划'}</small></div>
      <div class="radar-section-head"><h2>选择演示日报</h2><span>预载数据 ≠ 已执行</span></div>
      <div class="radar-date-row">${dates.map(date => `<button data-radar="date-${date}" class="${this.date === date ? 'active' : ''}">${date.slice(5)}</button>`).join('')}</div>
      <label class="radar-label">模拟场景<select name="radar-scenario" aria-label="每日巡检演示场景">
        ${[['normal','正常数据'],['missing-data','用户数据缺失'],['metric-conflict','UV 口径冲突'],['rank-incomparable','排名不可比'],['timeout','模拟超时'],['unauthorized','模拟无权限']].map(([id, label]) => `<option value="${id}" ${this.scenario === id ? 'selected' : ''}>${label}</option>`).join('')}
      </select></label>
      <div class="radar-actions">${btn('手动模拟执行', 'run-manual')}${btn('查看预载日报', 'page-report', true)}</div>
      <button class="radar-text-link" data-radar="run-due">模拟到点执行（需先启用 Skill）</button>
      ${this.memory.runs.some(item => item.key === makeRunKey(config, this.date)) ? `<button class="radar-text-link" data-radar="run-rerun">显式重跑同一日期（覆盖本机结果，不重复提醒）</button>` : ''}
      <div class="radar-section-head"><h2>最近本机记录</h2><button data-radar="page-history">查看历史 →</button></div>
      <div class="radar-panel"><p>${latest ? `${latest.date} · ${this.statusLabel(latest.status)} · ${latest.scenario} · ${latest.trace?.length || 0} 步 Trace` : '尚未模拟执行。可先查看预载日报，再手动运行。'}</p></div>`;
  }

  renderSkill() {
    const c = this.memory.config;
    return `<p class="radar-eyebrow">SKILL · 1.0.0</p><h1>一项 Skill，巡检四类经营变化。</h1><p class="radar-sub">配置仅保存在本机。扩展旧 S8 监控范围后，必须重新保存才能开启模拟订阅。</p>
      <div class="radar-panel radar-form">
        <label class="radar-label">Skill 名称<input name="radar-name" maxlength="36" value="${esc(c.name)}"></label>
        ${line('适用店铺', '动燃健身旗舰店 · demo-fitness-001')}
        <fieldset><legend>监控维度 · 至少选择一项</legend>${RADAR_DOMAINS.map(id => `<label class="radar-check"><input type="checkbox" name="radar-domain" value="${id}" ${c.domains.includes(id) ? 'checked' : ''}> ${domains[id]}</label>`).join('')}</fieldset>
        <div class="radar-form-grid"><label class="radar-label">频率<select name="radar-frequency"><option value="daily" ${c.frequency === 'daily' ? 'selected' : ''}>每日</option><option value="weekly" ${c.frequency === 'weekly' ? 'selected' : ''}>每周六</option></select></label>
          <label class="radar-label">固定小时<select name="radar-hour">${[8,9,10].map(hour => `<option value="${hour}" ${c.hour === hour ? 'selected' : ''}>${String(hour).padStart(2, '0')}:00</option>`).join('')}</select></label></div>
        <label class="radar-label">通知策略<select name="radar-notification"><option value="important_only" ${c.notification === 'important_only' ? 'selected' : ''}>仅重要异常（模拟）</option><option value="every_run" ${c.notification === 'every_run' ? 'selected' : ''}>每次巡检（模拟）</option><option value="none" ${c.notification === 'none' ? 'selected' : ''}>仅本机记录</option></select></label>
        ${line('权限', '当前演示店铺 · 只读；不能自动调预算')}
        ${line('状态', c.enabled ? '模拟订阅已启用' : c.saved ? '已保存，未启用' : '待保存/重新确认')}
        ${btn(c.saved ? '更新并重新确认 Skill' : '保存 Skill 配置', 'save-skill')}
        ${btn(c.enabled ? '暂停模拟订阅' : '开启模拟订阅', 'toggle-skill', true, c.saved ? '' : 'disabled')}
      </div>
      <div class="radar-panel radar-muted"><strong>模拟执行契约</strong><p>固定时区 Asia/Shanghai；只读查询 → 规则判断 → 证据 → 报告 → 本机日志/模拟提醒。缺数给部分报告，冲突待人工确认，失败不伪装成功。</p><small>这是课程 Skill 契约，不是已部署的 Hermes 或真实定时服务。</small></div>`;
  }

  renderRun() {
    const run = this.activeRun;
    if (!run) return `<h1>暂无执行记录</h1>${btn('返回总览', 'page-home')}`;
    return `<p class="radar-eyebrow">MOCK RUN · ${esc(run.date)}</p><h1>${this.statusLabel(run.status)}</h1><p class="radar-sub">${run.mode === 'due' ? '模拟到点触发' : run.rerun ? '显式重跑' : '手动模拟触发'} · ${esc(run.key)}。每步耗时均为模拟。</p>
      <ol class="radar-steps">${radarRunSteps.map((step, i) => {
        const trace = run.trace[i];
        return `<li class="${trace?.status === 'success' ? 'done' : trace ? 'failed' : i === run.stepIndex && run.status === 'running' ? 'active' : ''}"><span>${trace?.status === 'success' ? '✓' : i + 1}</span><div><strong>${step.label}</strong><small>${trace ? `${trace.status} · ${trace.mockLatencyMs} ms · ${trace.metricVersion}${trace.errorCode ? ` · ${trace.errorCode}` : ''}` : '尚未执行'}</small></div></li>`;
      }).join('')}</ol>
      <div class="radar-panel"><strong>阶段结果</strong><p>${run.report ? `${run.report.summary} 完整度 ${run.report.completeness}` : run.status === 'failed' ? '执行失败；只保留已完成 Trace，不生成完整日报。' : run.status === 'interrupted' ? '已中断；只保留阶段 Trace，未生成完整结论。' : '正在逐步核验，尚无完整结论。'}</p></div>
      <div class="radar-actions">${run.status === 'running' ? btn('中断模拟执行', 'interrupt-run', true) : run.report ? btn('打开交互日报', 'page-report') : btn('返回总览', 'page-home')}</div>`;
  }

  renderReport() {
    const { data: report, run } = this.report;
    if (report.status === 'unsupported' || report.status === 'unavailable') return `<h1>无可用日报</h1><p>${esc(report.reason)}</p>${btn('查看执行记录', 'page-history', true)}`;
    const metricCards = [
      ['traffic', '店铺 UV', report.metrics.traffic?.value, report.metrics.traffic?.gap != null ? `参考 ${num(report.metrics.traffic.expected)} · 缺口 ${num(report.metrics.traffic.gap)}` : report.metrics.traffic?.note],
      ['audience', '新访客', report.metrics.audience?.value, report.metrics.audience?.value == null ? '未覆盖 · 不判断' : `回访 ${num(report.metrics.audience.returningVisitors)} · 暂无可比基线`],
      ['transaction', '支付 GMV', report.metrics.transaction?.value, report.metrics.transaction?.value == null ? '未覆盖 · 不判断' : `买家 ${num(report.metrics.transaction.buyers)} · 暂无可比基线`],
      ['ranking', '搜索排名', report.metrics.ranking?.value, report.metrics.ranking?.value == null ? '未覆盖 · 不判断' : report.metrics.ranking.quality === 'incomparable' ? '采样不可比' : `第 ${report.metrics.ranking.previous} → ${report.metrics.ranking.value} 名`]
    ].filter(([id]) => report.selectedDomains.includes(id));
    return `<p class="radar-eyebrow">${esc(report.shopName)} · 经营巡检日报</p><h1>${report.date.slice(5)}，先看哪些变化值得处理？</h1>
      <div class="radar-scope"><span>数据日 ${report.date}</span><span>${run ? '本机已模拟执行' : '仅预载数据 · 未执行'}</span><span>完整度 ${report.completeness}</span><span>模拟时点 ${report.simulatedRunAt}</span></div>
      <div class="radar-summary"><span>一句话结论</span><p>${esc(report.summary)}</p></div>
      ${report.missing.length ? `<div class="radar-warning">未覆盖/待确认：${report.missing.map(esc).join('、')}。缺项不作推断。</div>` : ''}
      <div class="radar-section-head"><h2>四维经营指标</h2><span>点击看口径</span></div>
      <div class="radar-kpis">${metricCards.map(([id,label,value,hint]) => `<button class="radar-kpi ${this.selectedMetric === id ? 'active' : ''}" data-radar="metric-${id}"><span>${domains[id]} · ${label}</span><strong>${value == null ? '暂无数据' : `${id === 'transaction' ? '¥' : id === 'ranking' ? '第 ' : ''}${num(value)}${id === 'ranking' ? ' 名' : ''}`}</strong><small>${esc(hint)}</small></button>`).join('')}</div>
      ${this.renderMetricDetail(report)}
      <div class="radar-section-head"><h2>重要异常</h2><span>按影响与可行动性排序</span></div>
      ${report.alerts.length ? report.alerts.map((alert, index) => `<article class="radar-alert"><button data-radar="alert-${alert.incidentId}"><span class="radar-alert-rank">0${index + 1}</span><div><strong>${esc(alert.title)}</strong><small>${esc(alert.threshold)} · ${esc(alert.certainty)}</small></div><b>证据 →</b></button>${this.selectedAlert === alert.incidentId ? this.renderAlertDetail(alert, report) : ''}</article>`).join('') : `<div class="radar-panel radar-muted">当日没有命中已配置的确定性异常；缺失维度不代表正常。</div>`}
      <div class="radar-section-head"><h2>今日待办</h2><span>仅记录本机演示反馈</span></div>
      ${report.tasks.length ? report.tasks.map(task => this.renderTask(task)).join('') : `<div class="radar-panel radar-muted">没有新待办；已标记不适用的重复建议可能在 7 天内被抑制，但新重大异常仍提醒。</div>`}
      ${report.followup ? `<div class="radar-followup"><strong>关联事故 ${report.followup.incidentId} · 次日观察</strong><p>${report.followup.previousDate} 缺口 ${num(report.followup.previousGap)} → ${report.date} 缺口 ${num(report.followup.currentGap)}。</p><small>${report.followup.disclaimer}</small>${this.memory.feedback.find(row => row.incidentId === report.followup.incidentId) ? `<p>本机处理记录：${statuses[this.memory.feedback.find(row => row.incidentId === report.followup.incidentId).status]}</p>` : ''}</div>` : ''}
      <div class="radar-actions">${btn('切换历史日期', 'page-history', true)}${btn('查看执行日志', 'page-history', true)}</div>`;
  }

  renderMetricDetail(report) {
    const metric = report.metrics[this.selectedMetric];
    if (!metric) return '';
    const names = { traffic: '流量', audience: '用户', transaction: '交易', ranking: '排名' };
    const card = metric.evidence;
    return `<div class="radar-detail"><div class="radar-section-head"><h2>${names[this.selectedMetric]}详情与口径</h2><span>${esc(metric.quality)}</span></div>
      <p>${esc(metric.note)}</p>
      ${this.selectedMetric === 'traffic' && metric.gap != null ? `${line('店铺 UV / 参考预期', `${num(metric.actual)} / ${num(metric.expected)}`)}${line('额外缺口 / 分母', `${num(metric.gap)} / ${num(metric.expected)} = ${percent(metric.gapRatio)}`)}${metric.paid ? `${line('付费渠道实际 / 参考', `${num(metric.paid.actual)} / ${num(metric.paid.expected)}`)}${line('付费缺口 / 自身预期', `${num(metric.paid.gap)} / ${num(metric.paid.expected)} = ${percent(metric.paid.gapRatio)}`)}${line('付费占总缺口', `${num(metric.paid.gap)} / ${num(metric.gap)} = ${percent(metric.paid.contribution)}`)}` : ''}${metric.channels ? `<div class="radar-channel-list">${Object.entries(metric.channels).map(([id,row]) => `<div><span>${{paid:'付费',campaign:'活动',organic:'自然',returning_source:'老客来源'}[id]}</span><strong>${num(row.actual)} / ${num(row.expected)}</strong></div>`).join('')}</div>` : ''}` : ''}
      ${this.selectedMetric === 'audience' && metric.value != null ? `${line('新访客 + 回访访客', `${num(metric.newVisitors)} + ${num(metric.returningVisitors)} = ${num(metric.newVisitors + metric.returningVisitors)}`)}${line('对比基线', '暂无可比基线；不判构成异常')}` : ''}
      ${this.selectedMetric === 'transaction' && metric.value != null ? `${line('支付买家 / 订单', `${num(metric.buyers)} / ${num(metric.orders)}，教学设定一人一单`)}${line('买家转化率', `${num(metric.buyers)} / ${num(report.metrics.traffic.actual)} = ${percent(metric.conversion)}`)}${line('GMV 算式', `${num(metric.orders)} × ¥${num(metric.aov)} = ¥${num(metric.value)}`)}${line('对比基线', '暂无可比基线；不判交易异常')}` : ''}
      ${this.selectedMetric === 'ranking' && metric.value != null ? `${line('关键词', metric.keyword)}${line('排名比较', metric.delta == null ? '采样不可比，不计算变化' : `第 ${metric.previous} → ${metric.value} 名，下降 ${metric.delta} 位`)}` : ''}
      ${card ? `<details class="radar-evidence"><summary>展开指标证据 · ${card.metricId}@${card.version}</summary>${this.renderEvidence(card)}</details>` : `<div class="radar-warning">暂无当日指标证据，不推断。</div>`}
      ${this.selectedMetric === 'traffic' ? report.date === '2026-11-14' ? `<button class="radar-text-link" data-radar="continue-diagnosis">继续作业二 S2 流量诊断 →</button>` : `<p class="radar-unsupported">作业二诊断仅支持 11-14；不能用旧数据冒充 ${report.date}。</p>` : ''}
      </div>`;
  }

  renderEvidence(card) {
    const numerator = typeof card.numerator === 'number' ? num(card.numerator) : card.numerator;
    const denominator = typeof card.denominator === 'number' ? num(card.denominator) : card.denominator;
    return `${line('证据 ID', card.id)}${line('指标 ID / 口径版本', `${card.metricId} / ${card.version}`)}${line('定义', card.definition)}${line('分子 / 分母', `${numerator} / ${denominator}`)}${line('时间窗', card.timeWindow)}${line('数据源', card.source)}${line('数据血缘', card.lineage)}${line('模拟取数时间', card.fetchedAt)}${line('质量状态', card.qualityStatus)}${card.conditions ? line('采样条件', card.conditions) : ''}`;
  }

  renderAlertDetail(alert, report) {
    return `<div class="radar-alert-detail">${line('告警实例 / 事故', `${alert.alertInstanceId} / ${alert.incidentId}`)}${line('影响范围', alert.impact)}${line('变化 / 阈值', `${num(alert.gap)} · ${alert.threshold}`)}${line('不能确认', alert.exclusion)}<p><b>下一步：</b>${esc(alert.action)}</p><details open class="radar-evidence"><summary>证据卡 · ${alert.evidence.id}</summary>${this.renderEvidence(alert.evidence)}</details>
      ${alert.kind === 'paid' || alert.kind === 'traffic' ? report.date === '2026-11-14' ? `<button class="radar-text-link" data-radar="continue-diagnosis" data-alert-id="${alert.alertInstanceId}">带证据进入已有 S2 诊断 →</button>` : `<p class="radar-unsupported">作业二诊断仅支持 11-14；当前日期不可继续旧链路。</p>` : ''}</div>`;
  }

  renderTask(task) {
    const feedback = this.memory.feedback.find(item => item.incidentId === task.incidentId);
    return `<div class="radar-task"><strong>${esc(task.title)}</strong><small>关联 ${task.incidentId} · ${task.alertInstanceId}</small>
      <div class="radar-task-form"><select data-task-status="${task.incidentId}" aria-label="处理状态">${Object.entries(statuses).map(([id,label]) => `<option value="${id}" ${feedback?.status === id || !feedback && id === 'pending' ? 'selected' : ''}>${label}</option>`).join('')}</select><input data-task-note="${task.incidentId}" aria-label="处理备注" maxlength="300" placeholder="记录处理情况（Mock）" value="${esc(feedback?.note || '')}"></div>
      <button data-radar="feedback-${task.incidentId}" class="radar-mini-btn">保存处理反馈</button>${feedback ? `<p>本机记录：${statuses[feedback.status]} · ${feedback.updatedAt}${feedback.status === 'not_applicable' ? ' · 7 天抑制重复建议' : ''}</p>` : ''}</div>`;
  }

  renderHistory() {
    return `<p class="radar-eyebrow">本机历史 · 预载数据</p><h1>回看变化，不把观察写成因果。</h1><p class="radar-sub">只有本机模拟执行过的日期才标为“已执行”；预载日报只用于课程查看。</p>
      ${dates.map(date => {
        const report = buildRadarReport(date);
        const runs = this.memory.runs.filter(item => item.date === date);
        return `<button class="radar-history-item" data-radar="history-${date}"><span>${date}</span><strong>店铺 UV ${num(report.metrics.traffic.actual)} · 参考 ${num(report.metrics.traffic.expected)}</strong><small>${runs.length ? `${this.statusLabel(runs[0].status)} · ${runs.length} 条本机执行记录` : '仅预载数据 · 尚未模拟执行'}${report.followup ? ` · 关联 ${report.followup.incidentId}` : ''}</small></button>`;
      }).join('')}
      <div class="radar-section-head"><h2>本机执行日志</h2><span>${this.memory.runs.length} 条</span></div>
      ${this.memory.runs.length ? this.memory.runs.map(run => `<details class="radar-log"><summary>${run.date} · ${this.statusLabel(run.status)} · ${run.scenario}</summary><p>Run key：${esc(run.key)} · 完整度 ${run.report?.completeness || '未生成报告'}</p>${run.trace.map(row => `<div>${esc(row.step)} · ${esc(row.status)} · ${row.mockLatencyMs} ms · ${esc(row.metricVersion)} ${row.errorCode ? `· ${esc(row.errorCode)}` : ''}</div>`).join('')}<small>模拟通知 ${run.notifications.length} 条；不真实发送。</small></details>`).join('') : `<div class="radar-panel radar-muted">尚无执行日志。</div>`}
      <button class="radar-text-link" data-radar="clear-ask">清除本机作业三演示数据</button>
      ${this.confirmClear ? `<div class="radar-clear-dialog" role="dialog" aria-modal="true"><strong>二次确认</strong><p>只删除本机作业三 Skill、巡检历史与反馈。原作业二数据不会删除。</p>${btn('确认清除', 'clear-confirm')}${btn('取消', 'clear-cancel', true)}</div>` : ''}`;
  }

  renderGovernance() {
    const g = this.memory.governance;
    const proposal = g.proposals[0];
    return `<p class="radar-eyebrow">高级 / 教师演示</p><h1>反馈能改进体验，不能自动改规则。</h1><p class="radar-sub">手动触发的 Mock 治理工作流；不是运行中的自进化 AI。</p>
      <div class="radar-panel"><strong>当前演示版本 ${esc(g.version)}</strong><p>允许提案：话术、排序说明、FAQ；禁止自动改指标口径、阈值、权限、预算、评测标准。</p>${line('已批准发布', `${g.published.length} 次（仅本机模拟）`)}</div>
      <div class="radar-panel radar-form"><h2>1 / 根据商家反馈形成待审提案</h2><p>示例反馈：同一异常重复提醒，商家标记为“不适用”。</p>
        <label class="radar-label">改进范围<select name="radar-proposal-kind"><option value="wording">减少重复提醒的话术</option><option value="sort">告警排序说明</option><option value="faq">FAQ 解释模板</option></select></label>
        <label class="radar-label">待审描述<input name="radar-proposal-text" value="对已反馈的不适用建议，文案提示 7 天去重规则"></label>${btn('生成待审提案（Mock）', 'proposal-create')}</div>
      ${proposal ? `<div class="radar-panel"><h2>2 / 影子比较与人审</h2>${line('提案', `${proposal.id} · ${proposal.kind} · ${proposal.description}`)}${line('状态', proposal.status)}${proposal.shadow ? `<p>模拟影子比较：${proposal.shadow.before} → ${proposal.shadow.after}；指标和规则未变。未自动发布。</p>` : '<p>尚未进行影子比较；无法批准。</p>'}
        <div class="radar-actions">${btn('模拟影子比较', 'proposal-shadow', true, proposal.status === 'pending_shadow' ? '' : 'disabled')}${btn('人工批准（Mock）', 'proposal-approve', false, proposal.status === 'pending_review' ? '' : 'disabled')}${btn('人工拒绝', 'proposal-reject', true, proposal.status === 'pending_review' ? '' : 'disabled')}</div></div>` : ''}
      <div class="radar-panel"><h2>3 / 版本与回滚</h2><p>发布记录：${g.published.map(item => `${item.version} (${item.proposalId})`).join('、') || '尚无'}</p>${btn('人工回滚到上一审批版（Mock）', 'proposal-rollback', true, g.previousVersion ? '' : 'disabled')}</div>
      <details class="radar-log"><summary>查看模拟审计记录 · ${this.memory.audit.length} 条</summary>${this.memory.audit.map(item => `<div>${esc(item.updatedAt)} · ${esc(item.action)} · ${esc(item.details)}</div>`).join('') || '<p>暂无</p>'}</details>`;
  }

  statusLabel(status) { return { scheduled_mock: '待模拟执行', running: '巡检中', completed: '已完成（Mock）', partial: '部分报告（Mock）', failed: '失败（Mock）', interrupted: '已中断（Mock）' }[status] || '未开始'; }

  updateDraft(root) {
    const name = root.querySelector('[name="radar-name"]')?.value.trim() || '';
    const selected = [...root.querySelectorAll('[name="radar-domain"]:checked')].map(input => input.value);
    const patch = { name, domains: selected, frequency: root.querySelector('[name="radar-frequency"]')?.value, hour: Number(root.querySelector('[name="radar-hour"]')?.value), notification: root.querySelector('[name="radar-notification"]')?.value };
    const current = this.memory.config;
    if (JSON.stringify([current.name,current.domains,current.frequency,current.hour,current.notification]) === JSON.stringify([patch.name,patch.domains,patch.frequency,patch.hour,patch.notification])) return true;
    try { this.memory.saveConfig(editRadarSkill(current, patch)); this.notice = '配置已修改，旧模拟订阅已失效；请重新保存确认。'; return true; }
    catch (error) { this.notice = error.message; return false; }
  }

  onChange(target, root) {
    if (target.name === 'radar-scenario') { this.scenario = target.value; this.notice = `已选择 ${target.selectedOptions[0].textContent} 教学场景。`; this.onRender(); return true; }
    if (this.page === 'skill' && target.closest('.radar-form')) { this.updateDraft(root); this.onRender(); return true; }
    return false;
  }

  startRun(mode = 'manual', rerun = false) {
    const config = this.memory.config;
    if (!config.saved) { this.notice = '请先保存 Skill 配置，再模拟执行。'; this.onRender(); return; }
    if (mode === 'due' && !config.enabled) { this.notice = '模拟到点执行需要先开启订阅；不会在后台自动唤醒。'; this.onRender(); return; }
    if (mode === 'due' && (this.date !== '2026-11-14' || config.frequency !== 'daily' || Number(config.hour) !== 9)) {
      this.notice = '固定模拟时钟 2026-11-15 09:00 仅对应 11-14 日报与每日 09:00 配置；请选择手动模拟运行或调整配置。';
      this.onRender(); return;
    }
    const key = makeRunKey(config, this.date);
    const existing = this.memory.runs.find(item => item.key === key);
    if (existing && !rerun) {
      this.notice = `相同运行键已去重：复用 ${existing.date} 本机结果；没有再次产生模拟通知。可选择“显式重跑”。`;
      this.page = existing.report ? 'report' : 'history'; this.onRender(); return;
    }
    const runConfig = this.scenario === 'unauthorized' ? { ...config, shopId: 'unauthorized-demo-shop' } : config;
    this.activeRun = new RadarRun(runConfig, this.date, this.scenario);
    this.activeRun.mode = mode; this.activeRun.rerun = rerun;
    this.rerun = rerun;
    this.activeRun.start(); this.page = 'run'; this.notice = '仅模拟运行；时间、数据与工具 Trace 均为课程演示。';
    this.onRender(); this.tick();
  }

  tick() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const run = this.activeRun;
      if (!run || run.status !== 'running') return;
      run.advance();
      if (run.status === 'running') this.tick();
      else this.finishRun();
      this.onRender();
    }, 420);
  }

  finishRun() {
    if (!this.activeRun) return;
    const snapshot = this.activeRun.snapshot();
    if (this.rerun) snapshot.notifications = [];
    this.memory.addRun(snapshot, { rerun: this.rerun });
    if (this.activeRun.status === 'failed' && this.activeRun.trace[0]?.errorCode === 'MOCK_UNAUTHORIZED') this.memory.addAudit('unauthorized_denied', '模拟越权店铺请求被拒绝');
  }

  handle(action, root, element) {
    this.notice = '';
    if (action.startsWith('page-')) this.page = action.slice(5);
    else if (action.startsWith('date-')) this.selectDate(action.slice(5));
    else if (action.startsWith('history-')) { this.selectDate(action.slice(8)); this.page = 'report'; }
    else if (action.startsWith('metric-')) this.selectMetric(action.slice(7));
    else if (action.startsWith('alert-')) this.selectAlert(action.slice(6));
    else if (action === 'save-skill') {
      if (this.updateDraft(root)) {
        try { this.memory.saveConfig(saveRadarSkill(this.memory.config)); this.notice = 'Skill 已保存到本机；可选择开启模拟订阅。'; }
        catch (error) { this.notice = error.message; }
      }
    } else if (action === 'toggle-skill') {
      try {
        this.memory.saveConfig(this.memory.config.enabled ? { ...this.memory.config, enabled: false } : enableRadarSkill(this.memory.config));
        this.notice = this.memory.config.enabled ? '模拟订阅已开启；浏览器关闭后不会继续运行。' : '模拟订阅已暂停。';
      } catch (error) { this.notice = error.message; }
    } else if (action === 'run-manual') { this.startRun(); return true; }
    else if (action === 'run-due') { this.startRun('due'); return true; }
    else if (action === 'run-rerun') { this.startRun('manual', true); return true; }
    else if (action === 'interrupt-run') { clearTimeout(this.timer); this.activeRun?.interrupt(); this.finishRun(); }
    else if (action === 'continue-diagnosis') {
      if (this.date !== '2026-11-14') this.notice = '作业二诊断仅支持 11-14，不会复用旧日期数据。';
      else { this.onContinueDiagnosis({ date: this.date, alertId: element.dataset.alertId || 'INC-UV-GAP', metricId: 'SHOP_UV_001' }); return true; }
    } else if (action.startsWith('feedback-')) {
      const id = action.slice(9);
      const status = root.querySelector(`[data-task-status="${id}"]`)?.value || 'pending';
      const note = root.querySelector(`[data-task-note="${id}"]`)?.value || '';
      const alert = this.report.data.alerts.find(item => item.incidentId === id);
      this.memory.setFeedback(id, status, note, `${this.report.data.simulatedRunAt.slice(0,10)}T09:00:00+08:00`, alert?.gap || 0);
      this.notice = '处理反馈已保存到本机；改善仅作后续观察，不归因于该动作。';
    } else if (action === 'proposal-create') {
      const kind = root.querySelector('[name="radar-proposal-kind"]')?.value || 'wording';
      const description = root.querySelector('[name="radar-proposal-text"]')?.value.trim() || '减少重复提醒';
      try { this.memory.propose(kind, description); this.notice = '已形成待审提案；尚未影子比较或发布。'; } catch (error) { this.notice = error.message; }
    } else if (action === 'proposal-shadow') { this.memory.shadowCompare(this.memory.governance.proposals[0]?.id); this.notice = '模拟影子比较已完成；待人工审核。'; }
    else if (action === 'proposal-approve' || action === 'proposal-reject') { this.memory.review(this.memory.governance.proposals[0]?.id, action === 'proposal-approve' ? 'approve' : 'reject'); this.notice = '人工审核结果已记入本机 Mock 版本记录。'; }
    else if (action === 'proposal-rollback') { this.memory.rollback(); this.notice = '已模拟回滚到上一审批版本。'; }
    else if (action === 'clear-ask') this.confirmClear = true;
    else if (action === 'clear-cancel') this.confirmClear = false;
    else if (action === 'clear-confirm') { this.memory.clear(true); this.confirmClear = false; this.notice = '仅作业三本机演示数据已清除；作业二本机状态保留。'; }
    else return false;
    this.onRender(); return true;
  }
}
