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
  const topCause = attributionResult.rankedCauses[0];
  const causeTitles = attributionResult.rankedCauses.map((cause) => cause.title);
  const sourceObservationSignalIds = [
    ...new Set(attributionResult.rankedCauses.flatMap((cause) => cause.evidenceRefs)),
  ];
  const sourceAttributionFindingIds = attributionResult.rankedCauses.map(
    (cause) => `finding-${cause.rank}`,
  );

  // 从归因结果推断目标类型
  let title = "提升岗位商城首批岗位授权转化与执行成功率";
  let metric = "首批岗位授权转化与执行成功率";
  let target = "首批岗位商品完成可授权展示，授权转化和执行成功率进入可追踪状态";
  let currentValue = inferCurrentValue(attributionResult.gapSummary);
  const blockedReasons: string[] = [];
  let rationale: string;

  if (isDataInsufficient) {
    title = "补齐岗位商城经营观察数据基线";
    metric = "可归因经营证据完整度";
    currentValue = "证据不足";
    target = "观察证据、归因发现和关键经营指标均可追溯";
    blockedReasons.push("观察证据不足，暂不能进入正式规划");
    rationale =
      "当前缺少足够的岗位供给、授权转化、执行质量、费用和审核阻塞数据。先以岗位商城首批岗位运营为目标，建立可追踪数据基线。";
  } else if (isOnTrack) {
    rationale = `归因分析显示岗位商城运营处于可推进状态：${attributionResult.gapSummary}。继续巩固 ${topCause?.title ?? "授权转化与执行质量"}。`;
  } else {
    if (causeTitles.includes("API / 模型 / 工具 / Skill 问题")) {
      title = "清零 API、模型、工具和 Skill 执行阻塞";
      metric = "系统使用阻塞数";
      target = "API、模型、工具、Skill 阻塞数降到 0";
    } else if (causeTitles.includes("岗位供给问题") || causeTitles.includes("商城问题")) {
      title = "补齐首批岗位商品审核与可授权材料";
      metric = "首批岗位商品可授权完成度";
      target = "首批岗位商品完成审核、能力标签和输出样例补齐";
    } else if (causeTitles.includes("调度链路问题") || causeTitles.includes("岗位执行质量问题")) {
      title = "提升云端商城到本地 OpenClaw 的岗位执行闭环成功率";
      metric = "岗位执行闭环成功率";
      target = "岗位执行链路成功率达到 90%，产物、审计、账本和模型证据完整回读";
    } else if (causeTitles.includes("授权问题") || causeTitles.includes("能力路由问题")) {
      title = "打通岗位授权与能力路由可调用链路";
      metric = "已授权岗位可调用率";
      target = "已授权岗位可调用率达到 90%，关键能力路由阻塞清零";
    }
    rationale =
      `归因分析发现 ${attributionResult.rankedCauses.length} 个岗位商城运营问题，` +
      `最关键是：${topCause?.summary ?? attributionResult.gapSummary}`;
  }

  return {
    title,
    owner: input.owner,
    metric,
    currentValue,
    target,
    cycle: "当前经营周期",
    rationale,
    whyNow: topCause?.summary ?? "该目标来自最新观察和归因结果，需先确认目标，再进入规划拆解。",
    attributionReportId: input.attributionReportId,
    observationPackageId: input.observationPackageId,
    sourceObservationSignalIds,
    sourceAttributionFindingIds,
    blockedReasons,
    readyForPlanning: !isDataInsufficient && blockedReasons.length === 0,
  };
}

function inferCurrentValue(summary: string): string {
  const normalized = summary.trim();
  if (!normalized) return "待确认";
  const actualMatch = normalized.match(/实际\s*([^，。；]+)/);
  if (actualMatch?.[1]) return actualMatch[1].trim();
  const gapMatch = normalized.match(/(阻塞数|完成率|成功率|转化率|证据完整度)[^，。；]*/);
  return gapMatch?.[0]?.trim() || "来自最新观察，待用户确认";
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
        title: "岗位供给与审核优化",
        roleCapabilityRef: "marketplace-operations",
        taskIntent: "梳理首批岗位商品的供给完整度、审核状态、能力标签和上架阻塞。",
        expectedOutput: "岗位供给清单、缺口判断、审核阻塞和下一步补齐建议。",
        humanConfirmationRequired: false,
        capabilityMatchSummary: "适合商城运营岗位承接，需要读取岗位商品、审核、品类和授权状态。",
        acceptanceCriteria: [
          "列出首批岗位商品的审核状态、能力标签和输出样例缺口",
          "每个缺口给出负责人、处理顺序和验收口径",
          "明确哪些岗位商品已满足进入授权和调度前检查",
        ],
      },
      {
        title: "岗位商品信息架构优化",
        roleCapabilityRef: "marketplace-listing-ops",
        taskIntent:
          "优化首批岗位商品的能力说明、授权说明、输出样例、调用边界和审核材料，让买家能判断岗位是否可用。",
        expectedOutput: "岗位商品信息架构、授权说明、输出样例清单、可调用边界和审核材料补齐建议。",
        humanConfirmationRequired: true,
        capabilityMatchSummary:
          "适合商品运营岗位承接，需要岗位详情、能力说明、样例产物和审核意见。",
        acceptanceCriteria: [
          "每个岗位商品都有买家能看懂的能力说明和调用边界",
          "每个岗位商品至少有一个可审核的输出样例或样例缺口说明",
          "审核材料能直接交给商城审核模块继续处理",
        ],
      },
      {
        title: "能力路由与执行质量提升",
        roleCapabilityRef: "capability-routing",
        taskIntent:
          "分析岗位授权、能力匹配、工具/Skill/API 准备度、执行成功率、失败原因、产物回写和用户反馈。",
        expectedOutput: "能力路由诊断、执行质量诊断、失败模式、可验证改进动作和回写要求。",
        humanConfirmationRequired: false,
        capabilityMatchSummary:
          "适合能力路由/执行质量岗位承接，需要读取授权、工具、Skill、API 和历史执行结果。",
        acceptanceCriteria: [
          "列出每个可授权岗位的能力匹配状态和不可调用原因",
          "执行失败原因能映射到 API、工具、Skill、授权或调度修复入口",
          "产物、审计、账本和模型证据的回写要求清晰",
        ],
      },
      {
        title: "API 与模型连接治理",
        roleCapabilityRef: "api-connection-ops",
        taskIntent:
          "核对云端商城、本地 Gateway、多模型 Provider、工具 API、Skill 依赖和 SecretRef 是否能支撑岗位执行。",
        expectedOutput: "系统使用连通性检查表、缺失 SecretRef、blocked reason 和修复顺序。",
        humanConfirmationRequired: true,
        capabilityMatchSummary:
          "适合系统连接运营岗位承接，需要 API 管理页、SecretRef、模型 Provider 和本地服务健康状态。",
        acceptanceCriteria: [
          "列出云端商城、本地 Gateway、模型 Provider、工具和 Skill 的可用状态",
          "缺失连接必须给出要去的页面和填写项",
          "不包含费用、账单和岗位价格明细",
        ],
      },
      {
        title: "授权闸门治理",
        roleCapabilityRef: "authorization-governance",
        taskIntent: "核对岗位授权、执行确认、费用确认引用和 ledger 摘要是否能支撑调度前闸门。",
        expectedOutput:
          "授权闸门检查表、阻塞项和费用与授权页面处理建议，不在 API 管理页展示费用明细。",
        humanConfirmationRequired: true,
        capabilityMatchSummary:
          "适合费用与授权运营岗位承接，需要授权状态、执行确认、费用确认和账本摘要。",
        acceptanceCriteria: [
          "每个待调度岗位都有授权状态和费用确认状态",
          "缺授权或缺费用确认时给出费用与授权页面修复入口",
          "不在规划层直接执行岗位或创建正式 TaskPackage",
        ],
      },
      {
        title: "外部能力吸收与风险治理",
        roleCapabilityRef: "external-capability-risk",
        taskIntent: "观察竞品、外部模型、工具、产品能力和风险变化，判断哪些能力应被岗位商城吸收。",
        expectedOutput: "外部能力机会清单、风险清单、可吸收能力建议和暂不吸收原因。",
        humanConfirmationRequired: true,
        capabilityMatchSummary:
          "适合外部观察/风险治理岗位承接，需要外部信息采集工具、模型分析和风险规则。",
        acceptanceCriteria: [
          "外部能力或风险必须有来源和时间",
          "每个可吸收能力都说明适合绑定到哪个品类包或岗位能力",
          "风险项必须给出继续观察、暂缓或进入审核的建议",
        ],
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
        blockedReasons: [],
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
      capabilityMatchSummary:
        "适合数据分析岗位承接，需要内部经营数据、外部信息采集和证据整理能力。",
      acceptanceCriteria: [
        "每条观察信号都有证据来源",
        "缺失或过期数据必须标记为待验证",
        "输出能被归因层直接引用",
      ],
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
        capabilityMatchSummary: `根据归因发现 "${finding.title}" 匹配对应岗位能力。`,
        acceptanceCriteria: [
          `修复动作能对应归因发现：${finding.title}`,
          "输出包含业务结果、验证方式和下一步调度建议",
          "未满足执行条件时必须写明阻塞原因",
        ],
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
      capabilityMatchSummary: "适合通用运营岗位承接，需要根据目标补齐具体执行条件。",
      acceptanceCriteria: [
        "说明谁负责、做什么、输出什么",
        "产物和验收标准能被调度层读取",
        "缺 API、授权、工具或 Skill 时明确阻塞原因",
      ],
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
        capabilityMatchSummary: item.capabilityMatchSummary,
        blockedReasons: item.blockedReasons ?? [],
        acceptanceCriteria: item.acceptanceCriteria,
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
        rolePlanItem.roleCapabilityRef === "marketplace-listing-ops"
          ? "role_marketplace_listing_operations"
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
  if (lower.includes("能力路由") || lower.includes("执行成功") || lower.includes("可调用"))
    return "capability-routing";
  if (
    lower.includes("api") ||
    lower.includes("模型") ||
    lower.includes("tool") ||
    lower.includes("skill")
  )
    return "api-connection-ops";
  if (lower.includes("审核")) return "marketplace-review";
  if (lower.includes("授权")) return "authorization-governance";
  if (lower.includes("岗位商城") || lower.includes("岗位商品") || lower.includes("转化"))
    return "marketplace-listing-ops";
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
