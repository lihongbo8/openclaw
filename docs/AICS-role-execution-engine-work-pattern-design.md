# AICS 岗位执行引擎 Work Pattern 生产级设计

## 目标

岗位执行引擎面向非程序员真人用户。它的目标不是证明代码能跑，而是让用户在“我的岗位 / 岗位执行”里点击一个已授权、已派发的岗位任务后，系统能真实执行、交付可验收结果，并在失败时告诉用户下一步该去哪里处理。

岗位执行引擎只负责执行：

```text
RolePackage + TaskPackage + DispatchToRoleRequest
  -> RoleExecutionPlan
  -> Tool/Skill calls
  -> Business artifacts
  -> RoleResult + audit + ledger
```

它不负责岗位开发、品类规划、创建任务、授权购买、工具实现、正式记忆写入或账本伪造。前置系统已经完成岗位定义、品类规划、能力需求、SOP、质量标准、输入输出、风险边界和工具/Skill 需求；执行引擎只读取这些事实并把本次任务跑完。

## 核心抽象

执行引擎按执行方式设计，不按品类设计。

```text
第一层：Work Pattern 执行方式
第二层：Output Contract 输出契约
第三层：Business Context 业务上下文
```

### Work Pattern

Work Pattern 决定“这次任务怎么跑”。

| Work Pattern | 含义                           | 例子                                                 |
| ------------ | ------------------------------ | ---------------------------------------------------- |
| `generate`   | 从输入生成新产物               | 图片、文案、详情页、报告、PPT、合同草稿              |
| `analyze`    | 从数据或资料中提取结论         | 表格分析、竞品分析、运营诊断、财务总结               |
| `transform`  | 把一种材料转成另一种格式或结构 | Markdown 转 PDF、表格转报告、长文转短视频脚本        |
| `operate`    | 对外部系统执行动作             | 上传商品、发布文章、修改库存、创建工单               |
| `composite`  | 多种执行方式串联               | 分析数据 -> 生成报告 -> 写详情页 -> 打包 -> 提交审核 |

当前“图片 + 详情页”不是电商品类专属执行器，而是：

```text
workPatterns = ["generate", "composite"]
outputContracts = ["image", "html", "package"]
```

### Output Contract

Output Contract 决定“结果如何验收”。

| Output Contract   | 成功条件                                      |
| ----------------- | --------------------------------------------- |
| `image`           | 本地文件存在、非空、格式可识别、可被预览      |
| `html`            | 文件存在、可打开、引用资源存在、页面主体非空  |
| `document`        | 文件存在、可读取、正文非空、有可读摘要        |
| `spreadsheet`     | 文件存在、表结构可读、关键字段或 sheet 存在   |
| `json`            | 文件存在、JSON 可解析、必要 schema / 字段通过 |
| `external_record` | 外部系统返回 record id，并且可以回读验证      |
| `package`         | manifest 存在，压缩包非空，列出的产物都可读取 |

没有业务产物，不能成功。审计和账本是治理证据，不能替代业务结果。

### Business Context

Business Context 只影响内容和质量，不决定执行流程。

```text
businessCategory
domainKnowledge
vocabulary
inputHints
qualityStandards
styleRules
metricRules
forbiddenActions
```

例如电商详情页、招聘岗位页、课程介绍页、SaaS 产品页和活动报名页可以共用 `generate + html + package` 执行方式。品类只改变用词、字段、知识、风格和质量标准。

禁止把执行逻辑写成：

```text
if category === "ecommerce" then run ecommerce executor
```

应该写成：

```text
run WorkPattern template with BusinessContext
```

## 引擎职责边界

### 负责

- 读取 `TaskPackage`、`DispatchToRoleRequest`、岗位包、正式记忆和调度上下文。
- 从岗位包读取 `workPatterns`、`outputContracts`、`requiredSkills`、`requiredTools`、`validationRules` 和 `riskPolicy`。
- 生成本次 `RoleExecutionPlan`，包含当前状态、目标状态、差距、执行选择、步骤、产物和验收规则。
- 执行前检查授权、费用、Tool/Skill、API、人类确认和风险。
- 通过 Tool/Skill 执行引擎调用真实能力。
- 按 Output Contract 验收业务产物。
- 汇总 `RoleResult`、步骤、工具调用、模型用量、工具用量、审计和账本证据。
- 为非程序员页面提供明确状态、结果位置、费用摘要和恢复建议。

### 不负责

- 不设计岗位，不规划品类，不创建岗位包。
- 不创建任务，不绕过调度层派活。
- 不实现具体工具，不直接绕过 Tool/Skill 执行引擎。
- 不自动批准高风险 `operate` 动作。
- 不写正式记忆，只能提出 memory candidate。
- 不伪造 completed 审计、账本或业务产物。

## 内部模块

```text
RoleExecutionEngine
  ├─ ContextLoader
  ├─ WorkPatternResolver
  ├─ ExecutionPlanBuilder
  ├─ PreflightGate
  ├─ WorkflowRunner
  ├─ OutputValidator
  ├─ ArtifactPackager
  ├─ EvidenceRecorder
  └─ HumanReadablePresenter
```

### ContextLoader

读取执行上下文：

- `TaskPackage`
- `DispatchToRoleRequest`
- `manifest.json`
- `SOP.md`
- `skills.md`
- `knowledge.md`
- `templates.md`
- `validation.md`
- 已确认正式记忆
- `allowedSkills`
- `allowedTools`
- API 绑定状态
- 授权、人工执行确认和费用确认状态

### WorkPatternResolver

优先读取岗位包 manifest 中的声明：

```json
{
  "workPatterns": ["generate", "composite"],
  "outputContracts": ["image", "html", "package"],
  "businessCategory": "电商",
  "requiredSkills": ["img:gen", "ws:write", "quality:check", "file:pack"],
  "requiredTools": [
    "core.openai.image.generate",
    "core.workspace.detail.write",
    "core.artifact.quality.check",
    "core.artifact.package.bundle"
  ]
}
```

如果旧岗位包缺少 `workPatterns` 或 `outputContracts`，允许从 `TaskPackage`、required capabilities 和岗位包文本做保守推断，但必须写入：

```text
executionEvidence.inferredWorkPattern
executionEvidence.inferredOutputContracts
```

推断只能用于兼容旧包，不能作为新岗位包的长期规范。

### ExecutionPlanBuilder

每次执行必须先生成计划，最少包含：

```text
当前状态
目标状态
差距
执行选择
执行步骤
需要的 Skill/Tool
预期业务产物
验收规则
风险和人工确认点
失败恢复建议
```

计划写入 `executionEvidence.executionPlan`，供结果页和审计读回。

### PreflightGate

执行前必须通过：

| 检查                                          | 失败结果                                     |
| --------------------------------------------- | -------------------------------------------- |
| 存在 `TaskPackage` 和 `DispatchToRoleRequest` | blocked：请先到任务调度生成派发单            |
| 存在 `roleListingId` 和 `entitlementId`       | blocked：请先完成岗位授权                    |
| `confirmExecution=true`                       | blocked：请先人工确认本次执行                |
| `costConfirmed=true` 且有费用凭证             | blocked：请先确认本次费用                    |
| `allowedSkills` 覆盖计划需要的 Skill          | blocked：请回任务调度或工具与 Skill 处理能力 |
| `allowedTools` 覆盖计划需要的 Tool            | blocked：请回工具与 Skill 检查授权           |
| API 管理中有需要的 Provider                   | blocked：请到 API 管理连接模型或服务         |
| 高风险 `operate` 已人工确认                   | blocked：请人工确认外部动作                  |

Preflight 未通过时不得调用模型、不得调用工具、不得上传成功审计、不得写完成账本。

### WorkflowRunner

通用执行阶段：

```text
generate:
  intake -> generate_content -> write_artifact -> validate -> package

analyze:
  intake -> read_sources -> extract_facts -> infer_findings -> write_report -> validate -> package

transform:
  intake -> read_source -> transform_format -> validate_target -> package

operate:
  intake -> final_human_confirm -> execute_external_action -> readback_verify -> audit

composite:
  run ordered sub-patterns, each with step records and validation
```

所有工具调用必须通过 Tool/Skill 执行引擎，形成工具调用记录。

### OutputValidator

按 Output Contract 验证结果。验证失败时：

- `RoleResult.outcome = blocked` 或 `failed`
- `executionEvidence.validation` 写入失败项
- UI 显示业务语言原因
- 不显示完成态

### EvidenceRecorder

成功结果必须包含：

```text
executionId
taskPackageId
dispatchToRoleRequestId
roleListingId
entitlementId
workPatterns
outputContracts
businessCategory
executionPlan
steps
toolCalls
artifactRefs
validation
modelUsage
toolUsage
humanConfirmationRef
auditRef
ledgerRef
costSummary
memoryCandidates
```

失败或阻塞必须包含：

```text
blockedReason / error
failedStep
recoverySuggestion
partialArtifacts?
toolCalls?
validation?
```

`memoryCandidates` 只能写入待人工确认的候选池，证据里必须带 `candidateId`、`status=pending` 和 `requiresHumanConfirm=true`。执行引擎不得直接创建或更新正式记忆；正式记忆只能由人工确认流程晋升。

审计或账本读回失败时，结果必须降级为 blocked，不能显示完成。

## 非程序员真人体验

页面不展示：

- `TaskPackage`
- `DispatchToRoleRequest`
- capability id
- tool id
- manifest 路径
- raw ledger JSON
- raw audit JSON
- 本地绝对文件路径

页面展示：

- 任务名称
- 岗位名称
- 当前状态
- 正在做什么
- 需要用户确认什么
- 结果在哪里
- 是否产生费用
- 失败后下一步去哪里

状态文案固定：

| 状态                      | 真人文案     |
| ------------------------- | ------------ |
| `ready`                   | 待执行       |
| `preflight`               | 执行前检查中 |
| `needs_cost_confirmation` | 需要确认费用 |
| `needs_api_binding`       | 需要配置 API |
| `running`                 | 正在执行     |
| `generating_artifacts`    | 正在生成结果 |
| `validating`              | 正在检查结果 |
| `completed`               | 已完成       |
| `blocked`                 | 已阻塞       |
| `failed`                  | 执行失败     |

失败提示必须是动作型：

| 原因           | 下一步                             |
| -------------- | ---------------------------------- |
| 未授权         | 去费用与授权开通岗位               |
| 未确认执行     | 在岗位执行页确认本次执行           |
| 未确认费用     | 在岗位执行页确认费用               |
| 缺 API         | 去 API 管理连接模型或服务          |
| 缺 Tool/Skill  | 去工具与 Skill 处理能力            |
| 产物缺失       | 重新执行或联系系统开发者检查执行器 |
| 审计或账本缺失 | 刷新读回；仍缺失时联系系统开发者   |
| 重复执行       | 去任务调度重新生成派发单           |

## 数据契约

### Manifest 扩展

```ts
type RolePackageManifestV2 = {
  roleId: string;
  title: string;
  description: string;
  version: string;
  workPatterns: Array<"generate" | "analyze" | "transform" | "operate" | "composite">;
  outputContracts: Array<
    "image" | "html" | "document" | "spreadsheet" | "json" | "external_record" | "package"
  >;
  businessCategory?: string;
  requiredCapabilities: string[];
  requiredSkills?: string[];
  requiredTools?: string[];
  workflows: string[];
  skills: string[];
  knowledgeFiles: string[];
  templateFiles: string[];
  sopFiles: string[];
  riskPolicy?: {
    externalWriteRequiresHumanConfirm: boolean;
    paidApiRequiresCostConfirm: boolean;
    forbiddenActions: string[];
  };
  artifactPolicy?: {
    minBusinessArtifacts: number;
    requiredOutputContracts: string[];
    packageRequired: boolean;
  };
  validationRules?: Array<{
    outputContract: string;
    rule: string;
    severity: "blocking" | "warning";
    userMessage: string;
  }>;
};
```

### RoleExecutionPlan

```ts
type RoleExecutionPlan = {
  executionId: string;
  workPatterns: string[];
  outputContracts: string[];
  businessCategory?: string;
  currentState: string;
  targetState: string;
  gap: string;
  executionChoice: string;
  steps: Array<{
    stepId: string;
    pattern: string;
    title: string;
    expectedOutputContracts: string[];
    requiredSkills: string[];
    requiredTools: string[];
    humanConfirmRequired: boolean;
  }>;
  validationRules: Array<{
    outputContract: string;
    rule: string;
    severity: "blocking" | "warning";
    userMessage: string;
  }>;
};
```

### RoleExecutionEvidence

```ts
type RoleExecutionEvidence = {
  executionId: string;
  workPatterns: string[];
  outputContracts: string[];
  businessCategory?: string;
  executionPlan: RoleExecutionPlan;
  steps: unknown[];
  toolUsage: unknown;
  modelUsage: unknown;
  validation: {
    passed: boolean;
    failures: Array<{ outputContract: string; message: string }>;
  };
  humanConfirmationRef?: string;
  auditRef?: string;
  ledgerRef?: string;
  costSummary?: unknown;
  recoverySuggestion?: string;
};
```

## 首版落地范围

首版支持：

```text
generate
analyze
transform
composite
```

`operate` 首版只实现门禁、计划和人工确认证据，不自动执行外部写入。

首版样例：

| 场景       | Work Pattern                     | Output Contract                    |
| ---------- | -------------------------------- | ---------------------------------- |
| 详情页生成 | `generate + composite`           | `image + html + package`           |
| 运营诊断   | `analyze + generate + composite` | `document + json + package`        |
| 材料转换   | `transform`                      | `html` 或 `document + package`     |
| 数据转报告 | `analyze + transform`            | `spreadsheet + document + package` |

现有 `role-product-execution-workflow.ts` 迁移为 `generate + composite` 的默认模板，保留当前图片、详情页、执行摘要、manifest 和 ZIP 能力，但不再以电商品类命名。

## 生产级硬规则

- 调度层是唯一任务来源。
- 执行引擎不能创建任务。
- 执行引擎不能绕过岗位授权、人工确认或费用确认。
- 执行引擎不能绕过 Tool/Skill 执行引擎。
- 执行引擎不能修改正式记忆，只能登记待人工确认的 memory candidate。
- 外部写入、发布、删除、付款、投流必须人工确认。
- 成功必须有业务 artifact。
- 审计和账本不能替代业务结果。
- 同一派发单成功后不能重复执行。
- 多个 execution 的产物必须隔离。
- 失败可以记录证据，但不能伪装成功。
- UI 必须显示 recoverySuggestion。
- 品类只作为 Business Context，不能作为执行器分支。

## 验收标准

生产级验收必须证明：

1. 非程序员能点击执行并拿到结果。
2. 页面三秒内能让用户知道结果在哪里。
3. 缺授权、缺费用、缺 API、缺工具、缺产物、缺审计、缺账本都不能显示完成。
4. 同一 Work Pattern 能跨多个品类复用。
5. 执行记录能复盘每一步和每次工具调用。
6. 结果页能展示业务产物、费用摘要、审计状态和下一步动作。
7. `generate + html + package` 可以服务电商详情页、招聘岗位页、课程介绍页、SaaS 产品页和活动报名页，不新增品类执行器。
8. `analyze + document/json/package` 可以服务商城运营诊断、竞品分析和财务总结，不新增品类执行器。

## 测试计划

### 单元测试

- WorkPatternResolver 从 manifest 读取 `workPatterns` 和 `outputContracts`。
- 旧 manifest 缺字段时能保守推断，并写入 inferred evidence。
- PreflightGate 分别阻断未授权、未确认执行、未确认费用、缺 Skill、缺 Tool、缺 API。
- OutputValidator 分别验证 image、html、document、spreadsheet、json、external_record、package。
- `operate` 未人工确认时必须 blocked。

### 集成测试

- `generate + image/html/package` 生成业务产物并写入 RoleResult。
- `analyze + document/json/package` 生成分析报告和证据摘要。
- `transform + document/package` 能转换材料并通过验收。
- `composite` 串联多个 pattern，每段都有 step 和 tool call。
- 审计或账本 readback 缺失时降级 blocked。
- 同一派发单重复执行被拒绝。
- 多任务同名产物按 `executionId` 隔离。

### UI / E2E

- 非程序员从岗位执行页点击执行，看到运行状态、结果入口、费用摘要、审计账本状态。
- API 401、余额不足、限流、产物缺失、审计失败、账本失败都显示动作型下一步。
- 结果页不暴露 raw JSON、内部 id、manifest 路径或本地绝对路径。

## 与现有实现的迁移关系

当前实现已经具备：

- `RoleExecutionEngine.prepare()` 创建执行上下文和工作区。
- `RoleExecutionEngine.execute()` 汇总 `RoleResult` 和 `executionEvidence`。
- `role-product-execution-workflow.ts` 调用 Tool/Skill 执行引擎生成图片、详情页、摘要、manifest 和 ZIP。
- `aics.execution.run` 执行前检查授权、费用、API，并回写 RoleResult、RoleInstance、审计和账本引用。

迁移顺序：

1. 增加 manifest v2 兼容读取，不破坏旧岗位包。
2. 增加 WorkPatternResolver 和 RoleExecutionPlan 数据结构。
3. 将现有图片/详情页链路标记为 `generate + composite` 默认模板。
4. 增加 OutputValidator，把现有 quality check 升级成按 Output Contract 验收。
5. 增加 analyze / transform 通用模板。
6. 将 UI 文案改为 Work Pattern 和真人状态，不显示技术字段。
7. 最后启用 `operate` 的人工确认框架，仍不自动执行外部写入。
