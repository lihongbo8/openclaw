import type { AppViewState } from "../app-view-state.ts";

export type ReviewFindingSeverity = "pass" | "warning" | "blocking";

export type ReviewFinding = {
  id: string;
  section: "结构" | "能力绑定" | "跑通性" | "风险" | "合格性";
  severity: ReviewFindingSeverity;
  message: string;
};

export type RolePreListingReviewStatus =
  | "待审核"
  | "检查中"
  | "待开发者修改"
  | "已拒绝"
  | "已通过"
  | "已提交上架";

export type CloudSubmitStatus = "未提交" | "提交中" | "已提交" | "提交失败";

export type RolePreListingReview = {
  id: string;
  rolePackageId: string;
  listingDraftId: string | null;
  developerId: string;
  category: string;
  packageDir: string;
  requiredCapabilities: string[];
  boundCommonCapabilities: string[];
  validationStatus: string;
  riskLevel: string;
  reviewStatus: RolePreListingReviewStatus;
  reviewFindings: ReviewFinding[];
  reviewDecision: string | null;
  approvedAt: number | null;
  cloudRolePackageId: string | null;
  cloudPackageId: string | null;
  cloudPackageVersion: string | null;
  cloudRoleListingId: string | null;
  submittedAt: number | null;
  submitError: string | null;
  cloudSubmitStatus: CloudSubmitStatus;
  createdAt: number;
  updatedAt: number;
};

export type CategoryCapabilityRoleMaterials = {
  roleTitle?: string;
  roleDescription?: string;
  targetUser?: string;
  targetCategory?: string;
  requiredCapabilities?: string[];
  sopFlow?: string;
  dailyPlan?: string;
  weeklyPlan?: string;
  monthlyPlan?: string;
  inputOutput?: string;
  riskBoundaries?: string[];
};

export type CategoryCapabilityReview = {
  id: string;
  requestId: string;
  rolePackageId: string;
  developerId: string;
  title: string;
  listingDraftId: string | null;
  categoryRef: string;
  categoryName: string;
  roleDescription: string;
  targetUser: string;
  roleMaterials: CategoryCapabilityRoleMaterials;
  requiredCapabilities: string[];
  inputOutput: string;
  toolSkillRequirements: string[];
  riskBoundaries: string[];
  capabilityRefs: string[];
  skillPackRef: string;
  toolPackRef: string;
  categoryPackRef: string;
  catalogRefs: string[];
  workflowStatus: string;
  reviewStatus: Exclude<RolePreListingReviewStatus, "已提交上架">;
  reviewFindings: ReviewFinding[];
  reviewDecision: string | null;
  reviewedBy: string | null;
  reviewedAt: number | null;
  cloudSyncStatus: "未同步" | "同步中" | "已同步" | "同步失败";
  cloudSyncError: string | null;
  cloudSyncedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type ReviewEvent = {
  id: string;
  reviewId: string;
  action: string;
  summary: string;
  createdAt: number;
};

export type ReviewListPageInfo = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
};

export type ReviewQueueFilter =
  | "all"
  | "pending_review"
  | "missing_category"
  | "category_pending"
  | "ready_for_manual_approval"
  | "needs_changes"
  | "high_risk";

export type CategoryCapabilityQueueFilter =
  | "all"
  | "pending_review"
  | "approved"
  | "activated"
  | "sync_failed"
  | "needs_changes";

export type ReviewQueueSort = "updated_desc" | "updated_asc" | "risk_desc" | "status_asc";
export type CategoryCapabilityQueueSort =
  | "updated_desc"
  | "updated_asc"
  | "status_asc"
  | "activation_status_asc";

export type ReviewCenterState = {
  loading: boolean;
  actionBusyKey: string | null;
  error: string | null;
  roleReviews: RolePreListingReview[];
  categoryCapabilityReviews: CategoryCapabilityReview[];
  selectedRoleReviewId: string | null;
  selectedCategoryCapabilityReviewId: string | null;
  eventsByReviewId: Record<string, ReviewEvent[]>;
  roleQueueFilter: ReviewQueueFilter;
  roleQueueSearch: string;
  roleQueueSort: ReviewQueueSort;
  roleQueuePageInfo: ReviewListPageInfo;
  categoryQueueFilter: CategoryCapabilityQueueFilter;
  categoryQueueSearch: string;
  categoryQueueSort: CategoryCapabilityQueueSort;
  categoryQueuePageInfo: ReviewListPageInfo;
};

const DEFAULT_PAGE_INFO: ReviewListPageInfo = {
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
  hasPreviousPage: false,
  hasNextPage: false,
};

export function createDefaultReviewCenterState(): ReviewCenterState {
  return {
    loading: false,
    actionBusyKey: null,
    error: null,
    roleReviews: [],
    categoryCapabilityReviews: [],
    selectedRoleReviewId: null,
    selectedCategoryCapabilityReviewId: null,
    eventsByReviewId: {},
    roleQueueFilter: "all",
    roleQueueSearch: "",
    roleQueueSort: "updated_desc",
    roleQueuePageInfo: { ...DEFAULT_PAGE_INFO },
    categoryQueueFilter: "all",
    categoryQueueSearch: "",
    categoryQueueSort: "updated_desc",
    categoryQueuePageInfo: { ...DEFAULT_PAGE_INFO },
  };
}

function requestUpdate(state: AppViewState): void {
  (
    state as unknown as { requestHostUpdate?: () => void; requestUpdate?: () => void }
  ).requestHostUpdate?.();
  (
    state as unknown as { requestHostUpdate?: () => void; requestUpdate?: () => void }
  ).requestUpdate?.();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pageInfoOrDefault(value: unknown, fallbackTotal = 0): ReviewListPageInfo {
  if (!value || typeof value !== "object") {
    const totalPages = Math.max(1, Math.ceil(fallbackTotal / DEFAULT_PAGE_INFO.pageSize));
    return {
      ...DEFAULT_PAGE_INFO,
      total: fallbackTotal,
      totalPages,
      hasNextPage: totalPages > 1,
    };
  }
  const info = value as Partial<ReviewListPageInfo>;
  return {
    page: typeof info.page === "number" ? info.page : DEFAULT_PAGE_INFO.page,
    pageSize: typeof info.pageSize === "number" ? info.pageSize : DEFAULT_PAGE_INFO.pageSize,
    total: typeof info.total === "number" ? info.total : fallbackTotal,
    totalPages:
      typeof info.totalPages === "number" ? info.totalPages : DEFAULT_PAGE_INFO.totalPages,
    hasPreviousPage: Boolean(info.hasPreviousPage),
    hasNextPage: Boolean(info.hasNextPage),
  };
}

async function loadRoleEvents(state: AppViewState, reviewId: string): Promise<void> {
  if (!state.client) throw new Error("未连接");
  const result = await state.client.request<{ events?: ReviewEvent[] }>(
    "aics.rolePreListingReview.events",
    { reviewId },
  );
  state.reviewCenter.eventsByReviewId = {
    ...state.reviewCenter.eventsByReviewId,
    [reviewId]: Array.isArray(result.events) ? result.events : [],
  };
}

async function loadCategoryCapabilityEvents(state: AppViewState, reviewId: string): Promise<void> {
  if (!state.client) throw new Error("未连接");
  const result = await state.client.request<{ events?: ReviewEvent[] }>(
    "aics.categoryCapabilityReview.events",
    { reviewId },
  );
  state.reviewCenter.eventsByReviewId = {
    ...state.reviewCenter.eventsByReviewId,
    [reviewId]: Array.isArray(result.events) ? result.events : [],
  };
}

export async function refreshReviewCenter(state: AppViewState): Promise<void> {
  const pageState = state.reviewCenter;
  pageState.loading = true;
  pageState.error = null;
  requestUpdate(state);
  try {
    if (!state.client) throw new Error("未连接");
    const [roleResult, categoryCapabilityResult] = await Promise.all([
      state.client.request<{ reviews?: RolePreListingReview[]; pageInfo?: ReviewListPageInfo }>(
        "aics.rolePreListingReview.list",
        {
          page: pageState.roleQueuePageInfo.page,
          pageSize: pageState.roleQueuePageInfo.pageSize,
          filter: pageState.roleQueueFilter,
          search: pageState.roleQueueSearch,
          sort: pageState.roleQueueSort,
        },
      ),
      state.client.request<{ reviews?: CategoryCapabilityReview[]; pageInfo?: ReviewListPageInfo }>(
        "aics.categoryCapabilityReview.list",
        {
          page: pageState.categoryQueuePageInfo.page,
          pageSize: pageState.categoryQueuePageInfo.pageSize,
          filter: pageState.categoryQueueFilter,
          search: pageState.categoryQueueSearch,
          sort: pageState.categoryQueueSort,
        },
      ),
    ]);
    pageState.roleReviews = Array.isArray(roleResult.reviews) ? roleResult.reviews : [];
    pageState.roleQueuePageInfo = pageInfoOrDefault(
      roleResult.pageInfo,
      pageState.roleReviews.length,
    );
    pageState.categoryCapabilityReviews = Array.isArray(categoryCapabilityResult.reviews)
      ? categoryCapabilityResult.reviews
      : [];
    pageState.categoryQueuePageInfo = pageInfoOrDefault(
      categoryCapabilityResult.pageInfo,
      pageState.categoryCapabilityReviews.length,
    );
    if (
      !pageState.selectedRoleReviewId ||
      !pageState.roleReviews.some((item) => item.id === pageState.selectedRoleReviewId)
    ) {
      pageState.selectedRoleReviewId = null;
    }
    if (pageState.selectedRoleReviewId) {
      await loadRoleEvents(state, pageState.selectedRoleReviewId);
    }
    if (
      !pageState.selectedCategoryCapabilityReviewId ||
      !pageState.categoryCapabilityReviews.some(
        (item) => item.id === pageState.selectedCategoryCapabilityReviewId,
      )
    ) {
      pageState.selectedCategoryCapabilityReviewId = null;
    }
    if (pageState.selectedCategoryCapabilityReviewId) {
      await loadCategoryCapabilityEvents(state, pageState.selectedCategoryCapabilityReviewId);
    }
  } catch (error) {
    pageState.error = errorMessage(error);
  } finally {
    pageState.loading = false;
    requestUpdate(state);
  }
}

export function setReviewCenterRoleFilter(state: AppViewState, filter: ReviewQueueFilter): void {
  state.reviewCenter.roleQueueFilter = filter;
  state.reviewCenter.roleQueuePageInfo = { ...state.reviewCenter.roleQueuePageInfo, page: 1 };
  void refreshReviewCenter(state);
}

export function setReviewCenterRoleSearch(state: AppViewState, search: string): void {
  state.reviewCenter.roleQueueSearch = search;
  state.reviewCenter.roleQueuePageInfo = { ...state.reviewCenter.roleQueuePageInfo, page: 1 };
  void refreshReviewCenter(state);
}

export function setReviewCenterRoleSort(state: AppViewState, sort: ReviewQueueSort): void {
  state.reviewCenter.roleQueueSort = sort;
  state.reviewCenter.roleQueuePageInfo = { ...state.reviewCenter.roleQueuePageInfo, page: 1 };
  void refreshReviewCenter(state);
}

export function setReviewCenterRolePage(state: AppViewState, page: number): void {
  state.reviewCenter.roleQueuePageInfo = { ...state.reviewCenter.roleQueuePageInfo, page };
  void refreshReviewCenter(state);
}

export function setReviewCenterRolePageSize(state: AppViewState, pageSize: number): void {
  state.reviewCenter.roleQueuePageInfo = {
    ...state.reviewCenter.roleQueuePageInfo,
    page: 1,
    pageSize,
  };
  void refreshReviewCenter(state);
}

export function setReviewCenterCategoryFilter(
  state: AppViewState,
  filter: CategoryCapabilityQueueFilter,
): void {
  state.reviewCenter.categoryQueueFilter = filter;
  state.reviewCenter.categoryQueuePageInfo = {
    ...state.reviewCenter.categoryQueuePageInfo,
    page: 1,
  };
  void refreshReviewCenter(state);
}

export function setReviewCenterCategorySearch(state: AppViewState, search: string): void {
  state.reviewCenter.categoryQueueSearch = search;
  state.reviewCenter.categoryQueuePageInfo = {
    ...state.reviewCenter.categoryQueuePageInfo,
    page: 1,
  };
  void refreshReviewCenter(state);
}

export function setReviewCenterCategorySort(
  state: AppViewState,
  sort: CategoryCapabilityQueueSort,
): void {
  state.reviewCenter.categoryQueueSort = sort;
  state.reviewCenter.categoryQueuePageInfo = {
    ...state.reviewCenter.categoryQueuePageInfo,
    page: 1,
  };
  void refreshReviewCenter(state);
}

export function setReviewCenterCategoryPage(state: AppViewState, page: number): void {
  state.reviewCenter.categoryQueuePageInfo = { ...state.reviewCenter.categoryQueuePageInfo, page };
  void refreshReviewCenter(state);
}

export function setReviewCenterCategoryPageSize(state: AppViewState, pageSize: number): void {
  state.reviewCenter.categoryQueuePageInfo = {
    ...state.reviewCenter.categoryQueuePageInfo,
    page: 1,
    pageSize,
  };
  void refreshReviewCenter(state);
}

export function selectRoleReview(state: AppViewState, reviewId: string): void {
  state.reviewCenter.selectedRoleReviewId = reviewId;
  state.reviewCenter.selectedCategoryCapabilityReviewId = null;
  state.reviewCenter.error = null;
  void loadRoleEvents(state, reviewId)
    .catch((error) => {
      state.reviewCenter.error = errorMessage(error);
    })
    .finally(() => requestUpdate(state));
  requestUpdate(state);
}

export function selectCategoryCapabilityReview(state: AppViewState, reviewId: string | null): void {
  state.reviewCenter.selectedCategoryCapabilityReviewId = reviewId;
  state.reviewCenter.selectedRoleReviewId = null;
  state.reviewCenter.error = null;
  if (reviewId) {
    void loadCategoryCapabilityEvents(state, reviewId)
      .catch((error) => {
        state.reviewCenter.error = errorMessage(error);
      })
      .finally(() => requestUpdate(state));
  }
  requestUpdate(state);
}

async function runReviewAction(
  state: AppViewState,
  busyKey: string,
  action: () => Promise<unknown>,
): Promise<void> {
  const pageState = state.reviewCenter;
  pageState.actionBusyKey = busyKey;
  pageState.error = null;
  requestUpdate(state);
  try {
    await action();
    await refreshReviewCenter(state);
  } catch (error) {
    pageState.error = errorMessage(error);
    try {
      await refreshReviewCenter(state);
    } catch {
      /* Keep the original action error visible. */
    }
    requestUpdate(state);
  } finally {
    pageState.actionBusyKey = null;
    requestUpdate(state);
  }
}

export function runRoleReviewValidation(state: AppViewState, reviewId: string): Promise<void> {
  return runReviewAction(state, `role:${reviewId}:runValidation`, async () => {
    if (!state.client) throw new Error("未连接");
    await state.client.request("aics.rolePreListingReview.runValidation", { reviewId });
  });
}

export function bindRoleReviewCategory(
  state: AppViewState,
  reviewId: string,
  categoryCapabilityReviewId: string,
): Promise<void> {
  return runReviewAction(state, `role:${reviewId}:bindCategory`, async () => {
    if (!state.client) throw new Error("未连接");
    await state.client.request("aics.rolePreListingReview.bindCategory", {
      reviewId,
      categoryCapabilityReviewId,
    });
    await state.client.request("aics.rolePreListingReview.runValidation", { reviewId });
  });
}

export function approveRoleReview(state: AppViewState, reviewId: string): Promise<void> {
  return runReviewAction(state, `role:${reviewId}:approve`, async () => {
    if (!state.client) throw new Error("未连接");
    await state.client.request("aics.rolePreListingReview.approve", { reviewId });
  });
}

export function requestRoleReviewChanges(state: AppViewState, reviewId: string): Promise<void> {
  return runReviewAction(state, `role:${reviewId}:requestChanges`, async () => {
    if (!state.client) throw new Error("未连接");
    await state.client.request("aics.rolePreListingReview.requestChanges", { reviewId });
  });
}

export function rejectRoleReview(state: AppViewState, reviewId: string): Promise<void> {
  return runReviewAction(state, `role:${reviewId}:reject`, async () => {
    if (!state.client) throw new Error("未连接");
    await state.client.request("aics.rolePreListingReview.reject", { reviewId });
  });
}

export function runToolSkillReviewValidation(state: AppViewState, reviewId: string): Promise<void> {
  return runReviewAction(state, `toolSkill:${reviewId}:runValidation`, async () => {
    if (!state.client) throw new Error("未连接");
    await state.client.request("aics.toolSkillReview.runValidation", { reviewId });
  });
}

export function approveToolSkillReview(state: AppViewState, reviewId: string): Promise<void> {
  return runReviewAction(state, `toolSkill:${reviewId}:approve`, async () => {
    if (!state.client) throw new Error("未连接");
    await state.client.request("aics.toolSkillReview.approve", { reviewId });
  });
}

export function approveCategoryCapabilityReview(
  state: AppViewState,
  reviewId: string,
): Promise<void> {
  return runReviewAction(state, `categoryCapability:${reviewId}:approve`, async () => {
    if (!state.client) throw new Error("未连接");
    await state.client.request("aics.categoryCapabilityReview.approve", { reviewId });
  });
}

export function rejectCategoryCapabilityReview(
  state: AppViewState,
  reviewId: string,
): Promise<void> {
  return runReviewAction(state, `categoryCapability:${reviewId}:reject`, async () => {
    if (!state.client) throw new Error("未连接");
    await state.client.request("aics.categoryCapabilityReview.reject", { reviewId });
  });
}

export function requestCategoryCapabilityChanges(
  state: AppViewState,
  reviewId: string,
): Promise<void> {
  return runReviewAction(state, `categoryCapability:${reviewId}:requestChanges`, async () => {
    if (!state.client) throw new Error("未连接");
    await state.client.request("aics.categoryCapabilityReview.requestChanges", { reviewId });
  });
}

export function syncCategoryCapabilityReviewToCloud(
  state: AppViewState,
  reviewId: string,
): Promise<void> {
  return runReviewAction(state, `categoryCapability:${reviewId}:activateLocal`, async () => {
    if (!state.client) throw new Error("未连接");
    await state.client.request("aics.categoryCapabilityReview.activateLocal", { reviewId });
  });
}
