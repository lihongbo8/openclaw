import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { PROTOCOL_VERSION } from "../../../packages/gateway-protocol/src/version.js";
import { CONTROL_UI_BOOTSTRAP_CONFIG_PATH } from "../../../src/gateway/control-ui-contract.js";
import {
  controlUiBrowserOnlySharedModuleAliases,
  resolveSourcePackageAliasesForVite,
  resolveTsconfigPathAliasesForVite,
} from "../../vite.config.ts";

const require = createRequire(import.meta.url);
const json5EsmPath = require.resolve("json5/dist/index.mjs");
const commonJsOptimizeDeps = [
  "highlight.js/lib/core",
  "highlight.js/lib/languages/bash",
  "highlight.js/lib/languages/cpp",
  "highlight.js/lib/languages/css",
  "highlight.js/lib/languages/diff",
  "highlight.js/lib/languages/go",
  "highlight.js/lib/languages/java",
  "highlight.js/lib/languages/javascript",
  "highlight.js/lib/languages/json",
  "highlight.js/lib/languages/markdown",
  "highlight.js/lib/languages/python",
  "highlight.js/lib/languages/rust",
  "highlight.js/lib/languages/typescript",
  "highlight.js/lib/languages/xml",
  "highlight.js/lib/languages/yaml",
] as const;

export type MockGatewayRequest = {
  id: string;
  method: string;
  params?: unknown;
};

export type ControlUiMockGatewayScenario = {
  assistantAgentId?: string;
  assistantName?: string;
  defaultAgentId?: string;
  deferredMethods?: string[];
  historyMessages?: unknown[];
  methodResponses?: Record<string, unknown>;
  models?: Array<{ id: string; name: string; provider: string }>;
  sessionKey?: string;
};

export type ControlUiMockGatewayMethodResponseCase = {
  match?: Record<string, unknown>;
  response: unknown;
};

export type ControlUiMockGatewayMethodResponseCases = {
  cases: ControlUiMockGatewayMethodResponseCase[];
};

type NormalizedControlUiMockGatewayScenario = Required<ControlUiMockGatewayScenario>;

export type ControlUiE2eServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

export type MockGatewayControls = {
  closeLatest: (code?: number, reason?: string) => Promise<void>;
  deferNext: (method: string) => Promise<void>;
  emitChatFinal: (params: { runId: string; sessionKey?: string; text: string }) => Promise<void>;
  emitGatewayEvent: (event: string, payload?: unknown) => Promise<void>;
  getRequests: (method?: string) => Promise<MockGatewayRequest[]>;
  getSocketCount: () => Promise<number>;
  rejectDeferred: (
    method: string,
    error?: { code?: string; message?: string; details?: unknown; retryable?: boolean },
  ) => Promise<void>;
  resolveDeferred: (method: string, payload?: unknown) => Promise<void>;
  setHistoryMessages: (messages: unknown[]) => Promise<void>;
  waitForRequest: (method: string) => Promise<MockGatewayRequest>;
};

const chromiumExecutableOverrideEnvKey = "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH";
const systemChromiumExecutableCandidates = [
  "/snap/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
] as const;

function resolveRepoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../..");
}

export function resolvePlaywrightChromiumExecutablePath(
  defaultExecutablePath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const executableOverride = env[chromiumExecutableOverrideEnvKey]?.trim();
  if (executableOverride) {
    return executableOverride;
  }
  if (existsSync(defaultExecutablePath)) {
    return defaultExecutablePath;
  }
  return (
    systemChromiumExecutableCandidates.find((candidate) => existsSync(candidate)) ??
    defaultExecutablePath
  );
}

export function canRunPlaywrightChromium(chromiumExecutablePath: string): boolean {
  return existsSync(chromiumExecutablePath);
}

export async function startControlUiE2eServer(): Promise<ControlUiE2eServer> {
  const repoRoot = resolveRepoRoot();
  const uiRoot = path.join(repoRoot, "ui");
  const port = await resolveAvailableLoopbackPort();
  const server = await createServer({
    base: "/",
    cacheDir: path.join(repoRoot, ".artifacts", "control-ui-e2e-vite"),
    clearScreen: false,
    configFile: false,
    define: {
      OPENCLAW_CONTROL_UI_BUILD_ID: JSON.stringify("e2e"),
    },
    logLevel: "error",
    optimizeDeps: {
      include: [
        "ipaddr.js",
        "lit/directives/repeat.js",
        "markdown-it-task-lists",
        ...commonJsOptimizeDeps,
      ],
    },
    publicDir: path.join(uiRoot, "public"),
    plugins: [controlUiBrowserOnlySharedModuleAliases()],
    resolve: {
      alias: [
        { find: "json5", replacement: json5EsmPath },
        ...resolveSourcePackageAliasesForVite(),
        ...resolveTsconfigPathAliasesForVite(),
      ],
    },
    root: uiRoot,
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
    },
  });
  await server.listen(port);
  return {
    baseUrl: resolveServerBaseUrl(server),
    close: () => server.close(),
  };
}

async function resolveAvailableLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close(() => reject(new Error("Could not reserve a loopback port")));
        return;
      }
      probe.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

function resolveServerBaseUrl(server: ViteDevServer): string {
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") {
    throw new Error("Control UI E2E server did not expose a TCP port");
  }
  return `http://127.0.0.1:${address.port}/`;
}

function normalizeScenario(
  scenario: ControlUiMockGatewayScenario,
): NormalizedControlUiMockGatewayScenario {
  const defaultAgentId = scenario.defaultAgentId?.trim() || "main";
  const sessionKey = scenario.sessionKey?.trim() || "main";
  return {
    assistantAgentId: scenario.assistantAgentId?.trim() || defaultAgentId,
    assistantName: scenario.assistantName?.trim() || "OpenClaw",
    defaultAgentId,
    deferredMethods: scenario.deferredMethods ?? [],
    historyMessages: scenario.historyMessages ?? [],
    methodResponses: scenario.methodResponses ?? {},
    models: scenario.models ?? [{ id: "gpt-5.5", name: "gpt-5.5", provider: "openai" }],
    sessionKey,
  };
}

export function createControlUiMockBootstrapConfig(scenario: ControlUiMockGatewayScenario = {}) {
  const normalizedScenario = normalizeScenario(scenario);
  return {
    allowExternalEmbedUrls: false,
    assistantAgentId: normalizedScenario.assistantAgentId,
    assistantAvatar: "",
    assistantName: normalizedScenario.assistantName,
    basePath: "/",
    embedSandbox: "scripts",
    localMediaPreviewRoots: [],
    serverVersion: "e2e",
  };
}

export function createControlUiMockGatewayInitScript(
  scenario: ControlUiMockGatewayScenario = {},
): string {
  const input = {
    protocolVersion: PROTOCOL_VERSION,
    scenario: normalizeScenario(scenario),
  };
  return `(() => { const __name = (target) => target; (${installControlUiMockGateway.toString()})(${JSON.stringify(input)}); })();`;
}

function installControlUiMockGateway(input: {
  protocolVersion: number;
  scenario: NormalizedControlUiMockGatewayScenario;
}) {
  type BrowserRequest = { id: string; method: string; params?: unknown };
  type BrowserFrame = {
    id?: unknown;
    method?: unknown;
    params?: unknown;
    type?: unknown;
  };
  type BrowserScenario = NormalizedControlUiMockGatewayScenario;
  type BrowserMethodResponseCase = {
    match?: Record<string, unknown>;
    response?: unknown;
  };
  type BrowserMethodResponseCases = {
    cases?: BrowserMethodResponseCase[];
  };
  type DeferredResponse = {
    id: string;
    method: string;
    params?: unknown;
    socket: { deliver: (frame: unknown) => void };
  };
  type MainFlowEntity = {
    auditRefs: unknown[];
    createdAt: number;
    id: string;
    kind: string;
    status: string;
    updatedAt: number;
  };
  type MainFlowInteraction = MainFlowEntity & {
    kind: "Interaction";
    message: string;
    proposedNextAction?: string;
    stage: string;
  };
  type MainFlowObservation = MainFlowEntity & {
    kind: "ObservationPackage";
    signals: Array<Record<string, unknown>>;
    summary: string;
    title: string;
  };
  type MainFlowAttribution = MainFlowEntity & {
    findings: Array<Record<string, unknown>>;
    kind: "AttributionReport";
    observationPackageId: string;
    summary: string;
    title: string;
  };
  type MainFlowGoal = MainFlowEntity & {
    kind: "CompanyGoal";
    attributionReportId: string;
    observationPackageId?: string;
    owner: string;
    metric: string;
    target: string;
    rationale: string;
    title: string;
  };
  type MainFlowPlanning = MainFlowEntity & {
    kind: "PlanningPackage";
    goalId: string;
    title: string;
    summary: string;
    rolePlanItemIds: string[];
    revision: number;
  };
  type MainFlowRolePlanItem = MainFlowEntity & {
    kind: "RolePlanItem";
    planningPackageId: string;
    title: string;
    category?: string;
    roleCapabilityRef: string;
    taskIntent: string;
    expectedOutput: string;
    humanConfirmationRequired: boolean;
    dispatchStatus?: string;
    acceptanceCriteria?: string[];
    capabilityMatchSummary?: string;
  };
  type MainFlowDispatchProposal = MainFlowEntity & {
    kind: "DispatchProposalReview";
    planningPackageId: string;
    rolePlanItemId: string;
    title: string;
    riskSummary: string;
    confirmationSummary: string;
  };
  type MainFlowTaskPackage = MainFlowEntity & {
    kind: "TaskPackage";
    goalId: string;
    planningPackageId: string;
    rolePlanItemId: string;
    dispatchProposalReviewId: string;
    title: string;
    taskText: string;
  };
  type MainFlowDispatchToRoleRequest = MainFlowEntity & {
    kind: "DispatchToRoleRequest";
    taskPackageId: string;
    rolePlanItemId: string;
    roleTitle?: string;
    roleListingId?: string;
    entitlementId?: string;
    confirmExecution?: boolean;
    costConfirmed?: boolean;
    ledgerRef?: string;
    toolSkillReady?: boolean;
    apiBindingReady?: boolean;
  };
  type MainFlowRoleResult = MainFlowEntity & {
    kind: "RoleResult";
    taskPackageId: string;
    dispatchToRoleRequestId: string;
    outcome: "succeeded" | "failed" | "blocked";
    summary: string;
    artifactRefs: string[];
    executionEvidence: Record<string, unknown>;
  };
  type MainFlowMockState = {
    attributions: MainFlowAttribution[];
    dispatchProposalReviews: MainFlowDispatchProposal[];
    dispatchToRoleRequests: MainFlowDispatchToRoleRequest[];
    goals: MainFlowGoal[];
    interactions: MainFlowInteraction[];
    observations: MainFlowObservation[];
    planningPackages: MainFlowPlanning[];
    rolePlanItems: MainFlowRolePlanItem[];
    roleResults: MainFlowRoleResult[];
    taskPackages: MainFlowTaskPackage[];
  };
  type ExposedGateway = {
    closeLatest: (code?: number, reason?: string) => void;
    deferNext: (method: string) => void;
    emit: (event: string, payload?: unknown) => void;
    findRequests: (method?: string) => BrowserRequest[];
    rejectDeferred: (
      method: string,
      error?: { code?: string; message?: string; details?: unknown; retryable?: boolean },
    ) => void;
    requests: BrowserRequest[];
    resolveDeferred: (method: string, payload?: unknown) => void;
    setHistoryMessages: (messages: unknown[]) => void;
    socketCount: () => number;
  };
  type WindowWithGateway = Window & {
    openclawControlUiE2eGateway?: ExposedGateway;
  };

  const scenario: BrowserScenario = input.scenario;
  const protocolVersion = input.protocolVersion;
  const deferredMethods: string[] = [...scenario.deferredMethods];
  const deferredResponses: DeferredResponse[] = [];
  const requests: BrowserRequest[] = [];
  const sockets: unknown[] = [];
  const mainFlowState: MainFlowMockState = {
    attributions: [],
    dispatchProposalReviews: [],
    dispatchToRoleRequests: [],
    goals: [],
    interactions: [],
    observations: [],
    planningPackages: [],
    rolePlanItems: [],
    roleResults: [],
    taskPackages: [],
  };
  let seq = 0;

  function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function hasOwn(record: Record<string, unknown>, key: string): boolean {
    return Object.hasOwn(record, key);
  }

  function valuesEqual(actual: unknown, expected: unknown): boolean {
    if (Object.is(actual, expected)) {
      return true;
    }
    if ((actual && typeof actual === "object") || (expected && typeof expected === "object")) {
      try {
        return JSON.stringify(actual) === JSON.stringify(expected);
      } catch {
        return false;
      }
    }
    return false;
  }

  function paramsMatch(params: unknown, match: Record<string, unknown> | undefined): boolean {
    if (!match) {
      return true;
    }
    const entries = Object.entries(match);
    if (entries.length === 0) {
      return true;
    }
    if (!isRecord(params)) {
      return false;
    }
    return entries.every(
      ([key, expected]) => hasOwn(params, key) && valuesEqual(params[key], expected),
    );
  }

  function responseCases(value: unknown): BrowserMethodResponseCase[] | null {
    if (!isRecord(value)) {
      return null;
    }
    const maybeCases = (value as BrowserMethodResponseCases).cases;
    return Array.isArray(maybeCases) ? maybeCases : null;
  }

  function configuredResponse(
    method: string,
    params: unknown,
  ): { found: boolean; value?: unknown } {
    if (!hasOwn(scenario.methodResponses, method)) {
      return { found: false };
    }
    const configured = scenario.methodResponses[method];
    const cases = responseCases(configured);
    if (!cases) {
      return { found: true, value: configured };
    }
    const matchingCase = cases.find((candidate) => paramsMatch(params, candidate.match));
    if (!matchingCase) {
      return { found: false };
    }
    return { found: true, value: matchingCase.response };
  }

  function sessionRow() {
    return {
      contextTokens: null,
      displayName: "Main",
      hasActiveRun: false,
      key: scenario.sessionKey,
      kind: "direct",
      label: "Main",
      model: "gpt-5.5",
      modelProvider: "openai",
      status: "done",
      totalTokens: 0,
      updatedAt: Date.now(),
    };
  }

  function makeEntityBase(kind: string, prefix: string, status = "prepared"): MainFlowEntity {
    const now = Date.now();
    return {
      auditRefs: [{ createdAt: now, id: `audit_${seq + 1}`, kind: "system", label: "mock" }],
      createdAt: now,
      id: `${prefix}_${mainFlowState.interactions.length + mainFlowState.observations.length + 1}`,
      kind,
      status,
      updatedAt: now,
    };
  }

  function latestByCreatedAt<T extends { createdAt: number }>(items: T[]): T | null {
    return items.length
      ? ([...items].sort((left, right) => right.createdAt - left.createdAt)[0] ?? null)
      : null;
  }

  function latestObservationReady(): boolean {
    const observation = latestByCreatedAt(mainFlowState.observations);
    return Boolean(
      observation && observation.status === "confirmed" && observation.signals.length > 0,
    );
  }

  function latestAttributionReady(): boolean {
    const attribution = latestByCreatedAt(mainFlowState.attributions);
    return Boolean(
      attribution && attribution.status === "confirmed" && attribution.findings.length > 0,
    );
  }

  function latestConfirmedGoal(): MainFlowGoal | null {
    return latestByCreatedAt(mainFlowState.goals.filter((goal) => goal.status === "confirmed"));
  }

  function latestConfirmedPlanning(): MainFlowPlanning | null {
    return latestByCreatedAt(
      mainFlowState.planningPackages.filter((planning) => planning.status === "confirmed"),
    );
  }

  function buildMainFlowReadModel() {
    const observationReady = latestObservationReady();
    const attributionReady = latestAttributionReady();
    const blockedReasons = [
      ...(observationReady
        ? []
        : [
            {
              stage: "observation",
              code: "missing_observation_package",
              message: "ObservationPackage is required before attribution.",
            },
          ]),
      ...(attributionReady
        ? []
        : [
            {
              stage: "attribution",
              code: "missing_attribution_report",
              message: "AttributionReport is required before creating goal rationale.",
            },
          ]),
      ...(latestConfirmedGoal()
        ? []
        : [
            {
              stage: "goal",
              code: "missing_confirmed_company_goal",
              message: "A user-confirmed CompanyGoal is required before planning.",
            },
          ]),
      ...(latestConfirmedPlanning()
        ? []
        : [
            {
              stage: "planning",
              code: "missing_confirmed_planning_package",
              message:
                "A confirmed PlanningPackage with RolePlanItem entries is required before dispatch.",
            },
          ]),
      {
        stage: "dispatch",
        code: "missing_confirmed_dispatch_proposal",
        message:
          "A confirmed DispatchProposalReview is required before materializing a task package.",
      },
      {
        stage: "dispatch",
        code: "missing_task_package",
        message: "TaskPackage is required before role execution.",
      },
      {
        stage: "dispatch",
        code: "missing_dispatch_to_role_request",
        message: "DispatchToRoleRequest is required before role execution.",
      },
    ];
    return {
      version: 1,
      updatedAt: Date.now(),
      currentStage: blockedReasons[0]?.stage ?? "role",
      readiness: {
        canPrepareAttribution: observationReady,
        canCreateGoalCandidate: attributionReady,
        canPreparePlanning: Boolean(latestConfirmedGoal()),
        canCreateDispatchProposal: Boolean(latestConfirmedPlanning()),
        canMaterializeTaskPackage: mainFlowState.dispatchProposalReviews.some(
          (proposal) => proposal.status === "confirmed",
        ),
        canEnterRoleExecution: mainFlowState.dispatchToRoleRequests.length > 0,
        canRunApprovedTask: mainFlowState.dispatchToRoleRequests.some(
          (request) => request.confirmExecution === true && request.costConfirmed === true,
        ),
      },
      executionPreflight: {
        canRun: mainFlowState.dispatchToRoleRequests.some(
          (request) => request.confirmExecution === true && request.costConfirmed === true,
        ),
        blockedReasons: [],
      },
      blockedReasons,
      latest: {
        interaction: latestByCreatedAt(mainFlowState.interactions),
        observationPackage: latestByCreatedAt(mainFlowState.observations),
        attributionReport: latestByCreatedAt(mainFlowState.attributions),
        companyGoal: latestByCreatedAt(mainFlowState.goals),
        planningPackage: latestByCreatedAt(mainFlowState.planningPackages),
        rolePlanItem: latestByCreatedAt(mainFlowState.rolePlanItems),
        dispatchProposalReview: latestByCreatedAt(mainFlowState.dispatchProposalReviews),
        taskPackage: latestByCreatedAt(mainFlowState.taskPackages),
        dispatchToRoleRequest: latestByCreatedAt(mainFlowState.dispatchToRoleRequests),
        roleResult: latestByCreatedAt(mainFlowState.roleResults),
      },
      counts: {
        interactions: mainFlowState.interactions.length,
        observations: mainFlowState.observations.length,
        attributions: mainFlowState.attributions.length,
        goals: mainFlowState.goals.length,
        planningPackages: mainFlowState.planningPackages.length,
        rolePlanItems: mainFlowState.rolePlanItems.length,
        dispatchProposalReviews: mainFlowState.dispatchProposalReviews.length,
        taskPackages: mainFlowState.taskPackages.length,
        dispatchToRoleRequests: mainFlowState.dispatchToRoleRequests.length,
        roleResults: mainFlowState.roleResults.length,
      },
      objects: {
        interactions: mainFlowState.interactions,
        observations: mainFlowState.observations,
        attributions: mainFlowState.attributions,
        goals: mainFlowState.goals,
        planningPackages: mainFlowState.planningPackages,
        rolePlanItems: mainFlowState.rolePlanItems,
        dispatchProposalReviews: mainFlowState.dispatchProposalReviews,
        taskPackages: mainFlowState.taskPackages,
        dispatchToRoleRequests: mainFlowState.dispatchToRoleRequests,
        roleResults: mainFlowState.roleResults,
      },
      workBlocks: [],
      workBlockRoles: [],
      workBlockTaskCandidates: [],
      capabilities: {
        categoryCommon: [],
        uniqueRequests: [],
        approved: [],
        blocked: [],
      },
    };
  }

  function createMainFlowInteraction(params: unknown): MainFlowInteraction {
    const record = isRecord(params) ? params : {};
    const base = makeEntityBase("Interaction", "interaction");
    const interaction: MainFlowInteraction = {
      ...base,
      kind: "Interaction",
      stage: typeof record.stage === "string" ? record.stage : "observation",
      message: typeof record.message === "string" ? record.message : "",
      ...(typeof record.proposedNextAction === "string"
        ? { proposedNextAction: record.proposedNextAction }
        : {}),
    };
    mainFlowState.interactions.push(interaction);
    return interaction;
  }

  function prepareMainFlowObservation(params: unknown): MainFlowObservation {
    const record = isRecord(params) ? params : {};
    const signals = Array.isArray(record.signals)
      ? record.signals.filter(isRecord).map((signal) => ({ ...signal }))
      : [];
    const base = makeEntityBase("ObservationPackage", "obs_pkg");
    const observation: MainFlowObservation = {
      ...base,
      kind: "ObservationPackage",
      title: typeof record.title === "string" ? record.title : "经营意图初始观察包",
      summary: typeof record.summary === "string" ? record.summary : "",
      signals,
    };
    mainFlowState.observations.push(observation);
    return observation;
  }

  function collectMainFlowObservation(params: unknown): {
    observationPackage: MainFlowObservation;
  } {
    const record = isRecord(params) ? params : {};
    const observation = prepareMainFlowObservation({
      title: typeof record.title === "string" ? record.title : "当前账号真实数据分析包",
      summary: "从本地主流程 read model 采集到的真实观察事实。",
      signals: [
        {
          id: "local-main-flow-stage",
          title: "当前主流程阶段",
          summary: "本地主流程 read model 已返回当前阶段、阻塞项和下一步动作。",
          evidenceRefs: ["aics-local-read-model"],
        },
      ],
    });
    return { observationPackage: observation };
  }

  function prepareMainFlowAttribution(params: unknown): MainFlowAttribution {
    const record = isRecord(params) ? params : {};
    const findings = Array.isArray(record.findings)
      ? record.findings.filter(isRecord).map((finding) => ({ ...finding }))
      : [];
    const observationPackageId =
      typeof record.observationPackageId === "string"
        ? record.observationPackageId
        : (latestByCreatedAt(mainFlowState.observations)?.id ?? "obs_pkg_latest");
    const base = makeEntityBase("AttributionReport", "attr_report");
    const attribution: MainFlowAttribution = {
      ...base,
      findings,
      kind: "AttributionReport",
      observationPackageId,
      title: typeof record.title === "string" ? record.title : "上一轮目标归因报告",
      summary: typeof record.summary === "string" ? record.summary : "",
    };
    mainFlowState.attributions.push(attribution);
    return attribution;
  }

  function generateMainFlowAttributionFromLatest(): { attribution: MainFlowAttribution } {
    const observation = latestByCreatedAt(mainFlowState.observations);
    const signals =
      observation?.signals?.filter(
        (signal) => Array.isArray(signal.evidenceRefs) && signal.evidenceRefs.length > 0,
      ) ?? [];
    const attribution = prepareMainFlowAttribution({
      observationPackageId: observation?.id,
      title: "归因报告",
      summary: signals.length
        ? `基于 ${signals.length} 条已确认观察证据生成归因候选。`
        : "观察证据不足，需要补充真实经营数据。",
      findings: signals.slice(0, 3).map((signal, index) => ({
        id: `finding-${index + 1}`,
        title: signal.title,
        summary: signal.summary,
        confidence: "medium",
        observationSignalIds: [signal.id],
      })),
    });
    return { attribution };
  }

  function createMainFlowGoal(params: unknown = {}): MainFlowGoal {
    const record = isRecord(params) ? params : {};
    const attribution = latestByCreatedAt(mainFlowState.attributions);
    const observation = latestByCreatedAt(mainFlowState.observations);
    const base = makeEntityBase("CompanyGoal", "goal", "candidate");
    const goal: MainFlowGoal = {
      ...base,
      kind: "CompanyGoal",
      attributionReportId:
        typeof record.attributionReportId === "string"
          ? record.attributionReportId
          : (attribution?.id ?? "attr_latest"),
      ...(observation?.id ? { observationPackageId: observation.id } : {}),
      owner: typeof record.owner === "string" ? record.owner : "迭界AI",
      metric: typeof record.metric === "string" ? record.metric : "首批岗位授权转化与执行成功率",
      target: typeof record.target === "string" ? record.target : "首批岗位可授权、可执行、可回写",
      rationale:
        typeof record.rationale === "string"
          ? record.rationale
          : `基于归因报告 ${attribution?.title ?? "归因报告"} 生成的目标候选。`,
      title:
        typeof record.title === "string"
          ? record.title
          : "提升岗位商城首批岗位授权转化与执行成功率",
    };
    mainFlowState.goals.push(goal);
    return goal;
  }

  function updateMainFlowGoal(params: unknown, status: "confirmed"): MainFlowGoal {
    const record = isRecord(params) ? params : {};
    const goalId = typeof record.goalId === "string" ? record.goalId : undefined;
    const goal =
      mainFlowState.goals.find((item) => item.id === goalId) ??
      latestByCreatedAt(mainFlowState.goals);
    if (!goal) return createMainFlowGoal({ status });
    goal.status = status;
    goal.updatedAt = Date.now();
    return goal;
  }

  function generateMainFlowPlanning(params: unknown = {}): { planning: MainFlowPlanning } {
    const record = isRecord(params) ? params : {};
    const goal =
      latestConfirmedGoal() ?? latestByCreatedAt(mainFlowState.goals) ?? createMainFlowGoal();
    const revision =
      mainFlowState.planningPackages.filter((planning) => planning.goalId === goal.id).length + 1;
    const base = makeEntityBase("PlanningPackage", "planning_pkg", "prepared");
    const planning: MainFlowPlanning = {
      ...base,
      kind: "PlanningPackage",
      goalId: goal.id,
      title: `规划方案：${goal.title}`,
      summary: `基于目标 "${goal.metric} = ${goal.target}" 生成岗位工作项。`,
      rolePlanItemIds: [],
      revision,
    };
    const items: MainFlowRolePlanItem[] = [
      {
        ...makeEntityBase("RolePlanItem", "role_plan_item", "prepared"),
        kind: "RolePlanItem",
        planningPackageId: planning.id,
        title: "岗位供给与审核优化",
        category: "岗位商城",
        roleCapabilityRef: "marketplace-operations",
        taskIntent: "梳理岗位商品供给、审核状态、能力标签和上架阻塞。",
        expectedOutput: "岗位供给清单、审核阻塞和补齐建议。",
        humanConfirmationRequired: false,
        dispatchStatus: "not_dispatched",
        acceptanceCriteria: ["输入来源可追溯", "输出可进入调度层"],
        capabilityMatchSummary: "商城运营与审核能力。",
      },
      {
        ...makeEntityBase("RolePlanItem", "role_plan_item", "prepared"),
        kind: "RolePlanItem",
        planningPackageId: planning.id,
        title: "API 与模型连接治理",
        category: "岗位商城",
        roleCapabilityRef: "api-connection-ops",
        taskIntent: "核对模型 Provider、工具 API、Skill 依赖和 SecretRef。",
        expectedOutput: "系统使用连通性检查表和修复顺序。",
        humanConfirmationRequired: true,
        dispatchStatus: "not_dispatched",
        acceptanceCriteria: ["缺 SecretRef 能定位", "不在规划层执行岗位"],
        capabilityMatchSummary: "API 管理与能力路由能力。",
      },
    ];
    planning.rolePlanItemIds = items.map((item) => item.id);
    if (record.mode === "regenerate") {
      for (const previous of mainFlowState.planningPackages.filter(
        (item) => item.goalId === goal.id,
      )) {
        previous.status = "cancelled";
      }
    }
    mainFlowState.planningPackages.push(planning);
    mainFlowState.rolePlanItems.push(...items);
    return { planning };
  }

  function updateMainFlowPlanning(params: unknown, status: "confirmed"): MainFlowPlanning {
    const record = isRecord(params) ? params : {};
    const planningId =
      typeof record.planningPackageId === "string" ? record.planningPackageId : undefined;
    const planning =
      mainFlowState.planningPackages.find((item) => item.id === planningId) ??
      latestByCreatedAt(mainFlowState.planningPackages);
    if (!planning) return generateMainFlowPlanning().planning;
    planning.status = status;
    planning.updatedAt = Date.now();
    for (const item of mainFlowState.rolePlanItems.filter(
      (entry) => entry.planningPackageId === planning.id,
    )) {
      item.status = status;
      item.updatedAt = planning.updatedAt;
    }
    return planning;
  }

  function checkAndCreateMainFlowDispatchQueue(params: unknown = {}) {
    const record = isRecord(params) ? params : {};
    const planning =
      (typeof record.planningPackageId === "string"
        ? mainFlowState.planningPackages.find((item) => item.id === record.planningPackageId)
        : latestConfirmedPlanning()) ?? latestByCreatedAt(mainFlowState.planningPackages);
    if (!planning) return { materialized: [] };
    const rolePlanItems = mainFlowState.rolePlanItems.filter(
      (item) =>
        item.planningPackageId === planning.id &&
        item.status === "confirmed" &&
        item.dispatchStatus !== "dispatched" &&
        (typeof record.rolePlanItemId !== "string" || item.id === record.rolePlanItemId),
    );
    const materialized: Array<{
      taskPackage: MainFlowTaskPackage;
      dispatchToRoleRequest: MainFlowDispatchToRoleRequest;
    }> = [];
    for (const item of rolePlanItems) {
      const proposalBase = makeEntityBase("DispatchProposalReview", "dispatch_review", "confirmed");
      const proposal: MainFlowDispatchProposal = {
        ...proposalBase,
        kind: "DispatchProposalReview",
        planningPackageId: planning.id,
        rolePlanItemId: item.id,
        title: `调度建议：${item.title}`,
        riskSummary: "LOW: 可进入岗位执行前确认。",
        confirmationSummary: "确认后生成派发单和执行队列。",
      };
      const taskBase = makeEntityBase("TaskPackage", "task_pkg", "materialized");
      const taskPackage: MainFlowTaskPackage = {
        ...taskBase,
        kind: "TaskPackage",
        goalId: planning.goalId,
        planningPackageId: planning.id,
        rolePlanItemId: item.id,
        dispatchProposalReviewId: proposal.id,
        title: `任务：${item.title}`,
        taskText: `${item.taskIntent}；输出：${item.expectedOutput}`,
      };
      const requestBase = makeEntityBase("DispatchToRoleRequest", "dispatch_role_req", "ready");
      const dispatchToRoleRequest: MainFlowDispatchToRoleRequest = {
        ...requestBase,
        kind: "DispatchToRoleRequest",
        taskPackageId: taskPackage.id,
        rolePlanItemId: item.id,
        roleTitle: item.title,
        toolSkillReady: true,
        apiBindingReady: true,
      };
      item.dispatchStatus = "dispatched";
      mainFlowState.dispatchProposalReviews.push(proposal);
      mainFlowState.taskPackages.push(taskPackage);
      mainFlowState.dispatchToRoleRequests.push(dispatchToRoleRequest);
      materialized.push({ taskPackage, dispatchToRoleRequest });
    }
    return { materialized };
  }

  function confirmAndRunMainFlowExecution(params: unknown) {
    const record = isRecord(params) ? params : {};
    const requestId =
      typeof record.dispatchToRoleRequestId === "string" ? record.dispatchToRoleRequestId : "";
    const request =
      mainFlowState.dispatchToRoleRequests.find((item) => item.id === requestId) ??
      latestByCreatedAt(mainFlowState.dispatchToRoleRequests);
    if (!request) throw new Error("No mock DispatchToRoleRequest exists.");
    const task = mainFlowState.taskPackages.find((item) => item.id === request.taskPackageId);
    if (!task) throw new Error("No mock TaskPackage exists.");
    request.roleListingId =
      typeof record.roleListingId === "string" ? record.roleListingId : "marketplace-ops-role";
    request.entitlementId =
      typeof record.entitlementId === "string" ? record.entitlementId : "entitlement-local";
    request.ledgerRef =
      typeof record.ledgerRef === "string"
        ? record.ledgerRef
        : `ledger:role_execution:${request.entitlementId}`;
    request.confirmExecution = true;
    request.costConfirmed = true;
    request.status = "completed";
    request.updatedAt = Date.now();
    task.status = "completed";
    task.updatedAt = Date.now();
    const executionId = `execution_${seq++}`;
    const auditRecordId = `audit_${executionId}`;
    const roleResult: MainFlowRoleResult = {
      ...makeEntityBase("RoleResult", "role_result", "completed"),
      kind: "RoleResult",
      taskPackageId: task.id,
      dispatchToRoleRequestId: request.id,
      outcome: "succeeded",
      summary: "岗位已完成商城运营任务，业务结果、审计记录和账本记录均已读回。",
      artifactRefs: ["商城运营诊断报告.md", `audit:${auditRecordId}`, request.ledgerRef],
      executionEvidence: {
        executionId,
        ledgerRef: request.ledgerRef,
        modelUsageNotApplicable: true,
        modelUsageNotApplicableReason: "UI 测试模拟未调用真实模型。",
        auditReadback: {
          auditRecordId,
          executionId,
          status: "completed",
          summary: "审计记录已读回。",
        },
        ledgerReadback: {
          ledgerRef: request.ledgerRef,
          executionId,
          status: "posted",
          authorizationFeeCents: 0,
          executionFeeCents: 0,
        },
      },
    };
    mainFlowState.roleResults.push(roleResult);
    return {
      ok: true,
      status: "completed",
      roleResult,
      readModel: buildMainFlowReadModel(),
    };
  }

  function updateMainFlowObservation(
    params: unknown,
    status: "confirmed" | "rejected" | "prepared",
    summarySuffix?: string,
  ): MainFlowObservation {
    const record = isRecord(params) ? params : {};
    const observationPackageId =
      typeof record.observationPackageId === "string" ? record.observationPackageId : "";
    const observation =
      mainFlowState.observations.find((item) => item.id === observationPackageId) ??
      latestByCreatedAt(mainFlowState.observations);
    if (!observation) {
      throw new Error("No mock ObservationPackage exists.");
    }
    observation.status = status;
    observation.updatedAt = Date.now();
    if (summarySuffix && !observation.summary.includes(summarySuffix)) {
      observation.summary = `${observation.summary} ${summarySuffix}`.trim();
    }
    return observation;
  }

  function updateMainFlowAttribution(
    params: unknown,
    status: "confirmed" | "rejected" | "prepared",
    summarySuffix?: string,
  ): MainFlowAttribution {
    const record = isRecord(params) ? params : {};
    const attributionReportId =
      typeof record.attributionReportId === "string" ? record.attributionReportId : "";
    const attribution =
      mainFlowState.attributions.find((item) => item.id === attributionReportId) ??
      latestByCreatedAt(mainFlowState.attributions);
    if (!attribution) {
      throw new Error("No mock AttributionReport exists.");
    }
    attribution.status = status;
    attribution.updatedAt = Date.now();
    if (summarySuffix && !attribution.summary.includes(summarySuffix)) {
      attribution.summary = `${attribution.summary} ${summarySuffix}`.trim();
    }
    return attribution;
  }

  function buildToolSupplyReadModel() {
    const skillItem = {
      id: "skill:browser-automation",
      label: "Browser Automation",
      description: "浏览器自动化 Skill",
      kind: "skill",
      source: "skill",
      status: "available",
      risk: "unknown",
      blockedReasons: [],
      skillKey: "browser-automation",
      configBindings: ["skills.entries.browser-automation.apiKey"],
    };
    const cloudItem = {
      id: "cloud:marketplace-ops",
      label: "岗位商城运营通用能力",
      description: "岗位商城",
      kind: "cloud_capability",
      source: "cloud_marketplace",
      status: "blocked",
      risk: "medium",
      blockedReasons: ["cloud_capability_not_authorized"],
    };
    const uniqueItem = {
      id: "unique:visual-audit",
      label: "商品图视觉审核独特能力",
      description: "岗位商城",
      kind: "cloud_capability",
      source: "cloud_marketplace",
      status: "pending_review",
      risk: "high",
      blockedReasons: ["unique_capability_pending"],
    };
    return {
      version: 1,
      updatedAt: Date.now(),
      authority: "openclaw_local",
      metrics: {
        total: 2,
        localTools: 0,
        pluginTools: 0,
        skills: 1,
        apiConnections: 0,
        cloudCapabilities: 2,
        available: 1,
        blocked: 1,
        disabled: 0,
        pendingReview: 1,
        risks: 2,
      },
      localTools: [],
      skills: [skillItem],
      apiBindings: [],
      cloudCapabilities: [cloudItem, uniqueItem],
      risks: [
        {
          id: "cloud:marketplace-ops:cloud_capability_not_authorized",
          label: "岗位商城运营通用能力",
          targetKind: "cloud_capability",
          severity: "blocking",
          reason: "cloud_capability_not_authorized",
          message: "云端商城能力未授权，不能本地伪造通过。",
        },
        {
          id: "unique:visual-audit:unique_capability_pending",
          label: "商品图视觉审核独特能力",
          targetKind: "cloud_capability",
          severity: "blocking",
          reason: "unique_capability_pending",
          message: "独特能力仍在申请或审核中。",
        },
      ],
      grants: [],
      uniqueCapabilityRequests: [],
      capabilityLifecycle: [
        {
          id: "capability:cloud:marketplace-ops",
          title: "岗位商城运营通用能力",
          kind: "category_common",
          status: "blocked",
          sourceItemIds: ["cloud:marketplace-ops"],
          dispatchReady: false,
          nextAction: {
            label: "处理云端授权",
            routeTab: "apiManagement",
            reason: "云端商城仍是品类能力授权来源，本地不能伪造通过。",
          },
          formation:
            "品类通用能力 = 云端商城品类授权 + 本地 OpenClaw 工具权限 + Skill + API 绑定。",
          acquisition: "需要云端商城授权该品类通用能力，本地不能伪造通过。",
          usage: "当前只能展示和申请，不能进入岗位执行。",
          management: "云端负责审核、授权、计费；本地负责展示、grant overlay、风险和阻塞说明。",
          optimization:
            "根据调度失败、岗位执行结果和风险报告，补充工具/Skill/API 或调整品类能力说明。",
          blockedReasons: ["cloud_capability_not_authorized"],
        },
        {
          id: "capability:unique:visual-audit",
          title: "商品图视觉审核独特能力",
          kind: "unique_capability",
          status: "pending_review",
          sourceItemIds: ["unique:visual-audit"],
          dispatchReady: false,
          nextAction: {
            label: "准备独特能力申请",
            routeTab: "skills",
            reason: "独特能力仍在申请或审核中，不能直接调度。",
          },
          formation: "独特能力 = 业务缺口 + 能力申请 + 人工审核 + 所需工具/Skill/API。",
          acquisition: "先寻找开源社区或 OpenClaw Skill 包；没有合适方案，再准备自研和审核材料。",
          usage: "当前只能展示和申请，不能进入岗位执行。",
          management: "云端负责审核、授权、计费；本地负责展示、grant overlay、风险和阻塞说明。",
          optimization: "补齐缺失工具、Skill、API、示例输入输出和审核材料后再提交/复审。",
          blockedReasons: ["unique_capability_pending"],
        },
        {
          id: "capability:skill:browser-automation",
          title: "Browser Automation",
          kind: "skill",
          status: "available",
          sourceItemIds: ["skill:browser-automation"],
          dispatchReady: true,
          nextAction: {
            label: "进入任务调度使用",
            routeTab: "workboard",
            reason: "能力已可用，可被调度层匹配 RolePlanItem。",
          },
          formation: "Skill 能力 = Skill 包 + 依赖检查 + API/配置绑定 + 启用状态。",
          acquisition: "通过 OpenClaw Skill 仓库或本地 Skill 包获得，之后绑定 API 和依赖。",
          usage: "可被主对话、工具调用和岗位执行作为可调用能力。",
          management: "在本页启用/禁用 Skill，在 API 管理绑定 SecretRef 或 Provider。",
          optimization: "把反复出现的独特能力沉淀成 Skill，补齐 README、依赖和验收样例。",
          blockedReasons: [],
        },
      ],
    };
  }

  function buildSkillsStatusReport() {
    return {
      workspaceDir: "/tmp/workspace",
      managedSkillsDir: "/tmp/skills",
      skills: [
        {
          name: "Browser Automation",
          description: "浏览器自动化 Skill",
          source: "openclaw-managed",
          filePath: "/tmp/skills/browser-automation/SKILL.md",
          baseDir: "/tmp/skills/browser-automation",
          skillKey: "browser-automation",
          bundled: false,
          primaryEnv: "BROWSER_API_KEY",
          always: false,
          disabled: false,
          blockedByAllowlist: false,
          eligible: true,
          requirements: { bins: [], env: [], config: [], os: [] },
          missing: { bins: [], env: [], config: [], os: [] },
          configChecks: [],
          install: [],
        },
      ],
    };
  }

  function buildResponse(method: string, params: unknown): unknown {
    const configured = configuredResponse(method, params);
    if (configured.found) {
      return configured.value;
    }
    switch (method) {
      case "aics.mainFlow.readModel.get":
        return buildMainFlowReadModel();
      case "aics.mainFlow.interaction.create":
        return createMainFlowInteraction(params);
      case "aics.mainFlow.observation.prepare":
        return prepareMainFlowObservation(params);
      case "aics.mainFlow.observation.collect":
        return collectMainFlowObservation(params);
      case "aics.mainFlow.observation.confirm":
        return updateMainFlowObservation(params, "confirmed");
      case "aics.mainFlow.observation.reject":
        return updateMainFlowObservation(params, "rejected");
      case "aics.mainFlow.observation.markDataMissing":
        return updateMainFlowObservation(params, "prepared", "待补真实经营数据");
      case "aics.mainFlow.attribution.prepare":
        return prepareMainFlowAttribution(params);
      case "aics.mainFlow.attribution.generateFromLatest":
        return generateMainFlowAttributionFromLatest();
      case "aics.mainFlow.attribution.confirm":
        return updateMainFlowAttribution(params, "confirmed");
      case "aics.mainFlow.attribution.reject":
        return updateMainFlowAttribution(params, "rejected");
      case "aics.mainFlow.attribution.requestMoreData":
        return updateMainFlowAttribution(params, "prepared", "待补真实经营数据");
      case "aics.mainFlow.goal.candidate.create":
        return createMainFlowGoal(params);
      case "aics.mainFlow.goal.generateFromLatest":
        return { goal: createMainFlowGoal() };
      case "aics.mainFlow.goal.confirm":
        return updateMainFlowGoal(params, "confirmed");
      case "aics.mainFlow.planning.prepare":
      case "aics.mainFlow.planning.generateFromLatest":
      case "aics.mainFlow.planning.regenerate":
        return generateMainFlowPlanning(params);
      case "aics.mainFlow.planning.confirm":
        return updateMainFlowPlanning(params, "confirmed");
      case "aics.mainFlow.dispatch.checkAndCreateQueue":
        return checkAndCreateMainFlowDispatchQueue(params);
      case "aics.mainFlow.execution.confirmAndRun":
        return confirmAndRunMainFlowExecution(params);
      case "aics.toolSupply.readModel.get":
        return buildToolSupplyReadModel();
      case "skills.status":
        return buildSkillsStatusReport();
      case "connect":
        return {
          auth: {
            deviceToken: "e2e-device-token",
            role: "operator",
            scopes: [
              "operator.admin",
              "operator.read",
              "operator.write",
              "operator.approvals",
              "operator.pairing",
            ],
          },
          features: { events: [], methods: ["chat.startup"] },
          protocol: protocolVersion,
          server: { connId: "control-ui-e2e", version: "e2e" },
          snapshot: {
            sessionDefaults: {
              defaultAgentId: scenario.defaultAgentId,
              mainKey: "main",
              mainSessionKey: scenario.sessionKey,
              scope: "agent",
            },
          },
          type: "hello-ok",
        };
      case "agent.identity.get":
        return {
          agentId: scenario.assistantAgentId,
          avatar: "",
          avatarStatus: "none",
          name: scenario.assistantName,
        };
      case "agents.list":
        return {
          agents: [
            {
              id: scenario.defaultAgentId,
              identity: { name: scenario.assistantName },
              name: scenario.assistantName,
            },
          ],
          defaultId: scenario.defaultAgentId,
          mainKey: "main",
          scope: "agent",
        };
      case "agents.files.list":
        return {
          agentId:
            isRecord(params) && typeof params.agentId === "string"
              ? params.agentId
              : scenario.defaultAgentId,
          files: [],
          workspace: "",
        };
      case "agents.files.get":
        return null;
      case "chat.history":
        return {
          messages: scenario.historyMessages,
          sessionId: "control-ui-e2e-session",
          thinkingLevel: null,
        };
      case "chat.startup":
        return {
          agentsList: {
            agents: [
              {
                id: scenario.defaultAgentId,
                identity: { name: scenario.assistantName },
                name: scenario.assistantName,
              },
            ],
            defaultId: scenario.defaultAgentId,
            mainKey: "main",
            scope: "agent",
          },
          messages: scenario.historyMessages,
          sessionId: "control-ui-e2e-session",
          thinkingLevel: null,
        };
      case "chat.send":
        return {
          runId:
            isRecord(params) && typeof params.idempotencyKey === "string"
              ? params.idempotencyKey
              : "control-ui-e2e-run",
          status: "started",
        };
      case "commands.list":
        return { commands: [] };
      case "health":
        return {
          agents: [],
          defaultAgentId: scenario.defaultAgentId,
          durationMs: 0,
          heartbeatSeconds: 0,
          ok: true,
          sessions: { count: 1, path: "", recent: [] },
          ts: Date.now(),
        };
      case "models.list":
        return { models: scenario.models };
      case "sessions.list":
        return {
          count: 1,
          defaults: {
            contextTokens: null,
            model: "gpt-5.5",
            modelProvider: "openai",
          },
          path: "",
          sessions: [sessionRow()],
          ts: Date.now(),
        };
      case "sessions.subscribe":
        return { ok: true };
      default:
        return {};
    }
  }

  function shouldDefer(method: string): boolean {
    const index = deferredMethods.indexOf(method);
    if (index < 0) {
      return false;
    }
    deferredMethods.splice(index, 1);
    return true;
  }

  function parseFrame(raw: string | ArrayBufferLike | Blob | ArrayBufferView): BrowserFrame | null {
    if (typeof raw !== "string") {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as BrowserFrame;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  class MockWebSocket extends EventTarget {
    static readonly CLOSED = 3;
    static readonly CLOSING = 2;
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static latest: MockWebSocket | null = null;

    binaryType: BinaryType = "blob";
    readonly bufferedAmount = 0;
    readonly extensions = "";
    onclose: ((event: CloseEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onopen: ((event: Event) => void) | null = null;
    readonly protocol = "";
    readyState = MockWebSocket.CONNECTING;
    readonly url: string;

    constructor(url: string | URL) {
      super();
      this.url = String(url);
      MockWebSocket.latest = this;
      sockets.push(this);
      window.setTimeout(() => {
        if (this.readyState !== MockWebSocket.CONNECTING) {
          return;
        }
        this.readyState = MockWebSocket.OPEN;
        this.dispatchEvent(new Event("open"));
        this.deliver({
          event: "connect.challenge",
          payload: { nonce: "control-ui-e2e-nonce" },
          type: "event",
        });
      }, 0);
    }

    override dispatchEvent(event: Event): boolean {
      const dispatched = super.dispatchEvent(event);
      if (event.type === "open") {
        this.onopen?.(event);
      } else if (event.type === "message") {
        this.onmessage?.(event as MessageEvent);
      } else if (event.type === "close") {
        this.onclose?.(event as CloseEvent);
      } else if (event.type === "error") {
        this.onerror?.(event);
      }
      return dispatched;
    }

    close(code = 1000, reason = ""): void {
      if (this.readyState === MockWebSocket.CLOSED) {
        return;
      }
      this.readyState = MockWebSocket.CLOSED;
      this.dispatchEvent(new CloseEvent("close", { code, reason }));
    }

    send(raw: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      const frame = parseFrame(raw);
      if (!frame || frame.type !== "req") {
        return;
      }
      const id = typeof frame.id === "string" ? frame.id : "";
      const method = typeof frame.method === "string" ? frame.method : "";
      if (!id || !method) {
        return;
      }
      requests.push({ id, method, params: frame.params });
      if (shouldDefer(method)) {
        deferredResponses.push({ id, method, params: frame.params, socket: this });
        return;
      }
      window.setTimeout(() => {
        this.deliver({
          id,
          ok: true,
          payload: buildResponse(method, frame.params),
          type: "res",
        });
      }, 0);
    }

    deliver(frame: unknown): void {
      if (this.readyState !== MockWebSocket.OPEN) {
        return;
      }
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(frame) }));
    }
  }

  const exposed: ExposedGateway = {
    closeLatest(code, reason) {
      MockWebSocket.latest?.close(code ?? 1006, reason ?? "mock close");
    },
    deferNext(method) {
      deferredMethods.push(method);
    },
    emit(event, payload) {
      MockWebSocket.latest?.deliver({
        event,
        payload,
        seq: ++seq,
        type: "event",
      });
    },
    findRequests(method) {
      return method ? requests.filter((request) => request.method === method) : [...requests];
    },
    rejectDeferred(method, error) {
      const index = deferredResponses.findIndex((response) => response.method === method);
      if (index < 0) {
        throw new Error(`No deferred mock Gateway response for ${method}`);
      }
      const [response] = deferredResponses.splice(index, 1);
      response.socket.deliver({
        error: {
          code: error?.code ?? "INVALID_REQUEST",
          message: error?.message ?? "mock Gateway rejected request",
          ...(error?.details ? { details: error.details } : {}),
          ...(error?.retryable ? { retryable: true } : {}),
        },
        id: response.id,
        ok: false,
        type: "res",
      });
    },
    requests,
    resolveDeferred(method, payload) {
      const index = deferredResponses.findIndex((response) => response.method === method);
      if (index < 0) {
        throw new Error(`No deferred mock Gateway response for ${method}`);
      }
      const [response] = deferredResponses.splice(index, 1);
      response.socket.deliver({
        id: response.id,
        ok: true,
        payload: payload ?? buildResponse(response.method, response.params),
        type: "res",
      });
    },
    setHistoryMessages(messages) {
      scenario.historyMessages = Array.isArray(messages) ? messages : [];
    },
    socketCount() {
      return sockets.length;
    },
  };

  (window as WindowWithGateway).openclawControlUiE2eGateway = exposed;
  window.WebSocket = MockWebSocket as unknown as typeof WebSocket;
}

export async function installMockGateway(
  page: Page,
  scenario: ControlUiMockGatewayScenario = {},
): Promise<MockGatewayControls> {
  const normalizedScenario = normalizeScenario(scenario);
  await page.route(`**${CONTROL_UI_BOOTSTRAP_CONFIG_PATH}`, (route) =>
    route.fulfill({
      body: JSON.stringify(createControlUiMockBootstrapConfig(normalizedScenario)),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.addInitScript({ content: createControlUiMockGatewayInitScript(normalizedScenario) });
  return createMockGatewayControls(page, normalizedScenario.sessionKey);
}

function createMockGatewayControls(page: Page, defaultSessionKey: string): MockGatewayControls {
  const emitGatewayEvent = async (event: string, payload?: unknown) => {
    await page.evaluate(
      ({ eventName, eventPayload }) => {
        const gateway = (
          window as Window & {
            openclawControlUiE2eGateway?: {
              emit: (event: string, payload?: unknown) => void;
            };
          }
        ).openclawControlUiE2eGateway;
        if (!gateway) {
          throw new Error("Mock Gateway is not installed");
        }
        gateway.emit(eventName, eventPayload);
      },
      { eventName: event, eventPayload: payload },
    );
  };

  const getRequests = async (method?: string) =>
    page.evaluate((targetMethod) => {
      const gateway = (
        window as Window & {
          openclawControlUiE2eGateway?: {
            findRequests: (method?: string) => MockGatewayRequest[];
          };
        }
      ).openclawControlUiE2eGateway;
      return gateway?.findRequests(targetMethod) ?? [];
    }, method);

  return {
    async closeLatest(code, reason) {
      await page.evaluate(
        ({ closeCode, closeReason }) => {
          const gateway = (
            window as Window & {
              openclawControlUiE2eGateway?: {
                closeLatest: (code?: number, reason?: string) => void;
              };
            }
          ).openclawControlUiE2eGateway;
          if (!gateway) {
            throw new Error("Mock Gateway is not installed");
          }
          gateway.closeLatest(closeCode, closeReason);
        },
        { closeCode: code, closeReason: reason },
      );
    },
    async deferNext(method) {
      await page.evaluate((targetMethod) => {
        const gateway = (
          window as Window & {
            openclawControlUiE2eGateway?: {
              deferNext: (method: string) => void;
            };
          }
        ).openclawControlUiE2eGateway;
        if (!gateway) {
          throw new Error("Mock Gateway is not installed");
        }
        gateway.deferNext(targetMethod);
      }, method);
    },
    async emitChatFinal(params) {
      await emitGatewayEvent("chat", {
        message: {
          content: [{ text: params.text, type: "text" }],
          role: "assistant",
          timestamp: Date.now(),
        },
        runId: params.runId,
        sessionKey: params.sessionKey ?? defaultSessionKey,
        state: "final",
      });
    },
    emitGatewayEvent,
    getRequests,
    async getSocketCount() {
      return await page.evaluate(() => {
        const gateway = (
          window as Window & {
            openclawControlUiE2eGateway?: {
              socketCount: () => number;
            };
          }
        ).openclawControlUiE2eGateway;
        return gateway?.socketCount() ?? 0;
      });
    },
    async rejectDeferred(method, error) {
      await page.evaluate(
        ({ targetMethod, responseError }) => {
          const gateway = (
            window as Window & {
              openclawControlUiE2eGateway?: {
                rejectDeferred: (
                  method: string,
                  error?: {
                    code?: string;
                    message?: string;
                    details?: unknown;
                    retryable?: boolean;
                  },
                ) => void;
              };
            }
          ).openclawControlUiE2eGateway;
          if (!gateway) {
            throw new Error("Mock Gateway is not installed");
          }
          gateway.rejectDeferred(targetMethod, responseError);
        },
        { targetMethod: method, responseError: error },
      );
    },
    async resolveDeferred(method, payload) {
      await page.evaluate(
        ({ targetMethod, responsePayload }) => {
          const gateway = (
            window as Window & {
              openclawControlUiE2eGateway?: {
                resolveDeferred: (method: string, payload?: unknown) => void;
              };
            }
          ).openclawControlUiE2eGateway;
          if (!gateway) {
            throw new Error("Mock Gateway is not installed");
          }
          gateway.resolveDeferred(targetMethod, responsePayload);
        },
        { targetMethod: method, responsePayload: payload },
      );
    },
    async setHistoryMessages(messages) {
      await page.evaluate((nextMessages) => {
        const gateway = (
          window as Window & {
            openclawControlUiE2eGateway?: {
              setHistoryMessages: (messages: unknown[]) => void;
            };
          }
        ).openclawControlUiE2eGateway;
        if (!gateway) {
          throw new Error("Mock Gateway is not installed");
        }
        gateway.setHistoryMessages(nextMessages);
      }, messages);
    },
    async waitForRequest(method) {
      await page.waitForFunction(
        (targetMethod) => {
          const gateway = (
            window as Window & {
              openclawControlUiE2eGateway?: {
                requests: MockGatewayRequest[];
              };
            }
          ).openclawControlUiE2eGateway;
          return Boolean(gateway?.requests.some((request) => request.method === targetMethod));
        },
        method,
        { timeout: 10_000 },
      );
      const requests = await getRequests(method);
      const request = requests.at(-1);
      if (!request) {
        throw new Error(`No mock Gateway request found for ${method}`);
      }
      return request;
    },
  };
}
