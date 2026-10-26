import { RadarMemory } from './radar-memory.mjs';
const memory = new RadarMemory(localStorage), root = document.getElementById('governance');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const button = (label,action,disabled=false) => `<button class="radar-btn" data-govern="${action}" ${disabled?'disabled':''}>${label}</button>`;
let notice='';
function render() {
  const governance=memory.governance;
  root.innerHTML=`<a href="./index.html?view=daily">← 返回经营日报</a><p class="radar-eyebrow" style="margin-top:28px">商策 · 规则负责人</p><h1>每日巡检规则维护</h1>
    <div class="radar-panel"><h2>当前生效版本</h2><p class="version">${esc(governance.version)}</p><p>排序：${governance.policy.order==='unresolved_first'?'未处理事项优先':'经营影响优先'}</p><p class="radar-sub">改进范围为报告表达与事项排序；指标口径、告警条件、数据权限与经营金额沿用现行标准。</p>${button('回滚至上一批准版本','rollback',!governance.previousVersion)}</div>
    ${notice?`<p class="radar-notice" role="status">${esc(notice)}</p>`:''}
    <div class="radar-panel"><h2>从商家反馈发起改进</h2><p>已收集 ${memory.feedbackHistory.length} 条处理记录。候选改进：将已处理事项后置，让未处理问题更容易被看到。</p>${button('生成排序改进提案','propose',!memory.feedbackHistory.length)}${!memory.feedbackHistory.length?'<p class="radar-sub">有处理反馈后，可以发起对应的改进提案。</p>':''}</div>
    <h2>待审改进与版本记录</h2>${governance.proposals.map(item=>`<article class="radar-panel"><h3>${esc(item.id)} · ${esc(item.description)}</h3><p>基于版本 ${esc(item.baseVersion)} · ${{pending_shadow:'等待历史样本对照',pending_review:'对照完成，等待审核',approved:'已批准发布',rejected:'已拒绝'}[item.status]||esc(item.status)}</p>
      ${item.shadow?`<p>已对照 ${item.shadow.samples} 日报告 · ${item.shadow.metricRulesUnchanged?'指标与证据保持一致':'发现差异，暂不可发布'}</p><table><thead><tr><th>报告日期</th><th>现行事项顺序</th><th>候选事项顺序</th></tr></thead><tbody>${item.shadow.comparisons.map(row=>`<tr><td>${row.date}</td><td>${esc(row.before.join(' → '))||'无新异常'}</td><td>${esc(row.after.join(' → '))||'无新异常'}</td></tr>`).join('')}</tbody></table>`:''}
      <div class="radar-actions">${item.status==='pending_shadow'?button('运行三日历史对照',`shadow-${item.id}`):item.status==='pending_review'?button('批准并发布',`approve-${item.id}`)+button('拒绝提案',`reject-${item.id}`):''}</div></article>`).join('')||'<p class="radar-sub">暂无改进提案。</p>'}
    <details class="radar-panel"><summary>查看发布与回滚记录</summary><pre>${esc(memory.audit.slice(0,15).map(row=>`${row.action} · ${row.details}`).join('\n')||'暂无变更记录')}</pre></details>`;
}
root.addEventListener('click',event=>{
  const action=event.target.closest('[data-govern]')?.dataset.govern;if(!action)return;
  if(action==='propose'){const item=memory.propose('sort','未处理事项优先，已处理事项保留跟进');notice=`已生成 ${item.id}，尚未改变生效规则`;}
  else if(action.startsWith('shadow-')){memory.shadowCompare(action.slice(7));notice='历史对照已完成，等待负责人审核';}
  else if(action.startsWith('approve-'))notice=memory.review(action.slice(8),'approve')?'已批准发布；后续新生成报告使用新版本':'提案需要重新对照，当前版本未改变';
  else if(action.startsWith('reject-')){memory.review(action.slice(7),'reject');notice='提案已拒绝，当前版本未改变';}
  else if(action==='rollback'){memory.rollback();notice='已回滚至上一批准版本';}
  render();
});
render();
