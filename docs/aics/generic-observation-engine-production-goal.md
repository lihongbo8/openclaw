# 通用观察引擎生产级目标

日期：2026-06-20

## Summary

通用观察引擎是 AICS 六层主流程的第一层基础设施，不是某一个业务页面，也不是预置业务模板。

它的目标是：根据客户真实业务上下文，动态建模要观察的对象，发现可用内部/外部数据源，按需调用工具和 Skill 获取信息，把所有结果标准化成可追溯证据，再经过质量门生成可确认的观察包。

```text
业务上下文
-> 动态观察对象
-> 观察问题
-> 数据源发现
-> 工具/Skill/外部采集计划
-> 证据采集
-> 证据标准化
-> 数据质量门
-> 观察包候选
-> 用户确认
-> 归因层可读取
```

该引擎必须支持 OpenClaw 自身的岗位商城运营，也必须支持客户业务，例如自营电商、内容公司、本地服务公司等。业务不同，观察对象不同；底层证据、质量门和观察包结构保持统一。

## Goal Format

### Goal

把“数据分析”升级为生产级通用观察引擎，让非程序员用户也能完成一次真实观察：

```text
描述业务
-> 系统理解业务
-> 系统提出要观察什么
-> 系统发现可读取的内部数据、外部信息、工具和 Skill
-> 系统执行只读采集
-> 系统展示事实、来源、时间、可信度和缺失项
-> 用户确认观察包
-> 归因层只读取已确认观察包
```

### Production Boundary

这是生产级目标，不是程序员 demo：

- 不能只靠 mock 数据展示成功态。
- 不能只显示内部对象名、协议 ID 或数据库引用。
- 不能让大模型凭空生成观察事实。
- 不能把工具失败、无来源摘要、过期信息当作正式证据。
- 不能因为没有真实外部来源就静默成功。
- 没有真实 API、工具、Skill、权限或 Secret 时，必须显示可操作阻塞。
- 观察层可以调用只读工具和 Skill 获取信息，但不能写业务数据、定目标、生成规划、派发任务或执行岗位。

### User Outcome

真人用户完成这一层后应该能看懂：

- 系统现在理解我的业务是什么。
- 系统建议观察哪些对象，为什么。
- 哪些内部数据已经读到。
- 哪些外部信息已经真实获取。
- 哪些工具或 Skill 参与了采集。
- 哪些证据可信、待验证、过期、冲突或失败。
- 哪些缺失数据会影响后续归因。
- 是否可以确认观察包进入归因。

## Current Code Assessment

当前代码已有观察层雏形：

- `src/aics-main-flow/types.ts`
  - 已有 `ObservationSignal`、`ObservationPackage`。
- `src/aics-main-flow/store.ts`
  - 已有 `prepareObservation`、`confirmObservation`、`rejectObservation`、`markObservationDataMissing`。
  - 已有“无观察不能归因”的闸门。
- `src/aics-main-flow/adapters/types.ts`
  - 已有 `ObservationAdapter`、`AdapterFetchResult`、`EvidenceRef`、`SourceConfidence`、`SourceFreshness`。
- `src/aics-main-flow/adapters/collector.ts`
  - 已有 `collectObservations` 和 `toObservationPackageInput`。
- `src/aics-main-flow/adapters/external-info-adapter.ts`
  - 已有外部信息适配器方向。

现有设计的问题：

- 观察对象还不够动态，偏向“已有适配器返回信号”，不是先理解业务再生成观察对象。
- 缺少 `BusinessContext`，无法表达客户业务是什么。
- 缺少 `ObservationObject` 和 `ObservationQuestion`，不能按业务对象组织采集。
- 缺少工具/Skill 调用编排层，外部信息和工具结果不能成为统一证据流。
- `EvidenceRef` 偏引用，不足以承载完整观察证据、质量结果和用户可读来源。
- 质量门还不够明确，低可信、过期、冲突、模型推测等不应进入正式归因。
- 大模型边界需要固化：只能基于证据总结事实，不能凭空生成观察事实。

结论：现有代码可以作为底座，但需要升级为“动态观察对象 + 工具/Skill 采集 + 证据质量门”的通用观察引擎。

## Product Goal

真人用户只需要描述自己的业务和当前经营问题，系统就能回答：

```text
应该观察什么
哪些内部数据可以直接读取
哪些外部信息需要获取
哪些工具或 Skill 可以帮助采集
哪些证据可信
哪些证据缺失、过期、冲突或待验证
能否确认观察包进入归因
```

观察层只输出事实，不输出归因、目标、规划、调度或执行。

## Non-Goals

通用观察引擎不做：

- 不预置“电商模板 / 内容模板 / OpenClaw 模板”作为固定路径。
- 不根据模板字段硬采集。
- 不做归因结论。
- 不创建公司目标。
- 不生成规划方案。
- 不派发任务。
- 不执行岗位。
- 不写云端数据库。
- 不把工具失败伪造成事实。
- 不让大模型凭空生成观察。

## Architecture

### 1. Business Context

业务上下文描述客户真实业务，不是模板选择。

```ts
type BusinessContext = {
  id: string;
  accountId: string;
  businessName: string;
  businessDescription: string;
  operatingModel?: string;
  productsOrServices?: string[];
  customers?: string[];
  channels?: string[];
  revenueModel?: string;
  currentConcern?: string;
  createdAt: string;
  updatedAt: string;
};
```

示例：

```text
我是一个自营商城，不在第三方电商平台卖货，主要经营岗位商品、能力授权和本地 OpenClaw 使用。
```

系统应动态推导观察对象：

```text
岗位商品、授权转化、能力路由、API 可用性、用户购买后使用链路、执行成功率、审计账本完整性、外部可吸收工具。
```

如果客户是普通自营电商，系统可能动态推导：

```text
商品、订单、访客、转化、库存、退款、客服、投放、复购、利润。
```

这不是模板，而是由业务上下文和可用数据源共同生成。

### 2. Observation Object Modeler

根据业务上下文生成观察对象。

```ts
type ObservationObject = {
  id: string;
  businessContextId: string;
  name: string;
  objectType: "business_entity" | "metric" | "process" | "risk" | "external_factor";
  description: string;
  whyObserve: string;
  relatedDataHints: string[];
  priority: "high" | "medium" | "low";
  generatedBy: "system" | "llm" | "user";
  status: "candidate" | "active" | "dismissed";
};
```

大模型可以帮助生成观察对象候选，但不能直接生成事实。

### 3. Observation Questions

观察对象必须转成可采集的问题。

```ts
type ObservationQuestion = {
  id: string;
  objectId: string;
  question: string;
  expectedEvidence: string[];
  priority: "high" | "medium" | "low";
  sourceHints: string[];
};
```

示例：

```text
观察对象：授权转化
问题：最近用户购买岗位后，是否能在本地端成功使用？
需要证据：购买记录、授权记录、本地同步状态、执行队列、失败日志。
```

### 4. Source Discovery

发现当前账号能从哪里取证。

```ts
type ObservationSourceCandidate = {
  id: string;
  label: string;
  sourceKind:
    | "internal_read_model"
    | "gateway_api"
    | "external_web_search"
    | "external_web_fetch"
    | "external_api"
    | "file_parse"
    | "database_query"
    | "tool"
    | "skill"
    | "manual";
  canAccess: boolean;
  missingRequirement?: string;
  riskLevel: "low" | "medium" | "high";
  observedObjects: string[];
  freshnessHours?: number;
};
```

Source Discovery 必须回答：

- 哪些内部 read model 可以直接读。
- 哪些 Gateway/API 可以读。
- 哪些外部网页、搜索、公开 API 可以读。
- 哪些工具/Skill 可以调用。
- 哪些数据源缺 Secret、scope、授权或人工确认。

### 5. Observation Tool Orchestrator

观察引擎必须具备工具和 Skill 调用能力。

它负责编排：

- 内部 read model 读取。
- Gateway API 读取。
- 外部搜索。
- 外部网页读取。
- 外部 API 获取。
- 文件解析。
- 数据库只读查询。
- Tool 调用。
- Skill 运行。
- 用户手工补充。

```ts
type ObservationToolPlan = {
  id: string;
  businessContextId: string;
  questionId: string;
  steps: ObservationToolStep[];
  requiresUserApproval: boolean;
  status: "draft" | "ready" | "blocked" | "running" | "completed" | "failed";
};

type ObservationToolStep = {
  id: string;
  toolType:
    | "internal_read_model"
    | "gateway_api"
    | "external_web_search"
    | "external_web_fetch"
    | "external_api"
    | "file_parse"
    | "database_query"
    | "skill_run"
    | "manual_input";
  toolName?: string;
  purpose: string;
  input: Record<string, unknown>;
  expectedOutput: string;
  riskLevel: "low" | "medium" | "high";
  allowedSideEffects: "none";
  status: "pending" | "running" | "succeeded" | "failed" | "blocked";
};
```

工具调用边界：

```text
允许：读取、搜索、解析、归档、质量检查、生成证据。
禁止：改业务数据、确认目标、生成规划、派发任务、执行岗位、购买授权、写云端数据库。
```

### 6. Raw Tool Evidence

工具结果不能直接成为结论，必须先作为原始证据。

```ts
type RawToolEvidence = {
  id: string;
  toolPlanId: string;
  toolStepId: string;
  toolType: string;
  toolName?: string;
  rawOutputRef: string;
  rawSummary?: string;
  collectedAt: string;
  success: boolean;
  error?: string;
};
```

### 7. Observation Evidence

所有内部、外部、工具、Skill、手工输入都统一为观察证据。

```ts
type ObservationEvidence = {
  id: string;
  businessContextId: string;
  objectId: string;
  questionId?: string;
  statement: string;
  value?: string | number | boolean;
  unit?: string;
  sourceKind: "internal" | "external" | "tool" | "skill" | "manual";
  sourceLabel: string;
  sourceRef: string;
  rawRef?: string;
  observedAt: string;
  confidence: "high" | "medium" | "low";
  freshness: "fresh" | "stale" | "expired" | "unknown";
  qualityFlags: string[];
};
```

用户界面显示：

```text
事实是什么
来自哪里
什么时候采集
可信度如何
是否缺失/过期/冲突/待验证
```

用户界面不显示：

```text
artifact:
ledger:
audit:
TaskPackage
RoleResult
内部数据库 row id
```

### 8. Evidence Normalizer

把不同来源转成统一 `ObservationEvidence`。

Normalizer 需要处理：

- 内部 read model。
- 外部网页/搜索结果。
- 工具执行输出。
- Skill 执行输出。
- 文件解析输出。
- 手工输入。

规则：

- 没有 sourceRef 的事实不能进入正式观察包。
- 模型输出只能成为“摘要”，不能成为事实来源。
- 外部网页必须记录 URL、来源名称、抓取时间。
- 工具失败必须显示为失败，不得伪造成事实。

### 9. Observation Quality Gate

质量门决定证据能否进入正式观察包。

```ts
type ObservationQualityResult = {
  evidenceId: string;
  status: "accepted" | "needs_review" | "rejected";
  reasons: string[];
  userMessage: string;
};
```

规则：

```text
有来源、在有效期内、无冲突 -> accepted
来源过期 -> needs_review
来源冲突 -> needs_review
低可信 -> needs_review
用户手工输入未确认 -> needs_review
模型推测但无证据 -> rejected
工具失败 -> rejected
无 sourceRef -> rejected
```

### 10. Observation Package Candidate

质量门之后生成观察包候选。

```ts
type ObservationPackageCandidate = {
  id: string;
  businessContextId: string;
  title: string;
  summary: string;
  acceptedEvidenceIds: string[];
  pendingEvidenceIds: string[];
  rejectedEvidenceIds: string[];
  missingData: Array<{
    objectId: string;
    question: string;
    reason: string;
    repairAction: string;
  }>;
  qualitySummary: {
    accepted: number;
    needsReview: number;
    rejected: number;
    stale: number;
    missing: number;
  };
  canConfirm: boolean;
};
```

确认规则：

- 至少有一条 accepted evidence。
- 所有关键观察对象必须有 accepted 或明确的 missingData。
- 未覆盖的关键观察对象必须进入 `uncoveredRequiredObjectIds`，页面要告诉用户缺哪块证据。
- `needs_review` 可以展示，但不能作为归因强证据。
- `rejected` 不进入归因。

## LLM Boundary

大模型在观察层只能做：

- 理解业务上下文。
- 生成观察对象候选。
- 生成观察问题候选。
- 根据证据生成用户可读摘要。
- 标记缺失数据。

大模型不能做：

- 伪造事实。
- 在没有证据时生成观察。
- 做归因结论。
- 创建目标。
- 生成规划。
- 调度或执行岗位。

LLM 输出必须引用证据：

```ts
type ObservationSummaryByLLM = {
  summary: string;
  evidenceRefs: string[];
  missingDataRefs: string[];
  warnings: string[];
};
```

## Gateway Interface Plan

第一版新增/收敛以下 Gateway 方法：

```text
aics.observation.businessContext.get
aics.observation.businessContext.update
aics.observation.objects.generate
aics.observation.questions.generate
aics.observation.sources.discover
aics.observation.toolPlan.create
aics.observation.toolPlan.run
aics.observation.evidence.normalize
aics.observation.quality.evaluate
aics.observation.package.candidate.create
aics.observation.package.confirm
```

所有外部/工具/Skill 采集必须带：

```text
actor_context
purpose
requested_scope
source_surface
audit_ref
```

## UI Plan

数据分析页从“数据包页面”升级为“观察工作台”。

页面结构：

```text
当前业务理解
  - 系统理解你是什么业务
  - 当前经营问题
  - 需要观察的对象

观察对象
  - 系统建议观察什么
  - 为什么要观察
  - 缺哪些数据

数据源和工具
  - 内部数据源
  - 外部数据源
  - 工具/Skill
  - 哪些可用，哪些缺授权/API/Secret

采集计划
  - 要问哪些问题
  - 用哪些来源/工具采集
  - 哪些需要确认

观察证据
  - 事实
  - 来源
  - 时间
  - 可信度
  - 质量状态

观察包候选
  - 可确认事实
  - 待验证事实
  - 缺失数据
  - 确认进入归因
```

主按钮：

```text
更新业务理解
生成观察对象
发现数据源
生成采集计划
采集证据
生成观察包
确认观察
```

真人话术：

```text
系统理解你的业务是……
建议先观察这些对象……
这些数据可以自动获取……
这些信息需要用工具/Skill 到外部获取……
这些证据可信，可以进入归因……
这些证据缺失或过期，需要补采……
```

## Migration Plan

### Phase 1: Preserve Existing ObservationPackage

保留现有：

- `ObservationSignal`
- `ObservationPackage`
- `prepareObservation`
- `confirmObservation`
- `ObservationAdapter`
- `collectObservations`

新增结构先作为观察引擎 read model，不破坏现有主流程。

### Phase 2: Add Dynamic Observation Model

新增：

- `BusinessContext`
- `ObservationObject`
- `ObservationQuestion`
- `ObservationSourceCandidate`
- `ObservationToolPlan`
- `RawToolEvidence`
- `ObservationEvidence`
- `ObservationQualityResult`
- `ObservationPackageCandidate`

### Phase 3: Bridge Candidate to Existing Package

`ObservationPackageCandidate` 确认后转成现有 `ObservationPackage`：

```text
acceptedEvidence -> ObservationSignal[]
pending/rejected -> 质量摘要和缺失数据，不进入正式归因
```

### Phase 4: Add Real Tool/Skill Collection

接入：

- 内部 read model collector。
- Gateway API collector。
- 外部 web/search collector。
- Tool 状态 collector。
- Skill 状态 collector。
- Tool/Skill run collector。

### Phase 5: UI Productionization

数据分析页展示观察工作台，而不是只展示一个数据包。

## Acceptance Criteria

- 用户不需要选择业务模板，只描述业务即可生成观察对象候选。
- 系统能发现内部、外部、工具、Skill、手工输入这些来源。
- 系统能生成采集计划，并标记哪些需要用户授权。
- 工具/Skill 采集结果必须先成为 raw evidence，再标准化为 observation evidence。
- 工具/Skill 证据必须带 rawRef 或 rawOutputRef，可回读原始输出；否则不能进入正式观察包。
- 每条正式观察都有来源、时间、可信度、新鲜度、质量状态。
- 低可信、过期、冲突、模型推测、工具失败不能作为正式归因证据。
- 确认后的 ObservationPackage 仍然是归因层唯一入口。
- 数据分析页用户能看懂：发现了什么、来自哪里、缺什么、能不能确认。
- 页面不显示内部工程对象名或协议引用。
- 观察层不创建目标、不生成规划、不调度、不执行岗位。

## Production Decision

本目标按生产级标准执行，不能按程序员 demo 验收。

当前确定的观察引擎边界：

```text
输入：账号真实业务上下文 + 当前经营问题 + 当前账号可访问数据
处理：动态生成观察对象、发现来源、生成只读采集计划、真实采集、证据标准化、质量门
输出：可确认观察包候选
下游：只有用户确认后的 ObservationPackage 才能进入归因层
```

观察引擎不是固定业务模板，也不是页面静态看板。它必须服务不同客户业务：

- OpenClaw 自身：岗位商城运营、能力路由、岗位授权、调度执行、审计账本。
- 自营商城客户：商品、订单、流量、转化、库存、客服、复购、利润。
- 内容/服务类客户：内容供给、交付流程、客户反馈、渠道增长、风险事件。

业务不同，观察对象不同；证据模型、质量门、只读边界和确认规则保持统一。

## Production Runtime Requirements

### 1. Real Data Acquisition

观察引擎必须能真实获取信息：

- 内部 read model：主流程、云端商城投影、本地 OpenClaw 状态、API 管理、费用授权、岗位使用、调度执行、审计账本。
- Gateway/API：当前账号授权范围内的云端商城、能力、审核、商品、授权、调用状态。
- 外部来源：公开网页、搜索、外部 API、文档、产品/工具/模型信息、风险信息。
- 工具/Skill：只读采集、网页读取、文件解析、质量检查、信息抽取、结构化归档。
- 手工输入：用户补充事实，但必须带用户确认状态。

没有真实来源时不能静默成功，必须显示：

```text
缺连接 / 缺权限 / 缺 SecretRef / 缺用户授权 / 工具不可用 / Skill 不可用 / 数据过期 / 来源冲突
```

### 2. Tool And Skill Execution Contract

观察采集可以调用工具和 Skill，但必须满足：

- 所有步骤 `allowedSideEffects = "none"`。
- 每个步骤必须有 `purpose`、`requested_scope`、`source_surface`、`audit_ref`。
- 外部采集必须先获得用户授权或已有授权策略。
- 工具/Skill 运行结果先生成 `RawToolEvidence`。
- `RawToolEvidence` 必须有 `rawOutputRef`，否则不能进入正式观察证据。
- 工具失败、超时、返回空内容必须展示为失败或缺失，不得伪造成事实。

### 3. Evidence Contract

每条正式观察证据必须有：

```text
事实陈述
来源类型
来源名称
sourceRef
rawRef（工具/Skill/外部采集必须有）
采集时间
可信度
新鲜度
质量状态
```

大模型只能基于这些证据生成摘要。大模型生成的内容如果没有证据引用，只能进入 `rejected` 或 `needs_review`，不能进入正式归因。

### 4. Human UI Contract

数据分析页必须用真人话术回答四件事：

```text
系统理解你的业务是什么
现在建议观察哪些对象
哪些数据已经真实读到
哪些数据还缺、为什么缺、去哪里补
```

页面主动作必须形成闭环：

```text
更新业务理解
发现观察来源
生成采集计划
开始只读采集
复核观察证据
确认观察包
```

用户不能被要求理解：

```text
ObservationSignal
ObservationPackage
RawToolEvidence
sourceRef
TaskPackage
RoleResult
ledger:
audit:
artifact:
```

这些只能作为系统内部证据引用，不作为主 UI 文案。

## Current Implementation Status

已完成或已有基础：

- `BusinessContext`
- `ObservationObject`
- `ObservationQuestion`
- `ObservationSourceCandidate`
- `ObservationToolPlan`
- `RawToolEvidence`
- `ObservationEvidence`
- `ObservationQualityResult`
- `ObservationPackageCandidate`
- 业务上下文生成观察对象
- 来源发现与缺 Secret / 权限 / 用户授权判断
- 只读采集计划建模
- 工具/Skill 原始证据标准化函数
- 证据质量门
- 观察包候选
- 数据分析页观察工作台展示
- 主对话框读取观察工作台摘要
- `ObservationToolRunner` 初始骨架
- `aics.observation.toolPlan.run` 后端入口
- 内部 read model 只读采集可生成标准化观察证据
- 外部/工具/Skill 缺真实执行器时会返回阻塞证据，不伪造成成功
- `aics.observation.toolPlan.run` 会把 accepted evidence 桥接成准备态 ObservationPackage
- 数据分析页“开始观察”已接入新运行入口，并显示本次采集结果、阻塞和确认动作
- 旧 ObservationAdapter 可通过 `ObservationAdapterCollector` 接入新运行器
- 已支持把保存的外部信息连接或调用参数里的外部 URL 转成真实外部采集 collector
- 数据分析页已提供最小外部 URL 输入，可把公开网页带入“开始观察”
- 工具/Skill 观察已接入本地 read model 状态 collector，可读取能力匹配、工具/Skill 预检和阻塞摘要
- 观察采集运行会写入 `observation_evidence_runs`，刷新后能看到最近一次采集状态、质量计数和阻塞原因

尚未达到生产级完成：

- 外部 URL adapter 已能桥接进 `ObservationToolRunner`，数据分析页已有单 URL 输入；但还没有完整外部来源管理、授权确认、来源列表和历史复用。
- 工具、Skill 的状态观察已接入；真正运行工具或 Skill 采集外部/文件/质量检查结果的执行器还没有接入 `ObservationToolRunner`。
- 采集运行摘要已持久化；`RawToolEvidence`、逐条 `ObservationEvidence`、逐条质量结果还没有拆成独立明细表，目前完整 run result 先以 JSON 保存。
- 还没有完整 Gateway 方法覆盖 `toolPlan.run -> evidence.normalize -> package.candidate.create -> package.confirm`。
- 真人 Chrome 页面从“开始观察”到“证据回读再确认”的路径还没有稳定验证。
- 现有 `aics.mainFlow.observation.collect` 仍偏旧 Adapter 流程，不能代替通用观察引擎运行闭环。

因此当前状态只能判定为：

```text
架构和质量门已基本确定；
生产级真人观察闭环未完成；
不能标记为完成。
```

## Implementation Tasks

### Task 1: Observation Runtime Gateway

新增或收敛 Gateway 方法：

```text
aics.observation.businessContext.update
aics.observation.sources.discover
aics.observation.toolPlan.create
aics.observation.toolPlan.run
aics.observation.evidence.normalize
aics.observation.package.candidate.get
aics.observation.package.confirm
```

要求：

- 所有方法读取当前账号上下文。
- 外部/工具/Skill 调用必须带 actor_context、purpose、requested_scope、source_surface、audit_ref。
- 只写观察证据和观察包，不写目标、规划、调度、岗位执行。

### Task 2: Observation Tool Runner

实现统一运行器：

```text
ObservationToolPlan
-> validateObservationToolPlan
-> run step by step
-> RawToolEvidence[]
-> normalizeRawToolEvidenceToObservationEvidence
-> evaluateObservationEvidenceQuality
-> update ObservationPackageCandidate
```

运行器必须支持：

- 内部 read model collector。
- Gateway API collector。
- 外部 web/search collector。
- 外部 API collector。
- file parse collector。
- tool run collector。
- skill run collector。
- manual input collector。

### Task 3: Evidence Persistence

把观察证据持久化，页面刷新后仍能读回：

- `business_contexts`
- `observation_objects`
- `observation_questions`
- `observation_sources`
- `observation_tool_plans`
- `raw_tool_evidence`
- `observation_evidence`
- `observation_quality_results`
- `observation_package_candidates`

如短期不建新表，也必须通过现有 SQLite/state store 稳定恢复，不能只存在内存。

### Task 4: Human Observation UI

数据分析页补齐真人路径：

- 主按钮：开始观察 / 继续采集 / 复核证据 / 确认观察。
- 显示真实采集进度。
- 显示每条证据的来源、时间、可信度、质量状态。
- 显示失败来源和修复入口。
- 确认前明确说明：哪些证据进入归因，哪些不进入。

### Task 5: Main Chat Integration

主对话框必须能回答：

```text
现在观察层缺什么数据？
哪些数据已经读到了？
哪些外部来源还没授权？
哪些工具或 Skill 不能用？
能不能进入归因？
下一步去哪里点？
```

主对话框不能直接确认观察包，只能导航到数据分析页让用户确认。

### Task 6: Production Verification

验收必须覆盖真人路径：

```text
主对话框输入经营问题
更新业务上下文
生成观察对象
发现内部和外部来源
生成只读采集计划
运行采集
读回 RawToolEvidence
标准化 ObservationEvidence
质量门分类
用户确认 ObservationPackage
归因层读取 confirmed ObservationPackage
```

不能只用单元测试证明完成；必须有至少一个本地 UI 路径或 E2E 路径证明真人可用。

## Test Plan

单元测试：

- 业务上下文能生成观察对象候选。
- 观察问题能绑定观察对象。
- 数据源发现能区分可访问、缺权限、缺 Secret、需人工确认。
- 工具计划只能包含只读/采集型 step。
- 工具失败不能生成 accepted evidence。
- 无 sourceRef 的证据被 rejected。
- 过期/冲突/低可信证据进入 needs_review。
- accepted evidence 能生成 ObservationPackageCandidate。
- 无 accepted evidence 不能确认观察包。

UI 测试：

- 数据分析页显示业务理解、观察对象、数据源、采集计划、证据、质量门、观察包候选。
- 用户能看到内部来源、外部来源、工具/Skill 来源状态。
- 用户能看到缺失数据和修复入口。
- 页面不显示 `artifact:`、`ledger:`、`audit:`、`TaskPackage`、`RoleResult`。

E2E 验收：

- 主对话框输入业务问题。
- 系统更新 BusinessContext。
- 系统生成 ObservationObject。
- 系统发现内部和外部来源。
- 系统生成工具采集计划。
- 系统采集并标准化证据。
- 用户确认 ObservationPackage。
- 归因层只能读取 confirmed ObservationPackage。
