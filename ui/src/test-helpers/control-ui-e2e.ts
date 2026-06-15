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
  type MainFlowMockState = {
    interactions: MainFlowInteraction[];
    observations: MainFlowObservation[];
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
    interactions: [],
    observations: [],
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

  function buildMainFlowReadModel() {
    const observationReady = latestObservationReady();
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
      {
        stage: "attribution",
        code: "missing_attribution_report",
        message: "AttributionReport is required before creating goal rationale.",
      },
      {
        stage: "goal",
        code: "missing_confirmed_company_goal",
        message: "A user-confirmed CompanyGoal is required before planning.",
      },
      {
        stage: "planning",
        code: "missing_confirmed_planning_package",
        message:
          "A confirmed PlanningPackage with RolePlanItem entries is required before dispatch.",
      },
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
        canCreateGoalCandidate: false,
        canPreparePlanning: false,
        canCreateDispatchProposal: false,
        canMaterializeTaskPackage: false,
        canEnterRoleExecution: false,
        canRunApprovedTask: false,
      },
      executionPreflight: {
        canRun: false,
        blockedReasons: [],
      },
      blockedReasons,
      latest: {
        interaction: latestByCreatedAt(mainFlowState.interactions),
        observationPackage: latestByCreatedAt(mainFlowState.observations),
        attributionReport: null,
        companyGoal: null,
        planningPackage: null,
        rolePlanItem: null,
        dispatchProposalReview: null,
        taskPackage: null,
        dispatchToRoleRequest: null,
        roleResult: null,
      },
      counts: {
        interactions: mainFlowState.interactions.length,
        observations: mainFlowState.observations.length,
        attributions: 0,
        goals: 0,
        planningPackages: 0,
        rolePlanItems: 0,
        dispatchProposalReviews: 0,
        taskPackages: 0,
        dispatchToRoleRequests: 0,
        roleResults: 0,
      },
      objects: {
        interactions: mainFlowState.interactions,
        observations: mainFlowState.observations,
        attributions: [],
        goals: [],
        planningPackages: [],
        rolePlanItems: [],
        dispatchProposalReviews: [],
        taskPackages: [],
        dispatchToRoleRequests: [],
        roleResults: [],
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
      case "aics.mainFlow.observation.confirm":
        return updateMainFlowObservation(params, "confirmed");
      case "aics.mainFlow.observation.reject":
        return updateMainFlowObservation(params, "rejected");
      case "aics.mainFlow.observation.markDataMissing":
        return updateMainFlowObservation(params, "prepared", "待补真实经营数据");
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
