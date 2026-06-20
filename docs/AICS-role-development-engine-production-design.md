# AICS 岗位开发引擎生产级设计

## 目标

岗位开发引擎面向非程序员真人用户，不面向程序员测试。它的目标是让用户用自然语言说出一个岗位想法，系统把它变成可审核、可上架、可授权、可执行的岗位商品。

岗位开发引擎不是“生成几个 Markdown 文件”的工具。它是岗位产品从想法到上架的总控引擎。

第一版生产闭环：

```text
用户岗位想法
  -> 理解岗位需求
  -> 生成岗位定义
  -> 识别执行方式
  -> 规划能力需求
  -> 检查工具/Skill供给
  -> 处理缺失能力
  -> 生成岗位商品预览和岗位包
  -> 本地验证
  -> 提交审核
  -> 上架为可授权岗位
```

## 核心原则

- **真人优先**：用户只看到岗位能做什么、缺什么、下一步怎么处理，不看到 capability、JSON、文件路径和数据库字段。
- **本地为主**：岗位开发引擎运行在 OpenClaw 本地；云端商城负责审核、发布、授权和同步。
- **品类不是流程**：品类只影响知识、话术、质量标准和展示；开发流程由岗位开发状态机决定。
- **能力必须真实**：岗位声明的能力必须来自 Tool/Skill 供给检查；缺失能力不能伪装成已具备。
- **先基础版再增强**：缺失非核心能力时，默认允许生成基础版岗位；核心能力缺失时进入等待能力开发。
- **审核前不上架**：岗位包通过本地验证后仍必须进入 pre-listing review，不能绕过审核直接上架。

## 架构位置

```text
RoleDevelopmentEngine 岗位开发总控引擎
  ├─ BuildSessionStore        会话状态存储
  ├─ RequirementInterpreter   需求理解器
  ├─ RoleBriefPlanner         岗位定义器
  ├─ WorkPatternPlanner       执行方式识别器
  ├─ CapabilityPlanner        能力规划器
  ├─ ToolSupplyResolver       工具/Skill供给检查器
  ├─ RolePackageBuilder       岗位包生成器
  ├─ RolePackageValidator     本地验证器
  └─ ReviewSubmitter          审核/上架提交器

外部协作系统：
  ├─ Tool/Skill开发引擎        处理缺失能力
  ├─ Tool/Skill执行引擎        未来验证岗位测试任务
  ├─ 岗位执行引擎              上架后执行岗位任务
  └─ 云端商城                  审核、发布、授权、同步
```

现有 `BuildSession` 应降级为会话状态层。岗位开发决策不再散落在 `BuildSession` 和 gateway handler 里，而是集中到 `RoleDevelopmentEngine`。

## 用户可见流程

### 1. 输入岗位想法

用户输入一句自然语言：

```text
我想做一个小红书店铺运营岗位，能分析数据、生成内容计划、写笔记草稿。
```

页面只展示：

- 系统理解的岗位名称
- 服务对象
- 主要能做什么
- 不能做什么
- 预计交付结果

不展示：

- capability id
- tool id
- Skill 文件
- manifest 路径
- API 参数

### 2. 确认岗位定义

系统生成岗位定义卡：

```text
岗位名称：小红书店铺运营助手
适合用户：小红书店铺运营者
主要任务：
- 分析近期内容表现
- 找出高互动选题
- 生成下周内容计划
- 写笔记草稿
- 输出运营复盘报告

不能做：
- 不自动发布笔记
- 不自动投流
- 不承诺涨粉结果
- 不使用未授权素材
```

用户只需要选择：

- 确认
- 修改
- 重新生成

### 3. 能力检查

页面展示真人可读能力状态：

```text
已具备：
- 文案生成
- 报告生成
- 文件写入
- 打包下载

需要配置：
- 小红书数据导入：请上传表格或连接数据源

系统缺能力：
- 自动发布小红书笔记：当前不能启用
```

缺能力时提供三个选择：

- 先做基础版
- 创建能力开发请求
- 取消这个岗位

默认推荐“先做基础版”，除非缺失的是岗位核心能力。

### 4. 岗位商品预览

系统生成商品预览，不要求用户看岗位包文件：

```text
岗位商品预览

名称：小红书店铺运营助手
能做：
- 读取运营数据
- 分析内容表现
- 生成内容计划
- 写笔记草稿
- 输出运营报告

交付结果：
- 内容计划表
- 笔记草稿
- 运营复盘报告
- 打包文件
```

### 5. 本地验证

验证结果必须用真人语言展示：

```text
通过：
- 岗位说明完整
- 能力边界清楚
- 禁止动作已写明
- 输出结果可验证
- 至少有一个测试任务

已关闭：
- 自动发布小红书笔记能力缺失，基础版暂不启用
```

阻塞时必须告诉用户下一步：

```text
暂不能上架。
原因：这个岗位的核心任务依赖缺失能力。
下一步：创建工具/Skill开发请求，或修改岗位范围。
```

### 6. 提交审核/上架

用户看到：

```text
岗位已准备好，可以提交审核。

审核会检查：
- 是否夸大能力
- 是否依赖未授权工具
- 是否包含高风险动作
- 是否能被执行引擎真实调用
```

审核通过后才显示：

```text
岗位已上架，可以在“我的岗位”中授权并执行任务。
```

## 内部状态机

内部状态可以保持技术化，但必须映射为真人文案。

| 内部状态                         | 真人显示           | 说明                              |
| -------------------------------- | ------------------ | --------------------------------- |
| `created`                        | 草稿中             | 已创建岗位开发会话                |
| `understanding`                  | 理解需求中         | 正在把自然语言变成岗位定义        |
| `brief_ready`                    | 等待确认岗位定义   | 用户确认前不能生成岗位包          |
| `capability_planning`            | 规划能力中         | 识别执行方式和能力需求            |
| `supply_checking`                | 检查能力中         | 查询工具、Skill、API、插件供给    |
| `waiting_setup`                  | 等待配置能力       | 能力存在但需要 API/OAuth/插件配置 |
| `waiting_capability_development` | 等待工具/Skill开发 | 核心能力缺失                      |
| `scope_reduced`                  | 已生成基础版范围   | 非核心缺失能力已关闭              |
| `package_generating`             | 生成岗位中         | 生成岗位商品和岗位包              |
| `local_validating`               | 本地验证中         | 检查包结构、能力、风险、测试任务  |
| `ready_for_review`               | 可提交审核         | 本地验证通过                      |
| `reviewing`                      | 审核中             | 已进入 pre-listing review         |
| `published`                      | 已上架             | 已生成可授权岗位商品              |
| `blocked`                        | 已阻塞             | 需要用户或系统开发者处理          |
| `failed`                         | 生成失败           | 系统错误或模型/API失败            |
| `cancelled`                      | 已取消             | 用户取消                          |

## 关键数据契约

### RoleDevelopmentInput

```ts
type RoleDevelopmentInput = {
  userRequirements: string;
  targetUser?: string;
  expectedTasks?: string[];
  expectedOutputs?: string[];
  forbiddenActions?: string[];
  preferredCategory?: string;
};
```

### RoleBrief

```ts
type RoleBrief = {
  roleTitle: string;
  roleDescription: string;
  targetUser: string;
  workPatterns: Array<"generate" | "analyze" | "transform" | "operate" | "composite">;
  coreResponsibilities: string[];
  taskExamples: string[];
  inputTypes: string[];
  outputTypes: string[];
  forbiddenActions: string[];
  qualityStandards: string[];
  humanConfirmationRules: string[];
};
```

### CapabilityPlan

```ts
type CapabilityPlan = {
  requiredCapabilities: string[];
  optionalCapabilities: string[];
  highRiskCapabilities: string[];
  disabledCapabilities: Array<{
    capability: string;
    reason: string;
    userMessage: string;
  }>;
};
```

### CapabilitySupplyCheck

```ts
type CapabilitySupplyCheck = {
  capability: string;
  status: "available" | "needs_setup" | "missing";
  userLabel: string;
  userMessage: string;
  nextAction:
    | "bind"
    | "configure_api"
    | "install_plugin"
    | "create_development_request"
    | "disable_for_basic_version";
};
```

### CapabilityDevelopmentRequest

```ts
type CapabilityDevelopmentRequest = {
  capability: string;
  sourceRolePackageId?: string;
  sourceListingDraftId?: string;
  requiredInput: string;
  requiredOutput: string;
  riskBoundaries: string[];
  acceptanceCriteria: string[];
};
```

### RoleDevelopmentResult

```ts
type RoleDevelopmentResult = {
  sessionId: string;
  status: string;
  userStatusLabel: string;
  roleBrief?: RoleBrief;
  capabilityPlan?: CapabilityPlan;
  supplyChecks: CapabilitySupplyCheck[];
  missingCapabilityRequests: CapabilityDevelopmentRequest[];
  packagePreview?: RoleListingPreview;
  packageDir?: string;
  validation?: RolePackageValidationResult;
  reviewId?: string;
  roleListingId?: string;
};
```

## 岗位包产物

内部必须生成完整岗位包：

- `manifest.json`
- `listing.md`
- `README.md`
- `SOP.md`
- `skills.md`
- `knowledge.md`
- `templates.md`
- `validation.md`

文件职责：

- `manifest.json`：机器可读岗位定义、版本、能力、执行方式 `workPatterns`、输出契约 `outputContracts`、风险等级。
- `listing.md`：真人可读岗位商品页。
- `README.md`：开发者/审核员说明。
- `SOP.md`：岗位工作方式。
- `skills.md`：依赖的 Skill / capability。
- `knowledge.md`：领域知识。
- `templates.md`：输入输出模板。
- `validation.md`：验证标准、失败条件、测试任务。

用户界面不直接展示这些文件路径，只展示岗位商品预览和验证结果。

## 风险边界

默认自动允许：

- 本地生成文件
- 本地写报告
- 本地打包
- 生成草稿
- 分析用户上传数据

必须人工确认：

- 真实 API 调用产生费用
- 发布内容
- 上传商品
- 修改库存
- 删除数据
- 发送消息
- 对外部系统写入
- 付款、扣费、投流

默认禁止：

- 未审核开源工具自动上线
- 未授权素材使用
- 绕过 API 管理
- 绕过 Tool/Skill 供给检查
- 绕过审核直接上架
- 声明不存在或未审核的能力

## 与现有模块的关系

### BuildSession

保留，但只做会话状态存储：

- 创建/加载/列表
- 记录用户输入
- 记录 brief
- 记录进度
- 记录 packageDir
- 记录 validationErrors
- 记录 blockedReason

不再负责：

- 品类决定能力
- 缺能力决策
- 是否允许生成岗位包
- 是否允许进入审核

### Gateway Build Session Handler

保留 RPC 入口，但不直接做岗位开发决策。它应该调用 `RoleDevelopmentEngine`。

现有 `aics.buildSession.generate` 里直接调模型、解析文件、启动审核的逻辑，后续应迁移到引擎层。

### ToolSupply

作为能力现实检查器：

- 工具是否存在
- Skill 是否可用
- API 是否配置
- 插件是否启用
- 能力是否需要开发

### RolePreListingReview

作为审核/上架系统：

- 检查岗位包结构
- 检查能力绑定
- 检查风险边界
- 审核通过后进入本地或云端上架

### Tool/Skill 开发引擎

岗位开发引擎发现缺失能力时，只创建 `CapabilityDevelopmentRequest`。搜索开源、改造开源框架、生成待审工具包属于引擎 2。

## 第一版实施阶段

### P0：文档和边界收口

- 创建本设计文档。
- 明确 `BuildSession` 降级为状态层。
- 明确新增 `RoleDevelopmentEngine` 为总控层。
- 明确缺能力不能伪装成可用。

完成标准：

- 后续实现不再把 `BuildSession` 当岗位开发大脑。

### P1：引擎骨架

- 新增 `RoleDevelopmentEngine`。
- 定义 `RoleBrief`、`CapabilityPlan`、`CapabilitySupplyCheck`、`RoleDevelopmentResult`。
- 让现有 build session RPC 通过引擎推进状态。
- 保持现有 UI/RPC 兼容。

完成标准：

- 创建岗位、理解需求、提交 brief、能力检查可以走统一引擎返回。

### P2：能力检查和缺失处理

- 接入 ToolSupply。
- 输出 `available / needs_setup / missing`。
- 非核心 missing 可生成基础版。
- 核心 missing 进入 `waiting_capability_development`。
- 创建 `CapabilityDevelopmentRequest`。

完成标准：

- 小白页面能看到“已具备 / 需要配置 / 系统缺能力”。

### P3：岗位包生成和本地验证

- 岗位包生成由引擎统一调用。
- 生成岗位商品预览。
- 本地验证覆盖文件、能力、执行契约、风险、测试任务。
- 验证通过后进入 `ready_for_review`。

完成标准：

- 用户不用看文件，也能知道岗位是否可提交审核。

### P4：审核和上架闭环

- 引擎调用 pre-listing review。
- 审核通过后上架为本地岗位商品。
- 上架岗位能进入“我的岗位”授权执行。

完成标准：

- 真人从一句岗位想法开始，能得到一个可授权、可执行的岗位。

## 验收标准

生产级验收必须走真人路径：

1. 用户输入自然语言岗位想法。
2. 系统生成岗位定义卡。
3. 用户确认或修改。
4. 系统展示能力检查结果。
5. 缺能力时可选择“先做基础版”。
6. 系统生成岗位商品预览。
7. 系统完成本地验证。
8. 用户提交审核。
9. 审核通过后上架。
10. 上架岗位出现在“我的岗位”，可进入授权执行链路。

不可接受：

- 只通过命令行生成岗位包。
- 只检查文件存在，不验证能力真实供给和执行契约。
- 页面暴露 capability id 让小白决策。
- 缺能力时仍允许上架完整岗位。
- 审核前直接发布岗位。

## 测试计划

### 产品验收测试

- 小白输入岗位想法，系统生成岗位定义。
- 用户确认岗位前能看到“执行方式”和“交付物”预览，知道岗位不是按单一业务形态写死。
- 能力检查显示已具备、需配置、缺失三类。
- 页面正文用“商城数据读取、审计记录、图片生成”等真人语言展示能力，不让小白直接按 capability id 做决策。
- 生成被阻断时，页面必须用真人语言说明原因、缺失项和下一步动作，不能只灰掉按钮。
- 缺失非核心能力时可生成基础版。
- 缺失核心能力时进入等待工具/Skill开发。
- 岗位商品预览可读。
- 本地验证结果可读。
- 岗位生成完成页展示上架准备清单，说明正式品类、综合检查、人工审核、开发者确认上架各自是否完成。
- 审核通过后可上架。
- 岗位商品生成后，页面继续提示“费用与授权 -> 岗位执行 -> 读取图片/详情页/摘要/打包文件/审计/账本”的拿结果路径。
- 本地验收报告不能把已通过闭环的本地能力引用显示成“品类能力缺失”；没有云端品类 id 但本地能力覆盖并已执行读回时，应显示“本地能力已覆盖”。
- 本地验收命令必须可写出机器可读 acceptance manifest，记录本地闭环证据和云端最终验收剩余门槛，便于交接和后续云端升级复用。
- 云端 SaaS 未验收时，readiness 必须输出可执行检查清单：缺哪个字段、字段的人话含义、复查命令和密钥处理规则。

### 技术测试

- `RoleDevelopmentEngine` 能从需求生成 `RoleBrief`。
- 能识别 work patterns。
- 能生成 `CapabilityPlan`。
- 能调用 ToolSupply 生成 supply checks。
- missing capability 不允许作为 available 写入岗位包。
- 高风险能力必须生成人工确认规则。
- 生成岗位包必须包含全部必要文件。
- 生成岗位包必须声明 `workPatterns` 和 `outputContracts`，否则执行引擎不知道如何运行、验收。
- 本地验证失败不能进入审核。
- 审核通过前不能上架。
- 上架后能生成 `roleListingId`。

## 当前实现状态

截至本地实现收口，第一版岗位开发闭环已从“BuildSession 直接生成文件”升级为：

```text
RoleDevelopmentEngine
  -> BuildSession 状态层
  -> CategoryCapabilityReview 品类能力审核
  -> ToolSkillDevelopmentTask 工具/Skill开发待办
  -> ToolSupply 激活能力包
  -> BuildSession 生成岗位包
  -> RolePreListingReview 本地上架审核
```

已落地能力：

- `RoleDevelopmentEngine` 统一返回岗位开发状态、真人可读状态文案、下一步动作、能力缺口和工具/Skill开发进度。
- 岗位 Brief 页面展示真人可读的“执行与交付预览”，把系统推断出的通用执行方式和输出契约翻译成非程序员能理解的文案。
- 岗位包生成被阻断时，页面展示“现在还不能生成完整岗位包”的人话说明，列出缺失能力和可执行下一步。
- 能力分析、生成阻断和完成页会把常见 capability / tool / skill / provider 引用翻译成真人可读标签，内部 ID 仅保留在排查用提示中。
- 岗位生成完成页展示“上架准备清单”，把绑定正式品类、综合检查、人工审核和正式商品生成拆成可理解的完成/待处理状态。
- 正式岗位商品生成后，完成页展示“执行拿结果路径”，并提供去费用与授权、去岗位执行入口。
- 本地 demo 验收报告会区分“云端品类 id 未写入”和“本地能力已覆盖”，避免 PASS 报告里出现误导性的“品类能力缺失”。
- `aics-local-demo-verify --output <path>` 会写出本地 acceptance manifest，包含 `chainEvidence`、业务产物、审计账本、费用/人工确认和 `productionFinalGate`。
- `aics-local-demo-verify --timeout-ms <ms> --output <path>` 外层会保护 readiness 调用；如果本地服务、数据库或 gateway 初始化卡住，会返回 `readinessTimeout` 阻塞报告并仍然写出 manifest，不让真人验收卡死。
- production-plus readiness JSON / Markdown 会输出 `operatorChecklist`，给出云端商城、本地 OpenClaw、bridge bearer、执行令牌公钥、三类身份 token 的人话准备步骤和复查命令。
- 缺核心能力时，`aics.buildSession.generate` 会阻断岗位包生成，不能伪装成已具备能力。
- 用户点击“创建能力开发请求”后，系统复用 `CategoryCapabilityReview` 进入本地审核中心。
- 品类能力审核通过后，系统自动创建 `ToolSkillDevelopmentTask`，工具与 Skill 供给页面可以继续规划来源、选择来源、标记运行实现、运行综合检查。
- 工具/Skill 待办审核通过并激活后，岗位开发状态变为“能力可用，可以生成岗位包”。
- 缺失非核心能力时，用户可以点击“先做基础版”。系统只保留用户 Brief 中已具备的能力，把缺失能力写入基础版关闭说明，避免岗位包继续声明不可用能力。
- 岗位包生成支持 API Key / SecretRef 模型 Provider，也支持 OpenAI OAuth + `auto` 通过 Codex Responses 生成，不要求用户填写 OpenAI API Key。
- 岗位包生成成功后自动创建本地 pre-listing review，并与已通过的品类能力审核绑定。
- 岗位包生成和本地 pre-listing review 会检查 `workPatterns` / `outputContracts`，避免岗位包只像商品页、不能被执行引擎稳定运行和验收。

已有验证：

- `aics-build-session.test.ts` 覆盖缺能力阻断、基础版范围裁剪、能力开发待办、激活后允许生成、OpenAI OAuth auto 无 API Key 生成岗位包。
- `build-session.test.ts` 覆盖前端岗位开发状态刷新和创建能力开发请求。
- `build-session.test.ts` 覆盖“先做基础版”按钮和裁剪动作。
- `build-session.test.ts` 覆盖岗位 Brief 页面的执行方式和交付物预览。
- `build-session.test.ts` 覆盖生成阻断时的人话原因和下一步动作。
- `build-session.test.ts` 覆盖岗位开发页能力名的人话展示，避免正文直接暴露内部 capability id。
- `build-session.test.ts` 覆盖完成页上架准备清单在未绑定、待检查、待人工审核和已上架状态下的提示。
- `build-session.test.ts` 覆盖岗位商品生成后的执行拿结果路径和跳转到岗位执行入口。
- `aics-local-demo-verify.test.ts` 覆盖无云端品类 id 但本地能力引用和执行证据完整时，真人摘要显示“本地能力已覆盖”。
- `aics-local-demo-verify.test.ts` 覆盖 `--output` 写出本地验收 acceptance manifest。
- `aics-local-demo-verify.test.ts` 覆盖 readiness 超时时仍写出 blocked acceptance manifest，避免真人验收卡死且没有结果文件。
- 2026-06-20 本机真实验收：`node --import tsx scripts/aics-local-demo-verify.ts --json --require-executed --timeout-ms 15000 --output /private/tmp/aics-local-acceptance-manifest-codex-require-executed.json` 返回 `ok: true`、`executed: true`、`requireExecuted: true`，读回图片 `hero.png`、详情页 `detail.html`、执行摘要、产物包、审计、账本、费用摘要和人工确认。
- 2026-06-20 云端 readiness：`node scripts/persona/aics-production-plus-readiness.mjs --output-dir /private/tmp/aics-production-plus-readiness-latest` 正确返回 `status: blocked`，写出 `readiness.json`、`readiness.md`、`env-template.sh`，缺口是云端商城地址、本地 OpenClaw 地址、bridge bearer、执行令牌公钥和开发者/管理者/购买者 token。
- `aics-production-plus-persona.test.ts` 覆盖 production-plus readiness 的 operator checklist、字段人话标签、复查命令和密钥不泄露。
- `build-session-category-binding.e2e.test.ts` / `tool-skill-category-production.e2e.test.ts` 覆盖真人页面路径中的审核、激活和工具/Skill处理动作。

## 剩余差距

当前代码已有可复用基础：

- `role-build-session.ts`：会话状态、岗位包文件生成、基础校验。
- `aics-build-session.ts`：BuildSession 网关入口。
- `role-pre-listing-review.ts`：审核、能力分析、上架。
- `tool-supply-control/model.ts`：工具/Skill/API/能力供给读模型。

当前不足：

- `BuildSession` 仍承担岗位包文件写入和校验，后续可继续下沉为 `RolePackageBuilder` / `RolePackageValidator`。
- 页面已经有可点击闭环，但仍偏“开发中心流程”，还不是完整的新手向导式岗位产品开发体验。
- 第一版已支持“先做基础版并关闭缺失能力”，但核心/非核心能力的自动判定仍较保守，后续可增加用户明确勾选保留/关闭能力的向导。
- 本地验证已能挡文件结构、能力缺口和执行契约缺失，但还可以继续增强为“用测试任务跑一次岗位执行引擎”的验证。

## 结论

引擎 1 的生产级形态是：

```text
RoleDevelopmentEngine = 岗位产品从想法到可上架的总控引擎
```

它站在 BuildSession、ToolSupply、RolePreListingReview 之上。BuildSession 只是状态层；ToolSupply 是能力现实检查器；RolePreListingReview 是审核上架系统。

第一版成功的标志不是“生成了岗位包文件”，而是：

```text
真人用户不写代码、不看配置、不跑命令，
从一句岗位想法出发，
得到一个通过本地验证、审核后可上架、可授权、可执行的岗位商品。
```
