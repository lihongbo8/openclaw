# OpenClaw 岗位商城运营主流程方案

日期：2026-06-15

## 定位

OpenClaw 本地端是迭界AI岗位商城的本地执行与 AICS 主流程驾驶舱。它不经营第三方电商店铺，也不围绕淘宝、京东、抖店等平台规则做店铺运营。这里的“商城”只指迭界AI云端岗位商城：岗位商品、能力、授权、调用、执行、审计和经营状态。

本地端要解决的问题是：

```text
真实观察云端商城、本地 OpenClaw、岗位供给、能力路由、用户使用和外部环境
-> 归因为什么目标没有达成
-> 形成 CompanyGoal
-> 拆成规划方案和岗位工作项
-> 经调度层确认后执行岗位
-> 用真实结果回写下一轮观察
```

主链路固定：

```text
观察 -> 归因 -> 目标 -> 规划 -> 调度 -> 岗位执行
```

## 生产边界

本方案按生产可用设计，不接受只靠静态 mock 的主流程闭环。允许开发期使用 adapter/mock 验证 UI，但生产路径必须具备真实数据来源、真实采集、真实模型分析、真实调度和真实岗位执行结果。

必须真实接入：

- 云端岗位商城 API：岗位商品、能力、审核、授权、商品状态、调用状态、审计摘要。
- 本地 OpenClaw Gateway：本地服务状态、模型 Provider、工具/Skill、SecretRef、运行事件、失败原因。
- 调度和岗位执行：PlanningPackage、RolePlanItem、DispatchProposal、TaskPackage、DispatchToRoleRequest、RoleResult。
- 外部观察源：竞品产品、外部技术、工具、模型、政策/安全风险、可吸收能力库。
- 大模型分析：用于归因解释、目标建议、规划拆解、风险摘要和调度建议，但不能绕过数据证据和人工确认闸门。

不能发生：

- 公司目标直接绕过观察和归因创建。
- 公司管理页直接执行岗位。
- API 管理页展示费用、Token、账单、岗位价格。
- 本地端直接写云端商城数据库。
- 云端商城直接写 OpenClaw 本地运行库。
- 把岗位商城运营混成第三方电商店铺运营。

## 观察层

观察层只收集事实和证据，不下结论，不给策略。

观察层的生产级架构以通用观察引擎为准：它不是岗位商城专用模板，而是根据业务上下文动态生成观察对象、发现内部/外部/工具/Skill 数据源、编排只读采集、标准化证据并通过质量门后生成观察包。详细目标见
`docs/aics/generic-observation-engine-production-goal.md`。

### 观察域

1. 云端岗位商城观察
   - 岗位商品数量、发布状态、审核状态、分类和能力标签。
   - 授权状态、可调用状态、blocked reason。
   - 商品信息完整度：能力说明、授权说明、输出样例、调用边界、风险提示。

2. 本地 OpenClaw 运行观察
   - Gateway 在线状态、插件/Skill 状态、本地运行时、服务健康。
   - SecretRef、环境变量、模型 Provider、工具 API 连接状态。
   - 本地执行失败、超时、权限不足、缺依赖。

3. 岗位供给与能力观察
   - 已上架岗位、待审核岗位、缺失品类、独特能力申请。
   - 能力路由是否能把任务匹配到已授权岗位。
   - 岗位能力和历史执行数据是否支持当前目标。

4. 用户/管理者使用观察
   - 哪些页面被使用，哪些确认点卡住。
   - 授权转化、调度确认、执行重试、删除/编辑连接等行为。
   - 用户是否理解 API 管理、费用与授权、岗位执行的分工。

5. 调度与执行链路观察
   - PlanningPackage 是否确认。
   - RolePlanItem 是否可调度。
   - DispatchProposal 是否通过。
   - TaskPackage 是否物化。
   - DispatchToRoleRequest 是否具备授权、能力、API、工具、Skill 和确认条件。
   - RoleResult 是否成功、失败或阻塞。

6. 外部产品与竞品观察
   - 其他 AI Agent 商城、插件市场、岗位市场、自动化平台的产品能力。
   - 别人如何表达能力、授权、安装、测试、调用和失败恢复。
   - 对 OpenClaw 岗位商城有威胁或可学习的产品设计。

7. 外部技术/工具/模型观察
   - DeepSeek、阿里百炼、OpenAI、Anthropic、Gemini、Ollama/local 等模型可用性。
   - 图片生成、视频生成、文档处理、搜索、浏览器自动化、质量检查等工具能力。
   - 新技术是否能被吸收到岗位能力、工具、Skill 或模型路由里。

8. 可吸收能力库观察
   - 本地开源岗位库、工作流模板、Prompt、Skill、Tool、MCP、插件。
   - 可转化成岗位商品或能力包的资产。
   - 已吸收、待评估、不可吸收的原因。

9. 风险与数据质量观察
   - 数据缺失、接口异常、证据过旧、采样偏差、模型幻觉风险。
   - 权限、Secret、审计、越权调用、跨系统写入风险。
   - 外部 API 变化、模型退化、工具不可用、云端审核拒绝。

### 后端接口建议

```text
aics.observation.collect
aics.observation.package.prepare
aics.observation.package.confirm
aics.observation.sources.health.get
```

观察适配器必须输出：

```ts
type ObservationSignal = {
  id: string;
  title: string;
  summary: string;
  evidenceRefs: string[];
};
```

每条 evidence 必须有 source、collectedAt、freshness、confidence。无证据的模型判断不能成为正式观察信号。

## 归因层

归因层回答：目标为什么达成或没达成。它必须基于观察包，不允许脱离事实直接编原因。

### 归因维度

1. 云端商城问题：商品状态、审核、能力目录、授权、云端 blocked reason。
2. 本地 OpenClaw 问题：Gateway、插件、Skill、工具、模型、SecretRef、本地运行时。
3. 岗位供给问题：岗位数量、岗位质量、分类覆盖、能力说明、输出样例不足。
4. 授权问题：岗位未授权、授权过期、actor_context 不匹配、执行确认缺失。
5. 能力路由问题：任务无法匹配岗位、能力标签不准、独特能力缺失。
6. API/模型/工具/Skill 问题：DeepSeek、阿里百炼等 Provider 不可用，工具依赖缺失。
7. 页面体验问题：用户不知道怎么连接、编辑、删除、测试或进入调度。
8. 调度链路问题：规划未确认、调度建议未确认、TaskPackage 未物化。
9. 岗位执行质量问题：失败率高、产物不合格、回写缺失、重试不可用。
10. 外部能力未吸收：已有可用技术、工具、模型、产品能力没有纳入 OpenClaw。
11. 外部产品压力：竞品在授权、安装、能力表达、测试、调用体验上更成熟。
12. 风险与数据质量问题：证据不足、数据过期、权限风险、审计缺口。
13. 目标设定问题：目标不可量化、周期不清、责任人不清、目标脱离数据。

### 大模型职责

大模型可以：

- 对观察信号做聚类和解释。
- 给出 ranked causes、confidence、impact。
- 指出缺失证据和需要补采的数据。
- 生成面向用户的归因摘要。

大模型不能：

- 伪造证据。
- 把低置信数据说成确定结论。
- 直接创建目标、规划或调度任务。

## 目标层

CompanyGoal 的含义：公司目标，是观察层、归因层和用户确认共同形成的经营目标，不是凭空输入的口号。

目标层职责：

- 把观察和归因结果收敛成可治理目标。
- 明确 owner、metric、target、cycle、rationale。
- 记录 observationPackageId 和 attributionReportId。
- 经用户确认后才允许进入规划层。

岗位商城常见目标：

```text
Q3 首批岗位授权转化率达到 20%，执行成功率达到 85%
首批 50 个岗位商品完成审核、能力标签和输出样例补齐
云端商城到本地 OpenClaw 的执行链路成功率达到 90%
API/模型/工具/Skill 阻塞数降到 0
首批高价值岗位的可调用状态达到 95%
```

页面要显示：

- 目标来源：来自哪个观察包和归因报告。
- 当前进度：从真实观察/执行数据计算。
- 阻塞原因：来自归因和调度状态。
- 可规划状态：目标 confirmed 后才可规划。

## 规划层

规划层把 CompanyGoal 拆成可承接的工作块和 RolePlanItem。它不执行岗位。

### 规划结构

```text
CompanyGoal
-> WorkBlock
-> RolePlanItem
-> DispatchProposal candidate
```

岗位商城目标默认拆成：

1. 岗位供给与审核优化
   - 梳理岗位商品数量、审核状态、能力标签、上架阻塞。
   - 输出供给缺口、审核阻塞和补齐顺序。

2. 岗位商品信息架构优化
   - 优化能力说明、授权说明、输出样例、调用边界、风险提示。
   - 输出岗位商品信息架构和审核材料补齐建议。

3. 能力路由与执行质量提升
   - 检查授权、能力匹配、工具/Skill/API 准备度、执行成功率和失败原因。
   - 输出能力路由诊断、失败模式和改进动作。

4. API 与模型连接治理
   - 检查云端商城、本地 Gateway、DeepSeek、阿里百炼、OpenAI-compatible、工具 API、Skill 依赖。
   - 输出缺失连接、SecretRef、blocked reason 和修复顺序。

5. 授权闸门治理
   - 检查岗位授权、执行确认、费用确认引用、ledger 摘要是否满足调度前闸门。
   - 费用明细仍归费用与授权页，不放 API 管理页。

6. 审核阻塞处理
   - 定位岗位审核、能力审核、独特能力申请、风险项和责任人。
   - 输出解除阻塞顺序。

### 前端页面

规划方案页展示：

- 目标卡片：目标、来源、进度、阻塞、负责人、周期。
- 工作块：名称、目的、进度口径、状态、阻塞原因。
- RolePlanItem：岗位能力引用、任务意图、预期输出、是否需要人工确认。
- 操作：生成调度建议、确认规划、退回修改。

## 调度层

调度层是唯一能把规划变成 TaskPackage 的地方。

调度必须校验：

- CompanyGoal 已 confirmed。
- PlanningPackage 已 confirmed。
- RolePlanItem 已 confirmed。
- 云端岗位授权可用。
- actor_context 完整。
- scope 匹配。
- 能力路由匹配。
- 工具/Skill/API 依赖可用。
- 需要人工确认的项已经确认。

调度输出：

```text
DispatchProposalReview
-> TaskPackage
-> DispatchToRoleRequest
```

blocked reason 固定：

```text
missing_actor_context
actor_scope_mismatch
missing_category_capability
unique_capability_pending
dispatcher_role_not_authorized
api_boundary_required
local_gateway_unavailable
model_provider_unavailable
tool_or_skill_dependency_missing
human_confirmation_required
```

## 岗位执行层

岗位执行只接收 DispatchToRoleRequest，不接受页面或对话直接调用。

执行结果回写：

```text
RoleRun
RoleExecutionStep
ToolCallRequest
ToolExecutionResponse
ToolArtifact
RoleResult
AuditSummary
```

岗位结果必须能回到：

- 任务调度页：当前任务状态。
- 岗位执行页：运行步骤、产物、失败原因、重试。
- 数据分析页：下一轮观察信号。
- 归因分析页：失败原因和阻塞原因。
- 公司目标页：目标进度。

## API 管理页定位

API 管理页只回答：

```text
系统能不能用
哪里连不上
哪个岗位/工具/Skill 被阻塞
缺什么连接或 SecretRef
```

不回答：

```text
用了多少钱
剩多少额度
岗位授权多少钱
Token 花费多少
账单和预算是否超限
```

费用、Token、账单、授权购买、额度消耗统一放到费用与授权。

## UI 页面映射

1. 数据分析
   - 展示九类观察域、真实数据源健康、观察包、证据、新旧对比。

2. 归因分析
   - 展示十三类归因维度、ranked causes、置信度、证据引用、缺失证据。

3. 公司目标
   - 展示 CompanyGoal、来源观察包、来源归因报告、进度、确认状态。

4. 规划方案
   - 展示 WorkBlock 和 RolePlanItem，不直接执行岗位。

5. 任务调度
   - 展示 DispatchProposalReview、TaskPackage、DispatchToRoleRequest、blocked reason。

6. 岗位执行
   - 展示 RoleRun、RoleExecutionStep、ToolArtifact、RoleResult、重试/修复。

7. API 管理
   - 展示系统使用、连接适配、Provider、SecretRef、健康状态、阻塞原因。

8. 费用与授权
   - 展示岗位授权、账单、Token、额度、ledger、费用确认。

## 后端开发清单

1. 观察采集
   - 完成云端岗位商城 adapter。
   - 完成本地 Gateway/Provider/Tool/Skill health adapter。
   - 完成外部产品/技术/风险采集 adapter。
   - 所有 adapter 输出 evidence refs。

2. 归因服务
   - 以 ObservationPackage 为输入。
   - 大模型生成 ranked causes。
   - 服务端校验每个 finding 必须引用 observationSignalIds。

3. 目标服务
   - CompanyGoal 必须绑定 attributionReportId 和 observationPackageId。
   - confirmed 前不能规划。

4. 规划服务
   - 生成 WorkBlock 和 RolePlanItem。
   - 岗位商城默认六类拆解。
   - 规划确认后才能进入调度。

5. 调度服务
   - 读取云端授权和能力路由。
   - 校验 actor_context、scope、API/模型/工具/Skill。
   - 只在确认后物化 TaskPackage。

6. 岗位执行
   - 接入真实 OpenClaw embedded agent 或明确配置的临时执行器。
   - 回写 RoleResult、AuditSummary、Artifact。
   - 支持失败、阻塞、重试、取消。

7. Read Model
   - AicsOperationsReadModel 合并 AICS 主流程、CloudMarketplaceProjection、Local Gateway Health。
   - UI 只读 read model，不自己拼业务状态。

## 验收标准

- 数据分析页能从真实云端、本地、外部来源生成 ObservationPackage。
- 归因分析页能基于 ObservationPackage 生成 AttributionReport，并能追溯证据。
- 公司目标页只能确认有观察和归因来源的 CompanyGoal。
- 规划方案页能把岗位商城目标拆成六类工作块和 RolePlanItem。
- 任务调度页只能从 confirmed PlanningPackage 生成 TaskPackage。
- 岗位执行页只执行 DispatchToRoleRequest，不能被公司管理或对话绕过。
- API 管理页保存、回显、编辑、删除、测试连接都真实可用。
- DeepSeek 和阿里百炼能作为多模型 Provider 配置和测试。
- 页面里不再把岗位商城运营误写成第三方电商店铺运营。
- 每次执行结果能进入下一轮观察、归因和目标进度。
