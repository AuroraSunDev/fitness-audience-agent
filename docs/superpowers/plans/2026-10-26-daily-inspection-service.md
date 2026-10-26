# 每日经营巡检服务 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有巡检改为预置订阅、交互日报、处理与次日跟进的服务，独立交付 HTML。
**Architecture:** 保留原诊断引擎和 radar 模块；新增窄取数工具与报告导出模块；业务记忆负责专项订阅、处置和版本。内部治理独立页面。
**Tech Stack:** 原生 HTML/CSS/ES modules、Node test、Playwright；不新增依赖。
**Spec:** `docs/superpowers/specs/2026-10-26-daily-inspection-service-design.md`

## Global Constraints
- 仅 `feat/daily-business-pulse`，不合入 main；只把 main 已发布修复同步到功能分支。
- 单店只读；四维单独工具；界面不展示教学、Mock、Skill 或技术契约。
- 保留 11-14 原指标锚点；订阅不扩大原授权；报告历史不受未来反馈污染。

## Review Focus
- 仅订阅流量时不得读取其他三个维度。
- 11-15 处理反馈不得出现在 11-14 之前的报告中。
- 已处理但数据仍异常时不能显示已恢复。
- 导出 HTML 的备注文本必须转义，刷新后反馈不丢。
- 报告进入诊断后返回原日期、原异常与原滚动位置。

### Task 1: 窄工具与三日数据
**Files:** `src/radar-tools.mjs`, `src/radar-data.mjs`, `src/radar-rules.mjs`, `src/radar-runtime.mjs`, `tests/radar-tools.test.mjs`。
**Interfaces:** `queryTraffic`, `queryCustomers`, `queryTransactions`, `queryRanking` 返回单域 `{status, date, data, quality}`；报告接受只读工具结果。
- [x] 先写测试：域隔离/非法输入/缺数/排名不可比/三日四维守恒；观察失败。
- [x] 实现工具并连接报告、执行 Trace；维持独立查询步骤与失败停止。
- [x] 验证针对性测试和原规则测试通过。

### Task 2: 订阅、处理记忆与受控治理
**Files:** `src/radar-memory.mjs`, `src/radar-rules.mjs`, `tests/radar-memory.test.mjs`。
**Interfaces:** `subscribeDiagnosis(task, options)` 仅关注原诊断；`feedbackAt(date)` 与 `followup` 区分操作时间/数据日期；治理版本包含已审批 policy。
- [x] 先写测试：专项不启四维、反馈跨日但不回写过去、重复反馈留历史、审核前不生效/发布后新报告生效/回滚；观察失败。
- [x] 实现最小持久结构、去重、历史样本对照和可回滚版本。
- [x] 验证刷新、暂停恢复、异常未恢复等用例。

### Task 3: 商家日报、诊断衔接与独立报告
**Files:** `src/radar-ui.mjs`, `src/radar.css`, `src/app.mjs`, `src/report-export.mjs`, `governance.html`, `src/governance.mjs`。
**Interfaces:** 开启默认方案直接生成首报；诊断回调携带 report/date/metric/evidence/incident；导出 `createReportHtml(reports, feedback)`。
- [x] 补 UI 测试：一键开启、范围栏、跟进卡、专项关注、返回来源、导出结构。
- [x] 实现商家日报与设置，合并保留 main 诊断修复；维护页不进入商家导航。
- [x] 导出单 HTML 支持日期切换、指标/证据展开、处理记录；输出到 `docs/assignment-3/经营巡检日报.html`。

### Task 4: 交付验证
- [x] Node 全部测试、语法与 diff 检查。
- [x] 浏览器 375/390/1280px 实走完整链路、失败分支、独立 HTML 与治理；截图放交付目录。
- [x] 更新产品方案、工具与技能说明、3 条走查记录、README；独立复核发现问题后修复。
- [ ] 提交并推送功能分支，确认 main SHA 未变化；提供本地预览与下载交付物，不宣称 Pages/main 已更新。
