# AICS 两个执行引擎生产化计划

## 目标

让非程序员用户在“我的岗位/执行台”点击一个已授权岗位任务后，系统能真实执行并返回可用结果。

当前图片和详情页链路只是第一批已落地实例，不再作为岗位执行引擎的架构边界。岗位执行引擎的生产级通用设计以 [AICS 岗位执行引擎 Work Pattern 生产级设计](./AICS-role-execution-engine-work-pattern-design.md) 为准：引擎按 `Work Pattern -> Output Contract -> Business Context` 运行，品类只作为业务上下文和知识包，不决定执行流程。

## 两个引擎

### 1. 岗位执行引擎

位置：`src/aics-main-flow/role-execution-engine.ts`

职责：

- 读取 TaskPackage、岗位包、正式记忆和调度上下文。
- 创建独立执行工作区。
- 先做当前状态、目标状态、差距、执行选择分析。
- 按 Work Pattern 生成执行计划，并编排工具/Skill 执行链。
- 按 Output Contract 验收业务产物。
- 汇总 RoleResult、步骤、工具调用、产物、模型用量、审计证据。

当前状态：

- 已存在并可创建执行上下文。
- 已能收集本地图片、HTML、JSON、ZIP 等产物。
- 已能把执行步骤、工具调用、正式记忆和失败恢复建议写入 executionEvidence。
- 正在从第一版图片/详情页产品链路升级为 Work Pattern 通用执行模板：`generate`、`analyze`、`transform`、`operate`、`composite`。

### 2. 工具/Skill 执行引擎

位置：`src/aics-main-flow/tool-skill-execution-engine.ts`

职责：

- 把岗位工作流里的 Skill 解析成工具 capability。
- 检查本次调度允许的 Skill/Tool。
- 调用 ToolRegistry 里的真实工具。
- 把工具调用写入 ToolExecutionDb，保留可审计记录。

当前状态：

- 已存在并有单元测试。
- 已能阻止未授权 Skill 或 Tool。
- 已接入第一版核心工具：OpenAI 图片生成、详情页写入、质量检查、产物清单。

## 当前图片/详情页实例流程

入口：`aics.execution.run`

用户点击执行后：

1. 主流程检查任务是否可执行、是否已授权、是否已确认费用。
2. API 管理解析 OpenAI 连接，优先顺序为 `image`、`role_execution`、`model`。
3. 如果模型显示为 `auto`，图片工具内部映射为 `gpt-image-1`。
4. 岗位执行引擎创建工作区并执行分析步骤。
5. 工具/Skill 执行引擎调用 `img:gen`，写入 `hero.png`。
6. 调用 `ws:write`，写入 `detail.html`。
7. 调用 `quality:check`，检查图片和 HTML 是否真实存在且非空，并检查 HTML 图片引用是否可打开。
8. 调用 `file:pack`，写入 `artifact-manifest.json` 和真实 `artifacts.zip`。
9. 主流程写回 RoleResult、RoleInstance、RoleRun、RoleArtifact、账本引用和审计引用。
10. 前端结果页可以读取 artifactRefs，用户拿到本地文件路径并打开结果。

这条链路后续归类为：

```text
workPatterns = ["generate", "composite"]
outputContracts = ["image", "html", "package"]
businessCategory = 由岗位包注入
```

同一执行方式应可服务电商详情页、招聘岗位页、课程介绍页、SaaS 产品页和活动报名页，不新增品类执行器。

## 非程序员验收标准

一次成功执行必须满足：

- 不要求用户额外配置 OpenAI API Key，只使用 API 管理里的 OpenAI 连接。
- 执行结果不是一段摘要，而是至少包含：
  - `hero.png`
  - `detail.html`
  - `artifact-manifest.json`
  - `artifacts.zip`
- 失败时显示明确原因，例如 API 未绑定、OpenAI 未返回图片、Skill/Tool 未被允许。
- 执行记录能看到每一步和每个工具调用。
- 审计和账本引用能随 RoleResult 回写。

## 小白真人操作路径

面向非程序员用户，页面必须只暴露业务动作，不暴露数据库、工作区路径或命令行。

1. 用户进入“我的岗位”。
2. 选择一个已授权岗位任务。
3. 点击“执行任务”。
4. 如果会调用真实 API，页面提示费用确认。
5. 用户确认后系统自动执行，不要求填写 prompt、模型名或文件路径。
6. 完成后页面显示：
   - 状态：完成 / 阻塞 / 失败
   - 图片预览
   - “打开详情页”
   - “下载打包文件”
   - 执行摘要
   - 审计读回
   - 账本读回
7. 如果失败，页面只给下一步动作，例如：
   - “去 API 管理连接 OpenAI”
   - “重新生成派发单后再执行”
   - “当前工具未被本次调度允许，请回任务调度检查工具授权”

## 多任务可用规则

第一版必须支持多个岗位任务连续或并行使用，不能只为单个 demo 写死。

- 每次执行必须创建独立 `executionId` 和独立工作区。
- 不同任务的 `hero.png`、`detail.html`、`artifact-manifest.json`、`artifacts.zip` 不能互相覆盖。
- 已完成的同一个派发单不能重复执行；需要重新执行时必须生成新的派发单。
- `RoleInstanceStore` 记录每次运行、步骤和产物引用。
- UI 读取产物时必须按 `executionId` 校验 artifactRef，不能读取其它任务的文件。
- 工具调用记录必须带 `roleRunRef`，方便审计一条执行链中的所有工具调用。

当前非付费测试已覆盖：两个 execution 都有同名 `hero.png` 时，前端必须分别请求 `exec-1` 和 `exec-2` 的 artifact，并缓存为不同 key。

后端也必须做同样校验：`aics.execution.artifact.get` 只能读取当前 `executionId` 已记录的 artifact。即使两个任务都有同名 `hero.png`，也不能用 `exec-2` 读取 `exec-1` 的文件。

## 当前实现状态

| 要求                                               | 当前状态                                               | 证据                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 岗位执行引擎存在                                   | 已有                                                   | `src/aics-main-flow/role-execution-engine.ts`                                                   |
| 工具/Skill 执行引擎存在                            | 已有                                                   | `src/aics-main-flow/tool-skill-execution-engine.ts`                                             |
| 岗位执行主链路调用工具/Skill 引擎                  | 已接入                                                 | `src/aics-main-flow/role-product-execution-workflow.ts`                                         |
| Work Pattern 通用执行设计                          | 已定版                                                 | `docs/AICS-role-execution-engine-work-pattern-design.md`                                        |
| 派发单写入第一版产品执行核心 Skill/Tool 授权       | 已接入                                                 | `src/aics-main-flow/store.ts`、`src/aics-main-flow/store.test.ts`                               |
| 图片生成                                           | 已接入 OpenAI Images API                               | `core.openai.image.generate`                                                                    |
| `auto` 模型可用                                    | 已映射                                                 | `auto` 映射到 `gpt-image-1`                                                                     |
| API 管理 image-only OpenAI auto 可执行             | 已有非付费测试                                         | `src/gateway/server-methods/aics-execution.test.ts`                                             |
| 详情页和执行摘要 JSON 写入                         | 已接入                                                 | `core.workspace.detail.write`、`src/aics-main-flow/role-product-execution-workflow.test.ts`     |
| 质量检查                                           | 已接入，检查图片、HTML、执行摘要 JSON 和详情页图片引用 | `core.artifact.quality.check`                                                                   |
| 详情页图片引用检查                                 | 已有非付费测试                                         | `src/aics-main-flow/role-product-execution-workflow.test.ts`                                    |
| 打包下载                                           | 已接入，ZIP 和 manifest 包含图片、详情页和执行摘要     | `core.artifact.package.bundle`、`src/aics-main-flow/role-product-execution-workflow.test.ts`    |
| 旧文本摘要旁路                                     | 已移除                                                 | `aics.execution.run` 固定走产品执行器                                                           |
| OpenAI 限流/余额类失败提示                         | 已有 429 与额度不足非付费测试                          | `src/aics-main-flow/role-product-execution-workflow.test.ts`                                    |
| OpenAI/API Key/余额/限流失败页面下一步引导         | 已接入                                                 | `ui/src/ui/views/my-roles.ts`、`ui/src/ui/views/my-roles.test.ts`                               |
| 真实执行前确认弹窗说明 OpenAI 图片能力、费用和产物 | 已接入                                                 | `ui/src/ui/controllers/my-roles.ts`、`ui/src/ui/controllers/my-roles.test.ts`                   |
| 图片/详情页/ZIP 页面展示                           | 已接入                                                 | `ui/src/ui/views/my-roles.ts`                                                                   |
| 执行摘要 JSON 页面可读展示                         | 已接入                                                 | `ui/src/ui/views/my-roles.ts`、`ui/src/ui/views/my-roles.test.ts`                               |
| 页面产物名称小白可读，不直接暴露本地路径           | 已接入                                                 | `ui/src/ui/views/my-roles.ts`、`ui/src/ui/views/my-roles.test.ts`                               |
| 产物读取失败页面下一步引导                         | 已接入                                                 | `ui/src/ui/views/my-roles.ts`、`ui/src/ui/views/my-roles.test.ts`                               |
| 运行前费用凭证 ledgerRef 页面可见                  | 已接入                                                 | `ui/src/ui/views/my-roles.ts`、`ui/src/ui/views/my-roles.test.ts`                               |
| 本地 demo 图片/详情页/摘要/ZIP 人类可读产物名称    | 已有非付费测试                                         | `test/scripts/aics-local-demo-run.test.ts`、`test/scripts/aics-local-demo-verify.test.ts`       |
| artifact 按 executionId 隔离读取                   | 已接入                                                 | `aics.execution.artifact.get` 与 `artifactPreviews`                                             |
| 执行摘要 JSON artifact 可通过后端读取              | 已有非付费测试                                         | `src/gateway/server-methods/aics-execution.test.ts`                                             |
| 多任务同名文件不互相覆盖                           | 已有非付费测试                                         | `src/gateway/server-methods/aics-execution.test.ts`、`ui/src/ui/controllers/my-roles.test.ts`   |
| 多任务结果列表按最近执行更新排序                   | 已有非付费测试                                         | `src/gateway/server-methods/aics-execution.test.ts`                                             |
| 同一派发单完成后重复点击必须阻止                   | 已有非付费测试                                         | `src/gateway/server-methods/aics-execution.test.ts`、`test/scripts/aics-local-demo-run.test.ts` |
| 页面点击执行到图片/详情页/摘要/ZIP 展示            | 已有 mock e2e 测试                                     | `ui/src/ui/e2e/main-flow-execution.e2e.test.ts`                                                 |
| 网关入口写回图片/详情页/摘要/ZIP                   | 已有非付费测试                                         | `src/gateway/server-methods/aics-execution.test.ts`                                             |
| 真实 API demo 必须显式确认费用                     | 已有非付费测试                                         | `test/scripts/aics-local-demo-run.test.ts`                                                      |
| 真实 OpenAI 付费验收                               | 未执行                                                 | 需要人工确认真实 API 成本                                                                       |

## 生产化实施计划

### P0：主链路收口

- 保持 `aics.execution.run` 只做岗位执行编排，不直接做图片或文件写入。
- 将 `role-product-execution-workflow` 收敛为 `generate + composite` 默认模板，不再作为电商品类专属执行器。
- 保持 `tool-skill-execution-engine` 只做 Skill 到 Tool 的授权和调用。
- 移除或阻断任何绕过工具/Skill 引擎的旧 executor。

完成标准：

- `aics.execution.run` 调用 `createRoleProductExecutionExecutor`。
- 不再生成旧的 `marketplace-ops-summary.json` 作为主要业务结果。
- 测试覆盖：派发单 allowedSkills/allowedTools 不包含核心产品链路时必须阻断；旧派发单需要重新物化或补齐新核心工具授权。

### P0.5：Work Pattern 通用化

- 增加 manifest v2 兼容读取：`workPatterns`、`outputContracts`、`businessCategory`、`requiredSkills`、`requiredTools`、`riskPolicy`、`artifactPolicy`、`validationRules`。
- 增加 `RoleExecutionPlan`：当前状态、目标状态、差距、执行选择、步骤、预期产物、验收规则和人工确认点。
- 增加 Output Contract 验收：`image`、`html`、`document`、`spreadsheet`、`json`、`external_record`、`package`。
- 将品类降级为 Business Context：只影响用词、输入提示、质量标准、知识、风格和指标，不作为执行器分支。

完成标准：

- `generate + html + package` 可跨多个业务品类复用。
- `analyze + document/json/package` 可服务运营诊断、竞品分析、财务总结等分析型岗位。
- `operate` 默认只做门禁和人工确认证据，未确认时必须 blocked。

### P1：小白可见结果

- “我的岗位”完成后显示图片预览。
- HTML 详情页可一键打开。
- ZIP 可一键下载。
- 阻塞原因转成真人能理解的提示。
- 审计和账本读回显示为业务状态，而不是原始数据库字段。

完成标准：

- 用户不看命令行也能判断执行是否完成。
- 用户可以直接拿到图片、详情页、ZIP。

### P2：多任务稳定

- 连续运行两个不同任务，产物互不覆盖。
- 同一派发单完成后再次点击必须阻止。
- 多任务结果列表按最近执行排序。
- artifact 读取必须校验属于当前 execution。

完成标准：

- 两个任务各自有独立图片、详情页、ZIP、审计和账本。

### P3：真实 API 验收

- 使用 API 管理中已连接的 OpenAI。
- 执行真实图片生成。
- 页面点击完成闭环，不通过脚本伪造结果。
- 记录模型用量或明确记录本次模型用量不可用原因。

完成标准：

- 真人点击一次岗位执行，页面显示真实图片预览、详情页、ZIP、审计、账本。
- 失败时能明确告诉用户去 API 管理、费用余额、限流或工具授权处修复。

## 非付费验证命令

这些命令不应触发真实 OpenAI 付费调用：

```bash
pnpm tsgo:test:src
pnpm exec vitest run --config test/vitest/vitest.gateway.config.ts src/gateway/server-methods/aics-execution.test.ts
pnpm exec vitest run --config test/vitest/vitest.unit-src.config.ts src/aics-main-flow/tool-registry.test.ts src/aics-main-flow/tool-skill-execution-engine.test.ts src/aics-main-flow/role-product-execution-workflow.test.ts
node scripts/run-vitest.mjs run test/scripts/aics-local-demo-run.test.ts test/scripts/aics-local-demo-verify.test.ts --maxWorkers=1
```

## 真实验收命令

真实验收会调用 API 管理里的 OpenAI，必须由操作者确认费用后执行：

```bash
npm run aics:local-demo:seed
npm run aics:local-demo:verify
npm run aics:local-demo:run -- --confirm-real-api-cost
npm run aics:local-demo:verify -- --require-executed
node --import tsx scripts/aics-local-demo-verify.ts --json --require-executed --timeout-ms 15000 --output /private/tmp/aics-local-acceptance-manifest-codex-require-executed.json
```

## 完成审计矩阵

当前本地版目标已完成：操作者已明确确认真实 OpenAI 调用费用，系统使用 API 管理中的 OpenAI OAuth/auto 连接完成真实图片生成，并完成详情页、摘要、manifest、ZIP、审计、账本、费用摘要和人工确认读回。云端 SaaS、多账号、远端商城部署仍属于下一阶段，不作为本地版两个执行引擎完成门槛。

继续交接入口：`docs/aics/execution-engines-handoff.md`。

| 目标要求                                                    | 当前结论                               | 已有证据                                                                                                                                                                  | 还缺什么                                                                                                                                         |
| ----------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 必须策划两个执行引擎，不能合并                              | 已满足                                 | 本文档“两套引擎”章节；`role-execution-engine.ts`、`tool-skill-execution-engine.ts`                                                                                        | 无                                                                                                                                               |
| 岗位执行引擎读取任务、分析、编排、汇总结果                  | 已满足                                 | `role-product-execution-workflow.ts`；`role-product-execution-workflow.test.ts`                                                                                           | 无                                                                                                                                               |
| 工具/Skill 引擎负责 Skill 到 Tool、授权检查、工具调用和记录 | 已满足                                 | `tool-skill-execution-engine.ts`；`tool-skill-execution-engine.test.ts`                                                                                                   | 无                                                                                                                                               |
| `img:gen` 复用 API 管理 OpenAI `auto` 并走图片能力          | 已满足                                 | `resolveOpenAIImageRuntime`；`auto -> gpt-image-1` 测试；image-only OpenAI 测试；OAuth OpenAI readiness 测试；真实执行日志 `mode=oauth transport=codex-responses`         | 无                                                                                                                                               |
| `ws:write` 写出 `detail.html` 和执行摘要 JSON               | 已满足                                 | `workspace_detail_writer`；`role-product-execution-workflow.test.ts`                                                                                                      | 无                                                                                                                                               |
| `quality:check` 检查图片、HTML、摘要 JSON、HTML 图片引用    | 已满足                                 | `artifact_quality_check`；缺图片引用、缺摘要、坏 JSON 测试                                                                                                                | 无                                                                                                                                               |
| `file:pack` 打包图片、详情页、摘要、manifest、ZIP           | 已满足                                 | ZIP/manifest 内容测试                                                                                                                                                     | 无                                                                                                                                               |
| 未授权 Skill/Tool 必须阻断                                  | 已满足                                 | `tool-skill-execution-engine.test.ts`；`role-product-execution-workflow.test.ts`                                                                                          | 无                                                                                                                                               |
| 页面点执行后显示图片、详情页入口、ZIP、摘要、审计、账本     | 已满足                                 | `main-flow-execution.e2e.test.ts`；`my-roles.test.ts`；真实验收产物 `hero.png`、`detail.html`、`execution-summary.json`、`artifact-manifest.json`、`artifacts.zip`        | 无                                                                                                                                               |
| 非程序员不看路径、不跑命令也能拿结果                        | 已满足                                 | 友好产物名、产物读取失败下一步、执行摘要卡测试；真实验收摘要显示友好产物名                                                                                                | 无                                                                                                                                               |
| 真人确认费用前知道会调用 OpenAI 图片能力并生成哪些产物      | 已满足                                 | `my-roles` 控制器确认弹窗测试                                                                                                                                             | 无                                                                                                                                               |
| 多任务产物隔离、排序、重复执行阻断                          | 已满足                                 | artifact 按 `executionId` 读取测试；排序测试；重复执行测试                                                                                                                | 无                                                                                                                                               |
| 审计和账本 readback 成功才算闭环                            | 已满足                                 | `executionEvidence.readback.get` 严格测试；demo verify `--require-executed` 测试；`/private/tmp/aics-local-acceptance-manifest-codex-require-executed.json`               | 无                                                                                                                                               |
| 真人验收命令不能卡死，必须可输出机器可读结果                | 已满足                                 | `aics-local-demo-verify --timeout-ms 15000 --output ...`；超时时返回 `readinessTimeout` blocked manifest；短超时验证写出 `/private/tmp/aics-output-debug-state/out2.json` | 无                                                                                                                                               |
| 失败时告诉用户去哪里修                                      | 已满足                                 | API/余额/限流、产物读取失败、授权费用和审计账本缺失提示测试                                                                                                               | 无                                                                                                                                               |
| 真实 OpenAI 付费点击验收                                    | 已完成                                 | `npm run aics:local-demo:run -- --confirm-real-api-cost`；`npm run aics:local-demo:verify -- --require-executed`                                                          | 无                                                                                                                                               |
| 云端 SaaS production-plus 最终门禁                          | 未完成，不作为本地两个执行引擎完成门槛 | `node scripts/persona/aics-production-plus-readiness.mjs --output-dir /private/tmp/aics-production-plus-readiness-latest` 写出 readiness/env template，并正确阻塞         | 真实 `DIJIE_CLOUD_BASE_URL`、`OPENCLAW_LOCAL_URL`、bridge bearer、执行令牌公钥、vendor/admin/buyer 或 cloud token；最终 `production_plus_passed` |

## 真实 OpenAI 验收记录

操作者已确认允许调用真实 OpenAI 并接受可能产生的 API 费用。验收结果：

- 执行命令：`npm run aics:local-demo:run -- --confirm-real-api-cost`
- OpenAI 路线：`mode=oauth transport=codex-responses`
- executionId：`d514491d-367f-4e4b-9736-c708c5e39d69`
- dispatchToRoleRequestId：`dispatch_role_req_dd17f8db-046e-4e3f-bb64-f57e420ad3a9`
- auditRecordId：`local_audit_d514491d-367f-4e4b-9736-c708c5e39d69`
- ledgerRef：`ledger:role_execution:local_entitlement_ad262d261180a713:d514491d-367f-4e4b-9736-c708c5e39d69`
- 业务产物：`hero.png`、`detail.html`、`execution-summary.json`、`artifact-manifest.json`、`artifacts.zip`
- 物理文件大小：`hero.png` 1766988 bytes；`detail.html` 1442 bytes；`execution-summary.json` 3069 bytes；`artifact-manifest.json` 852 bytes；`artifacts.zip` 1772803 bytes
- ZIP 内容：`hero.png`、`detail.html`、`execution-summary.json`、`artifact-manifest.json`
- 最终验证：`npm run aics:local-demo:verify -- --require-executed` 返回“本地 demo 验收状态：已完成”
- 机器可读验收：`node --import tsx scripts/aics-local-demo-verify.ts --json --require-executed --timeout-ms 15000 --output /private/tmp/aics-local-acceptance-manifest-codex-require-executed.json` 返回 `ok: true`、`executed: true`、`requireExecuted: true`
- 重复执行保护：再次运行同一派发单返回“该派发单已经执行完成并生成结果，不能重复运行。”

## 云端 Production-Plus Readiness 记录

云端 SaaS、多账号、远端商城部署不作为本地两个执行引擎完成门槛，但不能假装已通过。当前 readiness 结果：

- 执行命令：`node scripts/persona/aics-production-plus-readiness.mjs --output-dir /private/tmp/aics-production-plus-readiness-latest`
- 结果：`status: blocked`
- 输出文件：`readiness.json`、`readiness.md`、`env-template.sh`
- 缺少输入：`DIJIE_CLOUD_BASE_URL`、`OPENCLAW_LOCAL_URL`、`DIJIE_INTERNAL_BRIDGE_BEARER`、`DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM`、`DIJIE_VENDOR_ACCESS_TOKEN` / `DIJIE_ADMIN_ACCESS_TOKEN` / `DIJIE_BUYER_ACCESS_TOKEN` 或 `DIJIE_CLOUD_ACCESS_TOKEN`
- 完成条件：readiness 全部通过后运行 production-plus orchestrator，最终 gate 返回 `production_plus_passed`

## 最近非付费回归记录

最近一次非付费回归已通过：

```bash
pnpm tsgo:test:src
pnpm exec vitest run --config test/vitest/vitest.ui-e2e.config.ts ui/src/ui/e2e/main-flow-execution.e2e.test.ts --configLoader runner
pnpm --dir ui exec vitest run --config vitest.config.ts src/ui/controllers/my-roles.test.ts src/ui/views/my-roles.test.ts
pnpm --dir ui build
pnpm exec vitest run --config test/vitest/vitest.gateway.config.ts src/gateway/server-methods/aics-execution.test.ts
pnpm exec vitest run --config test/vitest/vitest.unit-src.config.ts src/aics-main-flow/tool-registry.test.ts src/aics-main-flow/tool-skill-execution-engine.test.ts src/aics-main-flow/role-product-execution-workflow.test.ts
node scripts/run-vitest.mjs run test/scripts/aics-local-demo-run.test.ts test/scripts/aics-local-demo-verify.test.ts --maxWorkers=1
```

本次 OAuth 修复后额外通过：

```bash
pnpm tsgo:test:src
pnpm exec vitest run --config test/vitest/vitest.gateway.config.ts src/gateway/server-methods/aics-execution.test.ts
pnpm exec vitest run --config test/vitest/vitest.unit-src.config.ts src/aics-main-flow/role-product-execution-workflow.test.ts src/aics-main-flow/tool-skill-execution-engine.test.ts
node scripts/run-vitest.mjs run test/scripts/aics-local-demo-run.test.ts test/scripts/aics-local-demo-verify.test.ts --maxWorkers=1
```

## 下一阶段

1. 给不同岗位品类增加专属工作流，例如电商美工、详情页运营、广告素材。
2. 增加真实图片尺寸、格式、内容安全和品牌一致性检查。
3. 增加人工确认点：发布、上传、付费高风险工具必须人工确认。
4. 增加大文件产物分片下载，避免超大 ZIP 通过 RPC 一次性返回。
