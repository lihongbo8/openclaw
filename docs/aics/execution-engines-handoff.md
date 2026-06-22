# 通用执行引擎交接清单

更新日期：2026-06-20

## 当前结论

- 本地两个执行引擎已完成：`RoleExecutionEngine` 和 `ToolSkillExecutionEngine` 都能真实执行并产出结果。
- 云端 API 闭环已完成：真实岗位包上传、岗位商品创建、审核、发布、买家授权、云端执行、执行读回、账本读回均通过。
- 真人浏览器门禁还未达到 `production_plus_passed`：现在剩下的是 admin dashboard 静态路由、OpenClaw 本地页面探针、role_execution 模型费用归因和 secret scan 规则。
- 机器可读状态文件：`docs/aics/execution-engines-status.json`。

## 最新真实验收

最新 run：

```bash
aics-production-plus-codex-real-202606201105
```

关键产物：

- seed：`docs/aics-persona-runs/aics-production-plus-codex-real-202606201105/api-seed.json`
- final manifest：`docs/aics-persona-runs/aics-production-plus-codex-real-202606201105/final-manifest.json`
- persona evidence：`docs/aics-persona-runs/aics-production-plus-codex-real-202606201105/persona-evidence/persona-evidence.json`
- gate evidence：`docs/aics-persona-runs/aics-production-plus-codex-real-202606201105/evidence.json`

真实 API seed 已通过：

- `roleListingId`: `djrole_01KVHFTVX8TWV6VT57WYDMM7A4`
- `executionId`: `3e8e2223-9ccc-450e-b91b-d68b741984af`
- `ledgerEntryId`: `djledger_01KVHFTWY82KMQK53HM8SDHXWB`
- 执行状态：`completed`
- 执行结果 artifact：`1`

浏览器 persona 最新状态：

- 通过：`developer`、`buyer_storefront`、`user_center`
- API cross-check：全通过
- 真实页面已打开并命中：卖家创建页、买家岗位详情页、用户执行结果页、用户费用记录页
- 未通过：`admin_reviewer`、`openclaw_local_operator`、`ledger_receivables_reader`

## 已修正内容

- production-plus Playwright 配置已拆分为 cloud API、vendor、admin、storefront、OpenClaw 多个 base URL。
- storefront 浏览器上下文已注入 `_medusa_jwt` cookie。
- vendor persona 已带 `x-seller-id`，卖家页面和岗位包区域可以命中。
- buyer selector 已对齐实际 `/roles/:roleListingId` 页面。
- ledger API check 已改为真实存在的 `/dijie/ledger/entries`。
- OpenClaw model readback 已明确打到 `http://127.0.0.1:18789/aics/api-connections/read-model`，可返回 200。

## 剩余阻塞

1. Admin dashboard 静态路由自重定向：

- `GET /dashboard/` 返回 `308 Location: /dashboard/`
- Playwright 结果：`ERR_TOO_MANY_REDIRECTS`
- 对比：`/seller/` 返回 200，说明 seller 静态挂载正常，dashboard 挂载异常。

2. OpenClaw 本地页面探针未命中：

- `/chat` 没命中 `[data-testid="main-chat"]`
- `/api-management` 没命中 `[data-testid="openclaw-api-management"]`
- `/usage` 没命中 `[data-testid="openclaw-billing-model-metering"]`

3. 模型费用归因仍未满足最终门禁：

- OpenClaw API readback 可用。
- `local_dialog` 有 tokens/cost。
- `role_execution` 仍是 `0`，最终门禁要求 role execution 也有模型 token 费用。

4. secret scan 仍需校准：

- 当前扫描会把公开页面文本或已脱敏 API readback 片段计为 leak。
- 需要收紧规则，避免把普通中文页面文本、`data-testid`、已 redacted 的 bearer 提示误判为秘密泄漏。

## 下一步

1. 修 `dijie-role-marketplace` 的 dashboard 静态路由，让 `/dashboard/` 返回 SPA index，而不是 308 到自身。
2. 修 OpenClaw UI 路由/selector，让 `/chat`、`/api-management`、`/usage` 可由无人工点击的 Playwright probe 命中目标页面。
3. 让真实岗位执行经过模型网关计量，写入 `byConsumer.role_execution`。
4. 校准 persona secret scan。
5. 重新运行：

```bash
node scripts/persona/aics-production-plus-orchestrator-fixture.mjs --fixture /private/tmp/aics293-local-smoke.json --seed-file docs/aics-persona-runs/aics-production-plus-codex-real-202606201105/api-seed.json --production-plus-final --probe-endpoints --final-manifest docs/aics-persona-runs/aics-production-plus-codex-real-202606201105/final-manifest.json --base-url http://127.0.0.1:9000 --vendor-url http://127.0.0.1:9000/seller --admin-url http://127.0.0.1:9000/dashboard --storefront-url http://127.0.0.1:3036 --storefront-locale us --openclaw-url http://127.0.0.1:18789 --run-id aics-production-plus-codex-real-202606201105 --output-dir docs/aics-persona-runs/aics-production-plus-codex-real-202606201105
```

## 不要误判

- 本地通用执行引擎目标：已完成。
- 云端 API 真实闭环：已完成。
- 真人浏览器 production-plus：未完成。
- 总目标只有在 `production_plus_passed` 出现后才能标记为完全完成。
