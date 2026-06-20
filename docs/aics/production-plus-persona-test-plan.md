# AICS 生产级以上拟人化测试方案

日期：2026-06-16

## 当前结论

OpenClaw 本地端已经能证明一段真实本地闭环：

```text
工具/Skill 列表
-> 绑定品类能力
-> 品类能力组合解析
-> 任务调度预检
-> DispatchToRoleRequest.allowedTools / allowedSkills
-> 岗位执行 preflight
```

本轮浏览器拟人化验证结果：

- `/skills` 自动读取到 62 个 Skill、83 个工具、1 个品类能力。
- 将 `acp-router` 绑定到通用品类能力后，品类能力页显示：
  - `Tool: tool:read`
  - `Skill: skill:1password, skill:acp-router`
  - 状态为 `可调度`
- 继续将 `apple-notes` 绑定到通用品类能力后，品类能力页显示：
  - `Skill: skill:1password, skill:acp-router, skill:apple-notes`
- 从品类能力页进入 `/workboard` 后，任务调度页显示同一组能力组合：
  - `Tool: tool:read`
  - `Skill: skill:1password / skill:acp-router / skill:apple-notes`
- 点击 `检查并派发` 后，`/aics` 岗位执行页能看到调度请求写入：
  - `允许工具：tool:read`
  - `允许 Skill：skill:1password / skill:acp-router / skill:apple-notes`
- 缺少云端岗位授权时，岗位执行页保持阻塞，并显示 `先完成岗位授权`，不再误导用户可以直接确认费用和执行。

这说明本地端的能力绑定已经不再只是静态展示，而是真正进入了调度和岗位执行 preflight。

## 未达到“超过生产级”的原因

生产级以上不是只看本地 UI 能点通。当前 `scripts/aics-production-plus-persona.mjs` 已经定义了更高标准的 gate，并且 gate regression 已通过，证明它会拒绝假证据。

当前 readiness 检查仍为 `blocked`，阻塞项如下：

```text
DIJIE_CLOUD_BASE_URL
OPENCLAW_LOCAL_URL
DIJIE_INTERNAL_BRIDGE_BEARER
DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM
DIJIE_VENDOR_ACCESS_TOKEN or DIJIE_CLOUD_ACCESS_TOKEN
DIJIE_ADMIN_ACCESS_TOKEN or DIJIE_CLOUD_ACCESS_TOKEN
DIJIE_BUYER_ACCESS_TOKEN or DIJIE_CLOUD_ACCESS_TOKEN
```

因此当前只能证明“本地端闭环已推进”，不能宣称“云端商城生产级闭环已通过”。

## 最终执行方案

最终验收分四步执行，任何一步失败都不能进入下一步，也不能把本地 fake/dry-run
证据包装成生产级结果。

1. 准备真实环境。
   - 运行 readiness 生成安全模板：
     `node scripts/persona/aics-production-plus-readiness.mjs --probe-endpoints --output-dir /private/tmp/aics-production-plus-readiness`
   - 使用输出目录里的 `env-template.sh` 填入真实值，只在本机 shell 中 source，
     不提交填好 secret 的文件。
   - 必须补齐云端 URL、本地 OpenClaw URL、bridge bearer、公钥 PEM、以及
     vendor/admin/buyer actor token 或共享 cloud token。

2. 准备真实业务签字单。
   - 从真实云端/OpenClaw 回读并写入同一个 run 的 `api-seed.json` 和
     `final-manifest.json`。
   - 必须包含 `rolePackageId / rolePackageVersion / roleListingId / reviewId /
entitlementId / executionId / auditRecordId / ledgerEntryId`。
   - 必须包含模型 Token 费用 readback 期望，且最终要和 raw persona evidence
     里的 `modelTokenBilling.source=api_readback` 对齐。

3. 跑最终 orchestrator。
   - 命令固定使用真实 `--seed-file`，不能使用 scaffold-only `--api-seed`：

```bash
node scripts/persona/aics-production-plus-orchestrator.mjs \
  --seed-file docs/aics-persona-runs/<runId>/api-seed.json \
  --production-plus-final \
  --probe-endpoints \
  --final-manifest docs/aics-persona-runs/<runId>/final-manifest.json \
  --base-url "$DIJIE_CLOUD_BASE_URL" \
  --openclaw-url "$OPENCLAW_LOCAL_URL" \
  --run-id "<runId>" \
  --output-dir docs/aics-persona-runs/<runId>
```

- orchestrator 必须依次通过 selector coverage、readiness endpoint probe、
  final manifest validation、真实 Playwright 采集、production-plus gate 和
  completion audit。

4. 只按 completion audit 收口。
   - 唯一通过口径：

```text
stage: gate
verdict: production_plus_passed
completionAudit.status: complete
```

- 如果 completion audit 是 `incomplete`，则以
  `completion-audit.json.failedCheckIds` 和
  `remediation.json.implementationPlan.groups` 作为下一轮修改清单。
- 如果 readiness 继续 blocked，则只允许继续补环境和端点，不允许跳过
  readiness 或手工改 evidence。

## 生产级以上 gate

`scripts/aics-production-plus-persona.mjs` 的通过条件应作为最终验收标准：

1. Evidence 必须满足 schema contract：必填字段、枚举、数组结构、`proof`、`ids`、`finalProbes`、`secretScan.leakCount` 和关键计数字段类型都必须正确，不能由 normalize 默认补齐。
2. `schemaVersion` 必须显式为 `2`。
3. 必须是真实浏览器和真实应用，不接受 dry-run。
4. 必须有有效 PNG 截图证据：PNG 签名、IHDR 和非零宽高都必须成立，且声明截图数、实际保留文件数、有效截图数必须一致。
5. 必须覆盖六类 persona：
   - `developer`
   - `admin_reviewer`
   - `buyer_storefront`
   - `user_center`
   - `openclaw_local_operator`
   - `ledger_receivables_reader`
6. 每个 persona 必须有正向路径断言。
7. 每个 persona 必须有负向越权/失败注入断言。
8. 必须有 persona-scoped negative API cross-check。
9. 必须捕获并回读这些 ID：
   - `rolePackageId`
   - `rolePackageVersion`
   - `roleListingId`
   - `reviewId`
   - `entitlementId`
   - `executionId`
   - `auditRecordId`
   - `ledgerEntryId`
10. 证据不能泄漏 token、API key、本地路径或私有正文。
11. console error 和 network 5xx 必须为 0。
12. 每个标准 persona 必须有至少一个 passed browser action，`failedActionCount` 必须为 0，`actions.ndjson` 必须存在且行数与 `actionCount` 匹配，并且 artifact 行里的 persona 覆盖必须和 `proof.actionTrace` 一致。
13. 必须有 fresh seed 和 final probes：
    - developer submit
    - admin publish
    - buyer authorization
    - cloud execution
    - OpenClaw local sync
    - OpenClaw local execution
    - audit upload
    - ledger readback
    - receivables readback
    - cross-actor negatives
    - API model pricing
    - API metering readback
    - API usage attribution
    - screenshots
14. 必须回读模型 Token 费用证据：`modelTokenBilling.source=api_readback` 且 `status=passed`，包含模型 Provider、模型名、输入/输出单价、输入/输出/总 Token、CNY 费用，并且 `byConsumer.role_execution` 有 Token 和费用。Final manifest 只能声明期望，不能单独作为生产级证据。
15. OpenClaw 主对话路径必须通过，或明确 `provider-config-blocked`，不能用岗位工具路径代替。

## 完成审计矩阵

最终是否达到“超过生产级”，必须按下面矩阵逐项审计。任何一项证据缺失、间接、过期或来自 mock/fake runtime，都不能标记完成。

| 要求                  | 权威证据                                                                                                                                                                                                                | 当前状态                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 真实浏览器和真实应用  | `persona-evidence/persona-evidence.json` 中 `source=playwright`、`realBrowser=true`、`realApplication=true`，并且 URL 指向真实 `DIJIE_CLOUD_BASE_URL / OPENCLAW_LOCAL_URL`                                              | 离线 fake Playwright 可证明 gate 路径；真实环境仍缺 |
| 六类 persona 全覆盖   | `proof.personaNames` 和 `personas[].status` 覆盖 `developer/admin_reviewer/buyer_storefront/user_center/openclaw_local_operator/ledger_receivables_reader`，全部 `passed`                                               | 结构和 gate 已覆盖；真实云端 evidence 未生成        |
| 每 persona 有真实动作 | `proof.actionTrace` 与 `persona-evidence/actions.ndjson` 行数一致；每个 persona 至少一个 `passed` action；`failedActionCount=0`                                                                                         | 离线测试已覆盖；真实动作未跑                        |
| 稳定 selector 覆盖    | `selector-coverage/selector-coverage.json` 为 `covered`，`required=19 covered=19 missing=0`                                                                                                                             | 已通过源码扫描                                      |
| 正向/负向 UI 断言     | `positive[] / negative[]` 每个 persona 均有 `status=passed`，并带 persona 前缀                                                                                                                                          | gate 已覆盖；真实页面未跑                           |
| 负向 API cross-check  | `proof.apiChecks` 中每个 persona 有负向检查，匿名/越权/未授权返回期望状态                                                                                                                                               | gate 已覆盖；真实 API 未跑                          |
| 必要 ID 回读          | `ids` 包含 8 个 readback ID，且与 `api-seed.json` 和 `final-manifest.json` 一致                                                                                                                                         | scaffold seed 必须 invalid；真实 seed 未生成        |
| 截图证据              | `proof.screenshotCount >= 标准 persona + main chat + local probes`，`screenshots/*.png` 声明数、实际文件数、有效数一致，且 PNG 签名、IHDR、非零宽高有效                                                                 | 离线 fake runtime 测试已覆盖；真实截图未生成        |
| OpenClaw 主对话       | `openclawMainChat.path=main_chat`，来源为 `playwright/api_readback`，断言 passed 或结构化 `provider-config-blocked`                                                                                                     | schema/gate 已覆盖；真实 `/chat` 未跑               |
| 模型 Token 费用读回   | `modelTokenBilling.source=api_readback`，包含 provider/model/pricing/token/cost，且 `byConsumer.role_execution` 有 token 和 CNY 费用                                                                                    | schema/gate 已覆盖；真实 API 管理读回未跑           |
| 安全无泄漏            | `secretScan.leakCount=0`，`actions.ndjson / console.ndjson / network-summary.ndjson` 不含 raw token/API key/本地路径/用户输入正文                                                                                       | collector/gate 已覆盖；真实运行仍需确认             |
| console/network 干净  | `consoleErrorCount=0`、`network5xxCount=0`，artifact 行数与 proof 计数一致                                                                                                                                              | gate 已覆盖；真实页面未跑                           |
| fail-closed           | seed/manifest `runId` 冲突 -> `run_metadata_invalid`；缺 manifest ID -> `final_manifest_invalid`；缺 selector -> `selector_coverage_missing`；缺 env -> `readiness_blocked`；dry-run/fake evidence 不能 production pass | 已验证                                              |

最终完成判定只接受：

```text
stage: gate
verdict: production_plus_passed
```

并且同一 run 目录必须保留完整 artifact：

```text
selector-coverage/selector-coverage.json
readiness/readiness.json
resolved-seed.json
final-manifest.resolved.json
final-manifest.validation.json
run-metadata.validation.json
playwright-config.json
persona-evidence/persona-evidence.json
persona-evidence/screenshots/*.png
persona-evidence/actions.ndjson
persona-evidence/console.ndjson
persona-evidence/network-summary.ndjson
evidence.json
remediation.json
remediation.md
summary.md
redacted-env.txt
```

`final-manifest.resolved.json` 必须和 `resolved-seed.json` 重新校验为 valid，
并且 manifest 里的 required IDs 与 `persona-evidence.json.ids` 一致；manifest
里的模型计量声明必须和 raw evidence 的 API readback 计量一致。`remediation.json`
必须包含 `completionAudit`。最终完成只能接受
`completionAudit.status=achieved`；如果是 `not_achieved`，则
`completionAudit.missingGateIds` 是下一步方案改造的机器可读任务入口。
同一 run 目录里的 `resolved-seed.json`、`final-manifest.resolved.json`、
`run-metadata.validation.json`、raw persona evidence 和 top-level gate evidence
还必须共享同一个 `runId`；`run-metadata.validation.json` 必须为 `status=valid`，
raw/top-level evidence 必须带有效 `startedAt / endedAt` 时间戳。
同时必须包含 `implementationPlan.groups`，按运行环境、persona 覆盖、回读追溯、
artifact 完整性和 OpenClaw 本地页面分组输出阻塞 gate 与下一步动作，不能只给
一串失败 id。
`remediation.md` 也必须展示完整 `Next Commands`：endpoint readiness、
final manifest validation、以及使用真实 `--seed-file` 的 production-plus
orchestrator final run；正式命令不能使用 scaffold-only `--api-seed`。

最终还必须运行 completion audit：

```bash
node scripts/persona/aics-production-plus-completion-audit.mjs \
  --run-dir docs/aics-persona-runs/<runId> \
  --out docs/aics-persona-runs/<runId>/completion-audit.json \
  --markdown docs/aics-persona-runs/<runId>/completion-audit.md
```

只有 `status: complete` 才能宣称目标完成。该审计会额外检查
`remediation_contract`：`completionAudit.status=achieved`、
`missingGateIds=[]`、`implementationPlan.status=complete`、所有分组
`covered`，且没有 `ungrouped` gate。

## 下一步执行顺序

### 1. 固定本地端闭环

先保持当前本地端闭环稳定：

```text
工具/Skill 绑定
-> ToolSupplyResolution
-> TaskPackage
-> DispatchToRoleRequest
-> execution preflight
```

必须继续保持：

- 没有能力 resolution 时，`TaskPackage` 必须 blocked。
- `paused` binding 不进入调度。
- Skill disabled、plugin disabled、缺 API、缺云端授权、高风险未批准都必须进入 blocked reasons。
- 岗位执行页只运行已授权、已确认费用、能力和 API 都满足的请求。

### 2. 补云端连接 readiness

配置或注入以下环境，不把 token 写入 evidence。readiness 不是只检查“有值”：

- `DIJIE_CLOUD_BASE_URL` 和 `OPENCLAW_LOCAL_URL` 必须是 `http://` 或 `https://` URL。
- `DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM` 必须是 `-----BEGIN PUBLIC KEY-----` 或 `-----BEGIN RSA PUBLIC KEY-----` 形态的公钥 PEM。
- token 和 bearer 只检查存在性；readiness artifact 只写字段名、状态和 reason，不写原始值。
- 最终 run 必须开启 endpoint probe，证明 `DIJIE_CLOUD_BASE_URL` 和
  `OPENCLAW_LOCAL_URL` 可达；readiness artifact 只写字段名、HTTP 状态码和
  reason，不写原始 URL、路径或 token。

```text
DIJIE_CLOUD_BASE_URL
OPENCLAW_LOCAL_URL
DIJIE_INTERNAL_BRIDGE_BEARER
DIJIE_EXECUTION_TOKEN_PUBLIC_KEY_PEM
DIJIE_VENDOR_ACCESS_TOKEN / DIJIE_CLOUD_ACCESS_TOKEN
DIJIE_ADMIN_ACCESS_TOKEN / DIJIE_CLOUD_ACCESS_TOKEN
DIJIE_BUYER_ACCESS_TOKEN / DIJIE_CLOUD_ACCESS_TOKEN
```

运行：

```bash
node scripts/persona/aics-production-plus-readiness.mjs \
  --probe-endpoints \
  --output-dir /private/tmp/aics-production-plus-readiness
```

如果 readiness blocked，`readiness.md` 必须直接给出 `Next Commands` 和
`Secret Handling`：下一步命令只引用 env 名和 `<runId>` 占位符，不输出 token 值、
私有 URL、包正文、prompt 或用户数据。
`readiness.json` 也必须包含 `blockedChecks` 和 `nextRequiredEnv`，供自动化或
人工检查直接读取缺失环境变量和 endpoint probe，不需要解析 Markdown。
同一目录还必须写出 `env-template.sh`，只包含 env 名和占位符，方便本地注入真实
云端/OpenClaw 环境，但不能复制当前进程里的 token、私有 URL 或非法输入值。

只有 readiness 为 `ready` 后，才进入完整 persona 测试。

### 3. 使用现有 orchestrator 采集真实 persona evidence

当前真实采集链路已经存在，不需要再新增一个并行 runner：

```text
scripts/persona/aics-production-plus-orchestrator.mjs
-> scripts/persona/aics-final-manifest.mjs / final manifest validation
-> scripts/persona/aics-selector-coverage.mjs
-> scripts/persona/aics-production-plus-readiness.mjs
-> scripts/persona/aics-build-playwright-config.mjs
-> scripts/persona/aics-playwright-persona.mjs
-> scripts/aics-production-plus-persona.mjs
```

职责边界：

- `aics-production-plus-orchestrator.mjs`：统一 runId、seed、final manifest、selector coverage、readiness、Playwright evidence 和最终 gate。
- `aics-final-manifest.mjs`：生成/校验 final manifest。orchestrator 会在 run
  目录保留 `resolved-seed.json`、`final-manifest.resolved.json` 和
  `final-manifest.validation.json`，completion audit 会重新校验 manifest，并检查
  manifest ID / 模型计量是否和 raw persona evidence readback 一致。
- `aics-selector-coverage.mjs`：在 `--production-plus-final` 下检查六 persona 的正向断言、负向断言、浏览器动作，以及 OpenClaw 主对话 probe 使用的稳定 `data-testid / data-aics-*` selector 是否真实出现在源码根目录；缺失时不能继续 readiness 或 Playwright。
- `aics-production-plus-readiness.mjs`：检查环境、URL 形态、公钥 PEM 形态、token env 名、脚本文件、可选 evidence 文件和显式 endpoint reachability probe；传入 evidence 时还会解析 schema 和 production-plus verdict 摘要，只输出 schema error 名、failed gate id、HTTP 状态码和状态，不泄漏 token 值、错误输入值、URL 路径或 evidence 正文。
- `aics-build-playwright-config.mjs`：生成六类 persona 的真实页面 URL、正向断言、负向断言和 API cross-check。
- `aics-playwright-persona.mjs`：启动真实 Playwright/Chromium，访问云端商城和 OpenClaw 本地端，写入 `persona-evidence.json`、`screenshots/*.png`、`actions.ndjson`、`console.ndjson` 和 `network-summary.ndjson`；final config 中已校验的 required IDs 会进入 raw evidence，API capture 可继续覆盖/补充，使 raw evidence 本身可以通过 production-plus gate。
- `aics-production-plus-persona.mjs`：只做 gate 判定和 remediation 输出，不负责采集。
- `aics-production-plus-completion-audit.mjs`：由 orchestrator 在每个终止 stage
  自动写入 `completion-audit.json/md`；manifest、selector、readiness 或
  playwright skipped 等失败 stage 会保留 incomplete 审计，最终 `stage: gate`
  也必须通过完整 run 目录审计后才能判定 complete。

没有 readiness 时，orchestrator 必须停在 `readiness_blocked`，不能生成假通过证据。

`--production-plus-final` 下不能通过 CLI `--skip-preflight` 绕过 readiness。该参数只允许非最终本地诊断使用；测试 harness 若需要跑 fake Playwright pass path，必须通过内部 option 显式放行，不能作为生产级通过证据。

没有稳定 selector 源码覆盖时，orchestrator 必须停在 `selector_coverage_missing`，不能靠页面文案、脆弱 CSS 选择器，或没有真实 action 锚点的配置假装拟人化测试已覆盖真实页面。

安全扫描边界：

- gate 会扫描最终 evidence，拒绝 token、API key、本地路径等泄漏。
- Playwright collector 也会扫描运行时页面正文、API URL、API JSON 返回体和错误摘要。
- collector 只写入脱敏后的命中 surface 和计数，不把原始 token 或本地路径写进 evidence。
- collector 必须记录 persona 动作轨迹：`proof.actionCount`、`proof.failedActionCount`、`proof.actionTrace` 和 `actions.ndjson`。`fill` 动作只记录 `valueLength`，不能写入用户输入原文；最终 gate 会同时检查 proof 和 artifact 两边的 persona 覆盖。
- `security_no_leaks` gate 必须合并 evidence 二次扫描和 collector runtime scan，并输出 `evidenceLeakCount`、`collectorLeakCount`、脱敏 `collectorSurfaces`。
- `secretScan.leakCount > 0` 时，即使 persona 页面断言通过，最终 production-plus gate 也必须失败。

失败证据边界：

- `dry-run`、`self-check`、Playwright runtime unavailable 这类失败证据也必须满足 schema contract。
- 这些证据必须失败在真实生产级门槛上，例如 `real_browser_application`、`screenshots`、persona 覆盖、ID readback，而不是因为我们自己生成了 malformed evidence。

Gate 输出边界：

- `scripts/aics-production-plus-persona.mjs` 写出的 `evidence.json` 必须保留审计摘要：
  - `source`
  - `realBrowser`
  - `realApplication`
  - `finalProbes`
  - `secretScan`
  - `schemaErrors`
- 这样即使最终 `verdict: failed`，也能一眼区分是 schema 问题、假浏览器问题、缺截图、缺 persona、缺 ID，还是安全泄漏问题。

### 4. 接入六类 persona 真实路径

每个 persona 必须包含正向和负向：

- `developer`
  - 正向：提交岗位包并获得 `rolePackageId / rolePackageVersion`。
  - 负向：不能审核自己的上架审核项。

- `admin_reviewer`
  - 正向：审核通过并发布，获得 `reviewId / roleListingId`。
  - 负向：缺 admin scope 不能通过审核。

- `buyer_storefront`
  - 正向：浏览岗位商城并授权岗位，获得 `entitlementId`。
  - 负向：未购买/未授权不能拿执行 token。

- `user_center`
  - 正向：从用户中心发起云端执行，获得 `executionId`。
  - 负向：跨用户 entitlement 不能执行。

- `openclaw_local_operator`
  - 正向：同步云端授权岗位到本地端，生成 `DispatchToRoleRequest` 并执行本地 mock/真实适配器。
  - 负向：缺 `actor_context`、缺 tool/skill/API、缺费用确认时必须 blocked。

- `ledger_receivables_reader`
  - 正向：回读 `ledgerEntryId` 和 receivables 摘要。
  - 负向：非财务/非授权 scope 不能读取账本详情。

### 5. 最终 orchestrator 命令

真实环境、seed 和 final manifest 都准备好以后，优先运行 orchestrator：

```bash
node scripts/persona/aics-production-plus-orchestrator.mjs \
  --seed-file docs/aics-persona-runs/<runId>/api-seed.json \
  --production-plus-final \
  --probe-endpoints \
  --final-manifest docs/aics-persona-runs/<runId>/final-manifest.json \
  --base-url "$DIJIE_CLOUD_BASE_URL" \
  --openclaw-url "$OPENCLAW_LOCAL_URL" \
  --run-id "<runId>" \
  --output-dir docs/aics-persona-runs/<runId>
```

最终 `--production-plus-final` run 必须带 `--probe-endpoints`。orchestrator
也会在 `productionPlusFinal` 下强制启用 endpoint probe，防止漏参时继续采集。
completion audit 会检查 `DIJIE_CLOUD_BASE_URL reachable` 和
`OPENCLAW_LOCAL_URL reachable`，只配置 env 但不做 endpoint probe，不能宣称超过生产级完成。

`final-manifest.json` 不是简单的人工勾选表。它必须：

- `productionPlusFinal: true`
- 覆盖全部 final probes
- 包含全部 8 个 readback ID：
  - `rolePackageId`
  - `rolePackageVersion`
  - `roleListingId`
  - `reviewId`
  - `entitlementId`
  - `executionId`
  - `auditRecordId`
  - `ledgerEntryId`
- 和 `api-seed.json` 中已有 ID 完全一致；任一关键 ID 不一致时，Playwright config builder 必须拒绝运行。

可以先生成 scaffold，但没有真实 ID 时 scaffold 必须是 `invalid`：

```bash
node scripts/persona/aics-final-manifest.mjs \
  --out /private/tmp/aics-final-manifest-scaffold.json \
  --run-id "<runId>"
```

只有所有真实回读 ID 补齐后，才能作为 `--final-manifest` 传给 orchestrator。

如果 orchestrator 使用 `--write-final-manifest` 生成的 manifest 仍然缺 ID，必须停在：

```text
stage: final_manifest_invalid
verdict: failed
```

当前也可稳定产出 selector coverage remediation：

```bash
node scripts/persona/aics-production-plus-orchestrator.mjs \
  --seed-file /private/tmp/aics-selector-missing-cli/seed.json \
  --production-plus-final \
  --probe-endpoints \
  --final-manifest /private/tmp/aics-selector-missing-cli/final-manifest.json \
  --selector-source-root /private/tmp/aics-selector-missing-empty \
  --run-id codex-selector-missing-cli \
  --output-dir /private/tmp/aics-selector-missing-cli/run
```

输出：

```text
stage: selector_coverage_missing
verdict: failed
```

这一步要早于 readiness 和 Playwright，避免把无效签字单混进后续拟人化证据。

final manifest 通过后，还必须运行 selector coverage。缺任一最终 persona selector 时，必须停在：

```text
stage: selector_coverage_missing
verdict: failed
```

这一步也要早于 readiness 和 Playwright，避免用真实浏览器访问一个没有稳定测试锚点的页面。

orchestrator 会产出：

```text
docs/aics-persona-runs/<runId>/selector-coverage/selector-coverage.json
docs/aics-persona-runs/<runId>/selector-coverage/selector-coverage.md
docs/aics-persona-runs/<runId>/readiness/readiness.json
docs/aics-persona-runs/<runId>/run-metadata.validation.json
docs/aics-persona-runs/<runId>/resolved-seed.json
docs/aics-persona-runs/<runId>/final-manifest.resolved.json
docs/aics-persona-runs/<runId>/final-manifest.validation.json
docs/aics-persona-runs/<runId>/playwright-config.json
docs/aics-persona-runs/<runId>/persona-evidence/persona-evidence.json
docs/aics-persona-runs/<runId>/persona-evidence/screenshots/*.png
docs/aics-persona-runs/<runId>/persona-evidence/actions.ndjson
docs/aics-persona-runs/<runId>/persona-evidence/console.ndjson
docs/aics-persona-runs/<runId>/persona-evidence/network-summary.ndjson
docs/aics-persona-runs/<runId>/evidence.json
docs/aics-persona-runs/<runId>/remediation.json
docs/aics-persona-runs/<runId>/remediation.md
docs/aics-persona-runs/<runId>/summary.md
```

### 6. 单独 gate 命令

真实采集器产出 evidence 后运行：

```bash
node scripts/aics-production-plus-persona.mjs \
  --persona-evidence docs/aics-persona-runs/<runId>/persona-evidence.json \
  --output-dir docs/aics-persona-runs/<runId>/gate
```

只有输出：

```text
verdict: production_plus_passed
```

才能说“超过生产级拟人化测试通过”。

## 当前可用验证命令

已经通过：

```bash
node scripts/persona/aics-production-plus-gate-regression.mjs
node scripts/persona/aics-build-playwright-config.mjs --out /private/tmp/aics-playwright-config-codex.json
npm exec -- tsc -p test/tsconfig/tsconfig.test.ui.json --noEmit
```

当前 tooling 测试通过：

```bash
node scripts/run-vitest.mjs run \
  --config test/vitest/vitest.tooling.config.ts \
  test/scripts/aics-production-plus-persona.test.ts \
  test/scripts/test-projects.test.ts
```

结果：

```text
2 test files passed
189 tests passed
```

覆盖内容包括：

- gate regression 拒绝假证据。
- schema contract 拒绝缺 `schemaVersion`、缺 `proof`、缺 `secretScan`、错误 persona status、字符串计数等坏 evidence。
- 生成的 `dry-run` / `self-check` / Playwright unavailable 失败证据本身 schema-valid，`schema_contract` 为 PASS，但最终 gate 仍失败。
- gate 输出 artifact 保留 `source / realBrowser / realApplication / finalProbes / secretScan / schemaErrors`，方便后续审计和自动汇总。
- readiness 不泄漏 token 值，也不泄漏非法 URL / 非 PEM 原始输入值；传入无效或非 production-plus evidence 时会 blocked，且只暴露 schema error 名和 failed gate id。
- Playwright config 生成六类 persona。
- `--production-plus-final` orchestrator 会先跑 selector coverage；缺正向/负向/action/主对话 selector 都会停在 `selector_coverage_missing`。
- Playwright collector 会记录动作 trace 和 `actions.ndjson`，并验证输入值不进入 evidence；最终 gate 会拒绝缺 action trace、失败 action、action artifact 缺失或 artifact persona 覆盖不一致的 evidence。
- screenshot gate 会解析 PNG 签名和 IHDR，只有非零宽高的截图 artifact 才算有效；只有 8 字节签名的伪 PNG 会失败。`proof.screenshotCount`、实际 `screenshots/*.png` 文件数、有效截图数不一致时也会失败。
- fake Playwright evidence 能跑通 orchestrator pass 路径。
- 缺浏览器 runtime 时 evidence collection blocked。
- 页面正文出现 `Bearer ...` 时，collector 记录 `secretScan.leakCount`，不写入原始 token，并让 production-plus gate 失败。
- `security_no_leaks` gate 输出 collector leak count 和脱敏 surface，方便定位泄漏来源。
- final manifest 必须包含全部 required readback IDs，并且和 seed 一致；任一 required ID mismatch 都会被拒绝。
- production-plus orchestrator 会在 readiness/Playwright 前检查 seed 与 manifest
  中显式声明的 `runId`；如果和当前 `--run-id` 冲突，会停在
  `run_metadata_invalid`，避免跨 run artifact 混用。
- completion audit 会检查 `final_manifest`：缺 resolved seed / resolved manifest /
  validation artifact、manifest 重新校验失败、manifest ID 和 raw evidence ID 不一致、
  或 manifest 模型计量与 API readback evidence 不一致时，都不能判定 complete。
- completion audit 会检查 `run_metadata`：resolved seed、resolved manifest、raw
  evidence、top-level evidence 必须共享同一 `runId`，
  `run-metadata.validation.json` 必须有效，且 evidence 时间戳必须有效；validation
  mismatches / errors 会进入 completion audit markdown，避免人工复核时只看到失败数量。
  top-level gate evidence 还必须和 raw evidence 使用同一个 `startedAt`，且
  `endedAt` 不早于 raw evidence 的 `endedAt`，避免旧 gate artifact 拼接到新浏览器证据。
- completion audit 会检查 `remediation_contract`，缺 `implementationPlan`、仍有
  `missingGateIds`、仍有 blocked 分组或未分组 gate 时，即使其它 artifact 存在也不能
  判定 complete。

当前可稳定产出 blocked remediation：

```bash
node scripts/persona/aics-production-plus-orchestrator.mjs \
  --api-seed \
  --probe-endpoints \
  --run-id codex-readiness-check \
  --output-dir /private/tmp/aics-production-plus-codex-readiness
```

输出：

```text
stage: readiness_blocked
verdict: failed
```

当前也可稳定产出 invalid manifest remediation：

```bash
node scripts/persona/aics-production-plus-orchestrator.mjs \
  --api-seed \
  --write-final-manifest /private/tmp/aics-invalid-final-manifest.json \
  --skip-preflight \
  --skip-playwright \
  --run-id codex-invalid-manifest-check \
  --output-dir /private/tmp/aics-production-plus-invalid-manifest-check
```

输出：

```text
stage: final_manifest_invalid
verdict: failed
```

本轮曾通过：

```bash
npm exec -- vitest run src/tool-supply-control/model.test.ts src/aics-main-flow/store.test.ts src/aics-main-flow/e2e.test.ts
```

已知非本轮阻塞：

```text
NODE_OPTIONS=--max-old-space-size=8192 npm exec -- tsc -p test/tsconfig/tsconfig.test.src.json --noEmit
```

当前失败在 `src/plugins/providers.test.ts` 的 readonly tuple 类型问题，和 AICS 闭环改动无关，但全仓生产级验收前必须修。

## 判定

当前状态：

```text
本地端工具/Skill -> 调度 -> 岗位执行 preflight 闭环：已验证
云端商城六 persona 生产级以上闭环：未通过，readiness blocked
```

下一轮最优先不是继续堆 UI，也不是新增并行 runner，而是：

1. 补齐云端连接 readiness。
2. 用真实云端返回值生成 fresh `api-seed.json`。
3. 写入并校验 `final-manifest.json`。
4. 让现有 orchestrator 跑完真实 Playwright evidence 和最终 gate。
