import {
  listToolSkillReviews,
  runToolSkillValidation,
  startToolSkillReview,
  type ToolSkillReview,
  type ToolSkillValidationEvidence,
} from "./role-pre-listing-review.js";
import { SKILL_CATALOG } from "./skill-catalog.js";
import { ToolRegistry, type ToolCapabilityGroup } from "./tool-registry.js";
import {
  findToolSkillDevelopmentTaskForAsset,
  getToolSkillDevelopmentTask,
  listToolSkillDevelopmentTasks,
  listToolSkillDevelopmentTasksForCategory,
  updateToolSkillDevelopmentTask,
  type ToolSkillDevelopmentTask,
  type ToolSkillDevelopmentTaskStatus,
  type ToolSkillSourceCandidate,
  type ToolSkillSourceRoute,
} from "./tool-skill-development-store.js";

// ======================================================================
// ToolSkillDevelopmentEngine: 品类 Tool/Skill 开发执行引擎
// ======================================================================
//
// 这个引擎只负责“品类缺少 Tool / Skill / Provider/API 能力时，如何把能力
// 做出来或接进来”。它不替代岗位开发引擎，也不替代岗位执行引擎。
//
// 生产链路：
//   品类能力申请通过 -> ToolSkillDevelopmentTask
//   -> 路线决策/候选来源 -> 安装、改造或自研 -> 运行证据检查
//   -> ToolSkillReview 最终审核 -> 品类能力激活门禁读取已通过审核单

export type ToolSkillDevelopmentStatus = ToolSkillDevelopmentTaskStatus | "need_definition";

export type ToolSkillRuntimeEvidenceStatus = "available" | "disabled" | "missing" | "unknown";

export type ToolSkillDevelopmentNextActionKind =
  | "define_asset"
  | "plan_source"
  | "select_source"
  | "install_or_enable"
  | "adapt_open_source"
  | "build_in_house"
  | "add_runtime"
  | "run_validation"
  | "fix_asset"
  | "manual_approve"
  | "use_asset";

export type ToolSkillDevelopmentNextAction = {
  kind: ToolSkillDevelopmentNextActionKind;
  label: string;
  reason: string;
  enabled: boolean;
};

export type ToolSkillDevelopmentRequest = {
  taskId?: string;
  assetType: "tool" | "skill";
  assetId: string;
  source?: string;
  version?: string;
  declaredCapabilities?: string[];
  selectedSource?: string;
  evidence?: ToolSkillValidationEvidence;
};

export type ToolSkillDevelopmentRuntimeState = {
  status: ToolSkillRuntimeEvidenceStatus;
  summary: string;
  matchingRefs: string[];
};

export type ToolSkillDevelopmentState = {
  task: ToolSkillDevelopmentTask | null;
  assetType: "tool" | "skill";
  assetId: string;
  source: string;
  version: string;
  declaredCapabilities: string[];
  status: ToolSkillDevelopmentStatus;
  userStatusLabel: string;
  runtime: ToolSkillDevelopmentRuntimeState;
  sourceRoute: ToolSkillSourceRoute | null;
  sourceCandidates: ToolSkillSourceCandidate[];
  selectedSource: string | null;
  review: ToolSkillReview | null;
  nextActions: ToolSkillDevelopmentNextAction[];
};

export type ToolSkillDevelopmentEngine = {
  listTasks(): ToolSkillDevelopmentTask[];
  listTasksForCategory(categoryCapabilityReviewId: string): ToolSkillDevelopmentTask[];
  getTask(taskId: string): ToolSkillDevelopmentTask | null;
  getStatus(request: ToolSkillDevelopmentRequest): ToolSkillDevelopmentState;
  planSource(request: ToolSkillDevelopmentRequest): ToolSkillDevelopmentState;
  selectSource(request: ToolSkillDevelopmentRequest): ToolSkillDevelopmentState;
  markRuntimeReady(request: ToolSkillDevelopmentRequest): ToolSkillDevelopmentState;
  prepareReview(request: ToolSkillDevelopmentRequest): ToolSkillDevelopmentState;
  runValidation(request: ToolSkillDevelopmentRequest): ToolSkillDevelopmentState;
};

export function createToolSkillDevelopmentEngine(): ToolSkillDevelopmentEngine {
  return {
    listTasks() {
      return listToolSkillDevelopmentTasks();
    },

    listTasksForCategory(categoryCapabilityReviewId) {
      return listToolSkillDevelopmentTasksForCategory(categoryCapabilityReviewId);
    },

    getTask(taskId) {
      return getToolSkillDevelopmentTask(taskId);
    },

    getStatus(request) {
      return buildToolSkillDevelopmentState(request);
    },

    planSource(request) {
      const normalized = normalizeRequest(request);
      const task = resolveTask(normalized);
      if (!task) return buildToolSkillDevelopmentState(normalized);
      const runtime = runtimeStateFor(normalized);
      const patch = sourcePlanPatch(task, runtime);
      updateToolSkillDevelopmentTask(task.id, patch, {
        action: "toolSkillDevelopmentTask.planSource",
        summary: `已生成 ${normalized.assetId} 的开发路线：${routeLabel(patch.sourceRoute ?? task.sourceRoute)}。`,
      });
      return buildToolSkillDevelopmentState(normalized);
    },

    selectSource(request) {
      const normalized = normalizeRequest(request);
      const task = resolveTask(normalized);
      if (!task) return buildToolSkillDevelopmentState(normalized);
      const selectedSource = normalized.selectedSource || normalized.source;
      const candidate =
        task.sourceCandidates.find(
          (item) => item.id === selectedSource || item.source === selectedSource,
        ) ?? task.sourceCandidates[0];
      if (!candidate) return buildToolSkillDevelopmentState(normalized);
      updateToolSkillDevelopmentTask(
        task.id,
        {
          selectedSource: candidate.id,
          sourceRoute: candidate.route,
          developmentStatus: statusAfterSourceSelected(candidate.route),
        },
        {
          action: "toolSkillDevelopmentTask.selectSource",
          summary: `已选择 ${candidate.label} 作为 ${normalized.assetId} 的开发来源。`,
        },
      );
      return buildToolSkillDevelopmentState(normalized);
    },

    markRuntimeReady(request) {
      const normalized = normalizeRequest(request);
      const task = resolveTask(normalized);
      if (task) {
        updateToolSkillDevelopmentTask(
          task.id,
          {
            developmentStatus: "runtime_ready",
            blockedReason: null,
          },
          {
            action: "toolSkillDevelopmentTask.markRuntimeReady",
            summary: `${normalized.assetId} 已标记为运行实现就绪，等待综合检查。`,
          },
        );
      }
      return buildToolSkillDevelopmentState(normalized);
    },

    prepareReview(request) {
      const normalized = normalizeRequest(request);
      const state = buildToolSkillDevelopmentState(normalized);
      if (!normalized.assetId || !state.declaredCapabilities.length) return state;
      const review = ensureLinkedReview(state, normalized);
      return buildToolSkillDevelopmentState({
        ...normalized,
        taskId: state.task?.id,
        declaredCapabilities: review.declaredCapabilities,
      });
    },

    runValidation(request) {
      const normalized = normalizeRequest(request);
      const state = buildToolSkillDevelopmentState(normalized);
      if (!normalized.assetId || !state.declaredCapabilities.length) return state;

      if (
        state.task &&
        state.runtime.status !== "available" &&
        state.task.developmentStatus !== "runtime_ready"
      ) {
        const planned = sourcePlanPatch(state.task, state.runtime);
        updateToolSkillDevelopmentTask(
          state.task.id,
          {
            ...planned,
            blockedReason: state.runtime.summary,
          },
          {
            action: "toolSkillDevelopmentTask.validationBlocked",
            summary: `运行实现未就绪：${state.runtime.summary}`,
          },
        );
        return buildToolSkillDevelopmentState({ ...normalized, taskId: state.task.id });
      }

      const review = ensureLinkedReview(state, normalized);
      runToolSkillValidation(review.id, normalized.evidence);
      const checked = findToolSkillReviewById(review.id) ?? review;
      if (state.task) {
        updateToolSkillDevelopmentTask(
          state.task.id,
          {
            developmentStatus: statusFromReview(checked),
            linkedReviewId: checked.id,
            blockedReason: checked.reviewFindings.some((finding) => finding.severity === "blocking")
              ? checked.reviewDecision
              : null,
          },
          {
            action: "toolSkillDevelopmentTask.runValidation",
            summary: `${normalized.assetId} 已完成综合检查，当前审核状态：${checked.reviewStatus}。`,
          },
        );
      }
      return buildToolSkillDevelopmentState({ ...normalized, taskId: state.task?.id });
    },
  };
}

export function buildToolSkillDevelopmentState(
  request: ToolSkillDevelopmentRequest,
): ToolSkillDevelopmentState {
  const normalized = normalizeRequest(request);
  const task = resolveTask(normalized);
  const review = findLinkedReview(task, normalized);
  const declaredCapabilities = normalized.declaredCapabilities.length
    ? normalized.declaredCapabilities
    : task?.requiredCapabilities.length
      ? task.requiredCapabilities
      : (review?.declaredCapabilities ?? defaultCapabilitiesFor(normalized));
  const runtime = runtimeStateFor({ ...normalized, declaredCapabilities });
  const status = developmentStatusFor({
    assetId: normalized.assetId,
    declaredCapabilities,
    task,
    review,
    runtime,
  });

  return {
    task,
    assetType: normalized.assetType,
    assetId: normalized.assetId,
    source: normalized.source,
    version: normalized.version,
    declaredCapabilities,
    status,
    userStatusLabel: statusLabel(status),
    runtime,
    sourceRoute: task?.sourceRoute ?? null,
    sourceCandidates: task?.sourceCandidates ?? sourceCandidatesFor(normalized, runtime),
    selectedSource: task?.selectedSource ?? null,
    review,
    nextActions: nextActionsFor({ status, task, review, runtime }),
  };
}

function normalizeRequest(
  request: ToolSkillDevelopmentRequest,
): Required<ToolSkillDevelopmentRequest> {
  const assetId = request.assetId.trim();
  const declaredCapabilities = (request.declaredCapabilities ?? [])
    .map((capability) => capability.trim())
    .filter(Boolean);
  return {
    taskId: request.taskId?.trim() ?? "",
    assetType: request.assetType,
    assetId,
    source:
      request.source?.trim() || (assetId.startsWith("provider.") ? "provider-api" : "platform"),
    version: request.version?.trim() || "",
    declaredCapabilities: declaredCapabilities.length
      ? declaredCapabilities
      : defaultCapabilitiesFor({ ...request, assetId }),
    selectedSource: request.selectedSource?.trim() ?? "",
    evidence: request.evidence ?? {},
  };
}

function resolveTask(
  request: Required<ToolSkillDevelopmentRequest>,
): ToolSkillDevelopmentTask | null {
  if (request.taskId) return getToolSkillDevelopmentTask(request.taskId);
  return findToolSkillDevelopmentTaskForAsset({
    assetType: request.assetType,
    assetId: request.assetId,
  });
}

function defaultCapabilitiesFor(
  request: Pick<ToolSkillDevelopmentRequest, "assetType" | "assetId">,
): string[] {
  const assetId = request.assetId.trim();
  if (!assetId) return [];
  if (request.assetType === "skill") {
    const skill = SKILL_CATALOG[assetId];
    if (skill) return [skill.capability];
  }
  const tool = ToolRegistry.get(assetId);
  if (tool) return tool.capabilities;
  return [assetId];
}

function findLinkedReview(
  task: ToolSkillDevelopmentTask | null,
  request: Required<ToolSkillDevelopmentRequest>,
): ToolSkillReview | null {
  if (task?.linkedReviewId) {
    const review = findToolSkillReviewById(task.linkedReviewId);
    if (review) return review;
  }
  return findToolSkillReview(request);
}

function findToolSkillReviewById(reviewId: string): ToolSkillReview | null {
  return listToolSkillReviews().find((review) => review.id === reviewId) ?? null;
}

function findToolSkillReview(
  request: Required<ToolSkillDevelopmentRequest>,
): ToolSkillReview | null {
  return (
    listToolSkillReviews().find(
      (review) =>
        review.assetType === request.assetType &&
        review.assetId === request.assetId &&
        review.version === request.version,
    ) ?? null
  );
}

function ensureLinkedReview(
  state: ToolSkillDevelopmentState,
  request: Required<ToolSkillDevelopmentRequest>,
): ToolSkillReview {
  const existing = state.review ?? findToolSkillReview(request);
  if (existing) {
    if (state.task && state.task.linkedReviewId !== existing.id) {
      updateToolSkillDevelopmentTask(
        state.task.id,
        {
          linkedReviewId: existing.id,
          developmentStatus: statusFromReview(existing),
        },
        {
          action: "toolSkillDevelopmentTask.linkReview",
          summary: `${request.assetId} 已关联已有 ToolSkillReview：${existing.id}。`,
        },
      );
    }
    return existing;
  }
  const review = startToolSkillReview({
    assetType: request.assetType,
    assetId: request.assetId,
    source: sourceForReview(state, request),
    version: request.version,
    declaredCapabilities: state.declaredCapabilities,
  });
  if (state.task) {
    updateToolSkillDevelopmentTask(
      state.task.id,
      {
        linkedReviewId: review.id,
        developmentStatus: "validation_needed",
      },
      {
        action: "toolSkillDevelopmentTask.createReview",
        summary: `${request.assetId} 已进入 Tool/Skill 最终审核：${review.id}。`,
      },
    );
  }
  return review;
}

function sourceForReview(
  state: ToolSkillDevelopmentState,
  request: Required<ToolSkillDevelopmentRequest>,
): string {
  const selected = state.sourceCandidates.find(
    (candidate) => candidate.id === state.selectedSource,
  );
  if (selected?.source) return selected.source;
  if (request.assetId.startsWith("provider.")) return "provider-api";
  return request.source;
}

function runtimeStateFor(
  request: Required<ToolSkillDevelopmentRequest>,
): ToolSkillDevelopmentRuntimeState {
  if (request.assetType === "tool") return toolRuntimeStateFor(request);
  return skillRuntimeStateFor(request);
}

function toolRuntimeStateFor(
  request: Required<ToolSkillDevelopmentRequest>,
): ToolSkillDevelopmentRuntimeState {
  const direct = ToolRegistry.get(request.assetId);
  if (direct?.enabled) {
    return {
      status: "available",
      summary: `已找到启用工具：${direct.toolId}`,
      matchingRefs: [direct.toolId],
    };
  }
  if (direct && !direct.enabled) {
    return {
      status: "disabled",
      summary: `工具 ${direct.toolId} 已注册但未启用。`,
      matchingRefs: [direct.toolId],
    };
  }

  const matches = request.declaredCapabilities.flatMap((capability) =>
    ToolRegistry.findByCapability(capability as ToolCapabilityGroup),
  );
  const uniqueMatches = [...new Map(matches.map((tool) => [tool.toolId, tool])).values()];
  if (uniqueMatches.length > 0) {
    return {
      status: "available",
      summary: `已找到 ${uniqueMatches.length} 个匹配声明能力的工具实现。`,
      matchingRefs: uniqueMatches.map((tool) => tool.toolId),
    };
  }

  return {
    status: "missing",
    summary: `未找到可运行工具实现：${request.assetId}`,
    matchingRefs: [],
  };
}

function skillRuntimeStateFor(
  request: Required<ToolSkillDevelopmentRequest>,
): ToolSkillDevelopmentRuntimeState {
  const localSkill = SKILL_CATALOG[request.assetId];
  if (localSkill) {
    return {
      status: "available",
      summary: `已找到内置 Skill：${localSkill.skillId}`,
      matchingRefs: [localSkill.skillId],
    };
  }

  const report = request.evidence.skillsReport;
  if (!report) {
    return {
      status: "unknown",
      summary: `未读取到 Skill 状态报告：${request.assetId}`,
      matchingRefs: [],
    };
  }

  const matches = report.skills.filter(
    (skill) =>
      evidenceKeysMatch(request.assetId, skill.skillKey) ||
      evidenceKeysMatch(request.assetId, skill.name),
  );
  const available = matches.filter(
    (skill) =>
      !skill.disabled &&
      !skill.blockedByAllowlist &&
      !skill.blockedByAgentFilter &&
      skill.eligible &&
      skill.missing.bins.length === 0 &&
      skill.missing.anyBins.length === 0 &&
      skill.missing.env.length === 0 &&
      skill.missing.config.length === 0 &&
      skill.missing.os.length === 0 &&
      skill.configChecks.every((check) => check.satisfied),
  );

  if (available.length > 0) {
    return {
      status: "available",
      summary: `已找到 ${available.length} 个可用 Skill 实现。`,
      matchingRefs: available.map((skill) => skill.skillKey),
    };
  }
  if (matches.length > 0) {
    return {
      status: "disabled",
      summary: `Skill ${request.assetId} 已找到，但启用状态或依赖未满足。`,
      matchingRefs: matches.map((skill) => skill.skillKey),
    };
  }
  return {
    status: "missing",
    summary: `未找到可用 Skill 实现：${request.assetId}`,
    matchingRefs: [],
  };
}

function sourcePlanPatch(
  task: ToolSkillDevelopmentTask,
  runtime: ToolSkillDevelopmentRuntimeState,
): {
  sourceRoute: ToolSkillSourceRoute;
  sourceCandidates: ToolSkillSourceCandidate[];
  developmentStatus: ToolSkillDevelopmentTaskStatus;
  blockedReason: string | null;
} {
  if (runtime.status === "available") {
    return {
      sourceRoute: "reuse_existing",
      sourceCandidates: [
        {
          id: `${task.assetId}:existing-runtime`,
          label: "复用本地已启用实现",
          route: "reuse_existing",
          source: "openclaw-local",
          reason: runtime.summary,
          confidence: "high",
          matchingRefs: runtime.matchingRefs,
        },
        ...task.sourceCandidates.filter((candidate) => candidate.route !== "reuse_existing"),
      ],
      developmentStatus: "runtime_ready",
      blockedReason: null,
    };
  }
  return {
    sourceRoute: task.sourceRoute,
    sourceCandidates: task.sourceCandidates.length
      ? task.sourceCandidates
      : sourceCandidatesFor(task, runtime),
    developmentStatus: task.selectedSource
      ? statusAfterSourceSelected(task.sourceRoute)
      : "candidate_found",
    blockedReason: runtime.status === "missing" ? runtime.summary : null,
  };
}

function sourceCandidatesFor(
  input: Pick<ToolSkillDevelopmentTask, "assetType" | "assetId">,
  runtime: ToolSkillDevelopmentRuntimeState,
): ToolSkillSourceCandidate[] {
  if (runtime.status === "available") {
    return [
      {
        id: `${input.assetId}:existing-runtime`,
        label: "复用本地已启用实现",
        route: "reuse_existing",
        source: "openclaw-local",
        reason: runtime.summary,
        confidence: "high",
        matchingRefs: runtime.matchingRefs,
      },
    ];
  }
  if (input.assetType === "skill") {
    return [
      {
        id: `${input.assetId}:clawhub`,
        label: "从 Skill/ClawHub 复用",
        route: "reuse_open_source",
        source: "clawhub",
        reason: "优先搜索可安装 Skill，安装后由本地状态报告确认依赖和 allowlist。",
        confidence: "medium",
        installHint: `在 Skill 工作台搜索 ${input.assetId}，安装后回到本任务执行检查。`,
      },
    ];
  }
  if (input.assetId.startsWith("provider.")) {
    return [
      {
        id: `${input.assetId}:provider-adapter`,
        label: "自研 Provider/API Adapter",
        route: "build_in_house",
        source: "provider-api",
        reason: "需要接入 API 管理、凭证门禁、调用审计和风险确认。",
        confidence: "medium",
      },
    ];
  }
  return [
    {
      id: `${input.assetId}:open-source-adapter`,
      label: "开源工具改造成平台 Tool",
      route: "adapt_open_source",
      source: "open-source",
      reason: "优先复用稳定开源能力，再按 ToolRegistry 契约封装权限、输入输出和审计。",
      confidence: "medium",
    },
    {
      id: `${input.assetId}:in-house`,
      label: "自研本地 Tool",
      route: "build_in_house",
      source: "openclaw-local",
      reason: "没有合适开源实现时，直接按平台工具契约开发。",
      confidence: "low",
    },
  ];
}

function statusAfterSourceSelected(route: ToolSkillSourceRoute): ToolSkillDevelopmentTaskStatus {
  switch (route) {
    case "reuse_existing":
      return "runtime_ready";
    case "reuse_open_source":
      return "waiting_install_or_enable";
    case "adapt_open_source":
      return "waiting_adaptation";
    case "build_in_house":
      return "waiting_in_house_build";
  }
}

function statusFromReview(review: ToolSkillReview): ToolSkillDevelopmentTaskStatus {
  if (review.reviewStatus === "已通过") return "approved";
  if (review.reviewStatus === "已拒绝") return "rejected";
  if (review.reviewStatus === "待开发者修改") return "needs_changes";
  if (review.reviewStatus === "检查中") return "waiting_manual_approval";
  return "validation_needed";
}

function developmentStatusFor(params: {
  assetId: string;
  declaredCapabilities: string[];
  task: ToolSkillDevelopmentTask | null;
  review: ToolSkillReview | null;
  runtime: ToolSkillDevelopmentRuntimeState;
}): ToolSkillDevelopmentStatus {
  if (!params.assetId || params.declaredCapabilities.length === 0) return "need_definition";
  if (
    params.runtime.status !== "available" &&
    (!params.review || params.review.reviewStatus !== "已通过")
  ) {
    if (params.task?.developmentStatus && params.task.developmentStatus !== "validation_needed") {
      return params.task.developmentStatus;
    }
    return "need_runtime";
  }
  if (params.review) return statusFromReview(params.review);
  if (params.task) {
    if (
      params.runtime.status === "available" &&
      params.task.developmentStatus === "candidate_found"
    ) {
      return "runtime_ready";
    }
    return params.task.developmentStatus;
  }
  if (params.runtime.status === "available") return "runtime_ready";
  return "need_source_plan";
}

function statusLabel(status: ToolSkillDevelopmentStatus): string {
  switch (status) {
    case "need_definition":
      return "等待填写工具/Skill 定义";
    case "need_source_plan":
      return "等待生成开发路线";
    case "candidate_found":
      return "已找到开发候选路线";
    case "source_selected":
      return "已选择开发来源";
    case "need_runtime":
      return "等待补运行实现";
    case "waiting_install_or_enable":
      return "等待安装或启用开源 Skill";
    case "waiting_adaptation":
      return "等待开源工具改造";
    case "waiting_in_house_build":
      return "等待自研工具/API Adapter";
    case "runtime_ready":
      return "运行实现已就绪，等待检查";
    case "validation_needed":
      return "等待执行综合检查";
    case "needs_changes":
      return "检查未通过，等待修改";
    case "waiting_manual_approval":
      return "检查通过，等待人工确认";
    case "approved":
      return "已通过，可绑定为品类通用能力";
    case "blocked":
      return "开发受阻";
    case "rejected":
      return "已拒绝";
  }
}

function nextActionsFor(params: {
  status: ToolSkillDevelopmentStatus;
  task: ToolSkillDevelopmentTask | null;
  review: ToolSkillReview | null;
  runtime: ToolSkillDevelopmentRuntimeState;
}): ToolSkillDevelopmentNextAction[] {
  switch (params.status) {
    case "need_definition":
      return [
        {
          kind: "define_asset",
          label: "补充定义",
          reason: "需要 assetId 和 declaredCapabilities 才能进入工具/Skill 开发链路。",
          enabled: true,
        },
      ];
    case "need_source_plan":
      return [
        {
          kind: "plan_source",
          label: "生成路线",
          reason: "先判断本地复用、开源复用、开源改造或自研。",
          enabled: Boolean(params.task),
        },
      ];
    case "candidate_found":
      return [
        {
          kind: "select_source",
          label: "选择来源",
          reason: "已有候选开发路线，需要系统开发者确认采用哪一条。",
          enabled: Boolean(params.task),
        },
      ];
    case "source_selected":
    case "need_runtime":
      return [
        {
          kind: "add_runtime",
          label: "补运行实现",
          reason: params.runtime.summary,
          enabled: true,
        },
      ];
    case "waiting_install_or_enable":
      return [
        {
          kind: "install_or_enable",
          label: "安装或启用",
          reason: params.runtime.summary,
          enabled: true,
        },
      ];
    case "waiting_adaptation":
      return [
        {
          kind: "adapt_open_source",
          label: "改造开源工具",
          reason: "需要封装为平台 Tool，并补齐权限、风险确认和调用记录。",
          enabled: true,
        },
      ];
    case "waiting_in_house_build":
      return [
        {
          kind: "build_in_house",
          label: "自研实现",
          reason: "需要按平台 Tool/Provider 契约开发运行实现。",
          enabled: true,
        },
      ];
    case "runtime_ready":
    case "validation_needed":
      return [
        {
          kind: "run_validation",
          label: "执行综合检查",
          reason: "运行实现已就绪，需要检查能力声明、跑通性和风险。",
          enabled: true,
        },
      ];
    case "needs_changes":
      return [
        {
          kind: "fix_asset",
          label: "修改后复查",
          reason:
            params.review?.reviewDecision ??
            params.task?.blockedReason ??
            "当前检查存在阻塞项，需要修复后重新检查。",
          enabled: true,
        },
      ];
    case "waiting_manual_approval":
      return [
        {
          kind: "manual_approve",
          label: "人工确认通过",
          reason: "综合检查没有阻塞项，需由系统开发者最终确认。",
          enabled: Boolean(params.review),
        },
      ];
    case "approved":
      return [
        {
          kind: "use_asset",
          label: "用于能力绑定",
          reason: "该工具/Skill 已通过审核，可被品类能力或岗位调度引用。",
          enabled: true,
        },
      ];
    case "blocked":
      return [
        {
          kind: "fix_asset",
          label: "解除阻塞",
          reason: params.task?.blockedReason ?? params.runtime.summary,
          enabled: true,
        },
      ];
    case "rejected":
      return [
        {
          kind: "fix_asset",
          label: "重新设计",
          reason:
            params.review?.reviewDecision ?? "当前工具/Skill 已被拒绝，需要重新定义后再进入检查。",
          enabled: true,
        },
      ];
  }
}

function routeLabel(route: ToolSkillSourceRoute): string {
  switch (route) {
    case "reuse_existing":
      return "复用本地已有实现";
    case "reuse_open_source":
      return "复用开源 Skill";
    case "adapt_open_source":
      return "开源改造";
    case "build_in_house":
      return "自研";
  }
}

function evidenceKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^(?:skill|provider)[._:-]+/u, "")
    .replace(/^platform[._:-]+/u, "")
    .replace(/[^a-z0-9]+/gu, "");
}

function evidenceKeysMatch(left: string, right: string): boolean {
  const a = evidenceKey(left);
  const b = evidenceKey(right);
  return Boolean(a && b && (a === b || a.endsWith(b) || b.endsWith(a)));
}
