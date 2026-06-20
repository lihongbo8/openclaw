import {
  BuildSession,
  type BuildSessionBrief,
  type BuildSessionRecord,
} from "./role-build-session.js";
import {
  createCategoryCapabilityRequest,
  createRoleCapabilityAnalysis,
  listToolSkillReviews,
  type CategoryCapabilityReview,
  type RoleCapabilityAnalysis,
  type ToolSkillReview,
} from "./role-pre-listing-review.js";
import {
  listToolSkillDevelopmentTasksForCategory,
  type ToolSkillDevelopmentTask,
} from "./tool-skill-development-store.js";

// ======================================================================
// RoleDevelopmentEngine: 岗位开发编排层
// ======================================================================
//
// 这个模块不替代已有 BuildSession、能力分析、审核中心或 ToolSupply。
// 它把现有能力合成一个稳定的“岗位开发状态”，让真人用户知道下一步该做什么。

export type RoleDevelopmentStatus =
  | "need_requirements"
  | "need_brief"
  | "need_capability_decision"
  | "waiting_capability_review"
  | "waiting_tool_skill_development"
  | "ready_to_generate"
  | "generating"
  | "validating"
  | "ready_for_review"
  | "failed"
  | "cancelled";

export type RoleDevelopmentNextActionKind =
  | "start_briefing"
  | "edit_brief"
  | "submit_capability_request"
  | "use_basic_version"
  | "open_review_center"
  | "open_tool_supply"
  | "confirm_and_generate"
  | "wait_generation"
  | "fix_validation"
  | "open_pre_listing_review"
  | "restart";

export type RoleDevelopmentNextAction = {
  kind: RoleDevelopmentNextActionKind;
  label: string;
  reason: string;
  enabled: boolean;
};

export type RoleDevelopmentCapabilityState = {
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

export type RoleDevelopmentToolSkillTodo = {
  reviewId: string;
  assetType: "tool" | "skill";
  assetId: string;
  reviewStatus: string;
  approved: boolean;
  nextAction: RoleDevelopmentNextAction;
};

export type RoleDevelopmentToolSkillState = {
  required: string[];
  todos: RoleDevelopmentToolSkillTodo[];
  total: number;
  approved: number;
  pending: number;
  ready: boolean;
};

export type RoleDevelopmentState = {
  sessionId: string;
  status: RoleDevelopmentStatus;
  userStatusLabel: string;
  roleTitle: string;
  categoryName: string;
  categoryRef: string;
  briefReady: boolean;
  canGenerateRolePackage: boolean;
  capability: RoleDevelopmentCapabilityState;
  categoryCapabilityReview: CategoryCapabilityReview | null;
  toolSkillDevelopment: RoleDevelopmentToolSkillState;
  nextActions: RoleDevelopmentNextAction[];
  analysis: RoleCapabilityAnalysis | null;
};

export type RoleDevelopmentEngine = {
  getStatus(session: BuildSessionRecord): RoleDevelopmentState;
  prepareMissingCapability(session: BuildSessionRecord): RoleDevelopmentState;
  reduceScopeToBasicVersion(session: BuildSessionRecord): RoleDevelopmentState;
};

export function createRoleDevelopmentEngine(): RoleDevelopmentEngine {
  return {
    getStatus(session) {
      return buildRoleDevelopmentState(session);
    },

    prepareMissingCapability(session) {
      if (!session.brief) {
        throw new Error("岗位 Brief 未填写，不能提交能力开发申请。");
      }
      const analysis = analyzeSession(session);
      if (!analysis.missingCapabilities.length) {
        return buildRoleDevelopmentState(session, analysis);
      }
      const review = createCategoryCapabilityRequest({
        requestId: analysis.categoryCapabilityReview.requestId,
        rolePackageId: session.brief.roleTitle || session.sessionId,
        listingDraftId: session.sessionId,
        developerId: "local-developer",
        title: session.brief.roleTitle,
        categoryName: analysis.categoryName,
        categoryRef: analysis.categoryRef,
        roleDescription: session.brief.roleDescription,
        targetUser: session.brief.targetUser,
        roleMaterials: roleMaterialsFromBrief(session.brief, analysis),
        requiredCapabilities: analysis.requiredCapabilities,
        inputOutput: inputOutputFromBrief(session.brief),
        toolSkillRequirements: [
          ...analysis.neededTools,
          ...analysis.neededSkills,
          ...analysis.neededProviders,
        ],
        riskBoundaries: riskBoundariesFromBrief(session.brief),
        reason: [
          `岗位开发引擎发现缺失能力：${analysis.missingCapabilities.join("、") || "无"}。`,
          "已复用现有品类能力申请与审核中心链路。",
        ].join(" "),
      });
      return buildRoleDevelopmentState(session, {
        ...analysis,
        categoryCapabilityReview: review,
      });
    },

    reduceScopeToBasicVersion(session) {
      if (!session.brief) {
        throw new Error("岗位 Brief 未填写，不能生成基础版。");
      }
      const analysis = analyzeSession(session);
      if (!analysis.missingCapabilities.length) {
        return buildRoleDevelopmentState(session, analysis);
      }
      if (!analysis.existingCapabilities.length) {
        throw new Error("当前没有可保留的已具备能力，不能生成基础版岗位。");
      }
      const keptCapabilities = basicVersionKeptCapabilities(analysis, session.brief);
      if (!keptCapabilities.length) {
        throw new Error("当前没有可保留的已具备能力，不能生成基础版岗位。");
      }
      const updated = BuildSession.reduceScopeToBasicVersion(session.sessionId, {
        keptCapabilities,
        disabledCapabilities: analysis.missingCapabilities,
        reason: "这些能力还没有正式工具/Skill供给，基础版暂不启用；后续可以通过能力开发请求补齐。",
      });
      return buildRoleDevelopmentState(updated);
    },
  };
}

export function buildRoleDevelopmentState(
  session: BuildSessionRecord,
  analysisOverride?: RoleCapabilityAnalysis,
): RoleDevelopmentState {
  const analysis = analysisOverride ?? (session.brief ? analyzeSession(session) : null);
  const toolSkillDevelopment = toolSkillDevelopmentStateFor(
    analysis?.categoryCapabilityReview ?? null,
  );
  const status = developmentStatusFor(session, analysis, toolSkillDevelopment);
  const capability = capabilityStateFor(analysis, session);
  const canGenerateRolePackage =
    session.state === "confirming" && Boolean(session.brief) && capability.missing.length === 0;

  return {
    sessionId: session.sessionId,
    status,
    userStatusLabel: statusLabel(status),
    roleTitle: session.brief?.roleTitle || session.userRequirements.slice(0, 40) || "未命名岗位",
    categoryName:
      analysis?.categoryName || session.brief?.targetCategory || session.matchedTemplate || "通用",
    categoryRef:
      analysis?.categoryRef || session.brief?.targetCategory || session.matchedTemplate || "",
    briefReady: Boolean(session.brief),
    canGenerateRolePackage,
    capability,
    categoryCapabilityReview: analysis?.categoryCapabilityReview ?? null,
    toolSkillDevelopment,
    nextActions: nextActionsFor({
      session,
      status,
      analysis,
      canGenerateRolePackage,
      toolSkillDevelopment,
    }),
    analysis,
  };
}

function analyzeSession(session: BuildSessionRecord): RoleCapabilityAnalysis {
  if (!session.brief) {
    throw new Error("Brief is required before role capability analysis");
  }
  const brief = session.brief;
  return createRoleCapabilityAnalysis({
    rolePackageId: brief.roleTitle || session.sessionId,
    listingDraftId: session.sessionId,
    developerId: "local-developer",
    roleTitle: brief.roleTitle,
    roleDescription: brief.roleDescription,
    targetUser: brief.targetUser,
    requiredCapabilities: brief.requiredCapabilities,
    sopFlow: [...brief.coreResponsibilities, ...brief.taskExamples].join("\n"),
    dailyPlan: brief.dailySop.join("\n"),
    weeklyPlan: brief.weeklySop.join("\n"),
    monthlyPlan: (brief.monthlySop ?? []).join("\n"),
    inputOutput: inputOutputFromBrief(brief),
    riskBoundaries: riskBoundariesFromBrief(brief),
  });
}

function capabilityStateFor(
  analysis: RoleCapabilityAnalysis | null,
  session: BuildSessionRecord,
): RoleDevelopmentCapabilityState {
  if (analysis) {
    return {
      required: analysis.requiredCapabilities,
      existing: analysis.existingCapabilities,
      missing: analysis.missingCapabilities,
      disabled: disabledCapabilitiesFromBrief(session.brief),
      neededTools: analysis.neededTools,
      neededSkills: analysis.neededSkills,
      neededProviders: analysis.neededProviders,
      humanConfirmationCapabilities: analysis.humanConfirmationCapabilities,
      nonAutomaticCapabilities: analysis.nonAutomaticCapabilities,
    };
  }
  const required = session.capabilityReport?.required ?? [];
  return {
    required,
    existing: [],
    missing: required,
    disabled: disabledCapabilitiesFromBrief(session.brief),
    neededTools: [],
    neededSkills: [],
    neededProviders: [],
    humanConfirmationCapabilities: [],
    nonAutomaticCapabilities: [],
  };
}

function disabledCapabilitiesFromBrief(brief: BuildSessionBrief | undefined): string[] {
  if (!brief) return [];
  const disabled: string[] = [];
  for (const item of brief.forbiddenActions) {
    const match = /基础版已关闭暂不可用能力：(.+?)(?:。|$)/u.exec(item);
    if (!match?.[1]) continue;
    disabled.push(...match[1].split("、"));
  }
  return uniqueStrings(disabled);
}

function developmentStatusFor(
  session: BuildSessionRecord,
  analysis: RoleCapabilityAnalysis | null,
  toolSkillDevelopment: RoleDevelopmentToolSkillState,
): RoleDevelopmentStatus {
  if (session.state === "cancelled") return "cancelled";
  if (session.state === "failed") return "failed";
  if (session.state === "created") return "need_requirements";
  if (session.state === "briefing" && !session.brief) return "need_brief";
  if (session.state === "generating") return "generating";
  if (session.state === "validating") return "validating";
  if (session.state === "completed") return "ready_for_review";
  if (analysis?.missingCapabilities.length) {
    if (
      analysis.categoryCapabilityReview?.reviewStatus === "已通过" &&
      toolSkillDevelopment.total > 0 &&
      !toolSkillDevelopment.ready
    ) {
      return "waiting_tool_skill_development";
    }
    return analysis.categoryCapabilityReview?.id
      ? "waiting_capability_review"
      : "need_capability_decision";
  }
  if (!session.brief) return "need_brief";
  return "ready_to_generate";
}

function statusLabel(status: RoleDevelopmentStatus): string {
  switch (status) {
    case "need_requirements":
      return "等待填写岗位需求";
    case "need_brief":
      return "等待确认岗位定义";
    case "need_capability_decision":
      return "发现缺失能力，等待开发决策";
    case "waiting_capability_review":
      return "能力申请已进入审核中心";
    case "waiting_tool_skill_development":
      return "工具与 Skill 制作中";
    case "ready_to_generate":
      return "能力可用，可以生成岗位包";
    case "generating":
      return "正在生成岗位包";
    case "validating":
      return "正在校验岗位包";
    case "ready_for_review":
      return "岗位包已生成，等待上架前审核";
    case "failed":
      return "岗位开发失败";
    case "cancelled":
      return "岗位开发已取消";
  }
}

function nextActionsFor(params: {
  session: BuildSessionRecord;
  status: RoleDevelopmentStatus;
  analysis: RoleCapabilityAnalysis | null;
  canGenerateRolePackage: boolean;
  toolSkillDevelopment: RoleDevelopmentToolSkillState;
}): RoleDevelopmentNextAction[] {
  switch (params.status) {
    case "need_requirements":
      return [
        {
          kind: "start_briefing",
          label: "开始匹配岗位",
          reason: "先把自然语言需求转换成岗位 Brief 和能力候选。",
          enabled: params.session.state === "created",
        },
      ];
    case "need_brief":
      return [
        {
          kind: "edit_brief",
          label: "填写岗位定义",
          reason: "岗位名称、职责、输入输出和能力需求确认后才能继续。",
          enabled: true,
        },
      ];
    case "need_capability_decision":
      return [
        {
          kind: "use_basic_version",
          label: "先做基础版",
          reason: basicVersionKeptCapabilities(params.analysis, params.session.brief).length
            ? `保留已具备能力：${basicVersionKeptCapabilities(params.analysis, params.session.brief).join("、")}；暂时关闭缺失能力。`
            : "当前没有可保留的已具备能力，不能生成基础版。",
          enabled: basicVersionKeptCapabilities(params.analysis, params.session.brief).length > 0,
        },
        {
          kind: "submit_capability_request",
          label: "提交能力开发申请",
          reason: `缺失能力：${params.analysis?.missingCapabilities.join("、") || "未识别"}。`,
          enabled: true,
        },
      ];
    case "waiting_capability_review":
      return [
        {
          kind: "open_review_center",
          label: "去审核中心处理能力",
          reason: "能力申请通过后，会进入现有 Tool/Skill 制作待办链路。",
          enabled: true,
        },
      ];
    case "waiting_tool_skill_development":
      return [
        {
          kind: "open_tool_supply",
          label: "去工具与 Skill处理",
          reason: `还有 ${params.toolSkillDevelopment.pending} 项工具/Skill 待办未完成。`,
          enabled: true,
        },
      ];
    case "ready_to_generate":
      return [
        {
          kind: "confirm_and_generate",
          label: "确认并生成岗位包",
          reason: "当前岗位能力已可满足，可以进入岗位包生成。",
          enabled: params.canGenerateRolePackage,
        },
      ];
    case "generating":
      return [
        {
          kind: "wait_generation",
          label: "等待生成完成",
          reason: params.session.progress?.message || "岗位包正在生成。",
          enabled: false,
        },
      ];
    case "validating":
      return [
        {
          kind: "fix_validation",
          label: "查看校验结果",
          reason: params.session.validationErrors.length
            ? params.session.validationErrors.join("；")
            : "岗位包正在校验。",
          enabled: params.session.validationErrors.length > 0,
        },
      ];
    case "ready_for_review":
      return [
        {
          kind: "open_pre_listing_review",
          label: "进入上架前审核",
          reason: "岗位包已生成，需要本地审核和品类能力绑定后才能成为正式岗位商品。",
          enabled: true,
        },
      ];
    case "failed":
    case "cancelled":
      return [
        {
          kind: "restart",
          label: "重新开始",
          reason: params.session.blockedReason || "当前会话不能继续推进。",
          enabled: true,
        },
      ];
  }
}

function basicVersionKeptCapabilities(
  analysis: RoleCapabilityAnalysis | null,
  brief?: BuildSessionBrief,
): string[] {
  if (!analysis) return [];
  const candidates = brief?.requiredCapabilities.length
    ? brief.requiredCapabilities
    : analysis.requiredCapabilities;
  return candidates.filter((capability) => analysis.existingCapabilities.includes(capability));
}

function toolSkillDevelopmentStateFor(
  review: CategoryCapabilityReview | null,
): RoleDevelopmentToolSkillState {
  const required = review?.toolSkillRequirements ?? [];
  if (!review || required.length === 0) {
    return {
      required,
      todos: [],
      total: 0,
      approved: 0,
      pending: 0,
      ready: required.length === 0,
    };
  }
  const allReviews = listToolSkillReviews();
  const allTasks = listToolSkillDevelopmentTasksForCategory(review.id);
  const todos = required
    .map((assetId) => {
      const review = findToolSkillReviewForRequirement(allReviews, assetId);
      if (review) return toolSkillTodoForReview(review);
      const task = findToolSkillTaskForRequirement(allTasks, assetId);
      return task ? toolSkillTodoForTask(task) : null;
    })
    .filter((item): item is RoleDevelopmentToolSkillTodo => Boolean(item));
  const approved = todos.filter((todo) => todo.approved).length;
  return {
    required,
    todos,
    total: required.length,
    approved,
    pending: Math.max(0, required.length - approved),
    ready: required.length > 0 && approved === required.length,
  };
}

function findToolSkillReviewForRequirement(
  reviews: ToolSkillReview[],
  assetId: string,
): ToolSkillReview | null {
  return reviews.find((review) => review.assetId === assetId) ?? null;
}

function findToolSkillTaskForRequirement(
  tasks: ToolSkillDevelopmentTask[],
  assetId: string,
): ToolSkillDevelopmentTask | null {
  return tasks.find((task) => task.assetId === assetId) ?? null;
}

function toolSkillTodoForTask(task: ToolSkillDevelopmentTask): RoleDevelopmentToolSkillTodo {
  return {
    reviewId: task.linkedReviewId || task.id,
    assetType: task.assetType,
    assetId: task.assetId,
    reviewStatus: task.linkedReviewId ? task.developmentStatus : "待创建审核单",
    approved: task.developmentStatus === "approved",
    nextAction: {
      kind: "open_tool_supply",
      label: "检查并通过",
      reason: "先在工具与 Skill 模块补齐运行实现、执行检查，再由系统开发者人工确认。",
      enabled: true,
    },
  };
}

function toolSkillTodoForReview(review: ToolSkillReview): RoleDevelopmentToolSkillTodo {
  const approved = review.reviewStatus === "已通过";
  const hasBlocking = review.reviewFindings.some((finding) => finding.severity === "blocking");
  return {
    reviewId: review.id,
    assetType: review.assetType,
    assetId: review.assetId,
    reviewStatus: review.reviewStatus,
    approved,
    nextAction: approved
      ? {
          kind: "open_tool_supply",
          label: "已完成",
          reason: "该工具/Skill 已通过人工审核。",
          enabled: false,
        }
      : hasBlocking || review.reviewStatus === "待开发者修改"
        ? {
            kind: "open_tool_supply",
            label: "修改后复查",
            reason: "当前检查存在阻塞项，需要修复后重新检查。",
            enabled: true,
          }
        : {
            kind: "open_tool_supply",
            label: "检查并通过",
            reason: "先执行工具/Skill 检查，通过后由系统开发者人工确认。",
            enabled: true,
          },
  };
}

function inputOutputFromBrief(brief: BuildSessionBrief): string {
  return [
    brief.inputTypes.length ? `输入：${brief.inputTypes.join("、")}` : "",
    brief.outputTypes.length ? `输出：${brief.outputTypes.join("、")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function riskBoundariesFromBrief(brief: BuildSessionBrief): string[] {
  return [...brief.forbiddenActions, ...brief.qualityStandards].filter(Boolean);
}

function roleMaterialsFromBrief(brief: BuildSessionBrief, analysis: RoleCapabilityAnalysis) {
  return {
    roleTitle: brief.roleTitle,
    roleDescription: brief.roleDescription,
    targetUser: brief.targetUser,
    targetCategory: analysis.categoryName,
    requiredCapabilities: analysis.requiredCapabilities,
    sopFlow: [...brief.coreResponsibilities, ...brief.taskExamples].join("\n"),
    dailyPlan: brief.dailySop.join("\n"),
    weeklyPlan: brief.weeklySop.join("\n"),
    monthlyPlan: (brief.monthlySop ?? []).join("\n"),
    inputOutput: inputOutputFromBrief(brief),
    riskBoundaries: riskBoundariesFromBrief(brief),
  };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
