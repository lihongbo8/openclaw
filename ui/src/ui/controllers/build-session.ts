import type { AppViewState } from "../app-view-state.js";

// ═══ BuildSession 状态管理 ═══
//
// 多步岗位生成流程：
//   created → briefing → confirming → generating → validating → completed/failed
//
// 替代旧的一次性 dijie.roleBuilder.run JSON brief 模式。

export type BuildSessionBrief = {
  roleTitle: string;
  roleDescription: string;
  targetCategory: string;
  coreResponsibilities: string[];
  taskExamples: string[];
  dailySop: string[];
  weeklySop: string[];
  requiredCapabilities: string[];
  inputTypes: string[];
  outputTypes: string[];
  forbiddenActions: string[];
  qualityStandards: string[];
};

export type BuildSessionCapabilityReport = {
  summary: { ready: number; missing: number; total: number };
  items: Array<{ capability: string; available: boolean; toolName?: string }>;
};

export type BuildSessionRecord = {
  sessionId: string;
  state: string;
  createdAt: number;
  updatedAt: number;
  userRequirements: string;
  brief?: BuildSessionBrief;
  userConfirmations: string[];
  matchedTemplate?: string;
  capabilityReport?: BuildSessionCapabilityReport;
  outputPackageDir?: string;
  validationErrors: string[];
  blockedReason?: string;
};

export type AvailableTemplate = {
  id: string;
  label: string;
  defaultCapabilities: string[];
};

export type BuildSessionPageState = {
  loading: boolean;
  error: string | null;
  step: BuildSessionStep;
  // 会话
  sessionId: string | null;
  session: BuildSessionRecord | null;
  sessions: BuildSessionRecord[];
  // 创建表单
  requirements: string;
  // brief 表单
  briefForm: Partial<BuildSessionBrief>;
  // 品类模板列表
  availableTemplates: AvailableTemplate[];
  // 生成结果
  generateResult: {
    packageDir?: string;
    files?: string[];
    validationErrors?: string[];
  } | null;
};

export type BuildSessionStep =
  | "idle" // 未开始，可创建或加载现有会话
  | "requirements" // 输入需求
  | "briefing" // 系统匹配品类和能力
  | "confirming" // 用户确认/修改 brief
  | "generating" // 生成中
  | "validating" // 校验中
  | "completed" // 完成
  | "failed"; // 失败

export function createDefaultBuildSessionState(): BuildSessionPageState {
  return {
    loading: false,
    error: null,
    step: "idle",
    sessionId: null,
    session: null,
    sessions: [],
    requirements: "",
    briefForm: {},
    availableTemplates: [],
    generateResult: null,
  };
}

// ═══ 会话操作 ═══

export async function createSession(state: AppViewState, bs: BuildSessionPageState): Promise<void> {
  bs.loading = true;
  bs.error = null;
  try {
    if (!state.client) throw new Error("未连接");
    const result = await state.client.request("aics.buildSession.create", {
      requirements: bs.requirements,
    });
    const r = result as Record<string, unknown>;
    bs.session = r as unknown as BuildSessionRecord;
    bs.sessionId = bs.session.sessionId;
    bs.availableTemplates = (r.availableTemplates ?? []) as AvailableTemplate[];
    bs.step = "briefing";
  } catch (err) {
    bs.error = err instanceof Error ? err.message : String(err);
  } finally {
    bs.loading = false;
  }
}

export async function loadSession(
  state: AppViewState,
  bs: BuildSessionPageState,
  sessionId: string,
): Promise<void> {
  bs.loading = true;
  bs.error = null;
  try {
    if (!state.client) throw new Error("未连接");
    const result = await state.client.request("aics.buildSession.load", { sessionId });
    bs.session = result as BuildSessionRecord;
    bs.sessionId = sessionId;
    bs.step = mapStateToStep(bs.session.state);
  } catch (err) {
    bs.error = err instanceof Error ? err.message : String(err);
  } finally {
    bs.loading = false;
  }
}

export async function listSessions(state: AppViewState, bs: BuildSessionPageState): Promise<void> {
  bs.loading = true;
  bs.error = null;
  try {
    if (!state.client) throw new Error("未连接");
    const result = await state.client.request("aics.buildSession.list", {});
    bs.sessions = (result as BuildSessionRecord[]) ?? [];
  } catch (err) {
    bs.error = err instanceof Error ? err.message : String(err);
  } finally {
    bs.loading = false;
  }
}

// ═══ 步骤推进 ═══

export async function startBriefing(state: AppViewState, bs: BuildSessionPageState): Promise<void> {
  if (!bs.sessionId) return;
  bs.loading = true;
  bs.error = null;
  try {
    if (!state.client) throw new Error("未连接");
    const result = await state.client.request("aics.buildSession.startBriefing", {
      sessionId: bs.sessionId,
    });
    const r = result as Record<string, unknown>;
    bs.session = r as unknown as BuildSessionRecord;
    // 用匹配的模板预填 brief 表单
    const matchedTemplate = r.matchedTemplate as Record<string, unknown> | null;
    if (matchedTemplate) {
      bs.briefForm = {
        roleTitle: (matchedTemplate.label as string) ?? "",
        targetCategory: (matchedTemplate.id as string) ?? "",
        requiredCapabilities: (matchedTemplate.defaultCapabilities as string[]) ?? [],
      };
    }
    bs.step = "confirming";
  } catch (err) {
    bs.error = err instanceof Error ? err.message : String(err);
  } finally {
    bs.loading = false;
  }
}

export async function submitBrief(state: AppViewState, bs: BuildSessionPageState): Promise<void> {
  if (!bs.sessionId) return;
  bs.loading = true;
  bs.error = null;
  try {
    if (!state.client) throw new Error("未连接");
    const result = await state.client.request("aics.buildSession.submitBrief", {
      sessionId: bs.sessionId,
      brief: bs.briefForm,
    });
    bs.session = result as BuildSessionRecord;
    bs.step = "confirming";
  } catch (err) {
    bs.error = err instanceof Error ? err.message : String(err);
  } finally {
    bs.loading = false;
  }
}

export async function confirmSession(
  state: AppViewState,
  bs: BuildSessionPageState,
  note?: string,
): Promise<void> {
  if (!bs.sessionId) return;
  bs.loading = true;
  bs.error = null;
  try {
    if (!state.client) throw new Error("未连接");
    const result = await state.client.request("aics.buildSession.confirm", {
      sessionId: bs.sessionId,
      note,
    });
    bs.session = result as BuildSessionRecord;
  } catch (err) {
    bs.error = err instanceof Error ? err.message : String(err);
  } finally {
    bs.loading = false;
  }
}

export async function generatePackage(
  state: AppViewState,
  bs: BuildSessionPageState,
): Promise<void> {
  if (!bs.sessionId) return;
  bs.loading = true;
  bs.error = null;
  bs.step = "generating";
  try {
    if (!state.client) throw new Error("未连接");
    const result = await state.client.request("aics.buildSession.generate", {
      sessionId: bs.sessionId,
    });
    const r = result as Record<string, unknown>;
    bs.session = (r.session ?? r) as BuildSessionRecord;
    bs.generateResult = {
      packageDir: r.packageDir as string | undefined,
      files: r.files as string[] | undefined,
      validationErrors: r.validationErrors as string[] | undefined,
    };
    bs.step =
      bs.session.state === "completed"
        ? "completed"
        : bs.session.state === "validating"
          ? "validating"
          : "failed";
  } catch (err) {
    bs.error = err instanceof Error ? err.message : String(err);
    bs.step = "failed";
  } finally {
    bs.loading = false;
  }
}

// ═══ Helpers ═══

function mapStateToStep(state: string): BuildSessionStep {
  switch (state) {
    case "created":
      return "requirements";
    case "briefing":
      return "briefing";
    case "confirming":
      return "confirming";
    case "generating":
      return "generating";
    case "validating":
      return "validating";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "idle";
  }
}

export function resetBuildSession(bs: BuildSessionPageState): void {
  Object.assign(bs, createDefaultBuildSessionState());
}
