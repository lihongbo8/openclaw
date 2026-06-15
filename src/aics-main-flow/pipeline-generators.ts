import { randomUUID } from "node:crypto";
import type { AttributionCompareResult } from "./attribution-comparator.js";
import type {
  PreparePlanningInput,
  CreateDispatchProposalInput,
  MaterializeTaskPackageInput,
  CreateGoalCandidateInput,
} from "./store.js";
import type {
  CompanyGoal,
  AttributionReport,
  PlanningPackage,
  RolePlanItem,
  DispatchProposalReview,
  ObservationPackage,
} from "./types.js";

// ======================================================================
// GoalCandidateGenerator
// ======================================================================

export type GoalGenerateInput = {
  attributionResult: AttributionCompareResult;
  attributionReportId: string;
  /** 观察包 ID——CompanyGoal 是观察+归因+目标三方共同确认的结果 */
  observationPackageId?: string;
  owner: string;
};

/**
 * 根据观察和归因结果自动生成公司目标候选。
 * CompanyGoal = ObservationPackage + AttributionReport + 用户确认
 *
 * 关键边界：只产出可治理目标，不启动规划调度。
 */
export function generateGoalCandidate(input: GoalGenerateInput): CreateGoalCandidateInput {
  const { attributionResult } = input;

  const isOnTrack = attributionResult.completionStatus === "on_track";
  const isDataInsufficient = attributionResult.dataInsufficient;
  const defaultMarketplaceGoalTitle = "提升岗位商城首批岗位授权转化与执行成功率";

  // 从归因结果推断目标类型
  let title = defaultMarketplaceGoalTitle;
  let metric = "首批岗位授权转化与执行成功率";
  let target = "首批岗位商品完成可授权展示，授权转化和执行成功率进入可追踪状态";
  let rationale: string;

  if (isDataInsufficient) {
    rationale =
      "当前缺少足够的岗位供给、授权转化、执行质量、费用和审核阻塞数据。先以岗位商城首批岗位运营为目标，建立可追踪数据基线。";
  } else if (isOnTrack) {
    const topCause = attributionResult.rankedCauses[0];
    rationale = `归因分析显示岗位商城运营处于可推进状态：${attributionResult.gapSummary}。继续巩固 ${topCause?.title ?? "授权转化与执行质量"}。`;
  } else {
    const topCause = attributionResult.rankedCauses[0];
    rationale =
      `归因分析发现 ${attributionResult.rankedCauses.length} 个岗位商城运营问题，` +
      `最关键是：${topCause?.summary ?? attributionResult.gapSummary}`;
  }

  return {
    title,
    owner: input.owner,
    metric,
    target,
    rationale,
    attributionReportId: input.attributionReportId,
    observationPackageId: input.observationPackageId,
  };
}

// ======================================================================
// PlanningGenerator
// ======================================================================

export type PlanningGenerateInput = {
  goal: CompanyGoal;
  attributionReport?: AttributionReport;
  observationPackage?: ObservationPackage;
};

/**
 * 根据已确认的公司目标和归因报告，自动生成规划包和岗位计划项。
 *
 * 关键边界：只产出方案和 RolePlanItem，不创建 TaskPackage。
 */
export function generatePlanningPackage(input: PlanningGenerateInput): {
  planning: PreparePlanningInput;
  rolePlanItems: Array<RolePlanItem>;
} {
  const { goal, attributionReport } = input;
  const rolePlanItems: Array<RolePlanItem> = [];
  const now = Date.now();
  const marketplaceGoalText = `${goal.title} ${goal.metric} ${goal.target} ${goal.rationale}`;
  const isRoleMarketplaceOperation = /岗位商城|岗位商品|授权转化|执行成功率/.test(
    marketplaceGoalText,
  );

  if (isRoleMarketplaceOperation) {
    const marketplaceItems = [
      {
        title: "岗位供给优化",
        roleCapabilityRef: "data-analysis",
        taskIntent: "梳理首批岗位商品的供给完整度、审核状态、能力标签和上架阻塞。",
        expectedOutput: "岗位供给清单、缺口判断、审核阻塞和下一步补齐建议。",
        humanConfirmationRequired: false,
      },
      {
        title: "岗位详情页转化优化",
        roleCapabilityRef: "ecommerce-visual",
        taskIntent:
          "让电商美工岗位为岗位商城首批岗位商品输出展示优化建议、详情页结构建议、授权转化视觉建议。",
        expectedOutput: "岗位商品页展示优化方案、详情页模块结构、主视觉和授权转化建议。",
        humanConfirmationRequired: true,
      },
      {
        title: "执行质量提升",
        roleCapabilityRef: "data-analysis",
        taskIntent: "分析岗位执行成功率、失败原因、产物回写和用户反馈，找出首批岗位执行质量问题。",
        expectedOutput: "执行质量诊断、失败模式、可验证改进动作和回写要求。",
        humanConfirmationRequired: false,
      },
      {
        title: "授权费用治理",
        roleCapabilityRef: "billing-governance",
        taskIntent: "核对岗位授权、执行确认、费用确认和 ledger 记录是否能支撑调度前闸门。",
        expectedOutput: "授权/费用闸门检查表、阻塞项和费用与授权页面处理建议。",
        humanConfirmationRequired: true,
      },
      {
        title: "审核阻塞处理",
        roleCapabilityRef: "marketplace-review",
        taskIntent: "定位岗位审核、能力目录、云端岗位桥和本地调度之间的确认点。",
        expectedOutput: "审核阻塞清单、确认点负责人和解除阻塞顺序。",
        humanConfirmationRequired: true,
      },
    ];

    rolePlanItems.push(
      ...marketplaceItems.map((item) => ({
        id: randomUUID(),
        kind: "RolePlanItem" as const,
        status: "draft" as const,
        createdAt: now,
        updatedAt: now,
        auditRefs: [],
        planningPackageId: "",
        category: "岗位商城",
        ...item,
      })),
    );
  }

  // 1. 数据分析/观察岗位 —— 补充数据基线
  if (
    !isRoleMarketplaceOperation &&
    attributionReport?.findings.some(
      (f) => f.confidence === "low" || f.summary.includes("数据不足"),
    )
  ) {
    rolePlanItems.push({
      id: randomUUID(),
      kind: "RolePlanItem",
      status: "draft",
      createdAt: now,
      updatedAt: now,
      auditRefs: [],
      planningPackageId: "",
      title: "数据收集与基线建立",
      roleCapabilityRef: "data-collection",
      taskIntent: `收集 "${goal.metric}" 相关数据，建立可靠度量基线`,
      expectedOutput: "包含至少5个量化信号的新 ObservationPackage",
      humanConfirmationRequired: false,
    });
  }

  // 2. 根据归因结果生成修复/优化岗位
  if (!isRoleMarketplaceOperation && attributionReport) {
    for (const finding of attributionReport.findings.filter(
      (f) => f.confidence === "medium" || f.confidence === "high",
    )) {
      rolePlanItems.push({
        id: randomUUID(),
        kind: "RolePlanItem",
        status: "draft",
        createdAt: now,
        updatedAt: now,
        auditRefs: [],
        planningPackageId: "",
        title: `处理归因发现：${finding.title}`,
        roleCapabilityRef: findCapabilityForFinding(finding.title),
        taskIntent: finding.summary,
        expectedOutput: `解决 "${finding.title}" 的工作成果和验证证据`,
        humanConfirmationRequired: finding.confidence === "high",
      });
    }
  }

  // 3. 通用执行岗位 —— 推进目标
  if (rolePlanItems.length === 0) {
    rolePlanItems.push({
      id: randomUUID(),
      kind: "RolePlanItem",
      status: "draft",
      createdAt: now,
      updatedAt: now,
      auditRefs: [],
      planningPackageId: "",
      title: `推进目标：${goal.title}`,
      roleCapabilityRef: "general-execution",
      taskIntent: `执行为达成目标 "${goal.metric} = ${goal.target}" 所需的通用工作任务`,
      expectedOutput: `目标 "${goal.title}" 的阶段性进展报告`,
      humanConfirmationRequired: true,
    });
  }

  const itemIds = rolePlanItems.map((item) => item.id);

  return {
    planning: {
      title: `规划方案：${goal.title}`,
      summary: [
        `基于目标 "${goal.metric} = ${goal.target}"`,
        attributionReport ? `和归因报告 "${attributionReport.title}"` : "",
        `生成 ${itemIds.length} 个岗位计划项`,
        goal.rationale,
      ]
        .filter(Boolean)
        .join("。"),
      goalId: goal.id,
      rolePlanItems: rolePlanItems.map((item) => ({
        id: item.id,
        title: item.title,
        category: item.category,
        roleCapabilityRef: item.roleCapabilityRef,
        taskIntent: item.taskIntent,
        expectedOutput: item.expectedOutput,
        humanConfirmationRequired: item.humanConfirmationRequired,
      })),
    },
    rolePlanItems,
  };
}

// ======================================================================
// DispatchGenerator
// ======================================================================

export type DispatchGenerateInput = {
  planningPackage: PlanningPackage;
  rolePlanItems: RolePlanItem[];
  /** 哪个 RolePlanItem 要生成调度建议 */
  targetRolePlanItemId?: string;
};

/**
 * 根据已确认的规划包和岗位计划项，自动生成调度建议审核。
 *
 * 关键边界：只产出 DispatchProposalReview，不物化 TaskPackage。
 * 物化由 Dispatcher 层的 materialize_task_packages_from_dispatch_proposal 完成。
 */
export function generateDispatchProposal(input: DispatchGenerateInput): Array<{
  proposal: CreateDispatchProposalInput;
  rolePlanItem: RolePlanItem;
}> {
  const items = input.targetRolePlanItemId
    ? input.rolePlanItems.filter((item) => item.id === input.targetRolePlanItemId)
    : input.rolePlanItems;

  return items.map((item) => {
    const riskSummary = assessRisk(item);
    const confirmationSummary = buildConfirmationSummary(item, riskSummary);

    return {
      proposal: {
        title: `调度建议：${item.title}`,
        riskSummary,
        confirmationSummary,
        planningPackageId: input.planningPackage.id,
        rolePlanItemId: item.id,
      },
      rolePlanItem: item,
    };
  });
}

// ======================================================================
// TaskMaterializer (调度层唯一物化入口)
// ======================================================================

export type MaterializeInput = {
  dispatchProposal: DispatchProposalReview;
  rolePlanItem: RolePlanItem;
};

/**
 * 根据已批准的调度建议物化 TaskPackage。
 *
 * 关键边界：这是唯一可以创建 TaskPackage 的层。
 * 必须在 DispatchProposalReview 批准（HumanConfirm approve）后才能调用。
 */
export function materializeTaskPackage(input: MaterializeInput): MaterializeTaskPackageInput {
  const { dispatchProposal, rolePlanItem } = input;

  return {
    title: `任务：${rolePlanItem.title}`,
    taskText: [
      `任务意图：${rolePlanItem.taskIntent}`,
      `期望输出：${rolePlanItem.expectedOutput}`,
      `风险评估：${dispatchProposal.riskSummary}`,
      `确认要点：${dispatchProposal.confirmationSummary}`,
      `来源岗位计划项：${rolePlanItem.id}`,
    ].join("\n"),
    dispatchProposalReviewId: dispatchProposal.id,
    request: {
      roleListingId:
        rolePlanItem.roleCapabilityRef === "ecommerce-visual"
          ? "role_marketplace_ecommerce_visual"
          : undefined,
      roleTitle: rolePlanItem.title,
      workspaceDir: undefined,
    },
  };
}

// ======================================================================
// Helpers
// ======================================================================

function findCapabilityForFinding(findingTitle: string): string {
  const lower = findingTitle.toLowerCase();
  if (lower.includes("岗位商城") || lower.includes("授权转化")) return "ecommerce-visual";
  if (lower.includes("数据") || lower.includes("指标")) return "data-analysis";
  if (lower.includes("图片") || lower.includes("美工")) return "visual-design";
  if (lower.includes("视频")) return "video-production";
  if (lower.includes("文案") || lower.includes("内容")) return "content-creation";
  if (lower.includes("执行") || lower.includes("任务")) return "general-execution";
  return "general-execution";
}

function assessRisk(item: RolePlanItem): string {
  if (item.humanConfirmationRequired) {
    return `HIGH: 岗位 "${item.title}" 需要人工确认。该任务进入岗位商城调度前必须完成岗位授权、执行确认和费用确认。`;
  }
  return `LOW: 岗位 "${item.title}" 属于岗位商城常规运营分析任务。预期输出可人工复核，失败时回滚到 blocked 状态。`;
}

function buildConfirmationSummary(item: RolePlanItem, riskSummary: string): string {
  return [
    `请确认以下内容后批准调度：`,
    `1. 任务 "${item.title}" 的目标和预期输出明确`,
    `2. 岗位能力 "${item.roleCapabilityRef}" 可用于此任务`,
    `3. 岗位授权、执行确认和费用确认将在岗位执行前校验`,
    `4. 风险评估已审阅：${riskSummary.slice(0, 80)}...`,
    `确认批准后，Dispatcher 将物化 TaskPackage 并派给岗位层执行。`,
  ].join("\n");
}
