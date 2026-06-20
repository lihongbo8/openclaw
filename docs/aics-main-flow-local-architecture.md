# AICS Main Flow Local Architecture

OpenClaw 本地端的 AICS 主流程必须是一个隐藏的后端状态层，而不是 UI 静态投影、通用 workboard 或主对话 prompt。它维护经营任务从业务事实到岗位执行的真实链路，并向 UI 和对话提供 read model。

岗位商城运营场景的生产方案见 `docs/aics/marketplace-operations-main-flow-plan.md`。该方案是当前 OpenClaw 本地端控制台使用 AICS 主流程运营迭界AI云端岗位商城的业务基准。

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

## 开发者中心约束

本地版开发者中心暂定最多保留 3 个活跃岗位开发会话。`created / briefing / confirming / generating / validating / completed` 状态都算正在开发或已开发的岗位；`failed / cancelled` 不占用名额。限制落在 `BuildSession.create` 的后端状态机里，UI 只展示 gateway 返回的真实阻塞原因。

岗位绑定推荐品类时，后端必须确认该品类属于当前开发者，并且满足以下任一条件：同一个 listing draft、同一个 role package，或正式品类能力覆盖当前岗位的 requiredCapabilities。审核中心只展示满足该规则的推荐品类，避免开发者把其他岗位的品类误绑定到当前岗位。

本地版允许暂不部署云端 SaaS。当云端连接未配置，或仅存在 `localhost / 127.0.0.1` 占位地址且没有云端 Token 时，品类能力同步应激活为本地正式品类，上架应生成本地正式 0 元岗位商品；真实远端云端地址缺 Token 仍必须 fail closed。

云端商城投影在没有真实云端 SaaS 连接时必须显示 `blocked`，不能显示 mock 成功或 connected；本地正式链路只能通过本地审核、上架、授权、执行和账本事实证明。

## UI 边界

- 主对话：解释状态、导航确认点、准备候选观察/归因/目标/规划/调度建议；不能直接调度岗位。
- API 管理：保存、测试或同步云端连接后，必须刷新岗位商城、我的岗位和主流程读模型，避免用户填完 API 后仍看到旧的执行阻塞状态。
- 开发者中心：生成岗位包成功后必须自动刷新审核中心和工具/Skill 供给读模型，并进入现有审核中心入口，让本地上架审核、品类能力申请和系统开发者待办立即可见；不能要求用户通过日志或手动刷新理解状态。
- 费用与授权：同步岗位时必须包含本地已上架但未授权的 0 元岗位商品，并提供正式授权动作；不能只显示已授权岗位。0 元正式授权只有拿到正式 `entitlementId` 才算成功；缺少 `entitlementId` 必须停留在费用与授权并显示错误，不能刷新成成功态或进入任务调度。授权成功后必须释放 loading，刷新岗位商城、我的岗位和主流程读模型，让待授权岗位立即移动到已授权状态，并进入现有任务调度入口；任务调度生成执行队列后再进入岗位执行入口。Token 用量和费用只能来自真实 API metering 或 usage 汇总，没有真实计费证据时显示空/零值，不能按执行次数估算。
- 费用与授权页在存在已授权岗位时必须显示下一步入口：先去任务调度生成派发单，再去岗位执行运行任务；授权完成不能只显示“已授权”状态让小白用户猜下一页。
- 当岗位商城列表暂时为空但 `我的岗位` read model 仍有正式授权资产时，费用与授权页必须回退展示这些授权岗位和下一步入口，不能让已经可执行的本地授权链路在费用页消失。
- 费用与授权页同步岗位成功后必须同步刷新 `我的岗位` read model，保证授权资产 fallback 不依赖用户先打开我的岗位页。
- 目标管理：展示 `CompanyGoal`、归因依据、确认材料、readiness 和阻塞原因。
- 公司管理：展示部门、项目、岗位归属；项目承接目标，不直接创建岗位任务。
- 我的岗位：展示已授权岗位、能力和可调用状态；即使尚未生成执行队列，也必须能看到已同步的本地/云端授权岗位资产，并保留 `roleListingId / entitlementId` 供任务调度和岗位执行使用。
- 岗位任务：展示 `TaskPackage / DispatchToRoleRequest / RoleResult` 投影；岗位执行页可以从已同步的授权岗位资产确认本次执行和费用，点击“运行任务”必须调用真实岗位执行桥 `dijie.roleTask.run`，随后通过 `aics.execution.result.record` 回写可审计产物、审计引用和账本引用，不能用本地合成结果伪成功。执行桥必须先通过本地派发预检，确认 `confirmExecution / costConfirmed / ledgerRef`、工具/Skill 和 API 都就绪后，才允许申请 execution-token 或调用模型执行；未确认费用时不能先跑任务再在回写阶段失败。
- 真实模型 API 执行前，岗位执行页必须在原有执行入口上弹出最终确认，展示岗位、任务、选中的执行模型和本次 ledgerRef；用户取消时不得申请 execution-token、不得调用模型、不得写入审计或账本。
- Workboard：只能展示调度层投影，不能成为主流程任务来源。

执行结果记录层必须把最终 `ledgerRef` 同步写入 `RoleResult.executionEvidence.ledgerRef`，并保留审计引用，保证费用与授权页、我的岗位页可以回读执行结果、审计和账本。

岗位执行成功时必须至少生成一个业务结果产物引用，例如 `artifact:role-result:<executionId>:summary`；审计和账本只能作为治理证据，不能替代用户要查看的执行成果。

`aics.execution.result.record` 记录成功结果时必须显式收到业务产物 `artifactRefs`、真实审计记录 `auditRecordId/auditRef` 和真实账本引用 `ledgerRef/ledgerEntryId`；缺任一项必须返回 blocked，不能自动生成引用伪装成成功。失败或阻塞结果可以记录失败证据，但不能上传成功态审计或完成态账本。

`aics.execution.result.record` 必须按 `taskPackageId + dispatchToRoleRequestId + executionId` 幂等；重复回写已存在结果时返回 `idempotent:true`，不得新增第二条 `RoleResult`。如果原执行是失败或阻塞，前端仍必须保留原始失败原因和恢复建议，不能因为幂等返回 `ok:true` 就清空错误提示。

我的岗位详情的产物页必须优先展示 `RoleResult.summary` 作为可读成果摘要，再展示业务产物引用、审计引用和账本引用；不能只让小白用户看到 `artifact:/audit:/ledger:` 这类内部引用。

我的岗位详情和费用与授权账本回读必须展示 `RoleResult.executionEvidence.modelUsage` 中的本次模型用量和费用证据；没有真实 `modelUsage` 或费用金额时必须明确显示无证据，不能按执行次数或默认单价估算。

岗位执行桥或执行结果记录返回 `ok:false / blocked` 时，岗位执行页必须保留错误原因并停止成功刷新；缺少 `RoleResult`、审计引用或账本写入失败都不能被当成完成态。

云端 execution-token 申请、模型执行、账本计量和 audit 上传必须作为同一次岗位执行的证据链处理；如果模型已成功但云端 audit 上传失败，已写入的 `RoleResult` 必须降级为 `outcome: blocked`，派发单和任务包也必须回到 blocked，不能留下 completed 结果。

模型 Provider 返回 401、超时或空内容时，执行桥必须把原始可行动原因提升为 `blockedReasons`，页面也必须继续显示该原因；可以记录失败 `RoleResult` 作为证据，但不能上传成功审计或让用户误以为岗位已经完成。

失败或阻塞的 `RoleResult.executionEvidence.recoverySuggestion` 必须在我的岗位详情中可见，告诉小白用户下一步去 API 管理、费用与授权、工具与 Skill 或联系系统开发者；不能只把建议埋在日志或 JSON 里。

岗位实例历史库不可读时，`我的岗位` 仍必须显示正式授权岗位和当前执行队列，并把实例库错误作为可见提示；运行历史、步骤和产物回看可以降级，但不能让授权和调度主链路消失。页面必须提供显式修复动作，将不可读实例库备份为 `.unreadable-*` 后重建空实例库，避免小白用户需要进终端处理。

审核中心绑定推荐品类后可以自动运行本地综合检查，让岗位开发者立即看到是否满足上架条件；但不能自动人工通过、不能自动提交上架。

开发者中心确认上架成功后必须刷新岗位商城、我的岗位和主流程读模型，并进入现有费用与授权入口，让用户立即看到待创建 0 元正式授权的岗位商品；审核中心不能替岗位开发者提交上架。

开发者岗位包生成完成页必须显示下一步：待审核时去审核中心处理品类、能力和工具阻塞；审核通过但未上架时由岗位开发者确认上架；已上架后进入费用与授权创建 0 元正式授权。不能只显示一个灰掉的上架按钮让用户猜流程。

开发者中心、审核中心和我的岗位页都必须复用同一套支持联系人/加群信息，让岗位开发者、系统开发者和使用者在品类能力、工具/Skill、授权、执行、审计或账本卡住时能找到沟通入口；该入口只承载沟通信息，不改变审核或上架权限边界。未配置真实加群信息时必须显示“待配置”和配置位置提示，不能静默隐藏入口。

API 管理页必须把本地岗位闭环 API 状态讲清楚：`build_session` 决定岗位创建能否调用模型，`role_execution` 决定岗位执行能否调用模型；通用 `model` 池可作为本地 fallback，但页面必须明示是“通用模型池”还是“专用绑定”。云端桥接在本地版可暂不配置；云端变量同步失败（例如 401 / Bearer 不一致）必须单独显示，不能误导用户以为本地创建和本地执行也被阻塞。

本地真人 demo 数据通过 `npm run aics:local-demo:seed` 准备。该脚本只写入本地正式事实：商城运营岗位包、品类能力申请、工具/Skill 审核、本地审核、本地上架、0 元授权和待执行派发单；默认不删除其他数据。需要重建这条 demo 时使用 `npm run aics:local-demo:seed -- --reset-demo`，只能清理这条 demo 相关记录，不能清空用户真实数据。脚本不伪造执行结果；结果、审计和账本必须由岗位执行页在 API 管理填好模型 Key 后真实运行产生。

本地执行成功后必须写入正式 readback 事实：`local_role_execution_audits` 保存审计记录，`local_role_ledger_entries` 保存账本条目。页面可以继续展示 `audit:` 和 `ledger:` 引用，但后端必须能按审计编号和账本引用读回真实记录；如果本地审计或账本写入失败，执行结果必须降级为 blocked，不能只返回完成状态。

工具/Skill 审核通过、品类能力审核通过或同步成功后，前端必须刷新工具/Skill 供给读模型；品类能力变化还必须刷新主流程读模型，避免任务调度和岗位执行预检继续使用旧能力状态。

任务调度可从费用与授权页或我的岗位资产读取已授权岗位事实，并在物化 `DispatchToRoleRequest` 时写入 `roleListingId / entitlementId`；但 `confirmExecution` 和 `costConfirmed` 仍必须由岗位执行页的人工确认动作写入，不能在调度阶段自动绕过。

任务调度点击检查并派发成功后，必须刷新我的岗位/执行控制台读模型，再进入岗位执行入口，避免用户进入岗位执行页后仍看到旧的空队列。

当 `DispatchToRoleRequest` 或执行队列项已经指定 `roleListingId` 时，调度确认和岗位执行都必须精确匹配同一个已授权岗位；匹配不到时进入授权阻塞，不能 fallback 到其他已授权岗位，避免串岗执行。

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
