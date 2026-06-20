import type { AppViewState } from "../app-view-state.js";
import type { CategoryCapabilityReview } from "./review-center.ts";

// ═══ BuildSession 状态管理 ═══
//
// 多步岗位生成流程：
//   created → briefing → confirming → generating → validating → completed/failed
//
// 替代旧的一次性 dijie.roleBuilder.run JSON brief 模式。

export type BuildSessionBrief = {
  roleTitle: string;
  roleDescription: string;
  targetUser: string;
  targetCategory: string;
  coreResponsibilities: string[];
  taskExamples: string[];
  dailySop: string[];
  weeklySop: string[];
  monthlySop: string[];
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

export type RoleDevelopmentNextAction = {
  kind: string;
  label: string;
  reason: string;
  enabled: boolean;
};

export type RoleDevelopmentState = {
  sessionId: string;
  status: string;
  userStatusLabel: string;
  roleTitle: string;
  categoryName: string;
  categoryRef: string;
  briefReady: boolean;
  canGenerateRolePackage: boolean;
  capability: {
    required: string[];
    existing: string[];
    missing: string[];
    disabled: string[];
    neededTools: string[];
    neededSkills: string[];
    neededProviders: string[];
    humanConfirmationCapabilities: string[];
    nonAutomaticCapabilities: string[];
  };
  categoryCapabilityReview: Record<string, unknown> | null;
  toolSkillDevelopment: {
    required: string[];
    todos: Array<{
      reviewId: string;
      assetType: "tool" | "skill";
      assetId: string;
      reviewStatus: string;
      approved: boolean;
      nextAction: RoleDevelopmentNextAction;
    }>;
    total: number;
    approved: number;
    pending: number;
    ready: boolean;
  };
  nextActions: RoleDevelopmentNextAction[];
  analysis: Record<string, unknown> | null;
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
  roleDevelopment: RoleDevelopmentState | null;
  capabilityAnalysis: unknown;
  categoryCapabilityRequestResult: Record<string, unknown> | null;
  bindableCategoryReviews: CategoryCapabilityReview[];
  generateResult: {
    packageDir?: string;
    files?: string[];
    validationErrors?: string[];
    review?: Record<string, unknown> | null;
    listingResult?: Record<string, unknown> | null;
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

function countsTowardDeveloperRoleLimit(session: BuildSessionRecord): boolean {
  return session.state !== "failed" && session.state !== "cancelled";
}

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
    roleDevelopment: null,
    capabilityAnalysis: null,
    categoryCapabilityRequestResult: null,
    bindableCategoryReviews: [],
    generateResult: null,
  };
}

// ═══ 会话操作 ═══

export async function createSession(state: AppViewState, bs: BuildSessionPageState): Promise<void> {
  bs.loading = true;
  bs.error = null;
  try {
    if (!state.client) throw new Error("未连接");
    const sessionsResult = await state.client.request("aics.buildSession.list", {});
    bs.sessions = (sessionsResult as BuildSessionRecord[]) ?? [];
    if (bs.sessions.filter(countsTowardDeveloperRoleLimit).length >= 3) {
      throw new Error("开发者中心暂定最多开发 3 个岗位。请先取消或清理已有岗位后再创建新岗位。");
    }
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
    await refreshRoleDevelopmentStatus(state, bs);
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
    } else if (isMarketplaceOpsRequirement(bs.session.userRequirements)) {
      bs.briefForm = {
        roleTitle: "商城运营诊断官",
        roleDescription: "观察岗位供给、授权转化、执行成功率、审计和账本，输出运营诊断和调度建议。",
        targetUser: "岗位商城运营者",
        targetCategory: "商城运营",
        coreResponsibilities: ["观察岗位供给", "分析授权转化", "检查执行成功率", "回看审计和账本"],
        taskExamples: ["输出商城运营诊断报告", "发现品类能力和执行链路阻塞"],
        dailySop: ["查看授权转化、执行失败和审核阻塞"],
        weeklySop: ["复盘品类能力缺口、执行质量和费用收益"],
        monthlySop: ["汇总岗位商城经营表现和下一轮能力建设建议"],
        inputTypes: ["岗位商品、授权、执行、审计和账本摘要"],
        outputTypes: ["运营诊断报告", "原因归因", "目标建议", "调度建议", "审计摘要"],
        forbiddenActions: ["不自动上架", "不绕过审核", "不绕过费用确认", "不读取原始账本明细"],
        qualityStandards: ["必须产生可回看的结果、审计记录和账本引用"],
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
    await refreshRoleDevelopmentStatus(state, bs);
    bs.step = "confirming";
  } catch (err) {
    bs.error = err instanceof Error ? err.message : String(err);
  } finally {
    bs.loading = false;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function applyRoleDevelopmentPayload(bs: BuildSessionPageState, payload: unknown): void {
  const response = record(payload);
  const development = record(response.development);
  if (!development.sessionId) return;
  bs.roleDevelopment = development as unknown as RoleDevelopmentState;
  const analysis = record(development.analysis);
  bs.capabilityAnalysis = analysis.roleTitle || analysis.categoryName ? { analysis } : null;
  const categoryCapabilityReview = record(development.categoryCapabilityReview);
  if (categoryCapabilityReview.id || categoryCapabilityReview.requestId) {
    bs.categoryCapabilityRequestResult = { review: categoryCapabilityReview };
  }
}

export async function refreshRoleDevelopmentStatus(
  state: AppViewState,
  bs: BuildSessionPageState,
): Promise<void> {
  if (!bs.sessionId) return;
  if (!state.client) throw new Error("未连接");
  const payload = await state.client.request("aics.roleDevelopment.status.get", {
    sessionId: bs.sessionId,
  });
  applyRoleDevelopmentPayload(bs, payload);
}

function buildSessionCurrentReview(
  bs: BuildSessionPageState,
  fallbackReviewId?: string,
): Record<string, unknown> | null {
  const generatedReview =
    bs.generateResult?.review &&
    typeof bs.generateResult.review === "object" &&
    !Array.isArray(bs.generateResult.review)
      ? bs.generateResult.review
      : null;
  if (generatedReview) return generatedReview;
  return fallbackReviewId ? { id: fallbackReviewId } : null;
}

function bindableCategorySearchTerms(
  bs: BuildSessionPageState,
  review: Record<string, unknown> | null,
): string[] {
  const analysis = record(record(bs.capabilityAnalysis).analysis);
  return uniqueNonEmpty([
    stringValue(review?.rolePackageId),
    stringValue(review?.listingDraftId),
    stringValue(review?.category),
    stringValue(analysis.categoryName),
    stringValue(analysis.categoryRef),
    stringValue(bs.briefForm.targetCategory),
    stringValue(bs.briefForm.roleTitle),
    stringValue(bs.session?.brief?.targetCategory),
    stringValue(bs.session?.brief?.roleTitle),
  ]);
}

export async function refreshBindableCategoryReviews(
  state: AppViewState,
  bs: BuildSessionPageState,
  reviewId?: string,
): Promise<void> {
  if (!state.client) throw new Error("未连接");
  let review = buildSessionCurrentReview(bs, reviewId);
  const resolvedReviewId = stringValue(review?.id) || reviewId || "";
  if (resolvedReviewId && (!review || !stringValue(review.rolePackageId))) {
    const result = await state.client.request<Record<string, unknown>>(
      "aics.rolePreListingReview.get",
      { reviewId: resolvedReviewId },
    );
    const latestReview = record(result.review);
    if (latestReview.id) {
      review = latestReview;
      bs.generateResult = {
        ...(bs.generateResult ?? {}),
        review: latestReview,
      };
    }
  }
  const terms = bindableCategorySearchTerms(bs, review);
  const candidates = new Map<string, CategoryCapabilityReview>();
  const searches = terms.length ? terms : [""];
  for (const search of searches) {
    const result = await state.client.request<{
      reviews?: CategoryCapabilityReview[];
    }>("aics.categoryCapabilityReview.list", {
      filter: "activated",
      search,
      page: 1,
      pageSize: 100,
      sort: "updated_desc",
    });
    for (const category of Array.isArray(result.reviews) ? result.reviews : []) {
      if (category.id) candidates.set(category.id, category);
    }
  }
  bs.bindableCategoryReviews = [...candidates.values()];
}

export async function submitCategoryCapabilityRequest(
  state: AppViewState,
  bs: BuildSessionPageState,
): Promise<void> {
  bs.loading = true;
  bs.error = null;
  try {
    if (!state.client) throw new Error("未连接");
    if (!bs.sessionId) throw new Error("缺少岗位开发会话。");
    const result = await state.client.request<Record<string, unknown>>(
      "aics.roleDevelopment.prepareMissingCapability",
      { sessionId: bs.sessionId },
    );
    applyRoleDevelopmentPayload(bs, result);
    await state.refreshReviewCenter?.();
    await state.refreshToolSupplyControlReadModel?.();
  } catch (err) {
    bs.error = err instanceof Error ? err.message : String(err);
  } finally {
    bs.loading = false;
  }
}

export async function reduceRoleDevelopmentScopeToBasic(
  state: AppViewState,
  bs: BuildSessionPageState,
): Promise<void> {
  bs.loading = true;
  bs.error = null;
  try {
    if (!state.client) throw new Error("未连接");
    if (!bs.sessionId) throw new Error("缺少岗位开发会话。");
    const result = await state.client.request<Record<string, unknown>>(
      "aics.roleDevelopment.reduceScopeToBasic",
      { sessionId: bs.sessionId },
    );
    const response = record(result);
    const session = record(response.session);
    if (session.sessionId) bs.session = session as unknown as BuildSessionRecord;
    applyRoleDevelopmentPayload(bs, result);
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
    const resultError =
      typeof r.error === "string" && r.error.trim()
        ? r.error.trim()
        : typeof r.message === "string" && r.message.trim()
          ? r.message.trim()
          : null;
    if (resultError) {
      bs.error = resultError;
    }
    bs.generateResult = {
      packageDir: r.packageDir as string | undefined,
      files: r.files as string[] | undefined,
      validationErrors: r.validationErrors as string[] | undefined,
      review: (r.review as Record<string, unknown> | null | undefined) ?? null,
    };
    if (r.capabilityAnalysis && typeof r.capabilityAnalysis === "object") {
      bs.capabilityAnalysis = { analysis: r.capabilityAnalysis };
    }
    if (bs.generateResult.review) {
      await state.refreshReviewCenter?.();
      await state.refreshToolSupplyControlReadModel?.();
      await state.refreshBuildSessionBindableCategories?.(
        String(record(bs.generateResult.review).id ?? ""),
      );
      state.setTab?.("reviewCenter");
    }
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

export async function submitDeveloperRoleForListing(
  state: AppViewState,
  bs: BuildSessionPageState,
  reviewId: string,
): Promise<Record<string, unknown> | null> {
  bs.loading = true;
  bs.error = null;
  try {
    if (!state.client) throw new Error("未连接");
    const result = await state.client.request("aics.roleDeveloper.submitForListing", { reviewId });
    const record = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
    if (record.ok === false) {
      throw new Error(
        typeof record.error === "string" && record.error.trim()
          ? record.error.trim()
          : "岗位上架失败，请先确认本地审核已通过并绑定正式品类。",
      );
    }
    bs.generateResult = {
      ...(bs.generateResult ?? {}),
      review:
        record.review && typeof record.review === "object" && !Array.isArray(record.review)
          ? (record.review as Record<string, unknown>)
          : (bs.generateResult?.review ?? null),
      listingResult: record,
    };
    return record;
  } catch (err) {
    bs.error = err instanceof Error ? err.message : String(err);
    return null;
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

function isMarketplaceOpsRequirement(value: string): boolean {
  const text = value.toLowerCase();
  return (
    (text.includes("商城") && text.includes("运营")) ||
    text.includes("岗位商城") ||
    text.includes("授权转化") ||
    text.includes("执行成功率") ||
    text.includes("ledger") ||
    text.includes("audit")
  );
}
