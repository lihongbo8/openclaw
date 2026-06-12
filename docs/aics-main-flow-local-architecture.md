# AICS Main Flow Local Architecture

OpenClaw 本地端的 AICS 主流程必须是一个隐藏的后端状态层，而不是 UI 静态投影、通用 workboard 或主对话 prompt。它维护经营任务从业务事实到岗位执行的真实链路，并向 UI 和对话提供 read model。

## 固定链路

主流程顺序固定为：

```text
观察 -> 归因 -> 目标 -> 规划 -> 调度 -> 岗位
```

任何入口都不能跳过上游对象：

- 没有 `ObservationPackage`，不能生成 `AttributionReport`。
- 没有 `AttributionReport`，不能生成正式目标依据。
- 没有用户确认的 `CompanyGoal`，不能生成 `PlanningPackage`。
- 没有确认后的 `PlanningPackage / RolePlanItem`，不能生成调度提案。
- 没有确认后的 `DispatchProposalReview`，不能生成 `TaskPackage`。
- 没有 `TaskPackage / DispatchToRoleRequest`，岗位执行适配器不能运行。

## 核心对象

本地 store 合同落在 `src/aics-main-flow/types.ts`，当前对象为：

- `ObservationPackage`：收敛观察事实、证据和业务信号。
- `AttributionReport`：基于观察包给出归因发现和置信度。
- `CompanyGoal`：由归因支撑的公司目标，必须经用户确认后才可规划。
- `PlanningPackage`：围绕目标生成的规划包。
- `RolePlanItem`：规划包中的岗位工作项，表达岗位能力引用、任务意图、预期输出和人工确认要求。
- `DispatchProposalReview`：调度前的风险、确认材料和岗位执行提案。
- `TaskPackage`：调度确认后形成的可执行任务包。
- `DispatchToRoleRequest`：调度层发给岗位执行适配器的唯一请求对象。
- `RoleResult`：岗位执行回写结果。

`AicsMainFlowReadModel` 暴露当前阶段、readiness、blocked reasons、最新对象和计数。UI 只消费 read model，不直接拼装主流程状态。

## Gateway API

本地 gateway 注册以下核心方法：

```text
aics.mainFlow.readModel.get
aics.mainFlow.interaction.create
aics.mainFlow.observation.prepare
aics.mainFlow.attribution.prepare
aics.mainFlow.goal.candidate.create
aics.mainFlow.goal.confirm
aics.mainFlow.planning.prepare
aics.mainFlow.planning.confirm
aics.mainFlow.dispatch.proposal.create
aics.mainFlow.dispatch.confirm
aics.mainFlow.dispatch.materializeTaskPackage
aics.mainFlow.dispatch.runApprovedTask
```

`dispatch.runApprovedTask` 只允许在 `TaskPackage / DispatchToRoleRequest` 已存在时推进运行状态或接收结果。它不是主对话绕过调度层调用岗位工具的入口；真实岗位执行适配器只能接收 `DispatchToRoleRequest`。

## UI 边界

- 主对话：解释状态、导航确认点、准备候选观察/归因/目标/规划/调度建议；不能直接调度岗位。
- 目标管理：展示 `CompanyGoal`、归因依据、确认材料、readiness 和阻塞原因。
- 公司管理：展示部门、项目、岗位归属；项目承接目标，不直接创建岗位任务。
- 我的岗位：展示已授权岗位、能力和可调用状态。
- 岗位任务：展示 `TaskPackage / DispatchToRoleRequest / RoleResult` 投影。
- Workboard：只能展示调度层投影，不能成为主流程任务来源。

`ui/src/ui/business-flow-store.ts` 仍可作为 demo seed 或迁移期投影来源，但不能作为生产主流程引擎。

## 持久化

本地 store 默认路径：

```text
$OPENCLAW_STATE_DIR/aics-main-flow/state.json
```

未设置 `OPENCLAW_STATE_DIR` 时使用 OpenClaw 现有 `resolveStateDir()` 规则。测试应注入临时 state dir 或直接传入 store path，避免运行态文件进入仓库。

## 后续切片

1. 将目标管理、公司管理、岗位任务页面改为读取 `AicsMainFlowReadModel`。
2. 将 `business-flow-store.ts` 降级为 demo seed，并移除生产路径依赖。
3. 将现有 AICS 岗位执行能力包成低层执行适配器，只接收 `DispatchToRoleRequest`。
4. 清理硬编码演示内容和伪经营数据，避免污染主流程 read model。
