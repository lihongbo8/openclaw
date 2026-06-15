import { getSafeLocalStorage } from "../local-storage.ts";

export type BusinessCadenceId = "year" | "quarter" | "month" | "week";

export type BusinessCadence = {
  id: BusinessCadenceId;
  label: string;
  shortLabel: string;
  operatingQuestion: string;
  reviewRhythm: string;
};

export type BusinessGoal = {
  id: string;
  cadenceId: BusinessCadenceId;
  title: string;
  owner: string;
  status: "planned" | "running" | "review" | "blocked";
  metric: string;
  target: string;
  linkedProjectIds: string[];
  observationIds: string[];
  attributionIds: string[];
  planningIds: string[];
};

export type BusinessDepartment = {
  id: string;
  name: string;
  responsibility: string;
  owner: string;
  linkedProjectIds: string[];
  peopleFocus: string;
};

export type BusinessProjectMilestone = {
  title: string;
  status: "planned" | "running" | "review" | "done" | "blocked";
};

export type BusinessProjectRisk = {
  title: string;
  mitigation: string;
  status: "watch" | "needs-confirmation" | "blocked";
};

export type BusinessProject = {
  id: string;
  name: string;
  theme: string;
  ownerDepartmentId: string;
  linkedGoalIds: string[];
  status: "planned" | "running" | "review" | "blocked";
  deliverable: string;
  milestones: BusinessProjectMilestone[];
  risks: BusinessProjectRisk[];
};

export type BusinessSignalStatus = "ready" | "watch" | "needs-confirmation" | "blocked";

export type BusinessObservationSignal = {
  id: string;
  title: string;
  status: BusinessSignalStatus;
  summary: string;
  evidenceLabel: string;
  linkedGoalIds: string[];
};

export type BusinessAttributionSignal = {
  id: string;
  title: string;
  status: BusinessSignalStatus;
  summary: string;
  confidenceLabel: string;
  linkedGoalIds: string[];
};

export type BusinessPlanningSignal = {
  id: string;
  title: string;
  status: BusinessSignalStatus;
  summary: string;
  projectId: string;
  departmentId: string;
  linkedGoalIds: string[];
};

export type BusinessFlowTaskSource = "planning" | "dispatch" | "manual";

export type BusinessFlowTaskRef = {
  cadenceId: BusinessCadenceId;
  projectId: string;
  goalIds: string[];
  departmentId: string;
  source: BusinessFlowTaskSource;
  capabilityRefs?: string[];
  planningRef?: string;
  rolePlanItemRef?: string;
  taskPackageRef?: string;
  dispatchRunRef?: string;
};

export type BusinessFlowTaskDraft = {
  title: string;
  notes: string;
  labels: string[];
  businessFlow: BusinessFlowTaskRef;
};

export type ResolvedBusinessFlowTaskRef = {
  ref: BusinessFlowTaskRef;
  cadence: BusinessCadence | null;
  project: BusinessProject | null;
  goals: BusinessGoal[];
  department: BusinessDepartment | null;
};

export type BusinessFlowSelectionPatch = Partial<{
  selectedCadenceId: BusinessCadenceId;
  selectedProjectId: string;
}>;

export type BusinessFlowState = {
  selectedCadenceId: BusinessCadenceId;
  selectedProjectId: string;
};

export type BusinessFlowProjection = {
  cadences: BusinessCadence[];
  goals: BusinessGoal[];
  departments: BusinessDepartment[];
  projects: BusinessProject[];
  observations: BusinessObservationSignal[];
  attributions: BusinessAttributionSignal[];
  planningSignals: BusinessPlanningSignal[];
  selectedCadence: BusinessCadence;
  selectedGoals: BusinessGoal[];
  selectedObservations: BusinessObservationSignal[];
  selectedAttributions: BusinessAttributionSignal[];
  selectedPlanningSignals: BusinessPlanningSignal[];
  selectedProject: BusinessProject;
  selectedProjectGoals: BusinessGoal[];
  selectedProjectPlanningSignals: BusinessPlanningSignal[];
  selectedProjectDepartment: BusinessDepartment;
  projectTaskCount: number;
};

const STORAGE_KEY = "openclaw.business-flow.v1";

export const BUSINESS_CADENCES: BusinessCadence[] = [
  {
    id: "year",
    label: "年度经营目标",
    shortLabel: "年",
    operatingQuestion: "今年公司必须达成哪些经营结果？",
    reviewRhythm: "年度定方向，季度校准。",
  },
  {
    id: "quarter",
    label: "季度关键战役",
    shortLabel: "季",
    operatingQuestion: "本季度哪些项目最能推进年度目标？",
    reviewRhythm: "季度定战役，月度复盘。",
  },
  {
    id: "month",
    label: "月度经营计划",
    shortLabel: "月",
    operatingQuestion: "本月目标差距、现金、人员和项目风险在哪里？",
    reviewRhythm: "月度定计划，周会追偏差。",
  },
  {
    id: "week",
    label: "周经营例会",
    shortLabel: "周",
    operatingQuestion: "本周哪些任务必须推进、确认或止损？",
    reviewRhythm: "每周追项目阻塞和岗位交付。",
  },
];

export const BUSINESS_GOALS: BusinessGoal[] = [
  {
    id: "goal-annual-revenue",
    cadenceId: "year",
    title: "年度收入与现金流目标",
    owner: "经营管理层",
    status: "running",
    metric: "收入、毛利、现金回款、关键客户留存",
    target: "形成稳定获客、交付和复购节奏，保证现金流安全。",
    linkedProjectIds: ["project-channel-growth", "project-key-account-delivery"],
    observationIds: ["obs-revenue-cashflow", "obs-customer-retention"],
    attributionIds: ["attr-channel-quality", "attr-delivery-scope"],
    planningIds: ["plan-channel-growth", "plan-key-account-delivery"],
  },
  {
    id: "goal-quarter-growth",
    cadenceId: "quarter",
    title: "季度增长战役",
    owner: "市场与销售部",
    status: "running",
    metric: "线索数、成交率、复购机会、渠道转化",
    target: "围绕一个主推产品和一个重点渠道完成增长验证。",
    linkedProjectIds: ["project-channel-growth", "project-product-launch"],
    observationIds: ["obs-channel-conversion", "obs-product-feedback"],
    attributionIds: ["attr-channel-quality", "attr-product-positioning"],
    planningIds: ["plan-channel-growth", "plan-product-launch"],
  },
  {
    id: "goal-month-delivery",
    cadenceId: "month",
    title: "月度交付质量",
    owner: "交付与运营部",
    status: "planned",
    metric: "准时交付率、返工率、客户确认周期、问题关闭率",
    target: "把客户需求、方案确认、执行交付和验收复盘稳定下来。",
    linkedProjectIds: ["project-key-account-delivery", "project-delivery-process"],
    observationIds: ["obs-delivery-cycle", "obs-customer-retention"],
    attributionIds: ["attr-delivery-scope"],
    planningIds: ["plan-key-account-delivery", "plan-delivery-process"],
  },
  {
    id: "goal-weekly-ops",
    cadenceId: "week",
    title: "本周经营推进",
    owner: "项目部",
    status: "review",
    metric: "项目阻塞、待确认节点、规划就绪度、人员负荷",
    target: "把本周项目动作整理成可确认计划，并清掉确认和资源阻塞。",
    linkedProjectIds: ["project-product-launch", "project-ops-rhythm"],
    observationIds: ["obs-weekly-blockers", "obs-people-load"],
    attributionIds: ["attr-resource-conflict"],
    planningIds: ["plan-product-launch", "plan-ops-rhythm"],
  },
];

export const BUSINESS_OBSERVATIONS: BusinessObservationSignal[] = [
  {
    id: "obs-revenue-cashflow",
    title: "收入与现金流事实",
    status: "watch",
    summary: "收入、毛利、回款和成本消耗需要在经营例会中统一校准。",
    evidenceLabel: "财务台账 / 授权账本 / 费用摘要",
    linkedGoalIds: ["goal-annual-revenue"],
  },
  {
    id: "obs-customer-retention",
    title: "重点客户留存信号",
    status: "needs-confirmation",
    summary: "重点客户交付和复购机会已出现确认口径不一致的问题。",
    evidenceLabel: "客户确认记录 / 交付验收记录",
    linkedGoalIds: ["goal-annual-revenue", "goal-month-delivery"],
  },
  {
    id: "obs-channel-conversion",
    title: "渠道转化观察",
    status: "watch",
    summary: "渠道线索数量可追踪，但有效线索比例和成交原因还需要每周复核。",
    evidenceLabel: "线索池 / 跟进记录 / 成交复盘",
    linkedGoalIds: ["goal-quarter-growth"],
  },
  {
    id: "obs-product-feedback",
    title: "新品反馈观察",
    status: "ready",
    summary: "产品卖点、素材反馈和上架准备可以支撑本季度增长规划。",
    evidenceLabel: "产品资料 / 客户反馈 / 上架清单",
    linkedGoalIds: ["goal-quarter-growth"],
  },
  {
    id: "obs-delivery-cycle",
    title: "交付周期观察",
    status: "needs-confirmation",
    summary: "需求确认、方案评审、执行检查和验收复盘还没有形成稳定节奏。",
    evidenceLabel: "交付排期 / 问题关闭清单",
    linkedGoalIds: ["goal-month-delivery"],
  },
  {
    id: "obs-weekly-blockers",
    title: "本周阻塞观察",
    status: "needs-confirmation",
    summary: "本周需要先处理项目确认点和资源冲突，再进入岗位任务。",
    evidenceLabel: "周会记录 / 项目风险清单",
    linkedGoalIds: ["goal-weekly-ops"],
  },
  {
    id: "obs-people-load",
    title: "人员负荷观察",
    status: "watch",
    summary: "人员负荷、预算边界和优先级需要在人事财务侧持续跟踪。",
    evidenceLabel: "人员排期 / 预算边界",
    linkedGoalIds: ["goal-weekly-ops"],
  },
];

export const BUSINESS_ATTRIBUTIONS: BusinessAttributionSignal[] = [
  {
    id: "attr-channel-quality",
    title: "渠道质量波动",
    status: "watch",
    summary: "增长偏差主要来自渠道线索质量和跟进节奏不稳定。",
    confidenceLabel: "中等可信",
    linkedGoalIds: ["goal-annual-revenue", "goal-quarter-growth"],
  },
  {
    id: "attr-product-positioning",
    title: "产品卖点匹配度",
    status: "ready",
    summary: "新品增长需要先把目标客户、核心卖点和内容素材统一。",
    confidenceLabel: "较高可信",
    linkedGoalIds: ["goal-quarter-growth"],
  },
  {
    id: "attr-delivery-scope",
    title: "交付范围变化",
    status: "needs-confirmation",
    summary: "交付返工和验收周期拉长，主要与客户确认口径变化相关。",
    confidenceLabel: "待人工确认",
    linkedGoalIds: ["goal-annual-revenue", "goal-month-delivery"],
  },
  {
    id: "attr-resource-conflict",
    title: "资源优先级冲突",
    status: "needs-confirmation",
    summary: "周推进的主要风险是项目优先级、人员负荷和确认点相互挤压。",
    confidenceLabel: "待周会确认",
    linkedGoalIds: ["goal-weekly-ops"],
  },
];

export const BUSINESS_DEPARTMENTS: BusinessDepartment[] = [
  {
    id: "dept-executive",
    name: "经营管理层",
    responsibility: "确认年季月周经营节奏、资源优先级和重大风险。",
    owner: "CEO / 经营负责人",
    linkedProjectIds: ["project-channel-growth", "project-ops-rhythm"],
    peopleFocus: "管理层周会、目标复盘、关键决策记录。",
  },
  {
    id: "dept-project",
    name: "项目部",
    responsibility: "把经营目标拆成项目主题，管理里程碑、范围、预算和跨部门协作。",
    owner: "项目负责人",
    linkedProjectIds: [
      "project-channel-growth",
      "project-product-launch",
      "project-key-account-delivery",
      "project-delivery-process",
      "project-ops-rhythm",
    ],
    peopleFocus: "项目 owner、项目助理、跨部门协调。",
  },
  {
    id: "dept-growth",
    name: "市场与销售部",
    responsibility: "负责线索、成交、复购、渠道和客户反馈。",
    owner: "增长负责人",
    linkedProjectIds: ["project-channel-growth", "project-product-launch"],
    peopleFocus: "销售目标、客户反馈、渠道节奏。",
  },
  {
    id: "dept-product",
    name: "产品与设计部",
    responsibility: "负责产品方案、视觉标准、内容资产和交付物质量。",
    owner: "产品设计负责人",
    linkedProjectIds: ["project-product-launch", "project-delivery-process"],
    peopleFocus: "设计质量、素材规范、岗位验收标准。",
  },
  {
    id: "dept-operations",
    name: "交付与运营部",
    responsibility: "负责客户交付、运营 SOP、岗位任务验收和异常处理。",
    owner: "交付负责人",
    linkedProjectIds: [
      "project-key-account-delivery",
      "project-delivery-process",
      "project-ops-rhythm",
    ],
    peopleFocus: "交付排期、验收复盘、异常处理。",
  },
  {
    id: "dept-finance-hr",
    name: "人事与财务",
    responsibility: "负责人力规划、招聘、绩效、现金流、预算和成本边界。",
    owner: "人事财务负责人",
    linkedProjectIds: ["project-ops-rhythm"],
    peopleFocus: "人员负荷、预算边界、绩效节奏。",
  },
];

export const BUSINESS_PROJECTS: BusinessProject[] = [
  {
    id: "project-channel-growth",
    name: "渠道增长项目",
    theme: "围绕重点渠道获取线索、推进成交、沉淀复购机会和客户反馈。",
    ownerDepartmentId: "dept-project",
    linkedGoalIds: ["goal-annual-revenue", "goal-quarter-growth"],
    status: "running",
    deliverable: "渠道计划、线索清单、跟进记录、成交复盘和下周推进动作。",
    milestones: [
      { title: "渠道目标和客户画像确认", status: "running" },
      { title: "线索池建立和首轮跟进", status: "planned" },
      { title: "成交复盘和复购机会整理", status: "planned" },
    ],
    risks: [
      {
        title: "渠道线索质量不稳定",
        mitigation: "每周复盘来源、转化和无效原因，及时调整渠道投入。",
        status: "needs-confirmation",
      },
    ],
  },
  {
    id: "project-product-launch",
    name: "新品上市项目",
    theme: "把主推产品从卖点、素材、页面、上架节奏到反馈复盘跑通。",
    ownerDepartmentId: "dept-growth",
    linkedGoalIds: ["goal-quarter-growth", "goal-weekly-ops"],
    status: "running",
    deliverable: "产品卖点表、内容素材、上架清单、反馈记录和优化建议。",
    milestones: [
      { title: "产品卖点和目标客户确认", status: "running" },
      { title: "内容素材和上架清单完成", status: "planned" },
      { title: "首轮客户反馈和优化复盘", status: "planned" },
    ],
    risks: [
      {
        title: "卖点和客户痛点不匹配",
        mitigation: "先做小范围客户反馈确认，再扩大素材和渠道投放。",
        status: "watch",
      },
      {
        title: "上架前资料不完整",
        mitigation: "用项目清单卡住资料、素材、价格、售后和风险说明。",
        status: "needs-confirmation",
      },
    ],
  },
  {
    id: "project-key-account-delivery",
    name: "重点客户交付项目",
    theme: "围绕重点客户交付范围、确认节点、执行排期和验收复盘。",
    ownerDepartmentId: "dept-operations",
    linkedGoalIds: ["goal-annual-revenue", "goal-month-delivery"],
    status: "review",
    deliverable: "客户需求确认表、交付排期、验收记录、问题关闭清单。",
    milestones: [
      { title: "客户范围和验收标准确认", status: "review" },
      { title: "交付任务拆分和责任人排期", status: "running" },
      { title: "验收复盘和复购机会记录", status: "planned" },
    ],
    risks: [
      {
        title: "客户验收口径变化",
        mitigation: "所有范围变化必须进入确认记录，避免无边界返工。",
        status: "needs-confirmation",
      },
    ],
  },
  {
    id: "project-delivery-process",
    name: "交付流程优化项目",
    theme: "把需求确认、方案评审、执行检查、验收复盘沉淀为稳定流程。",
    ownerDepartmentId: "dept-operations",
    linkedGoalIds: ["goal-month-delivery"],
    status: "planned",
    deliverable: "需求确认表、交付清单、验收标准、复盘模板。",
    milestones: [
      { title: "需求确认模板", status: "planned" },
      { title: "交付清单和验收标准", status: "planned" },
      { title: "复盘模板", status: "planned" },
    ],
    risks: [
      {
        title: "验收口径不一致",
        mitigation: "任务启动前固定交付物、确认点和返工边界。",
        status: "watch",
      },
    ],
  },
  {
    id: "project-ops-rhythm",
    name: "经营例会与人员负荷项目",
    theme: "汇总目标达成、项目进度、成本用量、人员负荷和风险事件。",
    ownerDepartmentId: "dept-executive",
    linkedGoalIds: ["goal-weekly-ops"],
    status: "planned",
    deliverable: "经营周报、月度复盘、风险清单、人员负荷摘要。",
    milestones: [
      { title: "经营周报结构", status: "planned" },
      { title: "人员负荷和风险清单", status: "planned" },
      { title: "月度复盘摘要", status: "planned" },
    ],
    risks: [
      {
        title: "经营数据来源不稳定",
        mitigation: "先用本地任务和授权摘要生成复盘，再接正式数据源。",
        status: "watch",
      },
    ],
  },
];

export const BUSINESS_PLANNING_SIGNALS: BusinessPlanningSignal[] = [
  {
    id: "plan-channel-growth",
    title: "渠道增长规划",
    status: "needs-confirmation",
    summary: "先确认渠道目标、客户画像和线索质量口径，再形成岗位任务。",
    projectId: "project-channel-growth",
    departmentId: "dept-project",
    linkedGoalIds: ["goal-annual-revenue", "goal-quarter-growth"],
  },
  {
    id: "plan-product-launch",
    title: "新品上市规划",
    status: "ready",
    summary: "产品卖点、素材结构和上架清单已具备进入任务中心的条件。",
    projectId: "project-product-launch",
    departmentId: "dept-growth",
    linkedGoalIds: ["goal-quarter-growth", "goal-weekly-ops"],
  },
  {
    id: "plan-key-account-delivery",
    title: "重点客户交付规划",
    status: "needs-confirmation",
    summary: "客户范围和验收标准确认后，才能把执行项交给任务中心。",
    projectId: "project-key-account-delivery",
    departmentId: "dept-operations",
    linkedGoalIds: ["goal-annual-revenue", "goal-month-delivery"],
  },
  {
    id: "plan-delivery-process",
    title: "交付流程规划",
    status: "watch",
    summary: "需求确认表、交付清单和验收标准需要先完成治理。",
    projectId: "project-delivery-process",
    departmentId: "dept-operations",
    linkedGoalIds: ["goal-month-delivery"],
  },
  {
    id: "plan-ops-rhythm",
    title: "经营例会规划",
    status: "watch",
    summary: "经营周报、人员负荷和风险清单用于支持后续规划确认。",
    projectId: "project-ops-rhythm",
    departmentId: "dept-executive",
    linkedGoalIds: ["goal-weekly-ops"],
  },
];

function isBusinessCadenceId(value: unknown): value is BusinessCadenceId {
  return value === "year" || value === "quarter" || value === "month" || value === "week";
}

function projectExists(value: unknown): value is string {
  return typeof value === "string" && BUSINESS_PROJECTS.some((project) => project.id === value);
}

function normalizeBusinessFlowState(value: unknown): BusinessFlowState {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    selectedCadenceId: isBusinessCadenceId(record.selectedCadenceId)
      ? record.selectedCadenceId
      : "quarter",
    selectedProjectId: projectExists(record.selectedProjectId)
      ? record.selectedProjectId
      : (BUSINESS_PROJECTS[0]?.id ?? ""),
  };
}

export function loadBusinessFlowState(): BusinessFlowState {
  const raw = getSafeLocalStorage()?.getItem(STORAGE_KEY);
  if (!raw) {
    return normalizeBusinessFlowState(null);
  }
  try {
    return normalizeBusinessFlowState(JSON.parse(raw));
  } catch {
    return normalizeBusinessFlowState(null);
  }
}

export function saveBusinessFlowState(state: BusinessFlowState): void {
  getSafeLocalStorage()?.setItem(STORAGE_KEY, JSON.stringify(normalizeBusinessFlowState(state)));
}

export function applyBusinessFlowSelection(
  state: BusinessFlowState,
  patch: BusinessFlowSelectionPatch,
): BusinessFlowState {
  return normalizeBusinessFlowState({ ...state, ...patch });
}

export function buildBusinessFlowProjection(state: BusinessFlowState): BusinessFlowProjection {
  const normalized = normalizeBusinessFlowState(state);
  const selectedCadence =
    BUSINESS_CADENCES.find((cadence) => cadence.id === normalized.selectedCadenceId) ??
    BUSINESS_CADENCES[0];
  const selectedProject =
    BUSINESS_PROJECTS.find((project) => project.id === normalized.selectedProjectId) ??
    BUSINESS_PROJECTS[0];
  const selectedProjectDepartment =
    BUSINESS_DEPARTMENTS.find(
      (department) => department.id === selectedProject?.ownerDepartmentId,
    ) ?? BUSINESS_DEPARTMENTS[0];
  const selectedProjectGoals = BUSINESS_GOALS.filter((goal) =>
    selectedProject?.linkedGoalIds.includes(goal.id),
  );
  const selectedGoalIds = new Set(
    BUSINESS_GOALS.filter((goal) => goal.cadenceId === selectedCadence?.id).map((goal) => goal.id),
  );
  const selectedProjectGoalIds = new Set(selectedProjectGoals.map((goal) => goal.id));
  const selectedObservations = BUSINESS_OBSERVATIONS.filter((observation) =>
    observation.linkedGoalIds.some((goalId) => selectedGoalIds.has(goalId)),
  );
  const selectedAttributions = BUSINESS_ATTRIBUTIONS.filter((attribution) =>
    attribution.linkedGoalIds.some((goalId) => selectedGoalIds.has(goalId)),
  );
  const selectedPlanningSignals = BUSINESS_PLANNING_SIGNALS.filter((planning) =>
    planning.linkedGoalIds.some((goalId) => selectedGoalIds.has(goalId)),
  );
  const selectedProjectPlanningSignals = BUSINESS_PLANNING_SIGNALS.filter(
    (planning) =>
      planning.projectId === selectedProject?.id ||
      planning.linkedGoalIds.some((goalId) => selectedProjectGoalIds.has(goalId)),
  );
  return {
    cadences: BUSINESS_CADENCES,
    goals: BUSINESS_GOALS,
    departments: BUSINESS_DEPARTMENTS,
    projects: BUSINESS_PROJECTS,
    observations: BUSINESS_OBSERVATIONS,
    attributions: BUSINESS_ATTRIBUTIONS,
    planningSignals: BUSINESS_PLANNING_SIGNALS,
    selectedCadence: selectedCadence ?? BUSINESS_CADENCES[0],
    selectedGoals: BUSINESS_GOALS.filter((goal) => goal.cadenceId === selectedCadence?.id),
    selectedObservations,
    selectedAttributions,
    selectedPlanningSignals,
    selectedProject: selectedProject ?? BUSINESS_PROJECTS[0],
    selectedProjectGoals,
    selectedProjectPlanningSignals,
    selectedProjectDepartment: selectedProjectDepartment ?? BUSINESS_DEPARTMENTS[0],
    projectTaskCount: BUSINESS_PROJECTS.length,
  };
}

export function businessSignalStatusLabel(status: BusinessSignalStatus): string {
  const labels: Record<BusinessSignalStatus, string> = {
    ready: "已就绪",
    watch: "关注中",
    "needs-confirmation": "待确认",
    blocked: "已阻塞",
  };
  return labels[status];
}

export function businessFlowTaskSourceLabel(source: BusinessFlowTaskSource): string {
  const labels: Record<BusinessFlowTaskSource, string> = {
    planning: "规划确认",
    dispatch: "任务中心",
    manual: "人工补录",
  };
  return labels[source];
}

export function businessProjectMilestoneStatusLabel(
  status: BusinessProjectMilestone["status"],
): string {
  const labels: Record<BusinessProjectMilestone["status"], string> = {
    planned: "计划中",
    running: "执行中",
    review: "待确认",
    done: "已完成",
    blocked: "阻塞",
  };
  return labels[status];
}

export function businessProjectRiskStatusLabel(status: BusinessProjectRisk["status"]): string {
  const labels: Record<BusinessProjectRisk["status"], string> = {
    watch: "关注",
    "needs-confirmation": "待确认",
    blocked: "阻塞",
  };
  return labels[status];
}

export function resolveBusinessFlowTaskRef(
  ref: BusinessFlowTaskRef | null | undefined,
): ResolvedBusinessFlowTaskRef | null {
  if (!ref) {
    return null;
  }
  const cadence = BUSINESS_CADENCES.find((entry) => entry.id === ref.cadenceId) ?? null;
  const project = BUSINESS_PROJECTS.find((entry) => entry.id === ref.projectId) ?? null;
  const goals = BUSINESS_GOALS.filter((entry) => ref.goalIds.includes(entry.id));
  const department =
    BUSINESS_DEPARTMENTS.find((entry) => entry.id === ref.departmentId) ??
    (project
      ? (BUSINESS_DEPARTMENTS.find((entry) => entry.id === project.ownerDepartmentId) ?? null)
      : null);
  return {
    ref,
    cadence,
    project,
    goals,
    department,
  };
}

export function businessFlowTaskRefMatchesProject(
  ref: BusinessFlowTaskRef | null | undefined,
  projectId: string | null | undefined,
): boolean {
  const normalizedProjectId = typeof projectId === "string" ? projectId.trim() : "";
  return !normalizedProjectId || ref?.projectId === normalizedProjectId;
}
