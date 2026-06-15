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
import { getWorkboardState } from "./controllers/workboard.ts";

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

beforeEach(async () => {
  await i18n.setLocale("en");
});

describe("renderApp business flow routing", () => {
  it("routes empty data analysis to the visible business overview entry", () => {
    const harness = createBusinessFlowRenderHarness("observation");
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
      },
    };

    harness.render();

    const text = expectPageText(harness.container);
    expect(text).toContain("暂无数据分析包");
    expect(text).toContain("先在「经营概览」发起经营意图");
    expect(text).toContain("去经营概览");
    expect(text).not.toContain("主对话中描述经营目标");

    const button = Array.from(harness.container.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent?.trim() === "去经营概览",
    );
    expect(button).toBeInstanceOf(HTMLButtonElement);
    button?.click();
    expect(harness.state.tab).toBe("businessOverview");
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
      (candidate) => candidate.textContent?.trim() === "发起经营意图",
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
      "role_supply",
      "authorization_conversion",
      "execution_quality",
      "cost_usage",
      "review_blockers",
      "initial_confidence",
    ]);
    expect(harness.state.tab).toBe("observation");
  });

  it("enables attribution generation when an observation package has signals", () => {
    const harness = createBusinessFlowRenderHarness("attribution");
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
      (candidate) => candidate.textContent?.trim() === "生成归因报告",
    );
    expect(button).toBeInstanceOf(HTMLButtonElement);
    expect(button?.disabled).toBe(false);
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
      (candidate) => candidate.textContent?.trim() === "生成归因报告",
    );
    expect(button).toBeInstanceOf(HTMLButtonElement);
    button?.click();
    await flushPromises();

    expect(request).toHaveBeenCalledWith(
      "aics.mainFlow.attribution.prepare",
      expect.objectContaining({
        findings: [
          expect.objectContaining({
            title: "归因线索：经营意图",
            observationSignalIds: ["business_intent"],
          }),
        ],
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
    expect(text).toContain("确认归因报告");
    expect(text).toContain("要求补数据");
    expect(text).toContain("驳回归因报告");
  });

  it("renders the company goal page without the old strategy target explainer", () => {
    const harness = createBusinessFlowRenderHarness("goals");

    harness.render();

    const text = expectPageText(harness.container);
    expect(text).toContain("目标管理");
    expect(text).not.toContain("策略性目标层");
    expect(text).not.toContain("输入依据");
    expect(text).not.toContain("博弈策略");
    expect(text).not.toContain("经营目标");
    expect(text).not.toContain("管理目标");
    expect(text).not.toContain("约束规则");
    expect(text).not.toContain("执行岗位");
    expect(text).not.toContain("派任务");
  });

  it("enables the goal candidate submit button after required fields are filled", () => {
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
    ).find((candidate) => candidate.textContent?.trim() === "+ 创建候选目标");
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

  it("keeps the project board read-only for dispatch creation", () => {
    const harness = createBusinessFlowRenderHarness("projects");

    harness.render();
    const shell = expectMainSystemShell(harness.container);

    clickMainSystemItemAction(shell, "重点客户交付项目");

    expect(harness.state.tab).toBe("projects");
    expect(harness.state.businessFlow.selectedProjectId).toBe("project-key-account-delivery");
    const workboardState = getWorkboardState(harness.state);
    expect(workboardState.draftOpen).toBe(false);
    const text = shell.textContent ?? "";
    expect(text).not.toContain("派任务");
    expect(text).not.toContain("执行岗位");
    expect(text).not.toContain("项目到岗位任务");
    expect(text).not.toContain("能力预检");
  });

  it("renders project milestones, risks, and dispatch-linked feedback", () => {
    const harness = createBusinessFlowRenderHarness("projects");
    const workboardState = getWorkboardState(harness.state);
    workboardState.loaded = true;
    workboardState.cards = [
      {
        id: "card-1",
        title: "渠道增长项目关联记录",
        status: "review",
        priority: "normal",
        labels: [],
        position: 1000,
        createdAt: 1,
        updatedAt: 1,
        metadata: {
          businessFlow: {
            cadenceId: "quarter",
            projectId: "project-channel-growth",
            goalIds: ["goal-annual-revenue", "goal-quarter-growth"],
            departmentId: "dept-project",
            source: "planning",
          },
        },
      },
    ];

    harness.render();

    const shell = expectMainSystemShell(harness.container);
    const text = shell.textContent ?? "";
    expect(text).toContain("项目里程碑");
    expect(text).toContain("项目风险与确认");
    expect(text).toContain("任务关联记录");
    expect(text).toContain("1 条记录");
    expect(text).toContain("渠道线索质量不稳定");
    expect(text).not.toContain("能力预检");
    expect(text).not.toContain("执行岗位");
  });

  it("keeps company management focused on operating structure instead of system plumbing", () => {
    const harness = createBusinessFlowRenderHarness("company");

    harness.render();

    const text = expectPageText(harness.container);
    expect(text).toContain("公司管理看板");
    expect(text).toContain("工作块");
    expect(text).toContain("承接岗位");
    expect(text).toContain("任务状态");
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

  it("shows main-flow role execution controls before the legacy role queue loads", () => {
    const harness = createBusinessFlowRenderHarness("aics");
    harness.state.myRoles = {
      loading: false,
      runningExecutionId: null,
      error: null,
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
    expect(text).toContain("主流程岗位执行");
    expect(text).toContain("确认执行");
    expect(text).toContain("确认费用");
    expect(text).toContain("运行已授权任务");
    expect(text).toContain("岗位执行控制台尚未加载");
    expect(text).toContain("authorization_required");

    const runButton = Array.from(
      harness.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.textContent?.trim() === "运行已授权任务");
    expect(runButton).toBeInstanceOf(HTMLButtonElement);
    expect(runButton?.disabled).toBe(true);
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
});
