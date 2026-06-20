import { randomUUID } from "node:crypto";
import { createPipelineTables, getPipelineDb, type ToolSkillDevelopmentTaskRow } from "./db.js";

export type ToolSkillDevelopmentAssetType = "tool" | "skill";

export type ToolSkillSourceRoute =
  | "reuse_existing"
  | "reuse_open_source"
  | "adapt_open_source"
  | "build_in_house";

export type ToolSkillDevelopmentTaskStatus =
  | "need_source_plan"
  | "candidate_found"
  | "source_selected"
  | "need_runtime"
  | "waiting_install_or_enable"
  | "waiting_adaptation"
  | "waiting_in_house_build"
  | "runtime_ready"
  | "validation_needed"
  | "needs_changes"
  | "waiting_manual_approval"
  | "approved"
  | "blocked"
  | "rejected";

export type ToolSkillSourceCandidate = {
  id: string;
  label: string;
  route: ToolSkillSourceRoute;
  source: string;
  reason: string;
  confidence: "high" | "medium" | "low";
  installHint?: string;
  matchingRefs?: string[];
};

export type ToolSkillDevelopmentTask = {
  id: string;
  categoryCapabilityReviewId: string;
  targetCategoryRef: string;
  targetCategoryName: string;
  assetType: ToolSkillDevelopmentAssetType;
  assetId: string;
  requirementRef: string;
  requiredCapabilities: string[];
  sourceRoute: ToolSkillSourceRoute;
  sourceCandidates: ToolSkillSourceCandidate[];
  selectedSource: string | null;
  developmentStatus: ToolSkillDevelopmentTaskStatus;
  acceptanceCriteria: string[];
  riskBoundaries: string[];
  linkedReviewId: string | null;
  blockedReason: string | null;
  createdAt: number;
  updatedAt: number;
};

export type CreateToolSkillDevelopmentTasksInput = {
  categoryCapabilityReviewId: string;
  targetCategoryRef: string;
  targetCategoryName: string;
  toolSkillRequirements: string[];
  requiredCapabilities: string[];
  riskBoundaries: string[];
};

export type UpdateToolSkillDevelopmentTaskInput = Partial<
  Pick<
    ToolSkillDevelopmentTask,
    | "sourceRoute"
    | "sourceCandidates"
    | "selectedSource"
    | "developmentStatus"
    | "linkedReviewId"
    | "blockedReason"
    | "acceptanceCriteria"
    | "riskBoundaries"
  >
>;

export function createToolSkillDevelopmentTasksForCategoryCapability(
  input: CreateToolSkillDevelopmentTasksInput,
): ToolSkillDevelopmentTask[] {
  createPipelineTables(getPipelineDb());
  return uniqueStrings(input.toolSkillRequirements)
    .filter(Boolean)
    .map((requirementRef) => ensureDevelopmentTask(input, requirementRef));
}

export function listToolSkillDevelopmentTasks(): ToolSkillDevelopmentTask[] {
  let rows: ToolSkillDevelopmentTaskRow[];
  try {
    rows = getPipelineDb()
      .prepare("SELECT * FROM tool_skill_development_tasks ORDER BY updated_at DESC")
      .all() as unknown as ToolSkillDevelopmentTaskRow[];
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return rows.map(rowToTask);
}

export function listToolSkillDevelopmentTasksForCategory(
  categoryCapabilityReviewId: string,
): ToolSkillDevelopmentTask[] {
  let rows: ToolSkillDevelopmentTaskRow[];
  try {
    rows = getPipelineDb()
      .prepare(
        "SELECT * FROM tool_skill_development_tasks WHERE category_capability_review_id = ? ORDER BY created_at ASC",
      )
      .all(categoryCapabilityReviewId) as unknown as ToolSkillDevelopmentTaskRow[];
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return rows.map(rowToTask);
}

export function getToolSkillDevelopmentTask(taskId: string): ToolSkillDevelopmentTask | null {
  let row: ToolSkillDevelopmentTaskRow | undefined;
  try {
    row = getPipelineDb()
      .prepare("SELECT * FROM tool_skill_development_tasks WHERE id = ?")
      .get(taskId) as unknown as ToolSkillDevelopmentTaskRow | undefined;
  } catch (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return row ? rowToTask(row) : null;
}

export function findToolSkillDevelopmentTaskForAsset(input: {
  assetType: ToolSkillDevelopmentAssetType;
  assetId: string;
}): ToolSkillDevelopmentTask | null {
  let row: ToolSkillDevelopmentTaskRow | undefined;
  try {
    row = getPipelineDb()
      .prepare(
        "SELECT * FROM tool_skill_development_tasks WHERE asset_type = ? AND asset_id = ? ORDER BY updated_at DESC LIMIT 1",
      )
      .get(input.assetType, input.assetId) as unknown as ToolSkillDevelopmentTaskRow | undefined;
  } catch (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return row ? rowToTask(row) : null;
}

export function updateToolSkillDevelopmentTask(
  taskId: string,
  patch: UpdateToolSkillDevelopmentTaskInput,
  event?: { action: string; summary: string },
): ToolSkillDevelopmentTask {
  const current = getToolSkillDevelopmentTask(taskId);
  if (!current) throw new Error(`ToolSkillDevelopmentTask not found: ${taskId}`);
  const next = { ...current, ...patch, updatedAt: Date.now() };
  getPipelineDb()
    .prepare(
      `UPDATE tool_skill_development_tasks SET
        source_route = ?,
        source_candidates = ?,
        selected_source = ?,
        development_status = ?,
        acceptance_criteria = ?,
        risk_boundaries = ?,
        linked_review_id = ?,
        blocked_reason = ?,
        updated_at = ?
      WHERE id = ?`,
    )
    .run(
      next.sourceRoute,
      JSON.stringify(next.sourceCandidates),
      next.selectedSource,
      next.developmentStatus,
      JSON.stringify(next.acceptanceCriteria),
      JSON.stringify(next.riskBoundaries),
      next.linkedReviewId,
      next.blockedReason,
      next.updatedAt,
      taskId,
    );
  if (event) appendToolSkillDevelopmentEvent(taskId, event.action, event.summary);
  return getToolSkillDevelopmentTask(taskId)!;
}

export function appendToolSkillDevelopmentEvent(
  taskId: string,
  action: string,
  summary: string,
): void {
  getPipelineDb()
    .prepare(
      "INSERT INTO tool_skill_development_events (id, task_id, action, summary, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(randomUUID(), taskId, action, summary, Date.now());
}

function ensureDevelopmentTask(
  input: CreateToolSkillDevelopmentTasksInput,
  requirementRef: string,
): ToolSkillDevelopmentTask {
  const existing = getExistingTask(input.categoryCapabilityReviewId, requirementRef);
  if (existing) return existing;

  const assetType: ToolSkillDevelopmentAssetType = requirementRef.startsWith("skill.")
    ? "skill"
    : "tool";
  const isProvider = requirementRef.startsWith("provider.");
  const sourceRoute: ToolSkillSourceRoute =
    assetType === "skill"
      ? "reuse_open_source"
      : isProvider
        ? "build_in_house"
        : "adapt_open_source";
  const requiredCapabilities = isProvider
    ? input.requiredCapabilities.filter((capability) =>
        /(model|api|provider|chat|analysis)/iu.test(capability),
      )
    : input.requiredCapabilities;
  const timestamp = Date.now();
  const taskId = `tsd_${randomUUID()}`;
  const sourceCandidates = defaultSourceCandidates({
    assetType,
    assetId: requirementRef,
    sourceRoute,
  });
  getPipelineDb()
    .prepare(
      `INSERT INTO tool_skill_development_tasks (
        id,
        category_capability_review_id,
        target_category_ref,
        target_category_name,
        asset_type,
        asset_id,
        requirement_ref,
        required_capabilities,
        source_route,
        source_candidates,
        selected_source,
        development_status,
        acceptance_criteria,
        risk_boundaries,
        linked_review_id,
        blocked_reason,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      taskId,
      input.categoryCapabilityReviewId,
      input.targetCategoryRef,
      input.targetCategoryName,
      assetType,
      requirementRef,
      requirementRef,
      JSON.stringify(requiredCapabilities),
      sourceRoute,
      JSON.stringify(sourceCandidates),
      null,
      "candidate_found",
      JSON.stringify(acceptanceCriteriaForRequirement(requirementRef, requiredCapabilities)),
      JSON.stringify(input.riskBoundaries),
      null,
      null,
      timestamp,
      timestamp,
    );
  appendToolSkillDevelopmentEvent(
    taskId,
    "toolSkillDevelopmentTask.create",
    `已为品类 ${input.targetCategoryName || input.targetCategoryRef} 创建 ${requirementRef} 开发任务。`,
  );
  return getToolSkillDevelopmentTask(taskId)!;
}

function getExistingTask(
  categoryCapabilityReviewId: string,
  requirementRef: string,
): ToolSkillDevelopmentTask | null {
  const row = getPipelineDb()
    .prepare(
      "SELECT * FROM tool_skill_development_tasks WHERE category_capability_review_id = ? AND requirement_ref = ?",
    )
    .get(categoryCapabilityReviewId, requirementRef) as ToolSkillDevelopmentTaskRow | undefined;
  return row ? rowToTask(row) : null;
}

function defaultSourceCandidates(input: {
  assetType: ToolSkillDevelopmentAssetType;
  assetId: string;
  sourceRoute: ToolSkillSourceRoute;
}): ToolSkillSourceCandidate[] {
  if (input.sourceRoute === "reuse_open_source") {
    return [
      {
        id: `${input.assetId}:clawhub`,
        label: "从 Skill/ClawHub 复用",
        route: "reuse_open_source",
        source: "clawhub",
        reason: "优先搜索可安装 Skill，保留安装与依赖检查记录。",
        confidence: "medium",
        installHint: `在 Skill 工作台搜索 ${input.assetId}，安装后回到本任务执行检查。`,
      },
    ];
  }
  if (input.sourceRoute === "adapt_open_source") {
    return [
      {
        id: `${input.assetId}:open-source-adapter`,
        label: "开源工具改造成平台 Tool",
        route: "adapt_open_source",
        source: "open-source",
        reason: "工具类能力通常需要封装输入输出、权限、风险确认和审计记录。",
        confidence: "medium",
      },
      {
        id: `${input.assetId}:in-house`,
        label: "自研本地 Tool",
        route: "build_in_house",
        source: "openclaw-local",
        reason: "没有稳定开源实现时，按本地 ToolRegistry 契约自研。",
        confidence: "low",
      },
    ];
  }
  return [
    {
      id: `${input.assetId}:in-house`,
      label: input.assetId.startsWith("provider.") ? "自研 Provider/API Adapter" : "自研本地能力",
      route: "build_in_house",
      source: input.assetId.startsWith("provider.") ? "provider-api" : "openclaw-local",
      reason: "需要接入 API 管理、权限门禁、调用记录和风险确认。",
      confidence: "medium",
    },
  ];
}

function acceptanceCriteriaForRequirement(
  assetId: string,
  requiredCapabilities: string[],
): string[] {
  return [
    `${assetId} 已创建、安装或接入，并能被本地 OpenClaw 读取。`,
    `覆盖品类能力：${requiredCapabilities.join("、") || assetId}`,
    "通过 Tool/Skill 综合检查并由系统开发者人工确认。",
  ];
}

function rowToTask(row: ToolSkillDevelopmentTaskRow): ToolSkillDevelopmentTask {
  return {
    id: row.id,
    categoryCapabilityReviewId: row.category_capability_review_id,
    targetCategoryRef: row.target_category_ref,
    targetCategoryName: row.target_category_name,
    assetType: row.asset_type === "skill" ? "skill" : "tool",
    assetId: row.asset_id,
    requirementRef: row.requirement_ref,
    requiredCapabilities: readJsonArray(row.required_capabilities),
    sourceRoute: readSourceRoute(row.source_route),
    sourceCandidates: readSourceCandidates(row.source_candidates),
    selectedSource: row.selected_source,
    developmentStatus: readDevelopmentStatus(row.development_status),
    acceptanceCriteria: readJsonArray(row.acceptance_criteria),
    riskBoundaries: readJsonArray(row.risk_boundaries),
    linkedReviewId: row.linked_review_id,
    blockedReason: row.blocked_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function readSourceCandidates(value: string): ToolSkillSourceCandidate[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isSourceCandidate) : [];
  } catch {
    return [];
  }
}

function isSourceCandidate(value: unknown): value is ToolSkillSourceCandidate {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as ToolSkillSourceCandidate).id === "string" &&
    typeof (value as ToolSkillSourceCandidate).label === "string" &&
    typeof (value as ToolSkillSourceCandidate).source === "string",
  );
}

function readSourceRoute(value: string): ToolSkillSourceRoute {
  if (
    value === "reuse_existing" ||
    value === "reuse_open_source" ||
    value === "adapt_open_source" ||
    value === "build_in_house"
  ) {
    return value;
  }
  return "build_in_house";
}

function readDevelopmentStatus(value: string): ToolSkillDevelopmentTaskStatus {
  if (
    value === "need_source_plan" ||
    value === "candidate_found" ||
    value === "source_selected" ||
    value === "need_runtime" ||
    value === "waiting_install_or_enable" ||
    value === "waiting_adaptation" ||
    value === "waiting_in_house_build" ||
    value === "runtime_ready" ||
    value === "validation_needed" ||
    value === "needs_changes" ||
    value === "waiting_manual_approval" ||
    value === "approved" ||
    value === "blocked" ||
    value === "rejected"
  ) {
    return value;
  }
  return "need_source_plan";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isMissingTableError(error: unknown): boolean {
  return error instanceof Error && /no such table/u.test(error.message);
}
