/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { AppViewState } from "../app-view-state.ts";
import { createDefaultMyRolesState } from "../controllers/my-roles.ts";
import { createDefaultSupportContactState } from "../controllers/support-contact.ts";
import { renderMyRolesPage } from "./my-roles.ts";

function renderView(state: AppViewState, onNavigate = vi.fn()): HTMLElement {
  const host = document.createElement("div");
  render(renderMyRolesPage(state, onNavigate), host);
  return host;
}

function normalizedText(host: HTMLElement): string {
  return (host.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("renderMyRolesPage", () => {
  it("shows authorized synced roles when no execution task has been dispatched yet", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.readModel = {
      summary: { total: 0 },
      executions: [],
      blockedReasons: [],
      roleAssets: [
        {
          roleListingId: "local_rolelisting_marketplace_ops",
          title: "商城运营诊断官",
          entitlementStatus: "authorized",
          priceLabel: "0 元",
        },
      ],
      roleAssetsSummary: { totalRoles: 1, availableRoles: 1 },
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const onNavigate = vi.fn();
    const host = renderView(state, onNavigate);

    const text = normalizedText(host);
    expect(text).toContain("已同步 1 个已授权岗位");
    expect(text).toContain("商城运营诊断官 · 0 元");
    expect(text).toContain("检查并派发");
    const button = [...host.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("去任务调度"),
    ) as HTMLButtonElement | undefined;
    expect(button).toBeTruthy();
    button?.click();
    expect(onNavigate).toHaveBeenCalledWith("workboard");
  });

  it("shows authorized synced roles from the new my-role roles read model", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.readModel = {
      summary: { total: 0 },
      executions: [],
      blockedReasons: [],
      roles: [
        {
          roleListingId: "local_rolelisting_marketplace_ops",
          roleKey: "local_rolelisting_marketplace_ops",
          title: "商城运营诊断官",
          entitlementId: "local_entitlement_marketplace_ops",
          entitlementStatus: "authorized",
          priceLabel: "0 元",
        },
      ],
      roleAssetsSummary: { totalRoles: 1, availableRoles: 1 },
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const onNavigate = vi.fn();
    const host = renderView(state, onNavigate);

    const text = normalizedText(host);
    expect(text).toContain("已同步 1 个已授权岗位");
    expect(text).toContain("商城运营诊断官 · 0 元");
    const button = [...host.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("去任务调度"),
    ) as HTMLButtonElement | undefined;
    expect(button).toBeTruthy();
    button?.click();
    expect(onNavigate).toHaveBeenCalledWith("workboard");
  });

  it("guides users without authorized roles back to billing authorization", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.readModel = {
      summary: { total: 0 },
      executions: [],
      blockedReasons: [],
      roleAssets: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;
    const onNavigate = vi.fn();

    const host = renderView(state, onNavigate);

    expect(host.textContent).toContain("先完成岗位上架和 0 元授权");
    const button = [...host.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("去费用与授权"),
    ) as HTMLButtonElement | undefined;
    expect(button).toBeTruthy();
    button?.click();
    expect(onNavigate).toHaveBeenCalledWith("usage");
  });

  it("surfaces role instance store errors without hiding authorized roles", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.readModel = {
      summary: { total: 0, instanceStoreError: "unable to open database file" },
      executions: [],
      blockedReasons: [],
      roleAssets: [
        {
          roleListingId: "local_rolelisting_marketplace_ops",
          title: "商城运营诊断官",
          entitlementStatus: "authorized",
        },
      ],
      roleAssetsSummary: { totalRoles: 1, availableRoles: 1 },
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const onNavigate = vi.fn();
    const host = renderView(state, onNavigate);

    expect(host.textContent).toContain("岗位运行历史库暂时不可读");
    expect(host.textContent).toContain("unable to open database file");
    expect(host.textContent).toContain("修复运行历史库");
    expect(host.textContent).toContain("商城运营诊断官");
  });

  it("points missing API binding blockers to model keys and role execution", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.readModel = {
      summary: { total: 1, blocked: 1 },
      executions: [],
      blockedReasons: [
        {
          stage: "dispatch",
          code: "missing_api_binding",
          message: "API 管理未给岗位执行绑定可用模型 Provider。",
        },
      ],
      roleAssets: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const host = renderView(state);

    expect(host.textContent).toContain("缺少：缺少 API 绑定");
    expect(host.textContent).toContain("添加模型 API Key");
    expect(host.textContent).toContain("岗位执行");
  });

  it("does not show raw unknown blocker codes to non-technical users", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.readModel = {
      summary: { total: 1, blocked: 1 },
      executions: [],
      blockedReasons: [
        {
          stage: "dispatch",
          code: "unique:private-capability-id",
          message: "internal only",
        },
      ],
      roleAssets: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const host = renderView(state);
    const pageText = host.textContent ?? "";

    expect(pageText).toContain("缺少：待处理项");
    expect(pageText).not.toContain("unique:private-capability-id");
  });

  it("turns provider API errors into an API management next step", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.error = "deepseek API 401: Unauthorized";
    myRoles.readModel = {
      summary: { total: 1, failed: 1 },
      executions: [],
      blockedReasons: [],
      roleAssets: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;
    const onNavigate = vi.fn();

    const host = renderView(state, onNavigate);
    const text = (host.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("deepseek API 401: Unauthorized");
    expect(text).toContain("下一步：到 API 管理检查 OpenAI/API Key、余额和限流状态");
    const button = [...host.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("去处理"),
    ) as HTMLButtonElement | undefined;
    expect(button).toBeTruthy();
    button?.click();
    expect(onNavigate).toHaveBeenCalledWith("apiManagement");
  });

  it("shows a success message after execution evidence has been read back", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.message = "岗位任务已完成，执行结果、审计记录、账本记录和业务产物均已读回。";
    myRoles.readModel = {
      summary: { total: 0 },
      executions: [],
      blockedReasons: [],
      roleAssets: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const onNavigate = vi.fn();
    const host = renderView(state, onNavigate);

    expect(host.textContent).toContain("岗位任务已完成");
    expect(host.textContent).toContain("执行结果、审计记录、账本记录和业务产物均已读回");
    const button = [...host.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("查看闭环检查"),
    ) as HTMLButtonElement | undefined;
    expect(button).toBeTruthy();
    button?.click();
    expect(onNavigate).toHaveBeenCalledWith("apiManagement");
  });

  it("shows the execution closure card from the main flow read model", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.readModel = {
      summary: { total: 1, completed: 1 },
      executions: [],
      blockedReasons: [],
      roleAssets: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: {
        readModel: {
          executionClosure: {
            status: "blocked",
            canRun: false,
            readinessChecks: [
              {
                label: "费用确认",
                status: "missing",
                detail: "需要在费用与授权确认费用。",
                targetTab: "usage",
              },
            ],
            businessResult: {
              summary: "已生成业务摘要，但账本读回失败。",
              artifactRefs: ["artifact:role-result:exec-1:summary"],
            },
            evidenceReadback: {
              hasRoleResult: true,
              hasBusinessArtifact: true,
              hasAudit: true,
              hasLedger: false,
              hasModelUsage: true,
            },
            missingEvidence: ["账本记录未读回"],
            recoveryActions: [
              {
                label: "去费用与授权检查账本",
                targetTab: "usage",
                reason: "账本读回缺失。",
              },
            ],
          },
        },
        error: null,
      },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;
    const onNavigate = vi.fn();

    const host = renderView(state, onNavigate);
    const text = (host.textContent ?? "").replace(/\s+/g, " ");

    expect(host.querySelector('[data-testid="execution-closure-card"]')).toBeTruthy();
    expect(text).toContain("岗位执行闭环 · 阻塞");
    expect(text).toContain("业务结果：已生成业务摘要，但账本读回失败。");
    expect(text).toContain("证据缺口：账本记录未读回");
    const button = [...host.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("去费用与授权检查账本"),
    ) as HTMLButtonElement | undefined;
    expect(button).toBeTruthy();
    button?.click();
    expect(onNavigate).toHaveBeenCalledWith("usage");
  });

  it("renders explicit no-model execution closure evidence as complete", () => {
    const state = {
      tab: "aics",
      connected: true,
      myRoles: createDefaultMyRolesState(),
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: {
        readModel: {
          executionClosure: {
            status: "completed",
            canRun: false,
            readinessChecks: [
              {
                label: "派发单",
                status: "passed",
                detail: "任务调度已生成派发单。",
                targetTab: "workboard",
              },
              {
                label: "费用确认",
                status: "passed",
                detail: "已确认本次费用和账本入口。",
                targetTab: "usage",
              },
            ],
            businessResult: {
              summary: "文件打包任务已完成，未调用模型。",
              artifactRefs: ["artifact:role-result:exec-tool-only:zip"],
            },
            evidenceReadback: {
              hasRoleResult: true,
              hasBusinessArtifact: true,
              hasAudit: true,
              hasLedger: true,
              hasModelUsage: true,
              modelUsageStatus: "not_applicable",
              modelUsageMessage: "本次文件打包由本地工具完成，未调用模型。",
            },
            evidenceSummary: [
              { label: "业务产物", value: "业务产物 1", status: "available" },
              { label: "审计记录", value: "audit-exec-marketplace-ops", status: "available" },
              {
                label: "账本记录",
                value:
                  "ledger:role_execution:local_entitlement_marketplace_ops:exec-marketplace-ops",
                status: "available",
              },
              {
                label: "模型费用",
                value: "本次未调用模型 · 本次文件打包由本地工具完成，未调用模型。",
                status: "available",
              },
            ],
            missingEvidence: [],
            productionFinalGate: {
              status: "not_evaluated",
              requiredVerdict: "production_plus_passed",
              reason: "本地版岗位闭环已完成；云端 SaaS 验收可后续执行。",
              nextAction: "运行 production-plus orchestrator。",
              operatorChecklist: [
                {
                  label: "连接真实云端商城",
                  detail: "填写并探测云端商城地址。",
                  requiredInput: "DIJIE_CLOUD_BASE_URL",
                },
              ],
              operatorSteps: [
                {
                  step: "1. 连接两个地址",
                  status: "blocked",
                  action: "填云端商城 API 地址和本地 OpenClaw UI 地址，然后重新跑 readiness。",
                  requiredInputs: ["DIJIE_CLOUD_BASE_URL", "OPENCLAW_LOCAL_URL"],
                },
                {
                  step: "4. 跑云端 SaaS 最终验收",
                  status: "pending",
                  action: "readiness 全部通过后运行 production-plus orchestrator。",
                },
              ],
              requiredInputs: ["DIJIE_CLOUD_BASE_URL", "OPENCLAW_LOCAL_URL"],
              readinessCommand:
                "node scripts/persona/aics-production-plus-readiness.mjs --probe-endpoints --output-dir /private/tmp/aics-production-plus-readiness",
              finalCommand:
                "node scripts/persona/aics-production-plus-orchestrator.mjs --production-plus-final --probe-endpoints",
              secretHandling: "只填写环境变量名和占位符，不把 token 写入证据。",
            },
            recoveryActions: [],
          },
        },
        error: null,
      },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const host = renderView(state, vi.fn());
    const text = (host.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("岗位执行闭环 · 闭环完成");
    expect(text).toContain("运行前条件");
    expect(text).toContain("派发单");
    expect(text).toContain("费用确认");
    expect(text).toContain("已满足");
    expect(text).toContain("证据摘要");
    expect(text).toContain("模型费用 本次未调用模型 · 本次文件打包由本地工具完成，未调用模型。");
    expect(text).toContain("审计记录 已读回");
    expect(text).not.toContain("audit-exec-marketplace-ops");
    expect(text).toContain("云端 SaaS 最终验收：未执行（本地版可跳过）");
    expect(text).toContain("云端必须结果：production_plus_passed");
    expect(text).toContain("真人准备清单");
    expect(text).toContain("连接真实云端商城：填写并探测云端商城地址。");
    expect(text).toContain("云端 SaaS 操作步骤");
    expect(text).toContain("1. 连接两个地址");
    expect(text).toContain("4. 跑云端 SaaS 最终验收");
    expect(text).toContain("需要准备：DIJIE_CLOUD_BASE_URL、OPENCLAW_LOCAL_URL");
    expect(text).toContain("aics-production-plus-readiness.mjs");
    expect(text).toContain("aics-production-plus-orchestrator.mjs");
    expect(text).toContain("模型费用 无需");
    expect(text).toContain("模型费用说明：本次文件打包由本地工具完成，未调用模型。");
    expect(text).not.toContain("模型费用 缺失");
  });

  it("explains audit and ledger readback failures without pretending success", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.error = "本地执行证据不完整：账本记录缺失。";
    myRoles.readModel = {
      summary: { total: 1, failed: 1 },
      executions: [],
      blockedReasons: [],
      roleAssets: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;
    const onNavigate = vi.fn();

    const host = renderView(state, onNavigate);
    const text = (host.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("本地执行证据不完整：账本记录缺失。");
    expect(text).toContain("下一步：先刷新岗位执行读回证据");
    expect(text).toContain("联系系统开发者处理审计或账本写回");
  });

  it("uses fixed non-technical execution status labels", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.readModel = {
      summary: { total: 9, ready: 4, running: 3, blocked: 1, failed: 1, completed: 1 },
      executions: [
        { id: "ready", title: "待执行样例", roleTitle: "岗位", status: "ready", canRun: true },
        {
          id: "preflight",
          title: "预检样例",
          roleTitle: "岗位",
          status: "ready",
          canRun: false,
        },
        {
          id: "fee",
          title: "费用样例",
          roleTitle: "岗位",
          status: "blocked",
          confirmExecution: true,
          costConfirmed: false,
          ledgerRef: "",
          blockedReason: "岗位执行需要先完成本次费用确认并生成费用凭证。",
        },
        {
          id: "api",
          title: "API 样例",
          roleTitle: "岗位",
          status: "ready",
          apiBindingReady: false,
          blockedReason: "缺少 API 绑定。",
        },
        {
          id: "running",
          title: "执行样例",
          roleTitle: "岗位",
          status: "running",
          currentStep: "调用授权工具",
        },
        {
          id: "generating",
          title: "生成样例",
          roleTitle: "岗位",
          status: "running",
          currentStep: "生成图片和详情页",
        },
        {
          id: "checking",
          title: "检查样例",
          roleTitle: "岗位",
          status: "running",
          currentStep: "读回审计和账本证据",
        },
        {
          id: "completed",
          title: "完成样例",
          roleTitle: "岗位",
          status: "completed",
          result: {
            outcome: "succeeded",
            summary: "已完成。",
            executionEvidence: {
              auditReadback: { auditRecordId: "audit-1" },
              ledgerReadback: { ledgerRef: "ledger-1" },
              costSummary: { totalCostCents: 0 },
              modelUsage: { totalTokens: 1, costCents: 0 },
            },
          },
          artifactRefs: ["artifact:role-result:completed:summary"],
        },
        { id: "failed", title: "失败样例", roleTitle: "岗位", status: "failed" },
      ],
      blockedReasons: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const host = renderView(state);
    const pageText = (host.textContent ?? "").replace(/\s+/g, " ");

    for (const label of [
      "待执行",
      "执行前检查中",
      "需要确认费用",
      "需要配置 API",
      "正在执行",
      "正在生成结果",
      "正在检查结果",
      "已完成",
      "执行失败",
    ]) {
      expect(pageText).toContain(label);
    }
  });

  it("shows the selected execution model before running a ready task", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.readModel = {
      summary: {
        total: 1,
        ready: 1,
        selectedModelRef: {
          entryId: "model-deepseek",
          provider: "deepseek",
          model: "deepseek-chat",
          modelRef: "deepseek/deepseek-chat",
        },
      },
      executions: [
        {
          id: "dispatch-role-request-1",
          title: "商城运营诊断",
          roleTitle: "商城运营诊断官",
          status: "ready",
          canRun: true,
          dispatchRequestId: "dispatch-role-request-1",
          taskPackageId: "task-package-1",
          selectedModelRef: {
            entryId: "model-deepseek",
            provider: "deepseek",
            model: "deepseek-chat",
            modelRef: "deepseek/deepseek-chat",
          },
        },
      ],
      blockedReasons: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: {
        readModel: {
          latest: {},
          readiness: {},
          executionPreflight: { canRun: false, blockedReasons: [] },
        },
        error: null,
      },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const host = renderView(state);

    expect(host.textContent).toContain("执行模型：deepseek / deepseek-chat");
    expect(host.textContent).toContain("商城运营诊断官");
  });

  it("shows the pre-run evidence checklist for a runnable role task", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.readModel = {
      summary: { total: 1, ready: 1 },
      executions: [
        {
          id: "dispatch-role-request-1",
          title: "商城运营诊断",
          roleTitle: "商城运营诊断官",
          status: "ready",
          canRun: true,
          entitlementId: "local_entitlement_marketplace_ops",
          confirmExecution: true,
          costConfirmed: true,
          ledgerRef: "ledger:pending:local_entitlement_marketplace_ops",
        },
      ],
      blockedReasons: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const host = renderView(state);
    const text = (host.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("执行前核对");
    expect(text).toContain("授权凭证 已授权");
    expect(text).toContain("人工确认 已确认");
    expect(text).toContain("费用凭证 已确认");
    expect(text).not.toContain("local_entitlement_marketplace_ops");
    expect(text).not.toContain("ledger:pending:local_entitlement_marketplace_ops");
    expect(text).toContain("点击执行可能调用真实模型、工具或 Skill 并产生费用");
    expect(text).toContain("系统会再次弹窗确认");
    expect(text).toContain("业务产物、审计记录、账本记录和模型费用证据");
    expect(text).toContain("工具-only 任务必须明确说明未调用模型");
    expect(text).toContain("缺任一项都会显示阻塞，不报成功");
  });

  it("shows post-run evidence on the execution card without opening details", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.readModel = {
      summary: { total: 1, completed: 1, artifactCount: 2 },
      executions: [
        {
          id: "dispatch-role-request-1",
          title: "商城运营诊断",
          roleTitle: "商城运营诊断官",
          status: "completed",
          confirmExecution: true,
          progress: 100,
          result: {
            outcome: "succeeded",
            summary: "已完成商城运营诊断。",
            executionEvidence: {
              ledgerRef: "ledger:role_execution:entitlement-1:exec-1",
              humanConfirmationRef: "human:confirm:exec-1",
              costSummary: {
                authorizationFeeCents: 0,
                executionFeeCents: 3,
                modelUsageCostCents: 3,
                totalCostCents: 3,
                currency: "CNY",
                source: "local_ledger",
              },
              businessDeliverables: [
                { label: "商城运营诊断报告", summary: "已生成本轮岗位商城运营诊断。" },
                { label: "岗位供给分析", summary: "已汇总岗位商品供给与品类覆盖。" },
                { label: "授权转化分析", summary: "已分析 0 元授权转化状态。" },
                { label: "执行成功率分析", summary: "已分析本地执行成功率。" },
                { label: "阻塞原因分析", summary: "已列出能力、授权、审计和账本阻塞。" },
                { label: "日/周/月运营建议", summary: "已给出日、周、月运营动作。" },
                { label: "下一步调度建议", summary: "已给出后续调度建议。" },
                { label: "审计摘要", summary: "已读回审计摘要。" },
                { label: "账本摘要", summary: "已读回账本摘要。" },
              ],
              auditReadback: {
                auditRecordId: "audit-1",
                executionId: "exec-1",
                status: "completed",
              },
              ledgerReadback: {
                ledgerRef: "ledger:role_execution:entitlement-1:exec-1",
                executionId: "exec-1",
                status: "posted",
              },
              modelUsage: {
                provider: "deepseek",
                model: "deepseek-v4-flash",
                inputTokens: 120,
                outputTokens: 80,
                totalTokens: 200,
                costCents: 3,
              },
            },
          },
          artifactRefs: ["artifact:role-result:exec-1:summary", "audit:audit-1"],
        },
      ],
      blockedReasons: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const onNavigate = vi.fn();
    const host = renderView(state, onNavigate);
    const text = (host.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("已完成任务");
    expect(text).toContain("派发任务 已完成");
    expect(text).toContain("deepseek / deepseek-v4-flash API 绑定");
    expect(text).toContain("执行后证据");
    expect(text).toContain("闭环证据完整");
    expect(text).toContain("成果：已完成商城运营诊断。");
    expect(text).toContain("结果位置：执行摘要。打开“详情”可查看、打开或下载。");
    expect(text).toContain("业务产物 1 个");
    expect(text).toContain("审计记录 已读回");
    expect(text).toContain("账本记录 已读回");
    expect(text).toContain(
      "费用摘要 授权 ¥0.00 · 执行 ¥0.03 · 模型 ¥0.0300 · 合计 ¥0.0300 · local_ledger",
    );
    expect(text).toContain("人工确认 已确认");
    expect(text).toContain("费用证据 ¥0.0300 · 200 Token");
    expect(text).toContain("业务产物：执行摘要");
    expect(text).toContain("审计：审计记录 1");
    expect(text).toContain("账本：账本记录");
    expect(text).toContain(
      "费用摘要：授权 ¥0.00 · 执行 ¥0.03 · 模型 ¥0.0300 · 合计 ¥0.0300 · local_ledger",
    );
    expect(text).toContain("人工确认：已确认");
    expect(text).not.toContain("human:confirm:exec-1");
    expect(text).not.toContain("audit:audit-1");
    expect(text).not.toContain("ledger:role_execution:entitlement-1:exec-1");
    expect(text).not.toContain("artifact:role-result:exec-1:summary");
    expect(text).toContain("业务明细");
    expect(text).toContain("商城运营诊断报告：已生成本轮岗位商城运营诊断。");
    expect(text).toContain("岗位供给分析：已汇总岗位商品供给与品类覆盖。");
    expect(text).toContain("授权转化分析：已分析 0 元授权转化状态。");
    expect(text).toContain("执行成功率分析：已分析本地执行成功率。");
    expect(text).toContain("阻塞原因分析：已列出能力、授权、审计和账本阻塞。");
    expect(text).toContain("日/周/月运营建议：已给出日、周、月运营动作。");
    expect(text).toContain("下一步调度建议：已给出后续调度建议。");
    expect(text).toContain("审计摘要：已读回审计摘要。");
    expect(text).toContain("账本摘要：已读回账本摘要。");
    const button = [...host.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("查看闭环检查"),
    ) as HTMLButtonElement | undefined;
    expect(button).toBeTruthy();
    button?.click();
    expect(onNavigate).toHaveBeenCalledWith("apiManagement");
  });

  it("does not present completed executions as fully successful when audit or ledger evidence is missing", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.selectedRoleKey = "dispatch-role-request-1";
    myRoles.readModel = {
      summary: { total: 1, completed: 1, artifactCount: 1 },
      executions: [
        {
          id: "dispatch-role-request-1",
          title: "商城运营诊断",
          roleTitle: "商城运营诊断官",
          status: "completed",
          progress: 100,
          result: {
            outcome: "succeeded",
            summary: "岗位执行器返回了业务摘要，但审计账本读回不完整。",
            executionEvidence: {},
          },
          artifactRefs: ["artifact:role-result:exec-1:summary"],
        },
      ],
      blockedReasons: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const host = renderView(state);
    const text = (host.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("执行后证据");
    expect(text).toContain("已阻塞");
    expect(text).toContain("闭环证据不完整");
    expect(text).toContain("业务产物 1 个");
    expect(text).toContain("审计记录 缺失");
    expect(text).toContain("账本记录 缺失");
    expect(text).not.toContain("闭环证据完整");
    expect(text).not.toContain("查看闭环检查");
  });

  it("keeps the pre-run checklist blocked when cost evidence is missing", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.readModel = {
      summary: { total: 1, blocked: 1 },
      executions: [
        {
          id: "dispatch-role-request-1",
          title: "商城运营诊断",
          roleTitle: "商城运营诊断官",
          status: "blocked",
          canRun: false,
          entitlementId: "local_entitlement_marketplace_ops",
          confirmExecution: true,
          costConfirmed: false,
          ledgerRef: "",
          blockedReason: "岗位执行需要先完成本次费用确认并生成 ledgerRef。",
        },
      ],
      blockedReasons: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const host = renderView(state);
    const text = (host.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("执行前核对");
    expect(text).toContain("授权凭证 已授权");
    expect(text).toContain("人工确认 已确认");
    expect(text).toContain("费用凭证 待确认");
    expect(text).toContain("阻塞：岗位执行需要先完成本次费用确认并生成费用凭证。");
    expect(text).not.toContain("local_entitlement_marketplace_ops");
    expect(text).not.toContain("ledgerRef");
    expect(text).not.toContain("点击执行会调用真实模型 API");
    expect(text).not.toContain("查看闭环检查");
  });

  it("shows execution ledger, audit, and business artifacts in the detail artifacts tab", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.detailTab = "artifacts";
    myRoles.selectedRoleKey = "dispatch-role-request-1";
    myRoles.readModel = {
      summary: { total: 1, completed: 1, artifactCount: 2 },
      executions: [
        {
          id: "dispatch-role-request-1",
          title: "商城运营诊断",
          roleTitle: "商城运营诊断官",
          status: "completed",
          dispatchRequestId: "dispatch-role-request-1",
          taskPackageId: "task-package-1",
          updatedAt: 1,
          result: {
            outcome: "succeeded",
            summary: "已完成商城运营诊断。",
            executionEvidence: {
              ledgerRef: "ledger:role_execution:entitlement-1:exec-1",
              costSummary: {
                authorizationFeeCents: 0,
                executionFeeCents: 0,
                totalCostCents: 0,
                currency: "CNY",
                source: "local_ledger",
              },
              auditReadback: {
                auditRecordId: "audit-1",
                executionId: "exec-1",
                status: "completed",
                summary: "审计已记录商城运营诊断结果。",
              },
              ledgerReadback: {
                ledgerRef: "ledger:role_execution:entitlement-1:exec-1",
                executionId: "exec-1",
                authorizationFeeCents: 0,
                executionFeeCents: 0,
                source: "local_zero_price",
                status: "posted",
              },
              modelUsage: {
                provider: "deepseek",
                model: "deepseek-v4-flash",
                inputTokens: 120,
                outputTokens: 80,
                totalTokens: 200,
                costCents: 3,
              },
            },
          },
          artifactRefs: ["artifact:role-result:exec-1:summary", "audit:audit-1"],
        },
      ],
      blockedReasons: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const host = renderView(state);

    const text = normalizedText(host);
    expect(text).toContain("成果摘要");
    expect(text).toContain("已完成商城运营诊断。");
    expect(text).toContain("模型用量证据");
    expect(text).toContain("deepseek / deepseek-v4-flash");
    expect(text).toContain("Token：输入 120 / 输出 80 / 合计 200");
    expect(text).toContain("费用证据：¥0.0300");
    expect(text).toContain("账本记录");
    expect(text).toContain("账本读回");
    expect(text).toContain("状态：posted · 授权费用 ¥0.00");
    expect(text).toContain("执行费用 ¥0.00");
    expect(text).toContain("审计：审计记录 1");
    expect(text).toContain("审计读回");
    expect(text).toContain("审计已记录商城运营诊断结果。");
    expect(text).toContain("执行摘要");
    expect(text).toContain("执行结果引用");
    expect(text).not.toContain("artifact:role-result:exec-1:summary");
  });

  it("shows external record artifacts in human language without raw execution refs", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.detailTab = "artifacts";
    myRoles.selectedRoleKey = "dispatch-role-request-1";
    myRoles.readModel = {
      summary: { total: 1, completed: 1, artifactCount: 1 },
      executions: [
        {
          id: "dispatch-role-request-1",
          title: "创建客服工单",
          roleTitle: "客服运营专员",
          status: "completed",
          dispatchRequestId: "dispatch-role-request-1",
          taskPackageId: "task-package-1",
          confirmExecution: true,
          updatedAt: 1,
          result: {
            outcome: "succeeded",
            summary: "已创建客服工单并回读记录。",
            executionEvidence: {
              ledgerRef: "ledger:role_execution:entitlement-1:exec-1",
              humanConfirmationRef: "human:confirm:exec-1",
              outputContracts: ["external_record"],
              externalRecordRefs: ["external_record:ticket:T-100"],
              costSummary: {
                authorizationFeeCents: 0,
                executionFeeCents: 0,
                totalCostCents: 0,
                currency: "CNY",
                source: "local_ledger",
              },
              auditReadback: {
                auditRecordId: "audit-1",
                executionId: "exec-1",
                status: "completed",
              },
              ledgerReadback: {
                ledgerRef: "ledger:role_execution:entitlement-1:exec-1",
                executionId: "exec-1",
                status: "posted",
              },
              modelUsageNotApplicable: true,
              modelUsageNotApplicableReason: "本次只回读外部系统记录。",
            },
          },
          artifactRefs: ["external_record:ticket:T-100", "audit:audit-1"],
        },
      ],
      blockedReasons: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const host = renderView(state);
    const pageText = host.textContent ?? "";

    expect(pageText).toContain("业务产物：外部记录 T-100");
    expect(pageText).toContain("外部系统回读记录");
    expect(pageText).toContain("已回读");
    expect(pageText).not.toContain("external_record:ticket:T-100");
    expect(pageText).not.toContain("human:confirm:exec-1");
    expect(pageText).not.toContain("ledger:role_execution:entitlement-1:exec-1");
  });

  it("renders generated image preview, detail page opener, and zip download in artifacts tab", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.detailTab = "artifacts";
    myRoles.selectedRoleKey = "dispatch-role-request-1";
    const imageRef = "/tmp/exec-1/hero.png";
    const htmlRef = "/tmp/exec-1/detail.html";
    const summaryRef = "/tmp/exec-1/execution-summary.json";
    const zipRef = "/tmp/exec-1/artifacts.zip";
    const executionSummary = {
      title: "智能水杯详情页",
      roleTitle: "电商美工",
      category: "电商详情页",
      taskText: "为一款智能水杯生成首屏图片和商品详情页。",
      deliverables: [
        { type: "image", name: "hero.png", ref: imageRef },
        { type: "detail_page", name: "detail.html", ref: htmlRef },
      ],
    };
    myRoles.artifactPreviews = {
      [`exec-1::${imageRef}`]: {
        ok: true,
        executionId: "exec-1",
        ref: imageRef,
        name: "hero.png",
        kind: "image",
        mimeType: "image/png",
        sizeBytes: 8,
        dataUrl: "data:image/png;base64,ZmFrZS1wbmc=",
      },
      [`exec-1::${htmlRef}`]: {
        ok: true,
        executionId: "exec-1",
        ref: htmlRef,
        name: "detail.html",
        kind: "document",
        mimeType: "text/html; charset=utf-8",
        sizeBytes: 128,
        dataUrl: "data:text/html;base64,PGh0bWw+PC9odG1sPg==",
      },
      [`exec-1::${summaryRef}`]: {
        ok: true,
        executionId: "exec-1",
        ref: summaryRef,
        name: "execution-summary.json",
        kind: "document",
        mimeType: "application/json",
        sizeBytes: 256,
        dataUrl: `data:application/json;base64,${Buffer.from(JSON.stringify(executionSummary)).toString("base64")}`,
      },
      [`exec-1::${zipRef}`]: {
        ok: true,
        executionId: "exec-1",
        ref: zipRef,
        name: "artifacts.zip",
        kind: "archive",
        mimeType: "application/zip",
        sizeBytes: 512,
        dataUrl: "data:application/zip;base64,UEs=",
      },
    };
    myRoles.readModel = {
      summary: { total: 1, completed: 1, artifactCount: 4 },
      executions: [
        {
          id: "dispatch-role-request-1",
          title: "智能水杯详情页",
          roleTitle: "电商美工",
          status: "completed",
          dispatchRequestId: "dispatch-role-request-1",
          taskPackageId: "task-package-1",
          updatedAt: 1,
          result: {
            id: "exec-1",
            outcome: "succeeded",
            summary: "已生成图片和详情页。",
            executionEvidence: {
              ledgerRef: "ledger:role_execution:entitlement-1:exec-1",
              auditReadback: { auditRecordId: "audit-1", executionId: "exec-1" },
              ledgerReadback: { ledgerRef: "ledger:role_execution:entitlement-1:exec-1" },
              modelUsage: { totalTokens: 0, costCents: 0 },
            },
          },
          artifactRefs: [imageRef, htmlRef, summaryRef, zipRef, "audit:audit-1"],
        },
      ],
      blockedReasons: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const host = renderView(state);

    expect(host.querySelector('img[src="data:image/png;base64,ZmFrZS1wbmc="]')).toBeTruthy();
    const text = normalizedText(host);
    expect(text).toContain("执行摘要");
    expect(text).toContain("智能水杯详情页 · 电商美工 · 电商详情页");
    expect(text).toContain("交付物：2 个");
    expect(text).toContain("图片 hero.png");
    expect(text).toContain("详情页 detail.html");
    expect(text).toContain("执行摘要");
    expect(text).toContain("打包文件 artifacts.zip");
    expect(text).toContain("打开详情页");
    expect(text).toContain("下载打包文件");
    expect(text).not.toContain("/tmp/exec-1/hero.png");
    expect(text).not.toContain("/tmp/exec-1/detail.html");
    expect(text).not.toContain("execution-summary.json");
    expect(text).not.toContain("/tmp/exec-1/execution-summary.json");
    expect(text).not.toContain("/tmp/exec-1/artifacts.zip");
  });

  it("keeps ordinary execution detail free of raw technical fields", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.detailTab = "overview";
    myRoles.selectedRoleKey = "dispatch-role-request-1";
    myRoles.readModel = {
      summary: { total: 1, completed: 1, artifactCount: 4 },
      executions: [
        {
          id: "dispatch-role-request-1",
          title: "智能水杯详情页",
          roleTitle: "电商美工",
          status: "completed",
          dispatchRequestId: "dispatch-role-request-1",
          taskPackageId: "task-package-1",
          workBlockTitle: "电商详情页",
          sourceGoalTitle: "提高商品转化",
          planningTitle: "商品内容优化",
          capabilitySummary: "岗位能力已准备好。",
          allowedTools: [
            "core.openai.image.generate",
            "core.workspace.detail.write",
            "core.artifact.quality.check",
          ],
          allowedSkills: ["img:gen", "ws:write", "quality:check"],
          categoryCapabilityId: "category:marketplace-ops-local@1",
          assetId: "asset-technical-id",
          updatedAt: 1,
          result: {
            id: "exec-1",
            outcome: "succeeded",
            summary: "已生成图片、详情页和打包文件。",
            executionEvidence: {
              categoryCapabilityId: "category:marketplace-ops-local@1",
              ledgerRef: "ledger:role_execution:entitlement-1:exec-1",
              auditReadback: { auditRecordId: "audit-1", executionId: "exec-1" },
              ledgerReadback: { ledgerRef: "ledger:role_execution:entitlement-1:exec-1" },
              modelUsage: { totalTokens: 0, costCents: 0 },
            },
          },
          artifactRefs: [
            "/tmp/exec-1/hero.png",
            "/tmp/exec-1/detail.html",
            "/tmp/exec-1/execution-summary.json",
            "/tmp/exec-1/artifact-manifest.json",
            "audit:audit-1",
          ],
        },
      ],
      blockedReasons: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const host = renderView(state);
    const pageText = normalizedText(host);

    expect(pageText).toContain("执行结果：成功 / 已生成图片、详情页和打包文件。");
    expect(pageText).toContain("能力匹配：岗位能力已准备好。");
    expect(pageText).not.toContain("succeeded");
    expect(pageText).not.toContain("allowedSkills");
    expect(pageText).not.toContain("allowedTools");
    expect(pageText).not.toContain("asset-technical-id");
    expect(pageText).not.toContain("category:marketplace-ops-local@1");
    expect(pageText).not.toContain("core.openai.image.generate");
    expect(pageText).not.toContain("img:gen");
    expect(pageText).not.toContain("/tmp/exec-1");
    expect(pageText).not.toContain("execution-summary.json");
    expect(pageText).not.toContain("artifact-manifest.json");
  });

  it("hides raw unique capability refs in execution details", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.detailTab = "boundary";
    myRoles.selectedRoleKey = "dispatch-role-request-unique";
    myRoles.readModel = {
      summary: { total: 1, blocked: 1 },
      executions: [
        {
          id: "dispatch-role-request-unique",
          title: "特殊能力任务",
          roleTitle: "运营岗位",
          status: "blocked",
          blockedReason: "特殊能力待确认",
          uniqueCapabilityRequest: {
            missingCapability: "unique:private-capability-id",
            status: "pending_review",
          },
          updatedAt: 1,
          artifactRefs: [],
        },
      ],
      blockedReasons: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const host = renderView(state);
    const pageText = (host.textContent ?? "").replace(/\s+/g, " ");

    expect(pageText).toContain("独特能力申请：特殊岗位能力 / 待确认");
    expect(pageText).not.toContain("unique:private-capability-id");
    expect(pageText).not.toContain("pending_review");
  });

  it("shows a human next step when a business artifact cannot be read", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.detailTab = "artifacts";
    myRoles.selectedRoleKey = "dispatch-role-request-1";
    const imageRef = "/tmp/exec-1/hero.png";
    myRoles.artifactPreviews = {
      [`exec-1::${imageRef}`]: {
        ok: false,
        executionId: "exec-1",
        ref: imageRef,
        name: "hero.png",
        kind: "image",
        mimeType: "image/png",
        sizeBytes: 0,
        error: "产物文件不存在或为空。",
      },
    };
    myRoles.readModel = {
      summary: { total: 1, completed: 1, artifactCount: 1 },
      executions: [
        {
          id: "dispatch-role-request-1",
          title: "智能水杯详情页",
          roleTitle: "电商美工",
          status: "completed",
          dispatchRequestId: "dispatch-role-request-1",
          taskPackageId: "task-package-1",
          updatedAt: 1,
          result: {
            id: "exec-1",
            outcome: "succeeded",
            summary: "已生成图片和详情页。",
          },
          artifactRefs: [imageRef],
        },
      ],
      blockedReasons: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const host = renderView(state);
    const pageText = host.textContent ?? "";

    expect(pageText).toContain("图片 hero.png");
    expect(pageText).toContain("读取失败");
    expect(pageText).toContain("产物文件不存在或为空。");
    expect(pageText).toContain("下一步：先刷新岗位执行结果");
    expect(pageText).not.toContain("/tmp/exec-1/hero.png");
  });

  it("summarizes execution evidence on the default overview tab", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.detailTab = "overview";
    myRoles.selectedRoleKey = "dispatch-role-request-1";
    myRoles.readModel = {
      summary: { total: 1, completed: 1, artifactCount: 2 },
      executions: [
        {
          id: "dispatch-role-request-1",
          title: "商城运营诊断",
          roleTitle: "商城运营诊断官",
          status: "completed",
          dispatchRequestId: "dispatch-role-request-1",
          taskPackageId: "task-package-1",
          updatedAt: 1,
          result: {
            outcome: "succeeded",
            summary: "已完成商城运营诊断。",
            executionEvidence: {
              ledgerRef: "ledger:role_execution:entitlement-1:exec-1",
              costSummary: {
                authorizationFeeCents: 0,
                executionFeeCents: 0,
                totalCostCents: 0,
                currency: "CNY",
                source: "local_ledger",
              },
              auditReadback: {
                auditRecordId: "audit-1",
                executionId: "exec-1",
                status: "completed",
              },
              ledgerReadback: {
                ledgerRef: "ledger:role_execution:entitlement-1:exec-1",
                executionId: "exec-1",
                status: "posted",
              },
              modelUsage: {
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                costCents: 0,
              },
            },
          },
          artifactRefs: ["artifact:role-result:exec-1:summary", "audit:audit-1"],
        },
      ],
      blockedReasons: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const host = renderView(state);
    const text = (host.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("闭环证据");
    expect(text).toContain("闭环证据完整");
    expect(text).toContain("账本：已读回");
    expect(text).toContain("审计：已读回");
    expect(text).toContain("业务产物：1 个");
    expect(text).toContain("费用摘要：授权 ¥0.00 · 执行 ¥0.00 · 合计 ¥0.0000 · local_ledger");
  });

  it("marks the overview evidence summary incomplete when any required readback is missing", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.detailTab = "overview";
    myRoles.selectedRoleKey = "dispatch-role-request-1";
    myRoles.readModel = {
      summary: { total: 1, completed: 1, artifactCount: 1 },
      executions: [
        {
          id: "dispatch-role-request-1",
          title: "商城运营诊断",
          roleTitle: "商城运营诊断官",
          status: "completed",
          dispatchRequestId: "dispatch-role-request-1",
          taskPackageId: "task-package-1",
          updatedAt: 1,
          result: {
            outcome: "succeeded",
            summary: "已完成商城运营诊断。",
            executionEvidence: {
              ledgerRef: "ledger:role_execution:entitlement-1:exec-1",
            },
          },
          artifactRefs: ["artifact:role-result:exec-1:summary"],
        },
      ],
      blockedReasons: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const host = renderView(state);
    const text = (host.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("闭环证据不完整");
    expect(text).toContain("账本：已记录");
    expect(text).toContain("审计：缺失");
    expect(text).toContain("业务产物：1 个");
    expect(text).not.toContain("闭环证据完整");
  });

  it("does not present memory candidates as business artifacts", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.detailTab = "overview";
    myRoles.selectedRoleKey = "dispatch-role-request-1";
    myRoles.readModel = {
      summary: { total: 1, completed: 1, artifactCount: 1 },
      executions: [
        {
          id: "dispatch-role-request-1",
          title: "沉淀执行经验",
          roleTitle: "运营助手",
          status: "blocked",
          dispatchRequestId: "dispatch-role-request-1",
          taskPackageId: "task-package-1",
          confirmExecution: true,
          updatedAt: 1,
          result: {
            outcome: "blocked",
            summary: "只有候选记忆，没有业务产物。",
            executionEvidence: {
              ledgerRef: "ledger:role_execution:entitlement-1:exec-memory",
              humanConfirmationRef: "human:confirm:exec-memory",
              costSummary: {
                authorizationFeeCents: 0,
                executionFeeCents: 0,
                totalCostCents: 0,
                currency: "CNY",
                source: "local_ledger",
              },
              auditReadback: {
                auditRecordId: "audit-memory",
                executionId: "exec-memory",
                status: "completed",
              },
              ledgerReadback: {
                ledgerRef: "ledger:role_execution:entitlement-1:exec-memory",
                executionId: "exec-memory",
                status: "posted",
              },
              modelUsageNotApplicable: true,
              modelUsageNotApplicableReason: "本次只登记候选记忆。",
            },
          },
          artifactRefs: ["memory_candidate:candidate-1", "audit:audit-memory"],
        },
      ],
      blockedReasons: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const host = renderView(state);
    const pageText = (host.textContent ?? "").replace(/\s+/g, " ");

    expect(pageText).toContain("闭环证据不完整");
    expect(pageText).toContain("业务产物：0 个");
    expect(pageText).toContain("业务产物 缺失");
    expect(pageText).not.toContain("memory_candidate:candidate-1");
    expect(pageText).not.toContain("业务产物：1 个");
  });

  it("recognizes ledger artifacts even when execution evidence is missing", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.detailTab = "artifacts";
    myRoles.selectedRoleKey = "dispatch-role-request-1";
    myRoles.readModel = {
      summary: { total: 1, completed: 1, artifactCount: 3 },
      executions: [
        {
          id: "dispatch-role-request-1",
          title: "商城运营诊断",
          roleTitle: "商城运营诊断官",
          status: "completed",
          dispatchRequestId: "dispatch-role-request-1",
          taskPackageId: "task-package-1",
          updatedAt: 1,
          result: {
            outcome: "succeeded",
            summary: "已完成商城运营诊断。",
          },
          artifactRefs: [
            "artifact:role-result:exec-1:summary",
            "audit:audit-1",
            "ledger:role_execution:entitlement-1:exec-1",
          ],
        },
      ],
      blockedReasons: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const host = renderView(state);
    const text = host.textContent ?? "";
    expect(text).toContain("账本：账本记录");
    expect(text).toContain("审计：审计记录 1");
    expect(text).toContain("执行摘要");
    expect(text).toContain("执行结果引用");
    expect(text).not.toContain("artifact:role-result:exec-1:summary");
  });

  it("shows missing model usage evidence instead of silently hiding the cost section", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.detailTab = "artifacts";
    myRoles.selectedRoleKey = "dispatch-role-request-1";
    myRoles.readModel = {
      summary: { total: 1, completed: 1, artifactCount: 1 },
      executions: [
        {
          id: "dispatch-role-request-1",
          title: "商城运营诊断",
          roleTitle: "商城运营诊断官",
          status: "completed",
          dispatchRequestId: "dispatch-role-request-1",
          taskPackageId: "task-package-1",
          updatedAt: 1,
          result: {
            outcome: "succeeded",
            summary: "已完成商城运营诊断。",
            executionEvidence: {
              ledgerRef: "ledger:role_execution:entitlement-1:exec-1",
            },
          },
          artifactRefs: ["artifact:role-result:exec-1:summary"],
        },
      ],
      blockedReasons: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const host = renderView(state);

    expect(host.textContent).toContain("模型用量证据");
    expect(host.textContent).toContain("无模型用量证据");
    expect(host.textContent).toContain("费用证据：无真实费用金额");
  });

  it("uses zero-fee ledger readback as real fee evidence when model cost is absent", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.detailTab = "artifacts";
    myRoles.selectedRoleKey = "dispatch-role-request-1";
    myRoles.readModel = {
      summary: { total: 1, completed: 1, artifactCount: 2 },
      executions: [
        {
          id: "dispatch-role-request-1",
          title: "商城运营诊断",
          roleTitle: "商城运营诊断官",
          status: "completed",
          dispatchRequestId: "dispatch-role-request-1",
          taskPackageId: "task-package-1",
          updatedAt: 1,
          result: {
            outcome: "succeeded",
            summary: "已完成商城运营诊断。",
            executionEvidence: {
              ledgerRef: "ledger:role_execution:entitlement-1:exec-1",
              auditReadback: {
                auditRecordId: "audit-1",
                executionId: "exec-1",
                status: "completed",
              },
              ledgerReadback: {
                ledgerRef: "ledger:role_execution:entitlement-1:exec-1",
                executionId: "exec-1",
                authorizationFeeCents: 0,
                executionFeeCents: 0,
                source: "local_zero_price",
                status: "posted",
              },
              modelUsage: {
                inputTokens: 12,
                outputTokens: 8,
                totalTokens: 20,
              },
            },
          },
          artifactRefs: ["artifact:role-result:exec-1:summary", "audit:audit-1"],
        },
      ],
      blockedReasons: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const host = renderView(state);
    const text = host.textContent ?? "";

    expect(text).toContain("费用证据");
    expect(text).toContain("账本已读回 · 授权 ¥0.00 · 执行 ¥0.00");
    expect(text).not.toContain("费用证据：无真实费用金额");
    expect(text).not.toContain("缺真实费用金额");
  });

  it("shows zero-cost model usage as real cost evidence", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.detailTab = "artifacts";
    myRoles.selectedRoleKey = "dispatch-role-request-1";
    myRoles.readModel = {
      summary: { total: 1, completed: 1, artifactCount: 1 },
      executions: [
        {
          id: "dispatch-role-request-1",
          title: "商城运营诊断",
          roleTitle: "商城运营诊断官",
          status: "completed",
          dispatchRequestId: "dispatch-role-request-1",
          taskPackageId: "task-package-1",
          updatedAt: 1,
          result: {
            outcome: "succeeded",
            summary: "已完成商城运营诊断。",
            executionEvidence: {
              ledgerRef: "ledger:role_execution:entitlement-1:exec-1",
              modelUsage: {
                inputTokens: 12,
                outputTokens: 8,
                totalTokens: 20,
                costCents: 0,
              },
            },
          },
          artifactRefs: ["artifact:role-result:exec-1:summary"],
        },
      ],
      blockedReasons: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const host = renderView(state);

    expect(host.textContent).toContain("费用证据：¥0.0000");
    expect(host.textContent).not.toContain("费用证据：无真实费用金额");
  });

  it("shows recovery suggestions for failed role executions", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.detailTab = "artifacts";
    myRoles.selectedRoleKey = "dispatch-role-request-1";
    myRoles.readModel = {
      summary: { total: 1, failed: 1, artifactCount: 1 },
      executions: [
        {
          id: "dispatch-role-request-1",
          title: "商城运营诊断",
          roleTitle: "商城运营诊断官",
          status: "failed",
          dispatchRequestId: "dispatch-role-request-1",
          taskPackageId: "task-package-1",
          updatedAt: 1,
          blockedReason: "deepseek API 401: Unauthorized",
          result: {
            outcome: "failed",
            summary: "deepseek API 401: Unauthorized",
            executionEvidence: {
              ledgerRef: "ledger:role_execution:entitlement-1:exec-401",
              recoverySuggestion: "请到 API 管理检查 DeepSeek Key 是否过期或填错。",
            },
          },
          artifactRefs: ["audit:audit-401"],
        },
      ],
      blockedReasons: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const host = renderView(state);

    expect(host.textContent).toContain("恢复建议");
    expect(host.textContent).toContain("请到 API 管理检查 DeepSeek Key 是否过期或填错。");
    expect(host.textContent).toContain("deepseek API 401: Unauthorized");
  });

  it("shows recovery suggestions on the execution card without opening details", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.readModel = {
      summary: { total: 1, failed: 1, artifactCount: 0 },
      executions: [
        {
          id: "dispatch-role-request-1",
          title: "智能水杯详情页",
          roleTitle: "电商美工",
          status: "failed",
          blockedReason: "OpenAI 图片 API 429: Rate limit reached",
          result: {
            outcome: "failed",
            summary: "OpenAI 图片 API 429: Rate limit reached",
            executionEvidence: {
              recoverySuggestion: "请到 API 管理检查 OpenAI 账户限流、余额和 API Key 后重试。",
            },
          },
          artifactRefs: [],
        },
      ],
      blockedReasons: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;

    const host = renderView(state);
    const text = (host.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("智能水杯详情页");
    expect(text).toContain("执行后证据");
    expect(text).toContain("下一步：请到 API 管理检查 OpenAI 账户限流、余额和 API Key 后重试。");
  });

  it("guides OpenAI image API rate-limit failures to API management from execution details", () => {
    const myRoles = createDefaultMyRolesState();
    myRoles.detailTab = "boundary";
    myRoles.selectedRoleKey = "dispatch-role-request-1";
    myRoles.readModel = {
      summary: { total: 1, blocked: 1 },
      executions: [
        {
          id: "dispatch-role-request-1",
          title: "智能水杯详情页",
          roleTitle: "电商美工",
          status: "blocked",
          dispatchRequestId: "dispatch-role-request-1",
          taskPackageId: "task-package-1",
          updatedAt: 1,
          blockedReason: "OpenAI 图片 API 429: Rate limit reached",
          result: {
            outcome: "blocked",
            summary: "OpenAI 图片 API 429: Rate limit reached",
            executionEvidence: {
              recoverySuggestion: "请检查 OpenAI 账户限流、余额和 API Key 后重试。",
            },
          },
          artifactRefs: [],
        },
      ],
      blockedReasons: [],
    };
    const state = {
      tab: "aics",
      connected: true,
      myRoles,
      supportContact: createDefaultSupportContactState(),
      aicsMainFlow: { readModel: null, error: null },
      toolSupplyControl: { readModel: null, loading: false, error: null },
      refreshToolSupplyControlReadModel: vi.fn(),
    } as unknown as AppViewState;
    const onNavigate = vi.fn();

    const host = renderView(state, onNavigate);
    const text = (host.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("OpenAI 图片 API 429: Rate limit reached");
    expect(text).toContain("下一步：到 API 管理检查 OpenAI/API Key、余额和限流状态");
    const button = [...host.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("去 API 管理"),
    ) as HTMLButtonElement | undefined;
    expect(button).toBeTruthy();
    button?.click();
    expect(onNavigate).toHaveBeenCalledWith("apiManagement");
  });
});
