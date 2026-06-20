/* @vitest-environment jsdom */

import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.ts";
import { renderApp } from "./app-render.ts";
import type { AppViewState } from "./app-view-state.ts";
import {
  applyBusinessFlowSelection,
  type BusinessFlowSelectionPatch,
  type BusinessFlowState,
} from "./business-flow-store.ts";
import { createDefaultApiConnectionsPageState } from "./controllers/api-connections.ts";
import { createDefaultBuildSessionState } from "./controllers/build-session.ts";
import { createDefaultMyRolesState } from "./controllers/my-roles.ts";

function createState(overrides: Partial<AppViewState> = {}): AppViewState {
  return {
    settings: {
      gatewayUrl: "ws://localhost:18789",
      token: "",
      locale: "en",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      theme: "claw",
      themeMode: "dark",
      splitRatio: 0.6,
      navWidth: 280,
      navCollapsed: false,
      navGroupsCollapsed: {},
      borderRadius: 50,
      textScale: 100,
      chatShowThinking: false,
      chatShowToolCalls: true,
    },
    password: "",
    loginShowGatewayToken: false,
    loginShowGatewayPassword: false,
    tab: "goals",
    onboarding: false,
    basePath: "",
    connected: true,
    aicsRoleBuilder: {
      form: {} as AppViewState["aicsRoleBuilder"]["form"],
      running: false,
      tokenRunning: false,
      auditRunning: false,
      result: null,
      error: null,
    },
    aicsMarketplace: { roles: [], loading: false, error: null, result: null },
    submitDeveloperRoleForListing: vi.fn(async () => {}),
    businessFlow: {
      selectedCadenceId: "quarter",
      selectedProjectId: "project-channel-growth",
    },
    updateBusinessFlowSelection: vi.fn(),
    theme: "claw",
    themeMode: "dark",
    themeResolved: "dark",
    themeOrder: ["claw", "knot", "dash"],
    customThemeImportUrl: "",
    customThemeImportBusy: false,
    customThemeImportMessage: null,
    customThemeImportExpanded: false,
    customThemeImportFocusToken: 0,
    hello: null,
    lastError: null,
    lastErrorCode: null,
    chatError: null,
    eventLog: [],
    assistantName: "Nova",
    assistantAvatar: "/avatar/main",
    assistantAvatarSource: "avatars/missing.png",
    assistantAvatarStatus: "none",
    assistantAvatarReason: "missing",
    assistantAvatarUploadBusy: false,
    assistantAvatarUploadError: null,
    assistantAgentId: "main",
    userName: null,
    userAvatar: null,
    localMediaPreviewRoots: [],
    embedSandboxMode: "scripts",
    allowExternalEmbedUrls: false,
    chatMessageMaxWidth: null,
    sessionKey: "main",
    chatLoading: false,
    chatSending: false,
    chatMessage: "",
    chatAttachments: [],
    chatMessages: [],
    chatToolMessages: [],
    chatStreamSegments: [],
    chatStream: null,
    chatStreamStartedAt: null,
    chatRunId: null,
    chatSideResult: null,
    chatSideResultTerminalRuns: new Set(),
    compactionStatus: null,
    fallbackStatus: null,
    chatAvatarUrl: null,
    chatAvatarSource: null,
    chatAvatarStatus: null,
    chatAvatarReason: null,
    chatThinkingLevel: null,
    chatModelOverrides: {},
    chatModelsLoading: false,
    chatModelCatalog: [],
    chatQueue: [],
    chatQueueBySession: {},
    chatLocalInputHistoryBySession: {},
    chatInputHistorySessionKey: null,
    chatInputHistoryItems: null,
    chatInputHistoryIndex: -1,
    chatDraftBeforeHistory: null,
    realtimeTalkActive: false,
    realtimeTalkStatus: "idle",
    realtimeTalkDetail: null,
    realtimeTalkTranscript: null,
    chatManualRefreshInFlight: false,
    nodesLoading: false,
    nodes: [],
    chatNewMessagesBelow: false,
    navDrawerOpen: false,
    sidebarOpen: false,
    sidebarContent: null,
    sidebarError: null,
    splitRatio: 0.6,
    scrollToBottom: vi.fn(),
    presenceEntries: [],
    sessionsResult: null,
    cronStatus: null,
    configSettingsMode: "quick",
    configForm: {},
    configSnapshot: { config: {}, hash: "hash" } as AppViewState["configSnapshot"],
    configFormDirty: false,
    configSaving: false,
    configApplying: false,
    cronJobs: [],
    skillsReport: {
      skills: [],
      workspaceDir: "",
      managedSkillsDir: "",
    } as AppViewState["skillsReport"],
    configActiveSection: null,
    configActiveSubsection: null,
    communicationsActiveSection: null,
    communicationsActiveSubsection: null,
    appearanceActiveSection: null,
    appearanceActiveSubsection: null,
    appearanceFormMode: "form",
    appearanceSearchQuery: "",
    automationActiveSection: null,
    automationActiveSubsection: null,
    infrastructureActiveSection: null,
    infrastructureActiveSubsection: null,
    aiAgentsActiveSection: null,
    aiAgentsActiveSubsection: null,
    configReady: true,
    configRaw: "",
    configRawOriginal: "",
    configValid: true,
    configIssues: [],
    configLoading: false,
    configSchema: null,
    configSchemaLoading: false,
    configUiHints: null,
    configFormOriginal: {},
    updateRunning: false,
    agentsList: null,
    agentsSelectedId: null,
    cronModelSuggestions: [],
    cronForm: { deliveryChannel: "", deliveryMode: "last" },
    cronFieldErrors: {},
    cronError: null,
    cronQuickCreateOpen: false,
    cronQuickCreateStep: "what",
    cronQuickCreateDraft: null,
    cronEditingJobId: null,
    channelsSnapshot: null,
    execApprovalQueue: [],
    dreamingRestartConfirmOpen: false,
    dreamingRestartConfirmLoading: false,
    dreamingStatusError: null,
    client: null,
    refreshSessionsAfterChat: new Map(),
    connect: vi.fn(),
    setTab: vi.fn(),
    setTheme: vi.fn(),
    setThemeMode: vi.fn(),
    setCustomThemeImportUrl: vi.fn(),
    openCustomThemeImport: vi.fn(),
    importCustomTheme: vi.fn(),
    clearCustomTheme: vi.fn(),
    setBorderRadius: vi.fn(),
    setTextScale: vi.fn(),
    applySettings: vi.fn(),
    applyLocalUserIdentity: vi.fn(),
    loadOverview: vi.fn(),
    loadAssistantIdentity: vi.fn(),
    loadCron: vi.fn(),
    ...overrides,
  } as unknown as AppViewState;
}

function createBusinessFlowRenderHarness(initialTab: AppViewState["tab"] = "goals") {
  const container = document.createElement("div");
  let businessFlow: BusinessFlowState = {
    selectedCadenceId: "quarter",
    selectedProjectId: "project-channel-growth",
  };
  const state = createState({ tab: initialTab });
  state.businessFlow = businessFlow;
  state.updateBusinessFlowSelection = (patch: BusinessFlowSelectionPatch) => {
    businessFlow = applyBusinessFlowSelection(businessFlow, patch);
    state.businessFlow = businessFlow;
  };
  state.setTab = (tab) => {
    state.tab = tab;
  };
  return {
    container,
    state,
    render: () => render(renderApp(state), container),
  };
}

function expectMainSystemShell(container: ParentNode): HTMLElement {
  const shell = container.querySelector<HTMLElement>(".main-system-shell");
  expect(shell).toBeInstanceOf(HTMLElement);
  if (!(shell instanceof HTMLElement)) {
    throw new Error("Expected main system shell");
  }
  return shell;
}

function expectPageText(container: ParentNode): string {
  const text = container.textContent ?? "";
  expect(text.length).toBeGreaterThan(0);
  return text;
}

function expectMainSystemItemContainingText(root: ParentNode, text: string): HTMLElement {
  const item = Array.from(root.querySelectorAll<HTMLElement>(".main-system-shell__item")).find(
    (candidate) => candidate.textContent?.includes(text),
  );
  expect(item).toBeInstanceOf(HTMLElement);
  if (!(item instanceof HTMLElement)) {
    throw new Error(`Expected main system item containing "${text}"`);
  }
  return item;
}

function clickMainSystemItemAction(root: ParentNode, itemText: string) {
  const item = expectMainSystemItemContainingText(root, itemText);
  const button = item.querySelector<HTMLButtonElement>(".main-system-shell__item-action");
  expect(button).toBeInstanceOf(HTMLButtonElement);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected action button for "${itemText}"`);
  }
  button.click();
}

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function completedExecutionClosure() {
  return {
    status: "completed",
    canRun: false,
    executionId: "exec-role-1",
    readinessChecks: [
      {
        label: "派发单",
        status: "passed",
        detail: "任务调度已生成派发单。",
        targetTab: "workboard",
      },
      {
        label: "API 连接",
        status: "passed",
        detail: "岗位执行所需 API 绑定可用。",
        targetTab: "apiManagement",
      },
    ],
    businessResult: {
      summary: "商城运营诊断已完成，发现授权说明是主要卡点。",
      artifactRefs: ["artifact:role-result:exec-marketplace-ops:summary"],
    },
    nextObservationCandidate: {
      title: "上一轮执行结果可以用于新的数据分析",
      summary: "商城运营诊断已完成，发现授权说明是主要卡点。",
      artifactTitles: ["商城运营诊断报告"],
      auditComplete: true,
      ledgerComplete: true,
      modelUsageEvidence: "recorded",
      recoveryActions: [],
      boundary: "只作为观察候选，不会自动创建新目标，仍需用户确认后进入下一轮分析。",
    },
    evidenceReadback: {
      hasRoleResult: true,
      hasBusinessArtifact: true,
      hasAudit: true,
      hasLedger: true,
      hasModelUsage: true,
    },
    evidenceSummary: [
      {
        label: "业务产物",
        value: "artifact:role-result:exec-marketplace-ops:summary",
        status: "available",
      },
      { label: "审计记录", value: "audit-exec-marketplace-ops", status: "available" },
      {
        label: "账本记录",
        value: "ledger:role_execution:local_entitlement_marketplace_ops:exec-marketplace-ops",
        status: "available",
      },
      { label: "模型费用", value: "1900 Token · ¥0.00", status: "available" },
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
  };
}

beforeEach(async () => {
  await i18n.setLocale("en");
});

describe("renderApp business flow routing", () => {
  it("surfaces the role build wizard from the existing developer-mode chat entry", () => {
    const container = document.createElement("div");
    const developerState = createState({
      tab: "chat",
      aicsConversationMode: "developer",
      aicsConversationStage: "idle",
      buildSession: {
        ...createDefaultBuildSessionState(),
        loading: false,
        error: null,
        step: "idle",
        sessionId: null,
        session: null,
        sessions: [],
        requirements: "",
        briefForm: {},
        availableTemplates: [],
        capabilityAnalysis: null,
        generateResult: null,
        categoryCapabilityRequestResult: null,
      },
    });

    render(renderApp(developerState), container);
    const developerText = (container.textContent ?? "").replace(/\s+/g, " ");

    expect(developerText).toContain("开发者模式");
    expect(developerText).toContain("生成新岗位");
    expect(developerText).toContain("告诉我你要什么岗位");
    expect(developerText).toContain("开始匹配");

    const userContainer = document.createElement("div");
    const userState = createState({
      tab: "chat",
      aicsConversationMode: "user",
      aicsConversationStage: "idle",
    });

    render(renderApp(userState), userContainer);
    expect(userContainer.textContent ?? "").not.toContain("生成新岗位");
  });

  it("shows local ledger and cloud ledger sync readback on billing authorization page", () => {
    const container = document.createElement("div");
    const state = createState({
      tab: "usage",
      aicsRoleBuilder: {
        form: {
          roleListingId: "",
          entitlementId: "",
        } as AppViewState["aicsRoleBuilder"]["form"],
        running: false,
        tokenRunning: false,
        auditRunning: false,
        result: null,
        error: null,
      },
      apiConnections: {
        loading: false,
        error: null,
        readModel: {
          entries: [
            {
              id: "model-openai",
              name: "OpenAI",
              kind: "model",
              provider: "openai",
              metadata: {
                defaultModel: "codex-bengalfox",
                pricing: {
                  inputCnyPerMillion: 8,
                  outputCnyPerMillion: 32,
                },
                metering: {
                  calls: 1,
                  inputTokens: 1000,
                  outputTokens: 500,
                  totalTokens: 1500,
                  costCny: 0.024,
                  cloudLedgerSync: {
                    status: "pending",
                    usageRef: "exec-role-1",
                    message: "待同步：迭界AI云端服务 Token 或 Base URL 未配置。",
                    pendingUsageRefs: ["exec-role-1"],
                  },
                },
              },
            },
          ],
        },
      } as unknown as AppViewState["apiConnections"],
      usageResult: null,
      usageCostSummary: null,
      aicsMainFlow: {
        loading: false,
        error: null,
        readModel: {
          counts: { roleResults: 1 },
          objects: {
            roleResults: [
              {
                id: "exec-role-1",
                outcome: "succeeded",
                summary: "已完成。",
                artifactRefs: ["artifact:marketplace-ops-summary", "audit:audit-1"],
                executionEvidence: {
                  ledgerRef: "ledger:role_execution:entitlement-1:exec-role-1",
                  modelUsage: {
                    inputTokens: 1000,
                    outputTokens: 500,
                    totalTokens: 1500,
                    costCents: 2.4,
                  },
                },
              },
            ],
          },
        },
      } as unknown as AppViewState["aicsMainFlow"],
    });

    render(renderApp(state), container);
    const text = container.textContent ?? "";

    expect(text).toContain("账本回读");
    expect(text).toContain("执行结果：已完成。");
    expect(text).toContain("本地已记录 · 云端待同步");
    expect(text).toContain("本地账本：账本记录");
    expect(text).toContain("本次模型用量：1500 Token（输入 1000 / 输出 500）");
    expect(text).toContain("本次费用证据：¥0.0240");
    expect(text).toContain("审计记录：审计记录 1");
    expect(text).toContain("业务产物：marketplace-ops-summary");
    expect(text).toContain("待同步：迭界AI云端服务 Token 或 Base URL 未配置。");
  });

  it("shows completed execution results as the next observation candidate", () => {
    const container = document.createElement("div");
    const state = createState({
      tab: "businessOverview",
      aicsMainFlow: {
        loading: false,
        error: null,
        readModel: {
          currentStage: "observation",
          counts: {},
          readiness: {},
          latest: {},
          blockedReasons: [],
          executionClosure: completedExecutionClosure(),
        },
      } as unknown as AppViewState["aicsMainFlow"],
    });

    render(renderApp(state), container);
    let text = (container.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("上一轮执行结果可以用于新的数据分析");
    expect(text).toContain("商城运营诊断已完成，发现授权说明是主要卡点。");
    expect(text).toContain("产物：商城运营诊断报告");
    expect(text).toContain("建议进入下一轮观察");
    expect(text).toContain("只作为观察候选，不会自动创建新目标，仍需你确认后进入下一轮分析。");
    expect(text).toContain("运行条件");
    expect(text).toContain("派发单：已满足");
    expect(text).toContain("API 连接：已满足");
    expect(text).toContain("证据摘要");
    expect(text).toContain("模型费用 1900 Token · ¥0.00");
    expect(text).toContain("审计记录 1");
    expect(text).toContain("账本记录");
    expect(text).toContain("云端 SaaS 最终验收：未执行（本地版可跳过）");
    expect(text).toContain("真人准备清单");
    expect(text).toContain("连接真实云端商城：填写并探测云端商城地址。");
    expect(text).toContain("云端 SaaS 操作步骤");
    expect(text).toContain("1. 连接两个地址");
    expect(text).toContain("4. 跑云端 SaaS 最终验收");
    expect(text).toContain("需要准备：DIJIE_CLOUD_BASE_URL、OPENCLAW_LOCAL_URL");
    expect(text).toContain("aics-production-plus-readiness.mjs");

    state.tab = "observation";
    render(renderApp(state), container);
    text = (container.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("上一轮执行结果可以用于新的数据分析");
    expect(text).toContain("执行结果：已读回");
    expect(text).toContain("模型证据：已读回");
  });

  it("shows failed role execution as an observation candidate with recovery actions", () => {
    const container = document.createElement("div");
    const failedClosure = {
      ...completedExecutionClosure(),
      status: "failed",
      canRun: false,
      businessResult: {
        summary: "岗位执行失败：DeepSeek 连接不可用，未能生成运营诊断。",
        artifactRefs: [],
      },
      nextObservationCandidate: {
        title: "这次执行暴露出新的问题",
        summary: "岗位执行失败：DeepSeek 连接不可用，未能生成运营诊断。",
        artifactTitles: [],
        auditComplete: false,
        ledgerComplete: true,
        modelUsageEvidence: "missing",
        failureReason: "DeepSeek provider 不可用。",
        recoveryActions: [
          {
            label: "去 API 管理补模型连接",
            targetTab: "apiManagement",
            reason: "DeepSeek provider 不可用。",
          },
        ],
        boundary: "只作为观察候选，不会自动创建新目标，仍需用户确认后进入下一轮分析。",
      },
      evidenceReadback: {
        hasRoleResult: true,
        hasBusinessArtifact: false,
        hasAudit: false,
        hasLedger: true,
        hasModelUsage: false,
      },
      evidenceSummary: [
        { label: "业务产物", value: "", status: "missing" },
        { label: "审计记录", value: "", status: "missing" },
        {
          label: "账本记录",
          value: "ledger:role_execution:entitlement-1:exec-failed",
          status: "available",
        },
        { label: "模型费用", value: "", status: "missing" },
      ],
      missingEvidence: ["业务产物缺失", "审计记录缺失", "模型费用证据缺失"],
      recoveryActions: [
        {
          label: "去 API 管理补模型连接",
          targetTab: "apiManagement",
          reason: "DeepSeek provider 不可用。",
        },
      ],
    };
    const state = createState({
      tab: "observation",
      aicsMainFlow: {
        loading: false,
        error: null,
        readModel: {
          currentStage: "observation",
          counts: {},
          readiness: {},
          latest: {},
          blockedReasons: [],
          executionClosure: failedClosure,
        },
      } as unknown as AppViewState["aicsMainFlow"],
    });

    render(renderApp(state), container);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("这次执行暴露出新的问题");
    expect(text).toContain("岗位执行失败：DeepSeek 连接不可用，未能生成运营诊断。");
    expect(text).toContain("缺口：业务产物缺失；审计记录缺失；模型费用证据缺失");
    expect(text).toContain("失败/阻塞原因会作为新观察事实");
    expect(text).toContain("可记录的修复动作");
    expect(text).toContain("去 API 管理补模型连接");
    expect(text).toContain("只作为观察候选，不会自动创建新目标");
    expect(text).not.toContain("artifact:");
    expect(text).not.toContain("ledger:");
  });

  it("shows the same execution closure state on API management and billing pages", () => {
    const container = document.createElement("div");
    const state = createState({
      tab: "apiManagement",
      apiConnections: createDefaultApiConnectionsPageState(),
      checkClosedLoopReadiness: vi.fn(),
      aicsMainFlow: {
        loading: false,
        error: null,
        readModel: {
          executionClosure: {
            status: "blocked",
            canRun: false,
            readinessChecks: [
              {
                label: "API 连接",
                status: "missing",
                detail: "需要在 API 管理补齐模型或工具连接。",
                targetTab: "apiManagement",
              },
            ],
            evidenceReadback: {
              hasRoleResult: true,
              hasBusinessArtifact: true,
              hasAudit: false,
              hasLedger: true,
              hasModelUsage: false,
            },
            missingEvidence: ["审计记录未读回", "模型费用证据缺失"],
            recoveryActions: [
              {
                label: "去 API 管理补模型连接",
                targetTab: "apiManagement",
                reason: "岗位执行缺可用模型 Provider。",
              },
              {
                label: "去岗位执行继续闭环",
                targetTab: "aics",
                reason: "执行证据不完整。",
              },
            ],
          },
        },
      } as unknown as AppViewState["aicsMainFlow"],
    });

    render(renderApp(state), container);
    let text = (container.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("执行闭环系统状态");
    expect(text).toContain("这里只判断系统能否使用、缺哪个连接或证据");
    expect(text).toContain("API 连接：缺失");
    expect(text).toContain("缺口：审计记录未读回；模型费用证据缺失");

    state.tab = "usage";
    render(renderApp(state), container);
    text = (container.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("执行闭环状态");
    expect(text).toContain("审计：缺失");
    expect(text).toContain("模型证据：缺失");
    expect(text).toContain("去岗位执行继续闭环");
  });

  it("does not estimate token cost from execution count without real metering evidence", () => {
    const container = document.createElement("div");
    const state = createState({
      tab: "usage",
      usageResult: null,
      usageCostSummary: null,
      apiConnections: {
        loading: false,
        error: null,
        readModel: { entries: [] },
      } as unknown as AppViewState["apiConnections"],
      aicsMainFlow: {
        loading: false,
        error: null,
        readModel: {
          counts: { roleResults: 1 },
          objects: {
            roleResults: [
              {
                id: "exec-role-1",
                outcome: "succeeded",
                summary: "已完成。",
                artifactRefs: ["audit:audit-1"],
              },
            ],
          },
        },
      } as unknown as AppViewState["aicsMainFlow"],
    });

    render(renderApp(state), container);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("执行次数 1");
    expect(text).toContain("Token用量 -");
    expect(text).toContain("费用 ¥0.00");
    expect(text).not.toContain("1400");
    expect(text).not.toContain("~¥");
  });

  it("shows zero model cost as real billing evidence on billing authorization page", () => {
    const container = document.createElement("div");
    const state = createState({
      tab: "usage",
      usageResult: null,
      usageCostSummary: null,
      apiConnections: {
        loading: false,
        error: null,
        readModel: { entries: [] },
      } as unknown as AppViewState["apiConnections"],
      aicsMainFlow: {
        loading: false,
        error: null,
        readModel: {
          counts: { roleResults: 1 },
          objects: {
            roleResults: [
              {
                id: "exec-role-0",
                outcome: "succeeded",
                summary: "0 元岗位执行已完成。",
                artifactRefs: ["artifact:role-result:exec-role-0:summary", "audit:audit-0"],
                executionEvidence: {
                  ledgerRef: "ledger:role_execution:entitlement-1:exec-role-0",
                  modelUsage: {
                    inputTokens: 10,
                    outputTokens: 5,
                    totalTokens: 15,
                    costCents: 0,
                  },
                },
              },
            ],
          },
        },
      } as unknown as AppViewState["aicsMainFlow"],
    });

    render(renderApp(state), container);
    const text = container.textContent ?? "";

    expect(text).toContain("本次模型用量：15 Token（输入 10 / 输出 5）");
    expect(text).toContain("本次费用证据：¥0.0000");
    expect(text).not.toContain("本次费用证据：无真实费用金额");
  });

  it("guides users from an empty billing page back to developer-mode role creation", () => {
    const container = document.createElement("div");
    const state = createState({
      tab: "usage",
      aicsMarketplace: {
        loading: false,
        error: null,
        result: null,
        roles: [],
      },
      aicsRoleBuilder: {
        form: {
          roleListingId: "local_rolelisting_paid_ops",
          entitlementId: "",
        } as AppViewState["aicsRoleBuilder"]["form"],
        running: false,
        tokenRunning: false,
        auditRunning: false,
        result: null,
        error: null,
      },
      apiConnections: {
        loading: false,
        error: null,
        readModel: { entries: [] },
      } as unknown as AppViewState["apiConnections"],
    });

    render(renderApp(state), container);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("暂无岗位。先在主对话切换开发者模式创建岗位");
    expect(text).toContain("通过审核中心后由岗位开发者确认上架");
    expect(text).toContain("这里会显示待授权岗位");
  });

  it("shows local zero-yuan listings waiting for authorization on billing page", () => {
    const container = document.createElement("div");
    const authorizeAicsMarketplaceRole = vi.fn();
    const state = createState({
      tab: "usage",
      aicsMarketplace: {
        loading: false,
        error: null,
        result: null,
        roles: [
          {
            id: "local_rolelisting_marketplace_ops",
            roleListingId: "local_rolelisting_marketplace_ops",
            title: "商城运营诊断官",
            entitlementStatus: "missing",
            authorizationFeeCents: 0,
            priceLabel: "0 元",
            source: "local",
          },
        ],
      },
      aicsRoleBuilder: {
        form: {
          roleListingId: "",
          entitlementId: "",
        } as AppViewState["aicsRoleBuilder"]["form"],
        running: false,
        tokenRunning: false,
        auditRunning: false,
        result: null,
        error: null,
      },
      authorizeAicsMarketplaceRole,
      refreshAicsMarketplaceRoles: vi.fn(),
      updateAicsRoleBuilderField: vi.fn(),
      apiConnections: {
        loading: false,
        error: null,
        readModel: { entries: [] },
      } as unknown as AppViewState["apiConnections"],
    });

    render(renderApp(state), container);

    const text = container.textContent ?? "";
    expect(text).toContain("商城运营诊断官");
    expect(text).toContain("local_rolelisting_marketplace_ops");
    expect(text).toContain("0 元");
    expect(text).toContain("岗位商品编号 roleListingId");
    expect(text).toContain("岗位开发者确认上架后这里会显示正式岗位商品");
    expect(text).toContain("创建 0 元授权后会生成 RoleEntitlement");
    expect(text).toContain("同步岗位商品与授权");
    expect(text).toContain("暂无已授权岗位。请在上方待授权岗位点击“创建 0 元正式授权”");
    expect(text).not.toContain("云端岗位编号 roleListingId");
    expect(text).not.toContain("首批岗位按云端正式授权处理");
    const matchingButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).filter((candidate) => candidate.textContent?.trim() === "创建 0 元正式授权");
    const button = matchingButtons.at(-1);
    expect(button).toBeInstanceOf(HTMLButtonElement);
    button?.click();
    expect(authorizeAicsMarketplaceRole).toHaveBeenCalledWith("local_rolelisting_marketplace_ops");
  });

  it("does not offer zero-yuan authorization for non-zero-price listings on billing page", () => {
    const container = document.createElement("div");
    const authorizeAicsMarketplaceRole = vi.fn();
    const state = createState({
      tab: "usage",
      aicsMarketplace: {
        loading: false,
        error: null,
        result: null,
        roles: [
          {
            id: "local_rolelisting_paid_ops",
            roleListingId: "local_rolelisting_paid_ops",
            title: "付费商城运营岗位",
            entitlementStatus: "missing",
            authorizationFeeCents: 9900,
            priceLabel: "¥99.00",
            source: "local",
          },
        ],
      },
      aicsRoleBuilder: {
        form: {
          roleListingId: "local_rolelisting_paid_ops",
          entitlementId: "",
        } as AppViewState["aicsRoleBuilder"]["form"],
        running: false,
        tokenRunning: false,
        auditRunning: false,
        result: null,
        error: null,
      },
      authorizeAicsMarketplaceRole,
      refreshAicsMarketplaceRoles: vi.fn(),
      updateAicsRoleBuilderField: vi.fn(),
      apiConnections: {
        loading: false,
        error: null,
        readModel: { entries: [] },
      } as unknown as AppViewState["apiConnections"],
    });

    render(renderApp(state), container);

    expect(container.querySelector<HTMLInputElement>("input")?.value).toBe(
      "local_rolelisting_paid_ops",
    );

    const text = container.textContent ?? "";
    expect(text).toContain("付费商城运营岗位");
    expect(text).toContain("¥99.00");
    expect(text).toContain("该岗位不是 0 元授权岗位，不能走本地 0 元授权。");
    expect(text).toContain("该岗位不是 0 元授权岗位，不能在这里创建 0 元授权。");
    expect(text).toContain("需付费授权");
    const zeroAuthButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).filter((candidate) => candidate.textContent?.trim() === "创建 0 元正式授权");
    expect(zeroAuthButtons.every((button) => button.disabled)).toBe(true);
    zeroAuthButtons.at(-1)?.click();
    expect(authorizeAicsMarketplaceRole).not.toHaveBeenCalled();
  });

  it("guides authorized local roles from billing to dispatch and execution", () => {
    const container = document.createElement("div");
    const setTab = vi.fn();
    const state = createState({
      tab: "usage",
      setTab,
      aicsMarketplace: {
        loading: false,
        error: null,
        result: null,
        roles: [
          {
            id: "local_rolelisting_marketplace_ops",
            roleListingId: "local_rolelisting_marketplace_ops",
            title: "商城运营诊断官",
            entitlementId: "local_entitlement_marketplace_ops",
            entitlementStatus: "authorized",
            authorizationFeeCents: 0,
            priceLabel: "0 元",
            source: "local",
          },
        ],
      },
      aicsRoleBuilder: {
        form: {
          roleListingId: "local_rolelisting_marketplace_ops",
          entitlementId: "local_entitlement_marketplace_ops",
        } as AppViewState["aicsRoleBuilder"]["form"],
        running: false,
        tokenRunning: false,
        auditRunning: false,
        result: null,
        error: null,
      },
      refreshAicsMarketplaceRoles: vi.fn(),
      updateAicsRoleBuilderField: vi.fn(),
      apiConnections: {
        loading: false,
        error: null,
        readModel: { entries: [] },
      } as unknown as AppViewState["apiConnections"],
    });

    render(renderApp(state), container);

    const text = container.textContent ?? "";
    expect(text).toContain("授权已就绪");
    expect(text).toContain("已同步到我的岗位");
    expect(text).toContain("下一步先到任务调度生成派发单");
    expect(text).toContain("商城运营诊断官");
    expect(text).toContain("local_rolelisting_marketplace_ops");
    expect(text).toContain("entitlementId：local_entitlement_marketplace_ops");
    expect(text).toContain("已授权 · 0 元");

    const dispatchButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent?.trim() === "去任务调度",
    );
    const executionButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.textContent?.trim() === "去岗位执行");
    expect(dispatchButton).toBeInstanceOf(HTMLButtonElement);
    expect(executionButton).toBeInstanceOf(HTMLButtonElement);

    dispatchButton?.click();
    executionButton?.click();

    expect(setTab).toHaveBeenCalledWith("workboard");
    expect(setTab).toHaveBeenCalledWith("aics");
  });

  it("falls back to synced my-role assets when the marketplace role list is empty", () => {
    const container = document.createElement("div");
    const state = createState({
      tab: "usage",
      aicsMarketplace: {
        loading: false,
        error: null,
        result: { ok: true, mode: "local", roles: [] },
        roles: [],
      },
      myRoles: {
        ...createDefaultMyRolesState(),
        readModel: {
          roleAssets: [
            {
              roleListingId: "local_rolelisting_marketplace_ops",
              title: "商城运营诊断官",
              entitlementId: "local_entitlement_marketplace_ops",
              entitlementStatus: "authorized",
            },
          ],
        },
      },
      aicsRoleBuilder: {
        form: {
          roleListingId: "",
          entitlementId: "",
        } as AppViewState["aicsRoleBuilder"]["form"],
        running: false,
        tokenRunning: false,
        auditRunning: false,
        result: null,
        error: null,
      },
      refreshAicsMarketplaceRoles: vi.fn(),
      updateAicsRoleBuilderField: vi.fn(),
      apiConnections: {
        loading: false,
        error: null,
        readModel: { entries: [] },
      } as unknown as AppViewState["apiConnections"],
    });

    render(renderApp(state), container);

    const text = container.textContent ?? "";
    expect(text).toContain("授权已就绪");
    expect(text).toContain("已同步到我的岗位");
    expect(text).toContain("商城运营诊断官");
    expect(text).toContain("local_rolelisting_marketplace_ops");
    expect(text).toContain("entitlementId：local_entitlement_marketplace_ops");
    expect(text).toContain("已授权 · 0 元");
    expect(text).toContain("去任务调度");
    expect(text).toContain("去岗位执行");
  });

  it("falls back to the new my-role roles read model when the marketplace role list is empty", () => {
    const container = document.createElement("div");
    const setTab = vi.fn();
    const state = createState({
      tab: "usage",
      setTab,
      aicsMarketplace: {
        loading: false,
        error: null,
        result: { ok: true, mode: "local", roles: [] },
        roles: [],
      },
      myRoles: {
        ...createDefaultMyRolesState(),
        readModel: {
          roles: [
            {
              roleListingId: "local_rolelisting_marketplace_ops",
              roleKey: "local_rolelisting_marketplace_ops",
              title: "商城运营诊断官",
              entitlementId: "local_entitlement_marketplace_ops",
              entitlementStatus: "authorized",
              authorizationFeeCents: 0,
              priceLabel: "0 元",
            },
          ],
        },
      },
      aicsRoleBuilder: {
        form: {
          roleListingId: "",
          entitlementId: "",
        } as AppViewState["aicsRoleBuilder"]["form"],
        running: false,
        tokenRunning: false,
        auditRunning: false,
        result: null,
        error: null,
      },
      refreshAicsMarketplaceRoles: vi.fn(),
      updateAicsRoleBuilderField: vi.fn(),
      apiConnections: {
        loading: false,
        error: null,
        readModel: { entries: [] },
      } as unknown as AppViewState["apiConnections"],
    });

    render(renderApp(state), container);

    const text = container.textContent ?? "";
    expect(text).toContain("授权已就绪");
    expect(text).toContain("已同步到我的岗位");
    expect(text).toContain("商城运营诊断官");
    expect(text).toContain("local_rolelisting_marketplace_ops");
    expect(text).toContain("entitlementId：local_entitlement_marketplace_ops");

    const dispatchButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent?.trim() === "去任务调度",
    );
    const executionButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.textContent?.trim() === "去岗位执行");
    dispatchButton?.click();
    executionButton?.click();

    expect(setTab).toHaveBeenCalledWith("workboard");
    expect(setTab).toHaveBeenCalledWith("aics");
  });

  it("shows local closed-loop API readiness from a generic model pool", () => {
    const container = document.createElement("div");
    const apiConnections = createDefaultApiConnectionsPageState();
    apiConnections.readModel = {
      entries: [
        {
          id: "model-deepseek",
          name: "DeepSeek",
          kind: "model",
          provider: "deepseek",
          status: "available",
          authMode: "secret_ref",
          secret: { status: "configured" },
          consumers: ["model"],
          metadata: {
            defaultModel: "deepseek-chat",
            pricing: {
              inputCnyPerMillion: 0.02,
              outputCnyPerMillion: 0.02,
            },
          },
        },
      ],
    };
    const setTab = vi.fn();
    const state = createState({
      tab: "apiManagement",
      apiConnections,
      setTab,
    });

    render(renderApp(state), container);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("系统使用闭环检查");
    expect(text).toContain("检查模型连接、岗位创建、岗位执行、审计和账本读回");
    expect(text).toContain("创建岗位 可用 通用模型池：DeepSeek");
    expect(text).toContain("执行岗位 可用 通用模型池：DeepSeek");
    expect(text).toContain("云端桥接 本地版可跳过");
  });

  it("guides users from a ready role execution API to dispatch and execution", async () => {
    const container = document.createElement("div");
    const apiConnections = createDefaultApiConnectionsPageState();
    apiConnections.readModel = {
      entries: [
        {
          id: "model-deepseek",
          name: "DeepSeek",
          kind: "model",
          provider: "deepseek",
          status: "available",
          authMode: "secret_ref",
          secret: { status: "configured" },
          consumers: ["role_execution"],
          metadata: {
            defaultModel: "deepseek-chat",
            pricing: {
              inputCnyPerMillion: 0.02,
              outputCnyPerMillion: 0.02,
            },
          },
        },
      ],
    };
    const setTab = vi.fn();
    const refreshAicsMainFlowReadModel = vi.fn(async () => undefined);
    const refreshMyRolesReadModel = vi.fn(async () => undefined);
    const state = createState({
      tab: "apiManagement",
      apiConnections,
      setTab,
      refreshAicsMainFlowReadModel,
      refreshMyRolesReadModel,
    });

    render(renderApp(state), container);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    const dispatchButton = buttons.find((button) => button.textContent?.trim() === "去任务调度");
    const executionButton = buttons.find((button) => button.textContent?.trim() === "去岗位执行");

    expect(text).toContain("岗位执行 API 已就绪");
    expect(text).toContain("先到任务调度生成派发单");
    expect(dispatchButton).toBeInstanceOf(HTMLButtonElement);
    expect(executionButton).toBeInstanceOf(HTMLButtonElement);

    dispatchButton?.click();
    executionButton?.click();
    await Promise.resolve();

    expect(setTab).toHaveBeenCalledWith("workboard");
    expect(setTab).toHaveBeenCalledWith("aics");
    expect(refreshAicsMainFlowReadModel).toHaveBeenCalledOnce();
    expect(refreshMyRolesReadModel).toHaveBeenCalledOnce();
  });

  it("surfaces cloud variable sync failures without blocking local-only API readiness", () => {
    const container = document.createElement("div");
    const apiConnections = createDefaultApiConnectionsPageState();
    apiConnections.readModel = {
      entries: [
        {
          id: "model-deepseek",
          name: "DeepSeek",
          kind: "model",
          provider: "deepseek",
          status: "available",
          authMode: "secret_ref",
          secret: { status: "configured" },
          consumers: ["model", "build_session", "role_execution", "developer_center"],
          metadata: {
            defaultModel: "deepseek-chat",
            pricing: {
              inputCnyPerMillion: 0.02,
              outputCnyPerMillion: 0.02,
            },
            cloudVariableSync: {
              status: "failed",
              message:
                "迭界AI云端变量同步失败：内部桥接 Bearer 与云端 DIJIE_INTERNAL_BRIDGE_BEARER 不一致。",
            },
          },
        },
      ],
    };
    apiConnections.message =
      "云端变量同步未完成：401 Unauthorized。本地版岗位创建和岗位执行不受影响；需要云端 SaaS/使用者中心时再处理云端桥接。";
    const state = createState({
      tab: "apiManagement",
      apiConnections,
    });

    render(renderApp(state), container);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("创建岗位 可用 专用绑定：DeepSeek");
    expect(text).toContain("执行岗位 可用 专用绑定：DeepSeek");
    expect(text).toContain("云端变量同步未完成（本地版可跳过）：DeepSeek");
    expect(text).toContain("内部桥接 Bearer 与云端 DIJIE_INTERNAL_BRIDGE_BEARER 不一致");
    expect(text).toContain("本地版岗位创建和岗位执行不受影响");
  });

  it("does not show stale cloud closed-loop failures inside the local API check card", () => {
    const container = document.createElement("div");
    const checkClosedLoopReadiness = vi.fn(async () => {});
    const apiConnections = createDefaultApiConnectionsPageState();
    apiConnections.closedLoopReadiness = {
      ok: false,
      status: "blocked",
      checks: [
        {
          id: "cloudInstalledRoles",
          label: "我的岗位",
          status: "blocked",
          message: "fetch failed",
        },
      ],
    };
    const state = createState({
      tab: "apiManagement",
      apiConnections,
      checkClosedLoopReadiness,
    });

    render(renderApp(state), container);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent?.trim() === "重新检查本地闭环",
    );

    expect(text).toContain("当前显示的是旧的云端闭环检查结果");
    expect(text).toContain("重新点击“闭环检查”");
    expect(text).not.toContain("我的岗位 阻塞");
    expect(text).not.toContain("fetch failed");
    expect(button).toBeInstanceOf(HTMLButtonElement);
    button?.click();
    expect(checkClosedLoopReadiness).toHaveBeenCalledOnce();
  });

  it("renders closed-loop readiness checks so local users can see the exact blocker", () => {
    const container = document.createElement("div");
    const apiConnections = createDefaultApiConnectionsPageState();
    apiConnections.closedLoopReadiness = {
      ok: false,
      status: "blocked",
      mode: "local",
      checks: [
        {
          id: "localMode",
          label: "本地闭环模式",
          status: "pass",
          message: "未配置云端 SaaS，当前按本地岗位商城闭环检查。",
        },
        {
          id: "roleExecutionModel",
          label: "岗位执行模型",
          status: "blocked",
          message: "请先在 API 管理填写模型 API Key，并保留“岗位执行”用途。",
        },
        {
          id: "localEvidenceReadback",
          label: "本地审计账本读回",
          status: "skipped",
          message: "岗位尚未执行；执行后会检查结果、审计和账本读回。",
        },
      ],
      nextActions: [
        {
          id: "localEvidenceReadback",
          label: "本地审计账本读回",
          message: "本地 API、授权和执行队列已准备好，但还没有真实执行结果、审计和账本读回。",
          action: "到岗位执行页点击“确认并运行”，确认真实 API 费用提示。",
        },
      ],
    };
    apiConnections.error = "闭环检查阻塞：请先在 API 管理填写模型 API Key，并保留“岗位执行”用途。";
    const state = createState({
      tab: "apiManagement",
      apiConnections,
    });

    render(renderApp(state), container);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("闭环检查明细");
    expect(text).toContain("本地模式 · 有阻塞");
    expect(text).toContain("本地闭环模式 通过");
    expect(text).toContain("岗位执行模型 阻塞");
    expect(text).toContain("请先在 API 管理填写模型 API Key，并保留“岗位执行”用途。");
    expect(text).toContain("本地审计账本读回 跳过");
    expect(text).toContain("下一步");
    expect(text).toContain("还没有真实执行结果、审计和账本读回");
    expect(text).toContain("到岗位执行页点击“确认并运行”");
    expect(text).toContain("现场验收标准");
    expect(text).toContain("必须看到执行结果、审计记录、账本记录、业务产物、模型费用证据");
  });

  it("labels ready closed-loop checks with pending next actions as continuable", async () => {
    const container = document.createElement("div");
    const apiConnections = createDefaultApiConnectionsPageState();
    apiConnections.closedLoopReadiness = {
      ok: true,
      status: "ready",
      mode: "local",
      checks: [
        {
          id: "localMode",
          label: "本地闭环模式",
          status: "pass",
          message: "未配置云端 SaaS，当前按本地岗位商城闭环检查。",
        },
        {
          id: "localEvidenceReadback",
          label: "本地审计账本读回",
          status: "skipped",
          message: "岗位尚未执行；执行后会检查结果、审计和账本读回。",
        },
      ],
      nextActions: [
        {
          id: "localEvidenceReadback",
          label: "本地审计账本读回",
          action: "到岗位执行页点击“确认并运行”，确认真实 API 费用提示。",
        },
      ],
    };
    const setTab = vi.fn();
    const refreshAicsMainFlowReadModel = vi.fn(async () => undefined);
    const refreshMyRolesReadModel = vi.fn(async () => undefined);
    const state = createState({
      tab: "apiManagement",
      apiConnections,
      setTab,
      refreshAicsMainFlowReadModel,
      refreshMyRolesReadModel,
    });

    render(renderApp(state), container);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    const continuableBadge = Array.from(container.querySelectorAll("span")).find((item) =>
      item.textContent?.replace(/\s+/g, " ").includes("本地模式 · 可继续"),
    ) as HTMLElement | undefined;

    expect(text).toContain("本地模式 · 可继续");
    expect(text).not.toContain("本地模式 · 可执行");
    expect(text).toContain("到岗位执行页点击“确认并运行”");
    expect(text).toContain("现场验收标准");
    expect(continuableBadge?.getAttribute("style")).toContain("#b7791f");
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent?.trim() === "去岗位执行",
    );
    expect(button).toBeInstanceOf(HTMLButtonElement);
    button?.click();
    await Promise.resolve();
    expect(setTab).toHaveBeenCalledWith("aics");
    expect(refreshAicsMainFlowReadModel).toHaveBeenCalledOnce();
    expect(refreshMyRolesReadModel).toHaveBeenCalledOnce();
  });

  it("renders closed-loop execution evidence after audit and ledger readback", async () => {
    const container = document.createElement("div");
    const setTab = vi.fn();
    const refreshAicsMainFlowReadModel = vi.fn(async () => undefined);
    const refreshMyRolesReadModel = vi.fn(async () => undefined);
    const apiConnections = createDefaultApiConnectionsPageState();
    apiConnections.closedLoopReadiness = {
      ok: true,
      status: "ready",
      mode: "local",
      checks: [
        {
          id: "localEvidenceReadback",
          label: "本地审计账本读回",
          status: "pass",
          message:
            "本地执行结果、业务产物、审计记录、账本记录，以及模型费用证据或未调用模型说明均可读回。",
        },
      ],
      nextActions: [],
      context: {
        executionId: "exec-marketplace-ops",
        auditRecordId: "local_audit_exec-marketplace-ops",
        ledgerRef: "ledger:role_execution:local_entitlement_marketplace_ops:exec-marketplace-ops",
        artifactRefs: [
          "artifact:role-result:exec-marketplace-ops:summary",
          "audit:local_audit_exec-marketplace-ops",
        ],
        modelUsage: { totalTokens: 1900, costCents: 0 },
      },
    };
    const state = createState({
      tab: "apiManagement",
      setTab,
      refreshAicsMainFlowReadModel,
      refreshMyRolesReadModel,
      apiConnections,
    });

    render(renderApp(state), container);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("本地模式 · 已完成");
    expect(text).toContain("本地岗位闭环已完成");
    expect(text).toContain(
      "执行结果、审计记录、账本记录、业务产物，以及模型费用证据或未调用模型说明均已读回",
    );
    expect(text).toContain("真人验收摘要");
    expect(text).toContain("执行结果：已回写");
    expect(text).toContain("审计记录：已读回");
    expect(text).toContain("账本记录：已读回");
    expect(text).toContain("产物：岗位执行业务产物");
    expect(text).toContain("模型费用：1900 Token · ¥0.00");
    const resultButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent?.trim() === "查看岗位结果",
    );
    expect(resultButton).toBeInstanceOf(HTMLButtonElement);
    resultButton?.click();
    await Promise.resolve();
    expect(setTab).toHaveBeenCalledWith("aics");
    expect(refreshAicsMainFlowReadModel).toHaveBeenCalledOnce();
    expect(refreshMyRolesReadModel).toHaveBeenCalledOnce();
  });

  it("renders completed closed-loop evidence when the execution did not call a model", () => {
    const container = document.createElement("div");
    const apiConnections = createDefaultApiConnectionsPageState();
    apiConnections.closedLoopReadiness = {
      ok: true,
      status: "ready",
      mode: "local",
      checks: [
        {
          id: "localEvidenceReadback",
          label: "本地审计账本读回",
          status: "pass",
          message:
            "本地执行结果、业务产物、审计记录、账本记录，以及模型费用证据或未调用模型说明均可读回。",
        },
      ],
      nextActions: [],
      context: {
        executionId: "exec-marketplace-ops",
        auditRecordId: "local_audit_exec-marketplace-ops",
        ledgerRef: "ledger:role_execution:local_entitlement_marketplace_ops:exec-marketplace-ops",
        artifactRefs: [
          "artifact:role-result:exec-marketplace-ops:summary",
          "audit:local_audit_exec-marketplace-ops",
        ],
        modelUsageNotApplicableReason: "本次文件打包由本地工具完成，未调用模型。",
      },
    };
    const state = createState({
      tab: "apiManagement",
      apiConnections,
    });

    render(renderApp(state), container);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("本地模式 · 已完成");
    expect(text).toContain("本地岗位闭环已完成");
    expect(text).toContain(
      "执行结果、审计记录、账本记录、业务产物，以及模型费用证据或未调用模型说明均已读回",
    );
    expect(text).toContain("产物：岗位执行业务产物");
    expect(text).toContain("模型费用：本次未调用模型 · 本次文件打包由本地工具完成，未调用模型。");
  });

  it("does not mark closed-loop readiness completed without model usage evidence", () => {
    const container = document.createElement("div");
    const apiConnections = createDefaultApiConnectionsPageState();
    apiConnections.closedLoopReadiness = {
      ok: true,
      status: "ready",
      mode: "local",
      checks: [
        {
          id: "localEvidenceReadback",
          label: "本地审计账本读回",
          status: "pass",
          message:
            "本地执行结果、业务产物、审计记录、账本记录，以及模型费用证据或未调用模型说明均可读回。",
        },
      ],
      nextActions: [],
      context: {
        executionId: "exec-marketplace-ops",
        auditRecordId: "local_audit_exec-marketplace-ops",
        ledgerRef: "ledger:role_execution:local_entitlement_marketplace_ops:exec-marketplace-ops",
        artifactRefs: [
          "artifact:role-result:exec-marketplace-ops:summary",
          "audit:local_audit_exec-marketplace-ops",
        ],
      },
    };
    const state = createState({
      tab: "apiManagement",
      apiConnections,
    });

    render(renderApp(state), container);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("闭环检查明细");
    expect(text).not.toContain("本地模式 · 已完成");
    expect(text).not.toContain("本地岗位闭环已完成");
    expect(text).toContain("产物：岗位执行业务产物");
    expect(text).not.toContain("模型费用：");
  });

  it("does not mark closed-loop readiness completed without a business artifact", () => {
    const container = document.createElement("div");
    const apiConnections = createDefaultApiConnectionsPageState();
    apiConnections.closedLoopReadiness = {
      ok: true,
      status: "ready",
      mode: "local",
      checks: [
        {
          id: "localEvidenceReadback",
          label: "本地审计账本读回",
          status: "blocked",
          message: "岗位已执行，但本地业务产物、审计或账本读回缺失。",
        },
      ],
      nextActions: [],
      context: {
        executionId: "exec-marketplace-ops",
        auditRecordId: "local_audit_exec-marketplace-ops",
        ledgerRef: "ledger:role_execution:local_entitlement_marketplace_ops:exec-marketplace-ops",
        artifactRefs: ["audit:local_audit_exec-marketplace-ops"],
      },
    };
    const state = createState({
      tab: "apiManagement",
      apiConnections,
    });

    render(renderApp(state), container);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toContain("闭环检查明细");
    expect(text).not.toContain("本地模式 · 已完成");
    expect(text).not.toContain("本地岗位闭环已完成");
    expect(text).toContain("产物");
    expect(text).not.toContain("产物：audit:local_audit_exec-marketplace-ops");
  });

  it("keeps the closed-loop check action visible on the actual API management page", () => {
    const container = document.createElement("div");
    const checkClosedLoopReadiness = vi.fn(async () => {});
    const state = createState({
      tab: "apiManagement",
      checkClosedLoopReadiness,
      apiConnections: createDefaultApiConnectionsPageState(),
    });

    render(renderApp(state), container);
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent?.trim() === "闭环检查",
    );

    expect(button).toBeInstanceOf(HTMLButtonElement);
    button?.click();
    expect(checkClosedLoopReadiness).toHaveBeenCalledOnce();
  });

  it("routes empty data analysis to collection and the visible business overview entry", async () => {
    const harness = createBusinessFlowRenderHarness("observation");
    const request = vi.fn(async (method: string) => {
      if (method === "aics.mainFlow.observation.collect") {
        return { observationPackage: { id: "obs-collected" } };
      }
      if (method === "aics.mainFlow.readModel.get") {
        return harness.state.aicsMainFlow?.readModel;
      }
      return { ok: true };
    });
    harness.state.client = { request, stop: vi.fn() } as never;
    harness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: 1,
        currentStage: "observation",
        readiness: { canPrepareAttribution: false },
        blockedReasons: [
          {
            stage: "observation",
            code: "missing_observation_package",
            message: "ObservationPackage is required before attribution.",
          },
        ],
        latest: { observationPackage: null },
        counts: { observations: 0 },
        observationWorkspace: {
          businessContext: {
            businessDescription: "根据客户业务动态生成观察对象，而不是套固定模板。",
          },
          objects: [
            {
              id: "customer-business-health",
              name: "客户业务健康状态",
              description: "观察客户业务是否能完成核心闭环。",
              whyObserve: "这是后续归因和目标设定的事实入口。",
              status: "candidate",
            },
          ],
          sources: [
            {
              label: "客户内部经营数据",
              sourceKind: "internal_read_model",
              canAccess: true,
            },
            {
              label: "外部产品和风险信息",
              sourceKind: "external_web_search",
              canAccess: false,
              missingRequirement: "需要用户授权",
            },
          ],
          candidate: {
            canConfirm: false,
            uncoveredRequiredObjectIds: ["customer-business-health"],
            qualitySummary: {
              accepted: 0,
              needsReview: 1,
            },
          },
          collectionReadiness: {
            sourceCount: 2,
            accessibleSourceCount: 1,
            blockedSourceCount: 1,
            approvalRequiredCount: 1,
            missingSecretCount: 0,
            missingScopeCount: 0,
            readyToolPlanCount: 1,
            blockedToolPlanCount: 1,
            canCollect: true,
            blockedDetails: [
              {
                sourceId: "external-products",
                label: "外部产品和风险信息",
                reason: "需要用户授权",
                repairAction: "确认只读外部采集授权后再运行观察",
              },
            ],
          },
          guidance: {
            headline: "观察证据还不足",
            nextAction: "补采缺失数据或复核待验证证据",
          },
        },
      },
    };

    harness.render();

    const text = expectPageText(harness.container);
    expect(text).toContain("通用观察工作台");
    expect(text).toContain("先理解业务，再采集证据");
    expect(text).toContain("根据客户业务动态生成观察对象");
    expect(text).toContain("客户业务健康状态");
    expect(text).toContain("客户内部经营数据");
    expect(text).toContain("外部产品和风险信息");
    expect(text).toContain("内部数据 · 可读取");
    expect(text).toContain("外部搜索 · 待补条件");
    expect(text).toContain("观察证据还不足");
    expect(text).toContain("观察对象");
    expect(text).toContain("数据源和工具");
    expect(text).toContain("观察包候选");
    expect(text).toContain("真实来源：1");
    expect(text).toContain("缺连接：0 · 缺权限：0 · 待授权：1");
    expect(text).toContain("采集计划：1");
    expect(text).toContain("修复建议：外部产品和风险信息：确认只读外部采集授权后再运行观察");
    expect(text).toContain("证据来源：0 条可追溯");
    expect(text).toContain("不可归因：0 条缺证据或采集失败");
    expect(text).toContain("还缺关键观察：客户业务健康状态");
    expect(text).toContain("无证据来源的内容只能待验证，不能进入正式归因。");
    expect(text).toContain("需要补证据");
    expect(text).toContain("暂无数据分析包");
    expect(text).toContain("先在「经营概览」开始观察");
    expect(text).toContain("开始真实采集");
    expect(text).toContain("去经营概览");
    expect(text).not.toContain("主对话中描述经营目标");

    const collectButton = Array.from(
      harness.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.textContent?.trim() === "开始真实采集");
    expect(collectButton).toBeInstanceOf(HTMLButtonElement);
    collectButton?.click();
    await flushPromises();
    expect(request).toHaveBeenCalledWith("aics.mainFlow.observation.collect", {
      title: "当前账号真实数据分析包",
      includeLocalReadModel: true,
    });

    const button = Array.from(harness.container.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent?.trim() === "去经营概览",
    );
    expect(button).toBeInstanceOf(HTMLButtonElement);
    button?.click();
    expect(harness.state.tab).toBe("businessOverview");
  });

  it("renders the humanized main-flow cockpit with blocker repair actions", () => {
    const harness = createBusinessFlowRenderHarness("businessOverview");
    harness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: 1,
        currentStage: "goal",
        readiness: { canCreateGoalCandidate: false },
        blockedReasons: [
          {
            stage: "attribution",
            code: "missing_attribution_report",
            message: "AttributionReport is required before creating goal rationale.",
          },
        ],
        stageGuidance: {
          stage: "goal",
          title: "公司目标",
          description: "把观察和归因收敛成可治理目标。",
          primaryActionLabel: "确认目标",
          primaryActionTarget: "goals",
          nextStepLabel: "确认后进入规划方案",
        },
        stageProgress: [
          {
            stage: "observation",
            label: "数据分析",
            routeTab: "observation",
            status: "completed",
            statusLabel: "已完成",
            summary: "已形成数据分析包：商城经营观察",
            nextAction: "交给归因分析解释主因。",
            actionLabel: "查看数据分析",
            actionTab: "observation",
            evidenceCount: 4,
            blockerCount: 0,
          },
          {
            stage: "attribution",
            label: "归因分析",
            routeTab: "attribution",
            status: "blocked",
            statusLabel: "需修复",
            summary: "等待已确认的数据分析包，解释目标差距的主因和证据。",
            nextAction: "生成并确认归因。",
            actionLabel: "进入归因分析",
            actionTab: "attribution",
            evidenceCount: 0,
            blockerCount: 1,
          },
          {
            stage: "goal",
            label: "公司目标",
            routeTab: "goals",
            status: "current",
            statusLabel: "当前处理",
            summary: "等待归因结果收敛为可治理目标。",
            nextAction: "确认目标。",
            actionLabel: "进入公司目标",
            actionTab: "goals",
            evidenceCount: 0,
            blockerCount: 0,
          },
          {
            stage: "planning",
            label: "规划方案",
            routeTab: "company",
            status: "locked",
            statusLabel: "未开放",
            summary: "等待公司目标拆成经营工作块和岗位工作项。",
            nextAction: "确认规划。",
            actionLabel: "进入规划方案",
            actionTab: "company",
            evidenceCount: 0,
            blockerCount: 0,
          },
          {
            stage: "dispatch",
            label: "任务调度",
            routeTab: "workboard",
            status: "locked",
            statusLabel: "未开放",
            summary: "等待规划工作项做授权、能力、API、工具和费用预检。",
            nextAction: "检查并生成派发单和执行队列。",
            actionLabel: "进入任务调度",
            actionTab: "workboard",
            evidenceCount: 0,
            blockerCount: 0,
          },
          {
            stage: "role",
            label: "岗位执行",
            routeTab: "aics",
            status: "locked",
            statusLabel: "未开放",
            summary: "等待已派发、已授权、费用确认、API 和工具/Skill 就绪。",
            nextAction: "完成执行并读回产物、审计、账本和模型证据。",
            actionLabel: "进入岗位执行",
            actionTab: "aics",
            evidenceCount: 0,
            blockerCount: 0,
          },
        ],
        preconditions: [
          {
            id: "attribution_report",
            label: "归因报告",
            status: "blocked",
            message: "需要先完成归因分析。",
            fixTab: "attribution",
            fixActionLabel: "去归因分析",
          },
        ],
        blockerResolutions: [
          {
            code: "missing_attribution_report",
            humanMessage: "还没有基于观察数据生成并确认的归因报告。",
            impact: "公司目标缺少事实依据。",
            fixTab: "attribution",
            fixActionLabel: "去归因分析生成报告",
          },
        ],
        handoffPreview: {
          fromStage: "goal",
          toStage: "planning",
          outputLabel: "公司目标",
          outputCount: 0,
          summary: "确认后的公司目标才允许进入规划拆解。",
        },
        operatorRecommendation: {
          title: "先处理当前卡点",
          summary: "还没有基于观察数据生成并确认的归因报告。公司目标缺少事实依据。",
          severity: "warning",
          actionLabel: "去归因分析生成报告",
          actionTab: "attribution",
        },
        stageBoundary: {
          allowed: ["创建候选公司目标", "确认指标、目标值、负责人和周期"],
          prohibited: ["绕过归因凭空定目标", "在目标页执行岗位"],
          evidenceRequired: ["归因报告", "目标指标", "负责人或治理口径"],
        },
        latest: {},
        counts: {},
      },
    };

    harness.render();

    const text = expectPageText(harness.container);
    expect(text).toContain("主流程驾驶舱");
    expect(text).toContain("当前卡点");
    expect(text).toContain("当前状态");
    expect(text).toContain("为什么卡住");
    expect(text).toContain("下一步去哪");
    expect(text).toContain("做完结果");
    expect(text).toContain("公司目标 · 当前处理");
    expect(text).toContain("去公司目标");
    expect(text).toContain("六层进度");
    expect(text).toContain("数据分析");
    expect(text).toContain("已形成数据分析包：商城经营观察");
    expect(text).toContain("证据 4 · 阻塞 0");
    expect(text).toContain("需修复");
    expect(text).toContain("证据 0 · 阻塞 1");
    expect(text).toContain("任务调度");
    expect(text).toContain("岗位执行");
    expect(text).toContain("来源输入");
    expect(text).toContain("本页任务");
    expect(text).toContain("目标确认后才允许进入规划拆解");
    expect(text).toContain("先处理当前卡点");
    expect(text).toContain("公司目标缺少事实依据。");
    expect(text).toContain("前置条件");
    expect(text).toContain("归因报告");
    expect(text).toContain("本页边界");
    expect(text).toContain("创建候选公司目标");
    expect(text).toContain("在目标页执行岗位");
    expect(text).toContain("阻塞修复");
    expect(text).toContain("还没有基于观察数据生成并确认的归因报告。");
    expect(text).toContain("下一层输出");
    expect(text).toContain("公司目标");

    const dispatchStageButton = Array.from(
      harness.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.textContent?.includes("任务调度"));
    expect(dispatchStageButton).toBeInstanceOf(HTMLButtonElement);
    dispatchStageButton?.click();
    expect(harness.state.tab).toBe("workboard");

    const fixButton = Array.from(
      harness.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.textContent?.trim() === "去归因分析生成报告");
    expect(fixButton).toBeInstanceOf(HTMLButtonElement);
    fixButton?.click();
    expect(harness.state.tab).toBe("attribution");
  });

  it("infers cockpit progress from latest dispatch data when stageProgress is missing", () => {
    const harness = createBusinessFlowRenderHarness("businessOverview");
    harness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: 1,
        currentStage: "role",
        latest: {
          taskPackage: {
            id: "task-package-dd17f8db",
            title: "任务：商城运营诊断",
            status: "materialized",
          },
          dispatchToRoleRequest: {
            id: "dispatch_role_req_dd17f8db-046e-4e3f-bb64-f57e420ad3a9",
            status: "ready",
          },
        },
        counts: {},
      },
    };

    harness.render();

    const text = expectPageText(harness.container);
    expect(text).toContain("主流程驾驶舱");
    expect(text).toContain("任务调度");
    expect(text).toContain("已生成派发单/执行队列");
    expect(text).toContain("任务：商城运营诊断");
    expect(text).toContain("执行队列项已生成");
    expect(text).not.toContain("dispatch_role_req_dd17f8db-046e-4e3f-bb64-f57e420ad3a9");
    expect(text).toContain("岗位执行");
    expect(text).toContain("已有派发单和执行队列，等待岗位执行确认、运行和证据读回。");
    expect(text).toContain("派发单");
    expect(text).toContain("已生成派发单：任务：商城运营诊断");
    expect(text).toContain("执行队列");
    expect(text).toContain("已生成执行队列：执行队列项已生成");
    expect(text).toContain("阻塞修复");
    expect(text).toContain("数据分析需要处理");
    expect(text).not.toContain("当前没有前置条件数据");
    expect(text).not.toContain("等待上一层完成。");
    expect(text).not.toContain("当前主流程没有阻塞项，可以按主动作继续。");
  });

  it("submits a business intent through interaction and observation preparation", async () => {
    const harness = createBusinessFlowRenderHarness("businessOverview");
    const request = vi.fn(async (method: string) => {
      if (method === "aics.mainFlow.interaction.create") {
        return { id: "interaction-1" };
      }
      if (method === "aics.mainFlow.readModel.get") {
        return {
          version: 1,
          updatedAt: 2,
          currentStage: "attribution",
          readiness: { canPrepareAttribution: true },
          blockedReasons: [],
          latest: {
            interaction: {
              id: "interaction-1",
              message: "提升岗位商城首批岗位授权转化与执行成功率",
            },
            observationPackage: {
              id: "obs-1",
              title: "经营意图初始观察包",
              summary: "由经营概览提交的岗位商城经营意图生成。",
              signals: [
                {
                  id: "business_intent",
                  title: "经营意图",
                  summary: "提升岗位商城首批岗位授权转化与执行成功率",
                  evidenceRefs: ["interaction-1"],
                },
              ],
            },
          },
          counts: { interactions: 1, observations: 1 },
        };
      }
      return { id: "obs-1" };
    });
    harness.state.client = { request, stop: vi.fn() } as never;
    harness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: 1,
        currentStage: "observation",
        readiness: { canPrepareAttribution: false },
        blockedReasons: [],
        latest: {},
        counts: {},
      },
    };
    harness.state.refreshAicsMainFlowReadModel = vi.fn(async () => undefined);
    harness.render();

    const textarea = harness.container.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
    textarea!.value = "提升岗位商城首批岗位授权转化与执行成功率";
    textarea!.dispatchEvent(new InputEvent("input", { bubbles: true }));
    harness.render();

    const button = Array.from(harness.container.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent?.trim() === "开始观察",
    );
    expect(button).toBeInstanceOf(HTMLButtonElement);
    button?.click();
    await flushPromises();
    await flushPromises();

    expect(request).toHaveBeenCalledWith("aics.mainFlow.interaction.create", {
      stage: "observation",
      message: "提升岗位商城首批岗位授权转化与执行成功率",
      proposedNextAction: "prepare_observation_package",
    });
    const observationCall = request.mock.calls.find(
      ([method]) => method === "aics.mainFlow.observation.prepare",
    );
    expect(observationCall).toBeTruthy();
    const observationPayload = (
      observationCall as unknown as
        | [string, { signals?: Array<Record<string, unknown>> }]
        | undefined
    )?.[1];
    if (!observationPayload) throw new Error("Expected observation payload");
    expect(observationPayload.signals?.map((signal) => signal.id)).toEqual([
      "business_intent",
      "cloud_marketplace",
      "local_openclaw",
      "role_supply_capability",
      "operator_usage",
      "dispatch_execution_chain",
      "external_product_competitor",
      "external_technology_tool_model",
      "absorbable_capability_library",
      "risk_data_quality",
    ]);
    expect(harness.state.tab).toBe("observation");
  });

  it("generates attribution from confirmed observation evidence", async () => {
    const harness = createBusinessFlowRenderHarness("attribution");
    const request = vi.fn(async (method: string) => {
      if (method === "aics.mainFlow.attribution.generateFromLatest") {
        return { attribution: { id: "attr-1" } };
      }
      if (method === "aics.mainFlow.readModel.get") {
        return harness.state.aicsMainFlow?.readModel;
      }
      return { ok: true };
    });
    harness.state.client = { request, stop: vi.fn() } as never;
    harness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: 2,
        currentStage: "attribution",
        readiness: { canPrepareAttribution: true, canCreateGoalCandidate: false },
        blockedReasons: [
          {
            stage: "attribution",
            code: "missing_attribution_report",
            message: "AttributionReport is required before creating goal rationale.",
          },
        ],
        latest: {
          observationPackage: {
            id: "obs-1",
            title: "经营意图初始观察包",
            status: "confirmed",
            summary: "由经营概览提交的岗位商城经营意图生成。",
            signals: [
              {
                id: "business_intent",
                title: "经营意图",
                summary: "提升岗位商城首批岗位授权转化与执行成功率",
                evidenceRefs: ["interaction-1"],
              },
            ],
          },
          attributionReport: null,
        },
        counts: { observations: 1, attributions: 0 },
      },
    };

    harness.render();

    const button = Array.from(harness.container.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent?.trim() === "开始归因",
    );
    expect(button).toBeInstanceOf(HTMLButtonElement);
    expect(button?.disabled).toBe(false);
    button?.click();
    await flushPromises();
    expect(request).toHaveBeenCalledWith("aics.mainFlow.attribution.generateFromLatest", {});
    const text = expectPageText(harness.container);
    expect(text).not.toContain("AttributionReport is required before creating goal rationale");
  });

  it("shows data analysis confirmation controls for an observation package", () => {
    const harness = createBusinessFlowRenderHarness("observation");
    harness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: 2,
        currentStage: "observation",
        readiness: { canPrepareAttribution: false },
        blockedReasons: [],
        latest: {
          observationPackage: {
            id: "obs-1",
            title: "经营意图初始观察包",
            status: "prepared",
            summary: "本地观察包",
            signals: [
              {
                id: "business_intent",
                title: "经营意图",
                summary: "提升岗位商城授权转化",
                evidenceRefs: ["interaction-1"],
              },
            ],
          },
        },
        counts: { observations: 1 },
      },
    };

    harness.render();

    const text = expectPageText(harness.container);
    expect(text).toContain("确认观察包");
    expect(text).toContain("标记数据缺失");
    expect(text).toContain("驳回观察包");
    expect(text).toContain("岗位商城观察域");
    expect(text).toContain("云端岗位商城观察");
    expect(text).toContain("可吸收能力库观察");
    expect(text).toContain("风险与数据质量观察");
  });

  it("guides attribution back to data analysis until the observation package is confirmed", () => {
    const harness = createBusinessFlowRenderHarness("attribution");
    harness.state.setTab = vi.fn((tab: AppViewState["tab"]) => {
      harness.state.tab = tab;
    });
    harness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: 2,
        currentStage: "observation",
        stageGuidance: {
          stage: "observation",
          title: "数据分析",
          description: "确认观察后才能进入归因。",
          primaryActionLabel: "确认观察",
          primaryActionTarget: "observation",
          nextStepLabel: "确认后进入归因分析",
        },
        readiness: { canPrepareAttribution: false, canCreateGoalCandidate: false },
        blockedReasons: [
          {
            stage: "observation",
            code: "missing_observation_package",
            message: "ObservationPackage is required before attribution.",
          },
        ],
        latest: {
          observationPackage: {
            id: "obs-1",
            title: "经营意图初始观察包",
            status: "prepared",
            summary: "本地观察包",
            signals: [
              {
                id: "business_intent",
                title: "经营意图",
                summary: "提升岗位商城授权转化",
                evidenceRefs: ["interaction-1"],
              },
            ],
          },
        },
        counts: { observations: 1, attributions: 0 },
      },
    };

    harness.render();

    const text = expectPageText(harness.container);
    expect(text).toContain("通用观察工作台");
    expect(text).toContain("业务健康状态");
    expect(text).toContain("岗位供给与授权");
    expect(text).toContain("工具 / Skill / 外部信息");
    expect(text).toContain("已有可确认事实，可复核后进入归因");
    expect(text).toContain("确认后进入归因分析");
    expect(text).toContain("需要先确认观察包");
    const action = Array.from(harness.container.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent?.trim() === "先确认观察",
    );
    expect(action).toBeInstanceOf(HTMLButtonElement);
    action?.click();
    expect(harness.state.setTab).toHaveBeenCalledWith("observation");
  });

  it("generates attribution findings from observation signals instead of an empty report", async () => {
    const harness = createBusinessFlowRenderHarness("attribution");
    const request = vi.fn(async (method: string) => {
      if (method === "aics.mainFlow.readModel.get") {
        return harness.state.aicsMainFlow.readModel;
      }
      return { ok: true };
    });
    harness.state.client = { request, stop: vi.fn() } as never;
    harness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: 2,
        currentStage: "attribution",
        readiness: { canPrepareAttribution: true },
        blockedReasons: [],
        latest: {
          observationPackage: {
            id: "obs-1",
            title: "经营意图初始观察包",
            status: "confirmed",
            summary: "本地观察包",
            signals: [
              {
                id: "business_intent",
                title: "经营意图",
                summary: "提升岗位商城授权转化",
                evidenceRefs: ["interaction-1"],
              },
            ],
          },
          attributionReport: null,
        },
        counts: { observations: 1, attributions: 0 },
      },
    };

    harness.render();

    const button = Array.from(harness.container.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent?.trim() === "开始归因",
    );
    expect(button).toBeInstanceOf(HTMLButtonElement);
    button?.click();
    await flushPromises();

    expect(request).toHaveBeenCalledWith(
      "aics.mainFlow.attribution.prepare",
      expect.objectContaining({
        findings: expect.arrayContaining([
          expect.objectContaining({
            title: "云端商城问题",
          }),
          expect.objectContaining({
            title: "外部能力未吸收",
          }),
          expect.objectContaining({
            title: "风险与数据质量问题",
          }),
        ]),
      }),
    );
  });

  it("shows attribution confirmation controls for a prepared attribution report", () => {
    const harness = createBusinessFlowRenderHarness("attribution");
    harness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: 2,
        currentStage: "goal",
        readiness: { canCreateGoalCandidate: false },
        blockedReasons: [],
        latest: {
          attributionReport: {
            id: "attr-1",
            title: "岗位商城归因报告",
            status: "prepared",
            summary: "本地归因报告",
            findings: [
              {
                id: "finding-1",
                title: "授权转化不足",
                summary: "待真实经营数据验证",
                confidence: "low",
                observationSignalIds: ["business_intent"],
              },
            ],
          },
        },
        counts: { attributions: 1 },
      },
    };

    harness.render();

    const text = expectPageText(harness.container);
    expect(text).toContain("确认归因");
    expect(text).toContain("要求补数据");
    expect(text).toContain("驳回归因报告");
    expect(text).toContain("主要问题");
    expect(text).toContain("低可信或缺证据的问题需要补数据");
    expect(text).toContain("1. 授权转化不足");
    expect(text).toContain("影响：待真实经营数据验证");
    expect(text).toContain("证据：1 条观察证据");
    expect(text).toContain("可信度：低");
    expect(text).toContain("岗位商城归因维度");
    expect(text).toContain("云端商城问题");
    expect(text).toContain("外部能力未吸收");
    expect(text).toContain("风险与数据质量问题");
  });

  it("renders the company goal page without the old strategy target explainer", () => {
    const harness = createBusinessFlowRenderHarness("goals");

    harness.render();

    const text = expectPageText(harness.container);
    expect(text).toContain("公司目标");
    expect(text).not.toContain("策略性目标层");
    expect(text).not.toContain("输入依据");
    expect(text).not.toContain("博弈策略");
    expect(text).not.toContain("经营目标");
    expect(text).not.toContain("管理目标");
    expect(text).not.toContain("约束规则");
    expect(text).not.toContain("执行岗位");
    expect(text).not.toContain("派任务");
  });

  it("generates a goal candidate from confirmed attribution", async () => {
    const harness = createBusinessFlowRenderHarness("goals");
    const request = vi.fn(async (method: string) => {
      if (method === "aics.mainFlow.goal.generateFromLatest") {
        return { goal: { id: "goal-1" } };
      }
      if (method === "aics.mainFlow.readModel.get") {
        return harness.state.aicsMainFlow?.readModel;
      }
      return { ok: true };
    });
    harness.state.client = { request, stop: vi.fn() } as never;
    harness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: 3,
        currentStage: "goal",
        readiness: { canCreateGoalCandidate: true },
        blockedReasons: [],
        latest: { attributionReport: { id: "attr-1", title: "归因报告" } },
        counts: { attributions: 1, goals: 0 },
      },
    };
    harness.render();

    const generateButton = Array.from(
      harness.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.textContent?.trim() === "生成目标候选");
    expect(generateButton).toBeInstanceOf(HTMLButtonElement);
    expect(generateButton?.disabled).toBe(false);
    generateButton?.click();
    await flushPromises();
    expect(request).toHaveBeenCalledWith("aics.mainFlow.goal.generateFromLatest", {});
  });

  it("enables the manual goal candidate submit button after required fields are filled", () => {
    const harness = createBusinessFlowRenderHarness("goals");
    harness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: 3,
        currentStage: "goal",
        readiness: { canCreateGoalCandidate: true },
        blockedReasons: [],
        latest: { attributionReport: { id: "attr-1", title: "归因报告" } },
        counts: { attributions: 1, goals: 0 },
      },
    };
    harness.render();

    const openButton = Array.from(
      harness.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.textContent?.trim() === "手动补充");
    expect(openButton).toBeInstanceOf(HTMLButtonElement);
    openButton?.click();
    harness.render();

    const fill = (placeholder: string, value: string) => {
      const input = Array.from(
        harness.container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          "input, textarea",
        ),
      ).find((candidate) => candidate.placeholder === placeholder);
      expect(input).toBeInstanceOf(HTMLElement);
      input!.value = value;
      input!.dispatchEvent(new InputEvent("input", { bubbles: true }));
    };
    fill("目标名称（必填）", "Chrome 测试：提升商城岗位供给闭环");
    fill("指标（如：首批岗位授权转化与执行成功率）", "岗位供给/API/工具 Skill 可用率");
    fill("目标值（如：首批岗位可授权、可执行、可回写）", "主流程可推进到规划与调度前置状态");
    harness.render();

    const submit = Array.from(harness.container.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent?.trim() === "提交候选",
    );
    expect(submit).toBeInstanceOf(HTMLButtonElement);
    expect(submit?.disabled).toBe(false);
  });

  it("renders company goal as a human confirmation card with traceability and planning readiness", () => {
    const harness = createBusinessFlowRenderHarness("goals");
    harness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: 3,
        currentStage: "goal",
        readiness: { canCreateGoalCandidate: true },
        blockedReasons: [],
        latest: {
          attributionReport: { id: "attr-1", title: "归因报告" },
          companyGoal: {
            id: "goal-1",
            kind: "CompanyGoal",
            status: "candidate",
            title: "清零 API、模型、工具和 Skill 执行阻塞",
            owner: "运营负责人",
            metric: "系统使用阻塞数",
            currentValue: "1 个阻塞",
            target: "阻塞数降到 0",
            cycle: "当前经营周期",
            whyNow: "模型 provider 不可用，岗位不能执行。",
            rationale: "归因显示模型连接阻塞岗位执行。",
            sourceObservationSignalIds: ["signal-api-blocked"],
            sourceAttributionFindingIds: ["finding-api-blocked"],
            blockedReasons: [],
            readyForPlanning: true,
            auditRefs: [],
          },
        },
        counts: { goals: 1 },
      },
    };

    harness.render();

    const text = expectPageText(harness.container);
    expect(text).toContain("当前值");
    expect(text).toContain("1 个阻塞");
    expect(text).toContain("目标值");
    expect(text).toContain("阻塞数降到 0");
    expect(text).toContain("来源观察");
    expect(text).toContain("1 条事实");
    expect(text).toContain("来源归因");
    expect(text).toContain("1 条原因");
    expect(text).toContain("确认前检查");
    expect(text).toContain("这是候选目标，还不是正式公司目标；确认后才允许进入规划方案。");
    expect(text).toContain("来源：1 条观察事实 · 1 条归因原因。当前没有目标层阻塞。");
    expect(text).toContain("确认后可进入规划方案");
    expect(text).not.toContain("signal-api-blocked");
    expect(text).not.toContain("finding-api-blocked");
  });

  it("keeps the project board read-only for dispatch creation", () => {
    const harness = createBusinessFlowRenderHarness("projects");

    harness.render();
    const shell = expectMainSystemShell(harness.container);

    clickMainSystemItemAction(shell, "重点客户交付项目");

    expect(harness.state.tab).toBe("projects");
    expect(harness.state.businessFlow.selectedProjectId).toBe("project-key-account-delivery");
    const text = shell.textContent ?? "";
    expect(text).not.toContain("派任务");
    expect(text).not.toContain("执行岗位");
    expect(text).not.toContain("项目到岗位任务");
    expect(text).not.toContain("能力预检");
  });

  it("refreshes the execution queue after dispatching authorized work", async () => {
    const harness = createBusinessFlowRenderHarness("workboard");
    const request = vi.fn(async (method: string) => {
      if (method === "aics.mainFlow.dispatch.checkAndCreateQueue") {
        return { ok: true };
      }
      if (method === "aics.mainFlow.readModel.get") {
        return {
          version: 1,
          updatedAt: 2,
          currentStage: "role",
          readiness: {},
          blockedReasons: [],
          latest: {
            dispatchToRoleRequest: {
              id: "dispatch-1",
              roleListingId: "local_rolelisting_marketplace_ops",
              entitlementId: "local_entitlement_marketplace_ops",
            },
          },
          objects: {
            rolePlanItems: [],
            taskPackages: [{ id: "task-1", status: "materialized" }],
            dispatchToRoleRequests: [{ id: "dispatch-1", status: "ready" }],
            roleResults: [],
          },
          counts: { taskPackages: 1, dispatchToRoleRequests: 1, roleResults: 0 },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    harness.state.client = { request } as unknown as AppViewState["client"];
    harness.state.refreshMyRolesReadModel = vi.fn(async () => {});
    harness.state.myRoles = {
      ...createDefaultMyRolesState(),
      readModel: {
        roleAssets: [
          {
            roleListingId: "local_rolelisting_marketplace_ops",
            title: "商城运营诊断官",
            entitlementId: "local_entitlement_marketplace_ops",
            entitlementStatus: "authorized",
          },
        ],
      },
    };
    harness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: 1,
        currentStage: "dispatch",
        readiness: {
          canCreateDispatchProposal: false,
          canMaterializeTaskPackage: true,
        },
        blockedReasons: [],
        latest: {
          dispatchProposalReview: {
            id: "proposal-1",
            status: "confirmed",
          },
        },
        objects: {
          rolePlanItems: [
            {
              id: "role-plan-1",
              title: "商城运营岗位任务",
              status: "confirmed",
            },
          ],
          taskPackages: [],
          dispatchToRoleRequests: [],
          roleResults: [],
        },
        counts: { taskPackages: 0, dispatchToRoleRequests: 0, roleResults: 0 },
      },
    };

    harness.render();

    const dispatchButton = Array.from(
      harness.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.textContent?.trim() === "检查并派发");
    expect(dispatchButton).toBeInstanceOf(HTMLButtonElement);
    expect(dispatchButton?.disabled).toBe(false);

    dispatchButton?.click();
    await flushPromises();

    expect(request).toHaveBeenCalledWith(
      "aics.mainFlow.dispatch.checkAndCreateQueue",
      expect.objectContaining({
        rolePlanItemId: "role-plan-1",
      }),
    );
    expect(harness.state.refreshMyRolesReadModel).toHaveBeenCalledOnce();
    expect(harness.state.tab).toBe("aics");
  });

  it("blocks dispatch from task scheduling until a local role authorization is synced", () => {
    const harness = createBusinessFlowRenderHarness("workboard");
    harness.state.setTab = vi.fn((tab: AppViewState["tab"]) => {
      harness.state.tab = tab;
    });
    harness.state.aicsMarketplace = { roles: [], loading: false, error: null, result: null };
    harness.state.myRoles = {
      ...createDefaultMyRolesState(),
      readModel: { roleAssets: [] },
    };
    harness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: 1,
        currentStage: "dispatch",
        readiness: {
          canCreateDispatchProposal: false,
          canMaterializeTaskPackage: true,
        },
        blockedReasons: [],
        latest: {
          dispatchProposalReview: {
            id: "proposal-1",
            status: "confirmed",
          },
        },
        objects: {
          rolePlanItems: [
            {
              id: "role-plan-1",
              title: "商城运营岗位任务",
              status: "confirmed",
            },
          ],
          taskPackages: [],
          dispatchToRoleRequests: [],
          roleResults: [],
        },
        counts: { taskPackages: 0, dispatchToRoleRequests: 0, roleResults: 0 },
      },
    };

    harness.render();

    const text = harness.container.textContent ?? "";
    expect(text).toContain("调度前检查");
    expect(text).toContain("岗位已授权");
    expect(text).toContain("待处理");
    expect(text).toContain("还没有已同步的岗位授权");
    expect(text).toContain("岗位授权");
    expect(text).toContain("待授权");
    const dispatchButton = Array.from(
      harness.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.textContent?.trim() === "检查并派发");
    expect(dispatchButton).toBeInstanceOf(HTMLButtonElement);
    expect(dispatchButton?.disabled).toBe(true);
    const billingButton = Array.from(
      harness.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.textContent?.trim() === "去费用与授权");
    expect(billingButton).toBeInstanceOf(HTMLButtonElement);

    billingButton?.click();

    expect(harness.state.setTab).toHaveBeenCalledWith("usage");
  });

  it("shows dispatch preflight repair routes without running role execution", () => {
    const harness = createBusinessFlowRenderHarness("workboard");
    harness.state.setTab = vi.fn((tab: AppViewState["tab"]) => {
      harness.state.tab = tab;
    });
    harness.state.aicsMarketplace = { roles: [], loading: false, error: null, result: null };
    harness.state.myRoles = {
      ...createDefaultMyRolesState(),
      readModel: {
        roleAssets: [
          {
            roleListingId: "role-ops",
            title: "商城运营诊断官",
            entitlementId: "entitlement-ops",
            entitlementStatus: "authorized",
          },
        ],
      },
    };
    harness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: 1,
        currentStage: "dispatch",
        readiness: {
          canCreateDispatchProposal: true,
          canMaterializeTaskPackage: false,
        },
        blockedReasons: [{ stage: "dispatch", code: "missing_api_binding", message: "缺 API" }],
        latest: {
          companyGoal: { id: "goal-1", title: "清零阻塞", status: "confirmed" },
          planningPackage: { id: "planning-1", status: "confirmed" },
        },
        objects: {
          rolePlanItems: [
            {
              id: "role-plan-1",
              planningPackageId: "planning-1",
              title: "API 与模型连接治理",
              status: "confirmed",
              taskIntent: "核对模型 Provider。",
              expectedOutput: "连接检查表",
            },
          ],
          taskPackages: [],
          dispatchToRoleRequests: [],
          roleResults: [],
        },
        counts: {},
      },
    };

    harness.render();
    const text = expectPageText(harness.container);

    expect(text).toContain("调度前检查");
    expect(text).toContain("目标已确认");
    expect(text).toContain("规划已确认");
    expect(text).toContain("岗位已授权");
    expect(text).toContain("API 可用");
    expect(text).toContain("去 API 管理补齐模型、云端商城或工具连接。");
    expect(text).toContain("这里不会运行岗位");
    expect(text).toContain("生成派发单和执行队列");
    expect(text).toContain("做完结果：到岗位执行页确认并运行。");
    expect(text).not.toContain("actor_context");
    expect(text).not.toContain("确认并运行");

    const apiRepairButton = Array.from(
      harness.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "去处理");
    expect(apiRepairButton).toBeInstanceOf(HTMLButtonElement);
  });

  it("guides users from an existing dispatch queue to role execution", () => {
    const harness = createBusinessFlowRenderHarness("workboard");
    harness.state.setTab = vi.fn((tab: AppViewState["tab"]) => {
      harness.state.tab = tab;
    });
    harness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: 1,
        currentStage: "dispatch",
        readiness: {
          canCreateDispatchProposal: false,
          canMaterializeTaskPackage: false,
        },
        blockedReasons: [],
        latest: {
          dispatchProposalReview: {
            id: "proposal-1",
            status: "confirmed",
          },
        },
        objects: {
          rolePlanItems: [
            {
              id: "role-plan-1",
              title: "商城运营岗位任务",
              status: "confirmed",
            },
          ],
          taskPackages: [{ id: "task-1", status: "materialized" }],
          dispatchToRoleRequests: [{ id: "dispatch-1", status: "ready" }],
          roleResults: [],
        },
        counts: { taskPackages: 1, dispatchToRoleRequests: 1, roleResults: 0 },
      },
    };

    harness.render();

    const text = harness.container.textContent ?? "";
    expect(text).toContain("派发单已生成，下一步到岗位执行页运行已授权任务。");
    const executionButton = Array.from(
      harness.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.textContent?.trim() === "去岗位执行");
    expect(executionButton).toBeInstanceOf(HTMLButtonElement);

    executionButton?.click();

    expect(harness.state.setTab).toHaveBeenCalledWith("aics");
  });

  it("keeps multi-item dispatch selection on the dispatch page with a clear candidate prompt", () => {
    const harness = createBusinessFlowRenderHarness("workboard");
    harness.state.aicsMarketplace = { roles: [], loading: false, error: null, result: null };
    harness.state.myRoles = {
      ...createDefaultMyRolesState(),
      readModel: {
        roleAssets: [
          {
            roleListingId: "local_rolelisting_marketplace_ops",
            title: "商城运营诊断官",
            entitlementId: "local_entitlement_marketplace_ops",
            entitlementStatus: "authorized",
          },
        ],
      },
    };
    harness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: 1,
        currentStage: "dispatch",
        readiness: {
          canCreateDispatchProposal: true,
          canMaterializeTaskPackage: false,
        },
        blockedReasons: [],
        latest: {
          planningPackage: {
            id: "planning-1",
            title: "Q3 销售额 300 万 - 规划方案",
            status: "confirmed",
          },
        },
        objects: {
          rolePlanItems: [
            {
              id: "role-plan-1",
              planningPackageId: "planning-1",
              title: "渠道推广增长",
              status: "confirmed",
              category: "marketplace_growth",
              capabilityMatchSummary: "需要商城运营和渠道分析。",
              taskIntent: "形成渠道推广动作清单。",
              expectedOutput: "渠道推广计划",
            },
            {
              id: "role-plan-2",
              planningPackageId: "planning-1",
              title: "岗位商品转化",
              status: "confirmed",
              category: "role_marketplace_ops",
              capabilityMatchSummary: "需要商品运营能力。",
              taskIntent: "优化岗位商品说明。",
              expectedOutput: "岗位商品优化清单",
            },
          ],
          taskPackages: [],
          dispatchToRoleRequests: [],
          roleResults: [],
        },
        counts: { taskPackages: 0, dispatchToRoleRequests: 0, roleResults: 0 },
      },
    };

    harness.render();

    const text = expectPageText(harness.container);
    expect(text).toContain("有多个岗位工作项，请在下方派发候选卡选择一项生成派发单。");
    expect(text).toContain("请选择候选");
    const topAction = Array.from(
      harness.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.textContent?.trim() === "选择下方候选");
    expect(topAction).toBeInstanceOf(HTMLButtonElement);
    expect(topAction?.disabled).toBe(true);
    const candidateActions = Array.from(
      harness.container.querySelectorAll<HTMLButtonElement>("button"),
    ).filter((candidate) => candidate.textContent?.trim() === "生成这一项派发单");
    expect(candidateActions).toHaveLength(2);
    expect(candidateActions.every((button) => !button.disabled)).toBe(true);
  });

  it("materializes dispatch requests with synced local role authorization assets", async () => {
    const harness = createBusinessFlowRenderHarness("workboard");
    const request = vi.fn(async (method: string) => {
      if (method === "aics.mainFlow.dispatch.checkAndCreateQueue") {
        return { ok: true };
      }
      if (method === "aics.mainFlow.readModel.get") {
        return harness.state.aicsMainFlow.readModel;
      }
      throw new Error(`unexpected method ${method}`);
    });
    harness.state.client = { request } as unknown as AppViewState["client"];
    harness.state.refreshMyRolesReadModel = vi.fn(async () => {});
    harness.state.aicsMarketplace = { roles: [], loading: false, error: null, result: null };
    harness.state.aicsRoleBuilder = {
      form: {} as AppViewState["aicsRoleBuilder"]["form"],
      running: false,
      tokenRunning: false,
      auditRunning: false,
      result: null,
      error: null,
    };
    harness.state.myRoles = {
      ...createDefaultMyRolesState(),
      loading: false,
      runningExecutionId: null,
      error: null,
      message: null,
      readModel: {
        roleAssets: [
          {
            roleListingId: "local_rolelisting_marketplace_ops",
            title: "商城运营诊断官",
            entitlementId: "local_entitlement_marketplace_ops",
            entitlementStatus: "authorized",
          },
        ],
      },
      viewMode: "queue",
      query: "",
      statusFilter: "all",
      capabilityFilter: null,
      selectedRoleKey: null,
      detailTab: "overview",
    };
    harness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: 1,
        currentStage: "dispatch",
        readiness: {
          canCreateDispatchProposal: false,
          canMaterializeTaskPackage: true,
        },
        blockedReasons: [],
        latest: {
          dispatchProposalReview: {
            id: "proposal-1",
            status: "confirmed",
          },
        },
        objects: {
          rolePlanItems: [
            {
              id: "role-plan-1",
              title: "商城运营岗位任务",
              status: "confirmed",
            },
          ],
          taskPackages: [],
          dispatchToRoleRequests: [],
          roleResults: [],
        },
        counts: { taskPackages: 0, dispatchToRoleRequests: 0, roleResults: 0 },
      },
    };

    harness.render();

    const dispatchButton = Array.from(
      harness.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.textContent?.trim() === "检查并派发");
    expect(dispatchButton).toBeInstanceOf(HTMLButtonElement);
    dispatchButton?.click();
    await flushPromises();

    expect(request).toHaveBeenCalledWith(
      "aics.mainFlow.dispatch.checkAndCreateQueue",
      expect.objectContaining({
        rolePlanItemId: "role-plan-1",
      }),
    );
  });

  it("keeps planning and dispatch statuses in business language", () => {
    const planningReadModel = {
      version: 1,
      updatedAt: 1,
      currentStage: "planning",
      readiness: { canPreparePlanning: true },
      blockedReasons: [],
      latest: {
        companyGoal: { id: "goal-1", title: "Q3 销售额 300 万", status: "confirmed" },
        planningPackage: {
          id: "planning-1",
          title: "Q3 销售额 300 万 - 规划方案",
          status: "confirmed",
          revision: 2,
          summary: "拆解渠道推广、岗位商品转化和执行质量提升。",
        },
      },
      objects: {
        planningPackages: [],
        rolePlanItems: [
          {
            id: "role-plan-1",
            planningPackageId: "planning-1",
            title: "渠道推广增长",
            status: "confirmed",
            dispatchStatus: "not_dispatched",
            category: "marketplace_growth",
            roleCapabilityRef: "role-capability:marketplace-channel-ops",
            capabilityMatchSummary: "需要商城运营、渠道分析和内容策划能力。",
            taskIntent: "获取渠道推广信息并形成执行清单。",
            expectedOutput: "渠道推广计划",
            acceptanceCriteria: ["渠道来源可追溯"],
            blockedReasons: [],
          },
        ],
      },
      counts: {},
    };
    const companyHarness = createBusinessFlowRenderHarness("company");
    companyHarness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: planningReadModel,
    };

    companyHarness.render();
    const planningText = expectPageText(companyHarness.container);
    expect(planningText).toContain("渠道增长");
    expect(planningText).toContain("待派发");
    expect(planningText).toContain("承接岗位");
    expect(planningText).toContain("需要条件");
    expect(planningText).toContain("输出什么");
    expect(planningText).toContain("验收标准");
    expect(planningText).toContain("是否可调度");
    expect(planningText).toContain("可以进入任务调度生成派发单和执行队列。");
    expect(planningText).not.toContain("not_dispatched");
    expect(planningText).not.toContain("role-capability:");
    expect(planningText).not.toContain("marketplace_growth");

    const dispatchHarness = createBusinessFlowRenderHarness("workboard");
    dispatchHarness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: { ...planningReadModel, currentStage: "dispatch" },
    };

    dispatchHarness.render();
    const dispatchText = expectPageText(dispatchHarness.container);
    expect(dispatchText).toContain("已确认");
    expect(dispatchText).toContain("渠道增长");
    expect(dispatchText).toContain("需要商城运营、渠道分析和内容策划能力。");
    expect(dispatchText).not.toContain("confirmed");
    expect(dispatchText).not.toContain("role-capability:");
    expect(dispatchText).not.toContain("marketplace_growth");
  });

  it("renders project milestones, risks, and AICS dispatch-linked feedback", () => {
    const harness = createBusinessFlowRenderHarness("projects");

    harness.render();

    const shell = expectMainSystemShell(harness.container);
    const text = shell.textContent ?? "";
    expect(text).toContain("项目里程碑");
    expect(text).toContain("项目风险与确认");
    expect(text).toContain("任务关联记录");
    expect(text).toContain("待接数据");
    expect(text).toContain("渠道线索质量不稳定");
    expect(text).not.toContain("能力预检");
    expect(text).not.toContain("执行岗位");
  });

  it("keeps planning focused on role plan structure instead of system plumbing", () => {
    const harness = createBusinessFlowRenderHarness("company");

    harness.render();

    const text = expectPageText(harness.container);
    expect(text).toContain("规划方案");
    expect(text).toContain("工作块");
    expect(text).toContain("生成规划方案");
    expect(text).toContain("经营拆解");
    for (const hiddenWord of [
      "授权客户",
      "客户授权",
      "Gateway",
      "OpenClaw",
      "API Bridge",
      "MCP",
      "provider",
      "工具调用",
    ]) {
      expect(text).not.toContain(hiddenWord);
    }
  });

  it("generates planning from the confirmed goal through the backend read model", async () => {
    const harness = createBusinessFlowRenderHarness("company");
    const request = vi.fn(async (method: string) => {
      if (method === "aics.mainFlow.planning.generateFromLatest") {
        return { planning: { id: "planning-1" } };
      }
      if (method === "aics.mainFlow.readModel.get") {
        return harness.state.aicsMainFlow?.readModel;
      }
      return { ok: true };
    });
    harness.state.client = { request, stop: vi.fn() } as never;
    harness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: 4,
        currentStage: "planning",
        readiness: { canPreparePlanning: true },
        blockedReasons: [],
        latest: {
          companyGoal: {
            id: "goal-1",
            title: "提升岗位商城首批岗位授权转化与执行成功率",
            status: "confirmed",
          },
          planningPackage: null,
        },
        counts: { goals: 1, planningPackages: 0, rolePlanItems: 0 },
        objects: {
          planningPackages: [],
          rolePlanItems: [],
        },
      },
    };

    harness.render();
    const button = Array.from(harness.container.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent?.trim() === "生成规划方案",
    );
    expect(button).toBeInstanceOf(HTMLButtonElement);
    button?.click();
    await flushPromises();
    expect(request).toHaveBeenCalledWith("aics.mainFlow.planning.generateFromLatest", {});
  });

  it("shows main-flow role execution controls before the legacy role queue loads", () => {
    const harness = createBusinessFlowRenderHarness("aics");
    harness.state.myRoles = {
      ...createDefaultMyRolesState(),
      loading: false,
      runningExecutionId: null,
      error: null,
      message: null,
      readModel: null,
      viewMode: "queue",
      query: "",
      statusFilter: "all",
      capabilityFilter: null,
      selectedRoleKey: null,
      detailTab: "overview",
    };
    harness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: 1,
        currentStage: "role",
        readiness: {
          canEnterRoleExecution: true,
          canRunApprovedTask: false,
        },
        executionPreflight: {
          taskPackageId: "task-1",
          dispatchToRoleRequestId: "dispatch-1",
          hasTaskPackage: true,
          hasDispatchToRoleRequest: true,
          hasEntitlement: false,
          hasExecutionConfirmation: false,
          hasCostConfirmation: false,
          hasToolSkillReadiness: true,
          hasApiBinding: true,
          blockedReasons: [
            {
              stage: "role",
              code: "authorization_required",
              message: "岗位执行需要云端岗位授权。",
            },
          ],
          canRun: false,
        },
        blockedReasons: [],
        latest: {
          taskPackage: {
            id: "task-1",
            title: "结构化岗位任务包",
          },
          dispatchToRoleRequest: {
            id: "dispatch-1",
            roleTitle: "岗位商城运营",
            confirmExecution: false,
            costConfirmed: false,
          },
          roleResult: null,
        },
        counts: { taskPackages: 1, dispatchToRoleRequests: 1, roleResults: 0 },
      },
    };
    harness.state.refreshAicsMainFlowReadModel = vi.fn();
    harness.state.refreshMyRolesReadModel = vi.fn();

    harness.render();

    const text = expectPageText(harness.container);
    expect(text).toContain("岗位执行 · 执行控制台");
    expect(text).toContain("执行任务");
    expect(text).toContain("执行岗位");
    expect(text).toContain("授权状态");
    expect(text).toContain("工具 / Skill");
    expect(text).toContain("使用模型");
    expect(text).toContain("费用影响");
    expect(text).toContain("费用授权");
    expect(text).toContain("执行边界：只运行任务调度已经派发的岗位任务。");
    expect(text).toContain("做完结果必须读回业务产物、审计记录、账本记录和模型费用证据");
    expect(text).toContain("确认并运行");
    expect(text).toContain("岗位执行控制台尚未加载");
    expect(text).toContain("缺少岗位授权");
    expect(text).not.toContain("authorization_required");
    expect(text).not.toContain("dispatch-1");
    expect(text).not.toContain("task-1");

    const runButton = Array.from(
      harness.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.textContent?.trim() === "先完成岗位授权");
    expect(runButton).toBeInstanceOf(HTMLButtonElement);
    expect(runButton?.disabled).toBe(true);
  });

  it("confirms and runs execution from synced authorized role assets", async () => {
    const harness = createBusinessFlowRenderHarness("aics");
    const request = vi.fn(async (method: string) => {
      if (method === "aics.mainFlow.readModel.get") {
        return harness.state.aicsMainFlow.readModel;
      }
      return { ok: true };
    });
    harness.state.client = { request } as unknown as AppViewState["client"];
    harness.state.myRoles = {
      ...createDefaultMyRolesState(),
      loading: false,
      runningExecutionId: null,
      error: null,
      message: null,
      readModel: {
        roleAssets: [
          {
            roleListingId: "local_rolelisting_marketplace_ops",
            title: "商城运营诊断官",
            entitlementId: "local_entitlement_marketplace_ops",
            entitlementStatus: "authorized",
          },
        ],
      },
      viewMode: "queue",
      query: "",
      statusFilter: "all",
      capabilityFilter: null,
      selectedRoleKey: null,
      detailTab: "overview",
    };
    harness.state.aicsMarketplace = { roles: [], loading: false, error: null, result: null };
    harness.state.aicsRoleBuilder = {
      form: {} as AppViewState["aicsRoleBuilder"]["form"],
      running: false,
      tokenRunning: false,
      auditRunning: false,
      result: null,
      error: null,
    };
    harness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: 1,
        currentStage: "role",
        readiness: {
          canEnterRoleExecution: true,
          canRunApprovedTask: false,
        },
        executionPreflight: {
          taskPackageId: "task-1",
          dispatchToRoleRequestId: "dispatch-1",
          hasTaskPackage: true,
          hasDispatchToRoleRequest: true,
          hasEntitlement: false,
          hasExecutionConfirmation: false,
          hasCostConfirmation: false,
          hasToolSkillReadiness: true,
          hasApiBinding: true,
          blockedReasons: [
            {
              stage: "role",
              code: "authorization_required",
              message: "岗位执行需要云端岗位授权。",
            },
          ],
          canRun: false,
        },
        blockedReasons: [],
        latest: {
          taskPackage: {
            id: "task-1",
            title: "结构化岗位任务包",
          },
          dispatchToRoleRequest: {
            id: "dispatch-1",
            roleListingId: "local_rolelisting_marketplace_ops",
            roleTitle: "岗位商城运营",
            confirmExecution: false,
            costConfirmed: false,
          },
          roleResult: null,
        },
        counts: { taskPackages: 1, dispatchToRoleRequests: 1, roleResults: 0 },
      },
    };
    harness.state.refreshAicsMainFlowReadModel = vi.fn();
    harness.state.refreshMyRolesReadModel = vi.fn();

    harness.render();
    let text = expectPageText(harness.container);
    expect(text).toContain("执行任务");
    expect(text).toContain("结构化岗位任务包");
    expect(text).toContain("执行岗位");
    expect(text).toContain("岗位商城运营");
    expect(text).toContain("授权状态");
    expect(text).toContain("已授权");
    expect(text).toContain("费用影响");
    expect(text).toContain("运行前会确认费用");
    expect(text).not.toContain("local_entitlement_marketplace_ops");

    const confirmButton = Array.from(
      harness.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.textContent?.trim() === "确认并运行");
    expect(confirmButton).toBeInstanceOf(HTMLButtonElement);
    expect(confirmButton?.disabled).toBe(false);

    confirmButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(request).toHaveBeenCalledWith(
      "aics.mainFlow.execution.confirmAndRun",
      expect.objectContaining({
        dispatchToRoleRequestId: "dispatch-1",
        roleListingId: "local_rolelisting_marketplace_ops",
        roleTitle: "商城运营诊断官",
        entitlementId: "local_entitlement_marketplace_ops",
        ledgerRef: "ledger:pending:local_entitlement_marketplace_ops",
      }),
    );
    expect(request).not.toHaveBeenCalledWith("aics.mainFlow.execution.confirm", expect.anything());
    expect(request).not.toHaveBeenCalledWith(
      "aics.mainFlow.execution.cost.confirm",
      expect.anything(),
    );
  });

  it("runs an approved local role task with auditable artifacts", async () => {
    const harness = createBusinessFlowRenderHarness("aics");
    const request = vi.fn(async (method: string) => {
      if (method === "aics.mainFlow.readModel.get") {
        return harness.state.aicsMainFlow.readModel;
      }
      if (method === "dijie.roleTask.run") {
        return {
          ok: true,
          status: "completed",
          executionId: "exec-marketplace-ops",
          summary: "商城运营岗位任务已完成。",
          roleResult: {
            artifactRefs: [
              "artifact:role-result:task-1:marketplace-page-optimization",
              "audit:exec-marketplace-ops:summary",
            ],
            executionEvidence: {
              steps: [{ stepIndex: 1, stepName: "执行岗位任务", status: "completed" }],
              toolUsage: { totalToolCalls: 1, successfulCalls: 1, failedCalls: 0 },
              modelUsage: { totalTokens: 1900, costCents: 0 },
            },
          },
          auditUpload: {
            auditRecordId: "audit-exec-marketplace-ops",
          },
          billingSummary: {
            ledgerRef:
              "ledger:role_execution:local_entitlement_marketplace_ops:exec-marketplace-ops",
          },
        };
      }
      if (method === "aics.executionConsole.readModel.get") {
        return { summary: { completed: 1 }, executions: [] };
      }
      if (method === "aics.roles.mine.readModel.get") {
        return { summary: { totalRoles: 1 }, roles: [] };
      }
      return { ok: true };
    });
    harness.state.client = { request } as unknown as AppViewState["client"];
    harness.state.myRoles = {
      ...createDefaultMyRolesState(),
      loading: false,
      runningExecutionId: null,
      error: null,
      message: null,
      readModel: {
        roleAssets: [
          {
            roleListingId: "local_rolelisting_marketplace_ops",
            title: "商城运营诊断官",
            entitlementId: "local_entitlement_marketplace_ops",
            entitlementStatus: "authorized",
          },
        ],
      },
      viewMode: "queue",
      query: "",
      statusFilter: "all",
      capabilityFilter: null,
      selectedRoleKey: null,
      detailTab: "overview",
    };
    harness.state.aicsMarketplace = { roles: [], loading: false, error: null, result: null };
    harness.state.aicsRoleBuilder = {
      form: {} as AppViewState["aicsRoleBuilder"]["form"],
      running: false,
      tokenRunning: false,
      auditRunning: false,
      result: null,
      error: null,
    };
    harness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: 1,
        currentStage: "role",
        readiness: {
          canEnterRoleExecution: true,
          canRunApprovedTask: true,
        },
        executionPreflight: {
          taskPackageId: "task-1",
          dispatchToRoleRequestId: "dispatch-1",
          hasTaskPackage: true,
          hasDispatchToRoleRequest: true,
          hasEntitlement: true,
          hasExecutionConfirmation: true,
          hasCostConfirmation: true,
          hasToolSkillReadiness: true,
          hasApiBinding: true,
          blockedReasons: [],
          canRun: true,
        },
        blockedReasons: [],
        latest: {
          taskPackage: {
            id: "task-1",
            title: "结构化岗位任务包",
            status: "materialized",
          },
          dispatchToRoleRequest: {
            id: "dispatch-1",
            roleListingId: "local_rolelisting_marketplace_ops",
            roleTitle: "商城运营诊断官",
            entitlementId: "local_entitlement_marketplace_ops",
            ledgerRef: "ledger:pending:local_entitlement_marketplace_ops",
            confirmExecution: true,
            costConfirmed: true,
            status: "ready",
          },
          roleResult: null,
        },
        counts: { taskPackages: 1, dispatchToRoleRequests: 1, roleResults: 0 },
      },
    };
    harness.state.refreshAicsMainFlowReadModel = vi.fn();
    harness.state.refreshMyRolesReadModel = vi.fn();

    harness.render();

    const runButton = Array.from(
      harness.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.textContent?.trim() === "确认并运行");
    expect(runButton).toBeInstanceOf(HTMLButtonElement);
    expect(runButton?.disabled).toBe(false);

    runButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(request).toHaveBeenCalledWith(
      "aics.mainFlow.execution.confirmAndRun",
      expect.objectContaining({
        dispatchToRoleRequestId: "dispatch-1",
        roleListingId: "local_rolelisting_marketplace_ops",
        roleTitle: "商城运营诊断官",
        entitlementId: "local_entitlement_marketplace_ops",
        ledgerRef: "ledger:pending:local_entitlement_marketplace_ops",
      }),
    );
    expect(request).not.toHaveBeenCalledWith("dijie.roleTask.run", expect.anything());
    expect(request).not.toHaveBeenCalledWith("aics.execution.result.record", expect.anything());
    expect(request).not.toHaveBeenCalledWith(
      "aics.mainFlow.dispatch.runApprovedTask",
      expect.anything(),
    );
  });

  it("renders completed role execution result without protocol references", () => {
    const harness = createBusinessFlowRenderHarness("aics");
    harness.state.myRoles = {
      ...createDefaultMyRolesState(),
      loading: false,
      runningExecutionId: null,
      error: null,
      message: null,
      readModel: {
        executions: [
          {
            id: "exec-marketplace-ops",
            status: "completed",
            title: "商城运营诊断任务",
            roleTitle: "商城运营诊断官",
            taskPackageId: "task-1",
            dispatchRequestId: "dispatch-1",
            roleListingId: "local_rolelisting_marketplace_ops",
            entitlementId: "local_entitlement_marketplace_ops",
            confirmExecution: true,
            costConfirmed: true,
            ledgerRef:
              "ledger:role_execution:local_entitlement_marketplace_ops:exec-marketplace-ops",
            allowedTools: ["tool:web-search"],
            allowedSkills: ["skill:marketplace-analysis"],
            artifactRefs: [
              "artifact:role-result:task-1:marketplace-page-optimization",
              "audit:exec-marketplace-ops:summary",
            ],
            result: {
              id: "result-1",
              outcome: "succeeded",
              summary: "商城运营诊断已完成，发现授权说明是主要卡点。",
              artifactRefs: [
                "artifact:role-result:task-1:marketplace-page-optimization",
                "audit:exec-marketplace-ops:summary",
              ],
              executionEvidence: {
                humanConfirmationRef: "confirmed-by-user",
                ledgerRef:
                  "ledger:role_execution:local_entitlement_marketplace_ops:exec-marketplace-ops",
                auditReadback: { auditRecordId: "audit-exec-marketplace-ops" },
                ledgerReadback: {
                  ledgerRef:
                    "ledger:role_execution:local_entitlement_marketplace_ops:exec-marketplace-ops",
                  executionFeeCents: 0,
                  authorizationFeeCents: 0,
                },
                costSummary: {
                  authorizationFeeCents: 0,
                  executionFeeCents: 0,
                  modelUsageCostCents: 0,
                  totalCostCents: 0,
                },
                modelUsage: { totalTokens: 1900, costCents: 0 },
              },
            },
          },
        ],
      },
      viewMode: "queue",
      query: "",
      statusFilter: "all",
      capabilityFilter: null,
      selectedRoleKey: null,
      detailTab: "overview",
    };
    harness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: 1,
        currentStage: "role",
        readiness: { canEnterRoleExecution: true },
        executionPreflight: { blockedReasons: [], canRun: false },
        latest: {},
        counts: { roleResults: 1 },
      },
    };

    harness.render();
    const text = expectPageText(harness.container);

    expect(text).toContain("执行结果回读");
    expect(text).toContain("闭环证据完整");
    expect(text).toContain("商城运营诊断已完成，发现授权说明是主要卡点。");
    expect(text).toContain("业务产物");
    expect(text).toContain("审计记录");
    expect(text).toContain("账本记录");
    expect(text).toContain("费用证据");
    expect(text).toContain("1900 Token");
    expect(text).not.toContain("artifact:");
    expect(text).not.toContain("audit:");
    expect(text).not.toContain("ledger:");
    expect(text).not.toContain("RoleResult");
    expect(text).not.toContain("TaskPackage");
  });

  it("creates main-flow management breakdown from a confirmed company goal", async () => {
    const harness = createBusinessFlowRenderHarness("company");
    const request = vi.fn(async (method: string) => {
      if (method === "aics.mainFlow.readModel.get") {
        return {
          version: 1,
          updatedAt: 2,
          currentStage: "planning",
          readiness: {},
          blockedReasons: [],
          latest: {
            companyGoal: {
              id: "goal-1",
              kind: "CompanyGoal",
              status: "confirmed",
              title: "提升岗位商城首批授权转化",
            },
          },
          counts: { goals: 1 },
          workBlocks: [
            {
              id: "wb-1",
              goalId: "goal-1",
              name: "岗位供给",
              purpose: "拆解岗位商品和能力缺口。",
              progressGauge: "岗位商品可审核。",
              status: "pending",
              revision: 1,
              isStale: false,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        };
      }
      return { ok: true };
    });
    harness.state.client = { request, stop: vi.fn() } as never;
    harness.state.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: 1,
        currentStage: "planning",
        readiness: {},
        blockedReasons: [],
        latest: {
          companyGoal: {
            id: "goal-1",
            kind: "CompanyGoal",
            status: "confirmed",
            title: "提升岗位商城首批授权转化",
          },
        },
        counts: { goals: 1 },
        workBlocks: [],
      },
    };

    harness.render();

    const button = Array.from(harness.container.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent?.trim() === "生成经营拆解",
    );
    expect(button).toBeInstanceOf(HTMLButtonElement);
    expect(button?.disabled).toBe(false);
    button?.click();
    await flushPromises();

    expect(request).toHaveBeenCalledWith(
      "aics.mainFlow.management.workBlocks.create",
      expect.objectContaining({
        goalId: "goal-1",
        blocks: expect.arrayContaining([
          expect.objectContaining({ name: "岗位供给" }),
          expect.objectContaining({ name: "授权转化" }),
          expect.objectContaining({ name: "执行质量" }),
          expect.objectContaining({ name: "费用与审核" }),
        ]),
      }),
    );
    expect(request).toHaveBeenCalledWith("aics.mainFlow.readModel.get", {});
  });

  it("shows concrete category capability production todos only in the Tool and Skill page", () => {
    const container = document.createElement("div");
    const state = createState({
      tab: "skills",
      toolSupplyActiveSubpage: "skill",
      toolSupplySelectedCategoryId: null,
      toolSupplyCategoryDraftName: "",
      toolSupplySelectionDrafts: {},
      refreshToolSupplyControlReadModel: vi.fn(),
      runToolSkillReviewValidation: vi.fn(),
      runToolSkillDevelopmentValidation: vi.fn(),
      approveToolSkillReview: vi.fn(),
      toolSupplyControl: {
        loading: false,
        saving: false,
        error: null,
        message: null,
        readModel: {
          version: 1,
          updatedAt: 1,
          authority: "openclaw_local",
          metrics: {
            total: 1,
            localTools: 1,
            pluginTools: 0,
            skills: 0,
            apiConnections: 0,
            cloudCapabilities: 0,
            available: 0,
            blocked: 0,
            disabled: 0,
            pendingReview: 1,
            risks: 0,
          },
          localTools: [],
          skills: [],
          apiBindings: [],
          cloudCapabilities: [],
          categories: [],
          packages: [],
          risks: [],
          grants: [],
          bindings: [],
          uniqueCapabilityRequests: [],
          systemDevelopmentTodos: [
            {
              id: "tool-review-1",
              assetType: "tool",
              assetId: "tool.platform.marketplace_read_model",
              source: "system-analysis",
              sourceRolePackageId: "pkg-marketplace-ops",
              sourceListingDraftId: "draft-marketplace-ops",
              sourceRequestId: "role-capability:marketplace-ops",
              targetCategoryRef: "category:marketplace-ops@1",
              targetCategoryName: "商城运营",
              declaredCapabilities: ["marketplace.read"],
              requiredCapabilities: ["marketplace.read", "human.confirm"],
              toolRequirements: ["tool.platform.marketplace_read_model"],
              skillRequirements: ["skill.platform.marketplace_ops_diagnosis"],
              providerRequirements: ["provider.platform.model_chat_analysis"],
              humanConfirmationRules: ["包含 human.confirm 能力，执行前必须有人审确认。"],
              riskBoundaries: ["不自动上架", "不绕过审计账本"],
              acceptanceCriteria: ["工具可被本地 OpenClaw 读取", "正式品类激活时可被引用"],
              riskLevel: "低",
              reviewStatus: "待审核",
              reviewDecision: null,
              reviewFindings: [],
              nextAction: {
                label: "创建工具",
                reason: "品类能力申请需要商城读取工具。",
              },
            },
          ],
        },
      },
    } as Partial<AppViewState>);

    render(renderApp(state), container);
    const text = container.textContent ?? "";

    expect(text).toContain("品类能力制作待办");
    expect(text).toContain("具体 Tool、Skill、Provider/API 的开发、创建、安装和检查");
    expect(text).toContain("Tool/API · tool.platform.marketplace_read_model");
    expect(text).toContain("来源岗位：pkg-marketplace-ops");
    expect(text).toContain("申请：role-capability:marketplace-ops");
    expect(text).toContain("目标品类：商城运营");
    expect(text).toContain("Tool tool.platform.marketplace_read_model");
    expect(text).toContain("Skill skill.platform.marketplace_ops_diagnosis");
    expect(text).toContain("Provider/API provider.platform.model_chat_analysis");
    expect(text).toContain("人工确认：包含 human.confirm 能力");
    expect(text).toContain("风险边界：不自动上架；不绕过审计账本");
    expect(text).toContain("验收：工具可被本地 OpenClaw 读取；正式品类激活时可被引用");
    expect(text).toContain("回审核中心看品类状态");
    expect(text).not.toContain("系统开发待办");
    expect(text).not.toContain("去审核中心");
    const approveButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "通过审核",
    );
    expect(approveButton).toBeInstanceOf(HTMLButtonElement);
    expect(approveButton?.disabled).toBe(true);
    expect(approveButton?.title).toContain("请先点击检查");
    const checkButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "检查",
    );
    expect(checkButton).toBeInstanceOf(HTMLButtonElement);
    checkButton?.click();
    expect(state.runToolSkillDevelopmentValidation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "tool-review-1",
        assetType: "tool",
        assetId: "tool.platform.marketplace_read_model",
        declaredCapabilities: ["marketplace.read"],
      }),
    );
    expect(state.runToolSkillReviewValidation).not.toHaveBeenCalled();
  });

  it("returns role developers to the build flow after activating a ready category package", async () => {
    const activateToolSupplyCategoryCapabilityPackage = vi.fn(async () => {});
    const setTab = vi.fn();
    const container = document.createElement("div");
    const state = createState({
      tab: "skills",
      setTab,
      toolSupplyActiveSubpage: "skill",
      toolSupplySelectedCategoryId: null,
      toolSupplyCategoryDraftName: "",
      toolSupplySelectionDrafts: {},
      refreshToolSupplyControlReadModel: vi.fn(),
      runToolSkillDevelopmentValidation: vi.fn(),
      runToolSkillReviewValidation: vi.fn(),
      approveToolSkillReview: vi.fn(),
      activateToolSupplyCategoryCapabilityPackage,
      toolSupplyControl: {
        loading: false,
        saving: false,
        error: null,
        message: null,
        readModel: {
          version: 1,
          updatedAt: 1,
          authority: "openclaw_local",
          metrics: {
            total: 2,
            localTools: 1,
            pluginTools: 0,
            skills: 1,
            apiConnections: 0,
            cloudCapabilities: 0,
            available: 2,
            blocked: 0,
            disabled: 0,
            pendingReview: 0,
            risks: 0,
          },
          localTools: [],
          skills: [],
          apiBindings: [],
          cloudCapabilities: [],
          categories: [],
          packages: [],
          risks: [],
          grants: [],
          bindings: [],
          uniqueCapabilityRequests: [],
          systemDevelopmentTodos: [
            {
              id: "tool-review-1",
              assetType: "tool",
              assetId: "tool.platform.marketplace_read_model",
              source: "system-analysis",
              categoryCapabilityReviewId: "category-review-marketplace-ops",
              declaredCapabilities: ["marketplace.read"],
              riskLevel: "低",
              reviewStatus: "已通过",
              reviewDecision: "人工确认通过",
              reviewFindings: [],
              nextAction: { label: "已完成", reason: "工具已通过。" },
            },
            {
              id: "skill-review-1",
              assetType: "skill",
              assetId: "skill.platform.marketplace_ops_diagnosis",
              source: "system-analysis",
              categoryCapabilityReviewId: "category-review-marketplace-ops",
              declaredCapabilities: ["marketplace.read"],
              riskLevel: "低",
              reviewStatus: "已通过",
              reviewDecision: "人工确认通过",
              reviewFindings: [],
              nextAction: { label: "已完成", reason: "Skill 已通过。" },
            },
          ],
        },
      },
    } as Partial<AppViewState>);

    render(renderApp(state), container);
    const activateButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "激活并回岗位开发",
    );
    expect(activateButton).toBeInstanceOf(HTMLButtonElement);
    expect(activateButton?.disabled).toBe(false);

    activateButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(activateToolSupplyCategoryCapabilityPackage).toHaveBeenCalledWith(
      "category-review-marketplace-ops",
    );
    expect(setTab).toHaveBeenCalledWith("aics");
  });

  it("does not pretend plugin tool installation is a one-click in-page action", () => {
    const container = document.createElement("div");
    const state = createState({
      tab: "skills",
      toolSupplyActiveSubpage: "tool",
      toolSupplySelectedCategoryId: null,
      toolSupplyCategoryDraftName: "",
      toolSupplySelectionDrafts: {},
      refreshToolSupplyControlReadModel: vi.fn(),
      toolSupplyControl: {
        loading: false,
        saving: false,
        error: null,
        message: null,
        readModel: {
          version: 1,
          updatedAt: 1,
          authority: "openclaw_local",
          metrics: {
            total: 0,
            localTools: 0,
            pluginTools: 0,
            skills: 0,
            apiConnections: 0,
            cloudCapabilities: 0,
            available: 0,
            blocked: 0,
            disabled: 0,
            pendingReview: 0,
            risks: 0,
          },
          localTools: [],
          skills: [],
          apiBindings: [],
          cloudCapabilities: [],
          categories: [],
          packages: [],
          risks: [],
          grants: [],
          bindings: [],
          uniqueCapabilityRequests: [],
          systemDevelopmentTodos: [],
        },
      },
    } as Partial<AppViewState>);

    render(renderApp(state), container);
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent?.trim() === "安装插件工具",
    );
    expect(button).toBeInstanceOf(HTMLButtonElement);
    button?.click();
    render(renderApp(state), container);
    const text = container.textContent ?? "";

    expect(text).toContain("当前页面只管理已安装插件工具和内置工具权限");
    expect(text).toContain(
      "新增第三方插件工具需由系统开发者在本地完成安装或开发后，刷新这里检查能力包",
    );
    expect(text).not.toContain("插件工具安装入口待接入");
  });
});
