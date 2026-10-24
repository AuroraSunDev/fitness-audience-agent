import { analyzeTraffic, buildEvidence, defaultPlan, getFixture, getSuggestedQuestions, metricDefinitions, validatePlan } from './data.mjs';
import { ApprovalFlow, DiagnosticTask, steps } from './engine.mjs';
import { RadarUI } from './radar-ui.mjs';

const root = document.getElementById('app');
const number = value => Number(value).toLocaleString('zh-CN');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const state = {
  section: 'diagnosis', screen: 's1', scenario: 'normal', question: '', plan: { ...defaultPlan },
  editingPlan: false, notice: '', task: null, approval: new ApprovalFlow(),
  handoff: null, sourceAlertId: null
};
let tickTimer = null;
let lastRenderedScreen = null;
const radar = new RadarUI(localStorage, render, source => {
  state.section = 'diagnosis'; state.screen = 's2'; state.plan = { ...defaultPlan, date: source.date, metricId: source.metricId };
  state.sourceAlertId = source.alertId;
  state.notice = '已带入巡检发现的流量异常，请确认查询范围。';
  state.scenario = 'normal';
  state.editingPlan = false;
  render();
});

function icon(name) {
  const paths = {
    back: '<path d="m15 18-6-6 6-6"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    chart: '<path d="M4 19V9m6 10V5m6 14v-7m4 7V3"/>',
    file: '<path d="M6 3h9l4 4v14H6zM15 3v5h4M9 12h7m-7 4h7"/>',
    shield: '<path d="m12 2 8 4v6c0 5-3 8-8 10-5-2-8-5-8-10V6z"/>'
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.info}</svg>`;
}

function chrome(title, back = false) {
  return `<header class="topbar"><div class="topbar-left">${back ? `<button class="icon-button" data-action="back" aria-label="返回上一页">${icon('back')}</button>` : '<span class="brand-mark"></span>'}<strong>${esc(title)}</strong></div><span class="topbar-right">经营工作台</span></header>`;
}

function scopeLine() {
  return `<div class="scope-line">${icon('shield')} ${esc(state.plan.shop)} <span>·</span> ${esc(state.plan.date)}</div>`;
}

function footer(actions) { return `<div class="sticky-actions">${actions}</div>`; }
function button(label, action, secondary = false, extra = '') { return `<button class="btn ${secondary ? 'btn-secondary' : 'btn-primary'}" data-action="${action}" ${extra}>${label}</button>`; }
function tracePanel() {
  if (!state.task) return '';
  const names = { get_metric_def: '核对指标口径', query_metric: '查询店铺数据', drill_dimension: '查看渠道变化', run_attribution: '计算渠道缺口', get_evidence_card: '核对数据来源', propose_action: '整理处理建议' };
  return `<details class="trace-panel"><summary>查看分析记录</summary><div class="trace-list">${state.task.trace.map(row => `<div class="trace-row"><b>${names[row.tool] || '核对经营数据'}</b><span>${row.status === 'success' ? '已完成' : '待确认'} · ${esc(row.metricVersion)}</span></div>`).join('') || '<p>分析尚未开始。</p>'}</div></details>`;
}

function renderS1() {
  const fixture = getFixture(state.scenario);
  const questions = getSuggestedQuestions(fixture);
  return `<section data-screen="s1" class="screen screen-entry">
    <div class="intro-spacer"></div><p class="shop-kicker">${esc(fixture.shop)} · 店长视角</p>
    <h1>大促后流量掉了，<br>先看清原因。</h1>
    <p class="lead">11.11 后第 3 天，${state.scenario === 'metric-conflict' ? '两个来源的店铺 UV 数值不一致，先确认口径后再判断降幅。' : `店铺访客从峰值 ${number(fixture.peak)} 降至 ${number(fixture.actual)}。先分清正常回落与需要排查的缺口。`}</p>
    <div class="entry-signal"><div><span>11.11 峰值 UV</span><strong>${number(fixture.peak)}</strong></div><span class="signal-arrow">→</span><div><span>11.14 店铺 UV${state.scenario === 'metric-conflict' ? '（待核）' : ''}</span><strong class="red">${state.scenario === 'metric-conflict' ? `${number(fixture.actual)} / ${number(fixture.conflictingActual)}` : number(fixture.actual)}</strong></div><em>${state.scenario === 'metric-conflict' ? '口径冲突' : '较峰值 -40%'}</em></div>
    <h2 class="section-title">结合当前店铺数据，建议这样问</h2>
    <div class="question-list">${questions.map((question, i) => `<button class="question-row" data-action="question-${i}"><span class="question-index">0${i + 1}</span><span>${esc(question)}</span>${icon('chevron')}</button>`).join('')}</div>
    <p class="footnote">先确认流量变化，再查看渠道与处理建议。</p>
  </section>`;
}

function planRow(label, value, hint = '') { return `<div class="plan-row"><span>${label}</span><strong>${value}</strong>${hint ? `<small>${hint}</small>` : ''}</div>`; }
function renderS2() {
  const editing = state.editingPlan;
  const plan = state.plan;
  return `<section data-screen="s2" class="screen">
    <p class="step-label">01 / 查询计划</p><h1>先确认，我准备查什么</h1><p class="sublead">执行前可修改支持的条件；不支持的数据不会沿用旧结果。</p>
    ${scopeLine()}
    ${state.sourceAlertId ? '<p class="inline-note">来自每日巡检发现的访客异常；可从顶部返回日报。</p>' : ''}
    <div class="section-head"><h2>本次查询计划</h2><button class="text-button" data-action="edit-plan">${editing ? '完成修改' : '修改计划'}</button></div>
    <div class="plan-list">
      ${planRow('分析指标', editing ? `<select name="metricId" aria-label="分析指标"><option value="SHOP_UV_001" ${plan.metricId === 'SHOP_UV_001' ? 'selected' : ''}>店铺去重访客 UV</option><option value="PRODUCT_DETAIL_UV_002" ${plan.metricId === 'PRODUCT_DETAIL_UV_002' ? 'selected' : ''}>商品详情页 UV</option></select>` : esc(metricDefinitions[plan.metricId]?.name || plan.metricId), '指标 ID：' + esc(plan.metricId))}
      ${planRow('分析日期', editing ? `<select name="date" aria-label="分析日期"><option value="2026-11-14" ${plan.date === '2026-11-14' ? 'selected' : ''}>2026-11-14</option><option value="2026-11-13" ${plan.date === '2026-11-13' ? 'selected' : ''}>2026-11-13（无数据）</option></select>` : esc(plan.date), '北京时间自然日')}
      ${planRow('峰值对比', '2026-11-11', '11.11 当日店铺 UV')}
      ${planRow('参考基线', '历史相似活动预期', '用于区分大促正常回落与额外缺口')}
      ${planRow('下钻维度', editing ? `<select name="dimension" aria-label="下钻维度"><option value="primary_source" ${plan.dimension === 'primary_source' ? 'selected' : ''}>全部主来源渠道</option><option value="paid_only" ${plan.dimension === 'paid_only' ? 'selected' : ''}>仅付费广告</option><option value="sku" ${plan.dimension === 'sku' ? 'selected' : ''}>SKU（无数据）</option></select>` : plan.dimension === 'paid_only' ? '仅付费广告' : '全部主来源渠道', '付费广告 / 自然 / 活动 / 老客；互斥归属')}
      ${planRow('执行权限', '只读查询', '不会改动广告预算或商品')}
    </div>
    ${state.notice ? `<p class="inline-error" role="alert">${esc(state.notice)}</p>` : ''}
    ${footer(button('确认开始分析 ' + icon('arrow'), 'confirm-plan'))}
  </section>`;
}

function renderS3() {
  const task = state.task;
  return `<section data-screen="s3" class="screen">
    <p class="step-label">02 / 执行过程</p><h1>${task.status === 'interrupted' ? '分析已中断' : '正在执行诊断…'}</h1>
    <p class="sublead">正在核对访客变化、主要来源与参考基线。</p>
    ${scopeLine()}
    <ol class="progress-list">${steps.map((name, index) => {
      const status = index < task.stepIndex ? 'done' : index === task.stepIndex && task.status === 'running' ? 'active' : index === task.stepIndex && task.status === 'interrupted' ? 'paused' : 'waiting';
      return `<li class="progress-step ${status}"><span class="progress-node">${status === 'done' ? icon('check') : index + 1}</span><div><strong>${esc(name)}</strong><small>${status === 'done' ? '已完成' : status === 'active' ? '执行中…' : status === 'paused' ? '已中断，等待继续' : '未开始'}</small></div></li>`;
    }).join('')}</ol>
    <div class="partial-box"><span>已得到的阶段发现</span><p>${esc(task.partialFinding || '正在核对指标与授权范围；尚无可披露结论。')}</p></div>
    ${tracePanel()}
    ${footer(task.status === 'interrupted' ? button('从当前步骤继续', 'resume') + button('重新分析', 'restart', true) : button(icon('stop') + ' 中断分析', 'interrupt', true))}
  </section>`;
}

function renderS4() {
  const result = state.task.result;
  const channels = result.channels;
  return `<section data-screen="s4" class="screen result-screen">
    <p class="step-label">03 / 诊断结论</p><h1 class="result-title">大部分是正常回落，<br><span>但仍有额外缺口。</span></h1>
    <p class="result-lead">店铺流量较 11.11 峰值下降 ${result.dropPct}%，其中大部分属于预期回落；相对历史参考基线仍少约 ${number(result.extraGap)} 名访客，建议优先检查付费渠道。</p>
    ${scopeLine()}
    <div class="metric-trio"><div><span>11.11 峰值</span><b>${number(result.peak)}</b></div><div><span>11.14 实际</span><b class="red">${number(result.actual)}</b></div><div><span>11.14 预期</span><b>${number(result.expected)}</b></div></div>
    <div class="section-head"><h2>下降的 ${number(result.totalDrop)} 人怎么分解</h2><button class="text-button" data-action="evidence">看证据 ${icon('chevron')}</button></div>
    <div class="decomposition"><div class="decomp-track"><span style="width:${result.normalShare}%"></span><i style="width:${result.extraShare}%"></i></div><div class="decomp-labels"><p><b>${result.normalShare}%</b><small>预期回落 · ${number(result.expectedDrop)} 人</small></p><p><b class="red">${result.extraShare}%</b><small>额外缺口 · ${number(result.extraGap)} 人</small></p></div></div>
    <p class="tiny">以上比例表示下降量的结构分解。</p>
    <div class="section-head"><h2>渠道缺口贡献</h2><span class="small-muted">按额外缺口排序</span></div>
    <div class="channel-list">${channels.map((channel, i) => `<div class="channel-row"><span class="rank">0${i + 1}</span><div class="channel-main"><strong>${esc(channel.name)}</strong><div class="bar"><i style="width:${channel.contribution}%"></i></div></div><div class="channel-value"><b>${number(channel.gap)} 人</b><small>${channel.contribution}%</small></div></div>`).join('')}</div>
    <p class="tiny">${esc(result.scopeNote)} 渠道缺口贡献不等于因果；还需核查预算、曝光及计划状态。</p>
    <div class="section-head"><h2>按影响 / 成本排序的动作</h2></div>
    <div class="action-list">${result.actions.map((action, i) => `<article class="action-row"><span class="action-num">${i + 1}</span><div><strong>${esc(action.title)}</strong><p>${esc(action.reason)}</p><small>潜在影响 ${esc(action.impact)} · 执行成本 ${esc(action.cost)}</small>${action.id === 'paid' ? `<button class="inline-link" data-action="budget">查看受控预算测试申请 ${icon('chevron')}</button>` : ''}</div></article>`).join('')}</div>
    <div class="result-links"><button data-action="evidence">${icon('file')} 查看完整证据卡</button><button data-action="skill">${icon('clock')} 持续关注这类变化</button></div>
    ${tracePanel()}
  </section>`;
}

function evidenceField(label, value) { return `<div class="evidence-field"><span>${label}</span><strong>${esc(value)}</strong></div>`; }
function renderS5() {
  const cards = state.task?.evidence?.length ? state.task.evidence : buildEvidence(getFixture(state.scenario), state.plan);
  return `<section data-screen="s5" class="screen">
    <p class="step-label">04 / 结论可追溯</p><h1>证据卡与口径比较</h1><p class="sublead">相同日期不代表相同统计范围。切换口径必须重新确认计划。</p>
    ${cards.map((card, i) => `<article class="evidence-card ${i === 0 ? 'selected' : ''}"><div class="evidence-top"><div><span>${esc(card.id)} · ${i === 0 ? '当前分析口径' : '可比较定义'}</span><h2>${esc(card.name)}</h2></div><span class="version">${esc(card.version)}</span></div><p>${esc(card.definition)}</p><div class="evidence-fields">
      ${evidenceField('指标 ID', card.metricId)}${evidenceField('口径版本', card.version)}${evidenceField('时间窗口', card.window.replace('Asia/Shanghai', '北京时间'))}${evidenceField('数据源', i === 0 ? '店铺流量日报' : '商品访问明细')}${evidenceField('血缘', card.lineage.replace('演示数据', '当前数据'))}${evidenceField('取数时间', card.fetchedAt.replace('Asia/Shanghai', '北京时间'))}${evidenceField('有效样本', card.sample)}
    </div>${i === 1 ? `<button class="inline-link" data-action="switch-metric">改用此口径重新分析 ${icon('arrow')}</button>` : ''}</article>`).join('')}
    <div class="warning-box"><strong>不可直接混用</strong><p>店铺去重访客覆盖店铺访问；商品详情页去重访客只覆盖详情页。当前详情页日值与渠道数据不完整，暂无法用该口径判断变化。</p></div>
    ${footer(button('返回诊断结论', 'back-result', true))}
  </section>`;
}

function renderS6() {
  const failure = state.task?.failure || { code: 'low_evidence', reason: '证据不足', known: '', uncertain: '' };
  const explanation = failure.code === 'metric_conflict' ? '两个来源分别记录 6,000 / 6,180，口径版本不同。' : failure.code === 'timeout' ? '数据查询超时，尚未完成渠道贡献计算。' : failure.code === 'unsupported' ? '所选日期或维度暂无可用数据。' : state.plan.metricId !== 'SHOP_UV_001' ? '商品详情页 UV 缺少可比的日值与渠道下钻。' : '付费广告渠道数据缺失，主来源分类未完成。';
  return `<section data-screen="s6" class="screen">
    <p class="step-label">异常 / 低置信度</p><h1>这一步，不能给完整结论。</h1><p class="sublead">${esc(failure.reason)}</p>
    ${scopeLine()}
    <div class="uncertain-banner">${icon('info')} <div><strong>具体不确定的部分</strong><p>${esc(failure.uncertain)}</p></div></div>
    <div class="fact-block"><h2>目前可以确认</h2><p>${esc(failure.known || '尚未取得可用于判断的店铺数据。')}</p></div>
    <div class="fact-block"><h2>缺失 / 冲突证据</h2><p>${esc(explanation)}</p></div>
    <p class="tiny">不以未经校准的“AI 置信度”百分比代替证据。本页仅交付已完成步骤。</p>
    ${state.handoff ? `<div class="handoff"><div class="handoff-head">人工复核资料</div>${evidenceField('原问题', state.handoff.question)}${evidenceField('计划', `${state.handoff.plan.metricId} / ${state.handoff.plan.date}`)}${evidenceField('已完成', state.handoff.completedSteps.join('、') || '尚无')}${evidenceField('证据编号', state.handoff.evidenceIds.join('、') || '尚无')}${evidenceField('待处理', state.handoff.todo)}</div>` : ''}
    ${tracePanel()}
    ${footer(button('换口径 / 改计划', 'change-plan', true) + button('整理人工复核资料', 'handoff'))}
    <button class="bottom-text" data-action="retry-task">重新尝试当前查询</button>
  </section>`;
}

function renderS7() {
  const approval = state.approval;
  const statuses = { draft: '尚未提交', confirming: '等待确认', pending: '待审批', cancelled: '已取消', approved_mock: '审批通过，未执行', rejected_mock: '审批未通过' };
  return `<section data-screen="s7" class="screen">
    <p class="step-label">05 / 预算调整申请</p><h1>预算调整，必须先获确认。</h1>
    <p class="sublead">先核查广告计划是否受预算限制，再决定是否申请调整。</p>
    <div class="proposal"><h2>广告计划 A · 调整申请</h2><div class="budget-values"><div><span>当前日预算</span><strong>¥${approval.currentDaily}</strong></div><span>→</span><div><span>拟调整为</span><strong class="red">¥${approval.proposedDaily}</strong></div></div>${evidenceField('生效时长', `${approval.days} 天`)}${evidenceField('原两日预算上限', `¥${approval.currentDaily * approval.days}`)}${evidenceField('新两日预算上限', `¥${approval.proposedDaily * approval.days}`)}<div class="budget-cap">最多增加 <b>¥${approval.extraCap}</b> 的计划预算额度</div></div>
    <div class="warning-box"><strong>影响与风险</strong><p>额度增加不等于已发生支出，也不保证恢复流量。竞价、素材、曝光等未核验；已发生的广告消耗不能无损撤销。</p></div>
    <div class="fact-block"><h2>审批与留痕</h2>${evidenceField('当前状态', statuses[approval.status])}${approval.approvalId ? evidenceField('申请单号', approval.approvalId.replace('DEMO-APP-', 'APP-')) : ''}${evidenceField('预算变更', '尚未执行')}${evidenceField('撤销路径', '待审批时可取消申请；已发生的消耗不可撤销。')}</div>
    ${approval.status === 'confirming' ? '' : footer(approval.status === 'draft' ? button('确认申请内容', 'open-confirmation') : approval.status === 'pending' ? button('取消待审批申请', 'cancel-approval', true) : button('返回诊断结论', 'back-result', true))}
    ${approval.status === 'confirming' ? `<div class="confirm-overlay"><div class="confirm-dialog" role="dialog" aria-modal="true" aria-label="二次确认预算申请"><h2>再次确认申请</h2><p>将“广告计划 A”日预算 ¥300 → ¥350，为期 2 天；计划预算上限最多增加 ¥100。提交后进入待审批，审批前预算保持不变。</p>${button('确认并提交审批', 'submit-approval')}${button('暂不提交', 'close-confirmation', true)}</div></div>` : ''}
  </section>`;
}

function renderS8() {
  const skill = radar.memory.config;
  return `<section data-screen="s8" class="screen">
    <p class="step-label">06 / 持续关注</p><h1>每天关注店铺的重要变化。</h1><p class="sublead">开启每日巡检，集中查看异常与处理建议。</p>
    <div class="skill-card"><div class="skill-card-top"><span class="skill-icon">${icon('clock')}</span><span>${skill.enabled ? '已开启' : '未开启'}</span></div>
      ${evidenceField('适用店铺', defaultPlan.shop)}${evidenceField('关注范围', skill.domains.map(id => ({traffic:'流量',audience:'用户',transaction:'交易',ranking:'搜索排名'})[id]).join(' / '))}
    </div>
    ${footer(button(skill.enabled ? '查看巡检设置' : '开启每日经营巡检', 'open-radar-skill'))}
  </section>`;
}

function render() {
  const title = state.section === 'radar' ? '商策 · 每日巡检' : '商策 · 经营诊断';
  const screens = { s1: renderS1, s2: renderS2, s3: renderS3, s4: renderS4, s5: renderS5, s6: renderS6, s7: renderS7, s8: renderS8 };
  root.innerHTML = `<div class="app-shell"><aside class="desktop-rail"><div class="rail-brand"><span class="brand-mark"></span>商策</div><p>商家经营工作台</p><nav class="rail-main" aria-label="工作台导航"><button data-product="diagnosis" class="${state.section === 'diagnosis' ? 'active' : ''}">经营诊断</button><button data-product="radar" class="${state.section === 'radar' ? 'active' : ''}">每日巡检</button></nav>${state.section === 'radar' ? `<nav class="rail-subnav" aria-label="巡检功能">${[['report','日报总览'],['tasks','今日待办'],['history','历史报告'],['settings','巡检设置']].map(([page,label]) => `<button data-radar="page-${page}" class="${radar.page === page ? 'active' : ''}">${label}</button>`).join('')}</nav>` : '<div class="rail-scope">查看经营变化<br>核对依据，跟进行动</div>'}<small>${esc(defaultPlan.shop)}</small></aside><div class="phone-surface">${chrome(title, state.section === 'radar' || state.screen !== 's1')}<nav class="product-tabs" aria-label="商策产品导航"><button data-product="diagnosis" class="${state.section === 'diagnosis' ? 'active' : ''}">经营诊断</button><button data-product="radar" class="${state.section === 'radar' ? 'active' : ''}">每日巡检</button></nav><main>${state.section === 'radar' ? radar.render() : screens[state.screen]()}</main></div></div>`;
  const renderedScreen = state.section === 'radar' ? `radar-${radar.page}` : state.screen;
  if (state.section === 'radar' && radar.restoreScroll !== null) {
    window.scrollTo({ top: radar.restoreScroll, left: 0, behavior: 'instant' }); radar.restoreScroll = null;
  } else if (lastRenderedScreen !== renderedScreen) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  lastRenderedScreen = renderedScreen;
}

function scheduleTick() {
  clearTimeout(tickTimer);
  tickTimer = setTimeout(() => {
    if (state.screen !== 's3' || state.task?.status !== 'running') return;
    state.task.advance();
    if (state.task.status === 'completed') state.screen = 's4';
    else if (state.task.status === 'stopped') state.screen = 's6';
    render();
    if (state.task.status === 'running') scheduleTick();
  }, 720);
}

function startTask() {
  clearTimeout(tickTimer);
  state.task = new DiagnosticTask(getFixture(state.scenario), state.plan, state.question);
  state.task.start();
  state.handoff = null;
  state.screen = 's3';
  state.notice = '';
  render();
  scheduleTick();
}

root.addEventListener('click', event => {
  const product = event.target.closest('[data-product]')?.dataset.product;
  if (product) {
    if (product === 'radar' && state.section !== 'radar') { radar.page = 'report'; radar.navigation = []; radar.restoreScroll = 0; }
    state.section = product; state.notice = ''; render(); return;
  }
  const radarAction = event.target.closest('[data-radar]');
  if (state.section === 'radar' && radarAction) { radar.handle(radarAction.dataset.radar, root, radarAction); return; }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action.startsWith('question-')) {
    state.question = getSuggestedQuestions(getFixture(state.scenario))[Number(action.split('-')[1])];
    state.screen = 's2'; state.notice = ''; state.sourceAlertId = null;
  } else if (action === 'edit-plan') {
    state.editingPlan = !state.editingPlan; state.notice = '';
  } else if (action === 'confirm-plan') {
    const error = validatePlan(state.plan);
    if (error) { state.notice = error; render(); return; }
    state.editingPlan = false; startTask(); return;
  } else if (action === 'interrupt') {
    clearTimeout(tickTimer); state.task.interrupt();
  } else if (action === 'resume') {
    state.task.resume(); render(); scheduleTick(); return;
  } else if (action === 'restart' || action === 'retry-task') {
    startTask(); return;
  } else if (action === 'evidence') state.screen = 's5';
  else if (action === 'back-result') state.screen = 's4';
  else if (action === 'switch-metric') {
    state.plan.metricId = 'PRODUCT_DETAIL_UV_002'; state.screen = 's2'; state.editingPlan = true;
    state.notice = '已切换口径。请确认计划后重新分析；原店铺 UV 数值不会复用。';
  } else if (action === 'change-plan') { state.screen = 's2'; state.editingPlan = true; state.notice = ''; }
  else if (action === 'handoff') state.handoff = state.task.makeHandoff();
  else if (action === 'budget') { state.screen = 's7'; state.approval = new ApprovalFlow(); }
  else if (action === 'open-confirmation') state.approval.openConfirmation();
  else if (action === 'close-confirmation') state.approval.status = 'draft';
  else if (action === 'submit-approval') state.approval.submit();
  else if (action === 'cancel-approval') state.approval.cancel();
  else if (action === 'approve-demo') state.approval.approveDemo();
  else if (action === 'reject-demo') state.approval.rejectDemo();
  else if (action === 'skill') { state.screen = 's8'; state.notice = ''; }
  else if (action === 'open-radar-skill') { state.section = 'radar'; radar.page = 'settings'; radar.navigation = []; radar.restoreScroll = 0; render(); return; }
  else if (action === 'back') {
    if (state.section === 'radar') {
      if (!radar.back()) { state.section = 'diagnosis'; render(); }
      return;
    }
    if (state.screen === 's3') { clearTimeout(tickTimer); state.task?.interrupt(); state.screen = 's2'; }
    else if (['s5', 's7', 's8'].includes(state.screen)) state.screen = 's4';
    else if (state.screen === 's6') state.screen = 's2';
    else state.screen = 's1';
  }
  render();
});

root.addEventListener('change', event => {
  if (state.section === 'radar') return;
  const { name, value } = event.target;
  if (name === 'scenario') {
    clearTimeout(tickTimer);
    state.scenario = value; state.screen = 's1'; state.plan = { ...defaultPlan };
    state.question = ''; state.task = null; state.approval = new ApprovalFlow();
    state.handoff = null; state.notice = ''; state.editingPlan = false; state.sourceAlertId = null;
  } else if (['metricId', 'date', 'dimension'].includes(name)) {
    state.plan[name] = value;
    state.notice = validatePlan(state.plan) || '计划已更新；执行后将按当前选择重新取数。';
  } else return;
  render();
});

render();
