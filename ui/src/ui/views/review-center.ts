import { html, nothing } from "lit";
import type {
  CategoryCapabilityQueueSort,
  CategoryCapabilityQueueFilter,
  CategoryCapabilityReview,
  ReviewCenterState,
  ReviewFinding,
  ReviewQueueFilter,
  ReviewQueueSort,
  RolePreListingReview,
} from "../controllers/review-center.ts";
import type { SupportContactState } from "../controllers/support-contact.ts";
import { renderSupportContactCard } from "./support-contact.ts";

export type ReviewCenterProps = {
  state: ReviewCenterState;
  supportContact?: SupportContactState;
  onRefresh: () => void | Promise<void>;
  onLoadSupportContact?: () => void | Promise<void>;
  onSelectRoleReview: (reviewId: string) => void;
  onSelectCategoryCapabilityReview: (reviewId: string | null) => void;
  onRoleFilterChange: (filter: ReviewQueueFilter) => void;
  onRoleSearchChange: (search: string) => void;
  onRoleSortChange: (sort: ReviewQueueSort) => void;
  onRolePageChange: (page: number) => void;
  onRolePageSizeChange: (pageSize: number) => void;
  onCategoryFilterChange: (filter: CategoryCapabilityQueueFilter) => void;
  onCategorySearchChange: (search: string) => void;
  onCategorySortChange: (sort: CategoryCapabilityQueueSort) => void;
  onCategoryPageChange: (page: number) => void;
  onCategoryPageSizeChange: (pageSize: number) => void;
  onRunRoleValidation: (reviewId: string) => void | Promise<void>;
  onApproveRole: (reviewId: string) => void | Promise<void>;
  onRequestRoleChanges: (reviewId: string) => void | Promise<void>;
  onRejectRole: (reviewId: string) => void | Promise<void>;
  onApproveCategoryCapability: (reviewId: string) => void | Promise<void>;
  onRequestCategoryCapabilityChanges: (reviewId: string) => void | Promise<void>;
  onRejectCategoryCapability: (reviewId: string) => void | Promise<void>;
  onSyncCategoryCapabilityToCloud: (reviewId: string) => void | Promise<void>;
};

const buttonStyle =
  "border:1px solid var(--border-color,#d0d0d0);border-radius:6px;padding:8px 10px;background:var(--bg-elevated,#fff);color:var(--text-primary,#111);font-size:12px;cursor:pointer";
const primaryButtonStyle =
  "border:1px solid var(--accent-color,#2563eb);border-radius:6px;padding:8px 10px;background:var(--accent-color,#2563eb);color:#fff;font-size:12px;cursor:pointer";
const dangerButtonStyle =
  "border:1px solid #b91c1c;border-radius:6px;padding:8px 10px;background:#b91c1c;color:#fff;font-size:12px;cursor:pointer";

function formatTime(value: number | null | undefined): string {
  if (!value) return "未记录";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function statusTone(status: string): string {
  if (status.includes("拒绝") || status.includes("失败")) return "#b91c1c";
  if (status.includes("修改") || status.includes("检查中") || status.includes("提交中"))
    return "#b45309";
  if (status.includes("通过") || status.includes("已提交")) return "#047857";
  return "var(--text-secondary,#666)";
}

function renderPill(label: string, value: string) {
  return html`
    <span
      style="display:inline-flex;gap:5px;align-items:center;border:1px solid var(--border-color,#ddd);border-radius:999px;padding:4px 8px;font-size:12px;color:var(--text-secondary,#666)"
    >
      <span>${label}</span>
      <strong style="color:${statusTone(value)}">${value || "未设置"}</strong>
    </span>
  `;
}

const ROLE_FILTERS: Array<{ id: ReviewQueueFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "pending_review", label: "待审核" },
  { id: "missing_category", label: "待绑定品类" },
  { id: "category_pending", label: "品类申请中" },
  { id: "ready_for_manual_approval", label: "待人工通过" },
  { id: "needs_changes", label: "待修改" },
  { id: "high_risk", label: "高风险" },
];

const ROLE_SORTS: Array<{ id: ReviewQueueSort; label: string }> = [
  { id: "updated_desc", label: "提交时间倒序" },
  { id: "updated_asc", label: "提交时间正序" },
  { id: "risk_desc", label: "风险优先" },
  { id: "status_asc", label: "状态优先" },
];

const CATEGORY_SORTS: Array<{ id: CategoryCapabilityQueueSort; label: string }> = [
  { id: "updated_desc", label: "提交时间倒序" },
  { id: "updated_asc", label: "提交时间正序" },
  { id: "status_asc", label: "审核状态优先" },
  { id: "activation_status_asc", label: "激活状态优先" },
];

const CATEGORY_FILTERS: Array<{ id: CategoryCapabilityQueueFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "pending_review", label: "待审核" },
  { id: "approved", label: "待激活" },
  { id: "activated", label: "已激活" },
  { id: "sync_failed", label: "激活失败" },
  { id: "needs_changes", label: "待修改" },
];

const DEFAULT_PAGE_INFO = {
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
  hasPreviousPage: false,
  hasNextPage: false,
};

function rolePageInfo(state: ReviewCenterState) {
  if (state.roleQueuePageInfo) return state.roleQueuePageInfo;
  return { ...DEFAULT_PAGE_INFO, total: state.roleReviews.length };
}

function categoryPageInfo(state: ReviewCenterState) {
  if (state.categoryQueuePageInfo) return state.categoryQueuePageInfo;
  return { ...DEFAULT_PAGE_INFO, total: state.categoryCapabilityReviews.length };
}

function boundedPageSize(pageSize: number): number {
  if (!Number.isFinite(pageSize) || pageSize <= 0) return DEFAULT_PAGE_INFO.pageSize;
  return Math.min(Math.floor(pageSize), 100);
}

function visibleRoleReviews(state: ReviewCenterState): RolePreListingReview[] {
  return state.roleReviews.slice(0, boundedPageSize(rolePageInfo(state).pageSize));
}

function visibleCategoryCapabilityReviews(state: ReviewCenterState): CategoryCapabilityReview[] {
  return state.categoryCapabilityReviews.slice(
    0,
    boundedPageSize(categoryPageInfo(state).pageSize),
  );
}

function roleReviewReadyForManualApproval(review: RolePreListingReview): boolean {
  return (
    review.reviewStatus !== "已通过" &&
    review.validationStatus === "已通过" &&
    Boolean(review.category.trim()) &&
    !review.reviewFindings.some((finding) => finding.severity === "blocking")
  );
}

function roleQueueStatus(review: RolePreListingReview): string {
  if (review.reviewStatus === "已通过" || review.reviewStatus === "已提交上架")
    return review.reviewStatus;
  if (roleReviewReadyForManualApproval(review)) return "待人工通过";
  if (!review.category.trim()) return "待绑定品类";
  if (review.reviewStatus === "待开发者修改") return "待修改";
  if (review.reviewFindings.some((finding) => finding.message.includes("品类")))
    return "品类申请中";
  return review.reviewStatus;
}

function statusPillStyle(status: string): string {
  if (status.includes("人工通过") || status.includes("已通过")) {
    return "background:#ecfdf5;color:#047857;border:1px solid #bbf7d0";
  }
  if (status.includes("修改") || status.includes("绑定") || status.includes("申请")) {
    return "background:#fffbeb;color:#b45309;border:1px solid #fde68a";
  }
  if (status.includes("拒绝") || status.includes("失败")) {
    return "background:#fff5f5;color:#b91c1c;border:1px solid #fecaca";
  }
  if (status.includes("高")) {
    return "background:#fff5f5;color:#b91c1c;border:1px solid #fecaca";
  }
  return "background:var(--bg-subtle,#f7f7f7);color:var(--text-secondary,#666);border:1px solid var(--border-color,#ddd)";
}

function categoryActivationStatus(status: CategoryCapabilityReview["cloudSyncStatus"]): string {
  switch (status) {
    case "已同步":
      return "已激活";
    case "同步中":
      return "激活中";
    case "同步失败":
      return "激活失败";
    case "未同步":
    default:
      return "未激活";
  }
}

function findingsFor(review: RolePreListingReview | null, section: ReviewFinding["section"]) {
  return review?.reviewFindings.filter((finding) => finding.section === section) ?? [];
}

function renderFindings(title: string, findings: ReviewFinding[]) {
  return html`
    <section style="display:grid;gap:8px">
      <h3 style="margin:0;font-size:14px;color:var(--text-primary,#111)">${title}</h3>
      ${findings.length
        ? html`
            <div style="display:grid;gap:6px">
              ${findings.map(
                (finding) => html`
                  <div
                    style="border-left:3px solid ${statusTone(
                      finding.severity,
                    )};padding:7px 9px;background:var(--bg-subtle,#f7f7f7);font-size:12px;color:var(--text-primary,#111)"
                  >
                    <strong style="color:${statusTone(finding.severity)}"
                      >${finding.severity}</strong
                    >
                    <span>${finding.message}</span>
                  </div>
                `,
              )}
            </div>
          `
        : html`<p style="margin:0;color:var(--text-secondary,#666);font-size:12px">
            等待一键综合检查。
          </p>`}
    </section>
  `;
}

function materialText(
  review: CategoryCapabilityReview,
  key: keyof CategoryCapabilityReview["roleMaterials"],
  fallback = "",
): string {
  const value = review.roleMaterials?.[key];
  if (Array.isArray(value)) return value.join("、");
  return typeof value === "string" ? value : fallback;
}

function refAliases(value: string): string[] {
  const ref = value.trim();
  if (!ref) return [];
  return Array.from(new Set([ref, ref.replace(/_/gu, "."), ref.replace(/\./gu, "_")]));
}

function refsInclude(refs: Iterable<string>, value: string): boolean {
  const aliases = new Set(refAliases(value));
  for (const ref of refs) {
    if (aliases.has(ref)) return true;
    for (const alias of refAliases(ref)) {
      if (aliases.has(alias)) return true;
    }
  }
  return false;
}

function renderRoleTableRow(
  review: RolePreListingReview,
  selected: boolean,
  props: ReviewCenterProps,
) {
  const status = roleQueueStatus(review);
  return html`
    <tr
      style="background:${selected ? "rgba(220,38,38,.06)" : "transparent"};cursor:pointer"
      @click=${() => props.onSelectRoleReview(review.id)}
    >
      <td style="padding:9px;border-bottom:1px solid var(--border-color,#eee)">
        <input
          type="checkbox"
          .checked=${selected}
          @click=${(event: Event) => event.stopPropagation()}
        />
      </td>
      <td style="padding:9px;border-bottom:1px solid var(--border-color,#eee)">
        <button
          type="button"
          style="border:0;background:transparent;padding:0;margin:0;text-align:left;color:var(--text-primary,#111);font-weight:700;font-size:13px;cursor:pointer"
          @click=${(event: Event) => {
            event.stopPropagation();
            props.onSelectRoleReview(review.id);
          }}
        >
          ${review.rolePackageId}
        </button>
        <span style="display:block;font-size:12px;color:var(--text-secondary,#666);margin-top:2px"
          >${review.developerId}</span
        >
      </td>
      <td
        style="padding:9px;border-bottom:1px solid var(--border-color,#eee);font-size:12px;color:var(--text-secondary,#666)"
      >
        ${review.category || "未绑定"}
      </td>
      <td style="padding:9px;border-bottom:1px solid var(--border-color,#eee)">
        <span
          style="display:inline-flex;border-radius:999px;padding:3px 8px;font-size:12px;${statusPillStyle(
            status,
          )}"
          >${status}</span
        >
      </td>
      <td style="padding:9px;border-bottom:1px solid var(--border-color,#eee)">
        <span
          style="display:inline-flex;border-radius:999px;padding:3px 8px;font-size:12px;${statusPillStyle(
            review.riskLevel,
          )}"
          >${review.riskLevel || "未评估"}</span
        >
      </td>
      <td
        style="padding:9px;border-bottom:1px solid var(--border-color,#eee);font-size:12px;color:var(--text-secondary,#666)"
      >
        ${formatTime(review.updatedAt)}
      </td>
      <td style="padding:9px;border-bottom:1px solid var(--border-color,#eee)">
        <button
          type="button"
          style=${buttonStyle}
          @click=${(event: Event) => {
            event.stopPropagation();
            props.onSelectRoleReview(review.id);
          }}
        >
          查看
        </button>
      </td>
    </tr>
  `;
}

function categoryProductionStatus(review: CategoryCapabilityReview, props: ReviewCenterProps) {
  void props;
  const pendingToolSkillRequirements =
    review.cloudSyncStatus === "已同步" ? [] : [...review.toolSkillRequirements];
  const totalRequirements = review.toolSkillRequirements.length;
  const completedRequirements = review.cloudSyncStatus === "已同步" ? totalRequirements : 0;
  let productionStatus = "待审核";
  if (review.reviewStatus === "已通过" && review.cloudSyncStatus === "已同步") {
    productionStatus = "已准备";
  } else if (review.reviewStatus === "已通过" && totalRequirements === 0) {
    productionStatus = "无需补齐";
  } else if (review.reviewStatus === "已通过") {
    productionStatus = `待工具与 Skill ${pendingToolSkillRequirements.length} 项`;
  }
  return {
    pendingToolSkillRequirements,
    totalRequirements,
    completedRequirements,
    productionStatus,
  };
}

function renderCategoryCapabilityDetail(
  review: CategoryCapabilityReview,
  props: ReviewCenterProps,
) {
  const busy = props.state.actionBusyKey?.startsWith(`categoryCapability:${review.id}:`) ?? false;
  const events = props.state.eventsByReviewId[review.id] ?? [];
  const {
    pendingToolSkillRequirements,
    totalRequirements,
    completedRequirements,
    productionStatus,
  } = categoryProductionStatus(review, props);
  const activated = review.reviewStatus === "已通过" && review.cloudSyncStatus === "已同步";
  const approvedWaitingActivation =
    review.reviewStatus === "已通过" && review.cloudSyncStatus !== "已同步";
  const primarySummary = activated
    ? `正式品类已激活，开发者可在开发者中心绑定：${review.categoryRef}`
    : approvedWaitingActivation
      ? pendingToolSkillRequirements.length
        ? `本地审核已通过，还需在工具与 Skill 完成 ${pendingToolSkillRequirements.length} 项能力制作。`
        : "本地审核已通过，可激活正式品类能力包。"
      : "等待审核员判断申请资料是否完整、是否需要制作新品类能力包。";
  return html`
    <section
      style="border:1px solid var(--border-color,#ddd);border-radius:8px;padding:12px;display:grid;gap:8px;background:var(--bg-elevated,#fff)"
    >
      <div>
        <strong>品类能力 · ${review.categoryName || review.title}</strong>
        <div style="font-size:12px;color:var(--text-secondary,#666)">${review.categoryRef}</div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${renderPill("审核", review.reviewStatus)}
        ${renderPill("品类", categoryActivationStatus(review.cloudSyncStatus))}
      </div>
      <div
        style="border:1px solid ${activated
          ? "#bbf7d0"
          : "#fde68a"};border-radius:6px;padding:8px;background:${activated
          ? "#f0fdf4"
          : "#fffbeb"};font-size:12px;line-height:1.55;color:${activated ? "#047857" : "#92400e"}"
      >
        ${primarySummary}
      </div>
      <div style="display:grid;gap:6px;font-size:12px;color:var(--text-primary,#111)">
        <div>岗位：${review.rolePackageId || review.title}</div>
        <div>能力包状态：${productionStatus}</div>
        ${totalRequirements
          ? html`<div style="color:var(--text-secondary,#666)">
              能力包进度：${completedRequirements}/${totalRequirements}
            </div>`
          : nothing}
        ${review.reviewDecision
          ? html`<div style="color:var(--text-secondary,#666)">${review.reviewDecision}</div>`
          : nothing}
        ${review.cloudSyncError
          ? html`<div style="color:#b91c1c">激活错误：${review.cloudSyncError}</div>`
          : nothing}
      </div>
      ${activated
        ? html`<div style="font-size:12px;color:#047857">
            已完成：该品类可被岗位开发者绑定。危险操作已收起，避免误处理历史申请。
          </div>`
        : html`
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button
                type="button"
                style=${primaryButtonStyle}
                title="审核通过后，会把能力制作需求推到「工具与 Skill」。"
                ?disabled=${busy || review.reviewStatus === "已通过"}
                @click=${() => props.onApproveCategoryCapability(review.id)}
              >
                通过
              </button>
              <button
                type="button"
                style=${buttonStyle}
                title=${approvedWaitingActivation
                  ? "系统会检查工具与 Skill 待办；未完成时保持 blocked。"
                  : ""}
                ?disabled=${busy || !approvedWaitingActivation}
                @click=${() => props.onSyncCategoryCapabilityToCloud(review.id)}
              >
                ${busy ? "处理中" : "激活品类"}
              </button>
              <button
                type="button"
                style=${buttonStyle}
                ?disabled=${busy || review.reviewStatus === "已通过"}
                @click=${() => props.onRequestCategoryCapabilityChanges(review.id)}
              >
                退回补充资料
              </button>
              <button
                type="button"
                style=${dangerButtonStyle}
                ?disabled=${busy || review.reviewStatus === "已通过"}
                @click=${() => props.onRejectCategoryCapability(review.id)}
              >
                驳回
              </button>
            </div>
          `}
      <details style="border-top:1px solid var(--border-color,#eee);padding-top:8px">
        <summary style="cursor:pointer;font-size:12px;font-weight:700">岗位资料</summary>
        <div
          style="display:grid;gap:5px;margin-top:8px;font-size:12px;color:var(--text-secondary,#666)"
        >
          <div>
            岗位说明：${materialText(review, "roleDescription", review.roleDescription) || "未填写"}
          </div>
          <div>目标用户：${materialText(review, "targetUser", review.targetUser) || "未填写"}</div>
          <div>SOP：${materialText(review, "sopFlow") || "未填写"}</div>
          <div>
            日/周/月：${materialText(review, "dailyPlan") || "未填写"} ·
            ${materialText(review, "weeklyPlan") || "未填写"} ·
            ${materialText(review, "monthlyPlan") || "未填写"}
          </div>
          <div>
            输入输出：${materialText(review, "inputOutput", review.inputOutput) || "未填写"}
          </div>
          <div>
            风险边界：${materialText(review, "riskBoundaries", review.riskBoundaries.join("、")) ||
            "未填写"}
          </div>
        </div>
      </details>
      <details style="border-top:1px solid var(--border-color,#eee);padding-top:8px">
        <summary style="cursor:pointer;font-size:12px;font-weight:700">能力与待办</summary>
        <div
          style="display:grid;gap:5px;margin-top:8px;font-size:12px;color:var(--text-secondary,#666)"
        >
          <div>
            能力：${(review.capabilityRefs.length
              ? review.capabilityRefs
              : review.requiredCapabilities
            ).join("、") || "未声明"}
          </div>
          <div>Tool / Skill / Provider：${review.toolSkillRequirements.join("、") || "无"}</div>
          <div>具体开发、创建、安装和检查在「工具与 Skill」模块完成。</div>
        </div>
      </details>
      <details style="border-top:1px solid var(--border-color,#eee);padding-top:8px">
        <summary style="cursor:pointer;font-size:12px;font-weight:700">审核事件</summary>
        <div
          style="display:grid;gap:5px;margin-top:8px;font-size:12px;color:var(--text-secondary,#666)"
        >
          ${events.length
            ? events
                .slice(0, 3)
                .map((event) => html`<span>${event.action} · ${event.summary}</span>`)
            : html`<span>暂无事件。</span>`}
        </div>
      </details>
    </section>
  `;
}

function renderCategoryTableRow(
  review: CategoryCapabilityReview,
  selected: boolean,
  props: ReviewCenterProps,
) {
  const {
    pendingToolSkillRequirements,
    totalRequirements,
    completedRequirements,
    productionStatus,
  } = categoryProductionStatus(review, props);
  const activation = categoryActivationStatus(review.cloudSyncStatus);
  return html`
    <tr
      style="background:${selected ? "rgba(37,99,235,.06)" : "transparent"};cursor:pointer"
      @click=${() => props.onSelectCategoryCapabilityReview(review.id)}
    >
      <td style="padding:9px;border-bottom:1px solid var(--border-color,#eee)">
        <input
          type="checkbox"
          .checked=${selected}
          @click=${(event: Event) => event.stopPropagation()}
        />
      </td>
      <td style="padding:9px;border-bottom:1px solid var(--border-color,#eee)">
        <button
          type="button"
          style="border:0;background:transparent;padding:0;margin:0;text-align:left;color:var(--text-primary,#111);font-weight:700;font-size:13px;cursor:pointer"
          @click=${(event: Event) => {
            event.stopPropagation();
            props.onSelectCategoryCapabilityReview(review.id);
          }}
        >
          ${review.categoryName || review.title}
        </button>
        <span style="display:block;font-size:12px;color:var(--text-secondary,#666);margin-top:2px"
          >${review.categoryRef}</span
        >
      </td>
      <td
        style="padding:9px;border-bottom:1px solid var(--border-color,#eee);font-size:12px;color:var(--text-secondary,#666)"
      >
        ${review.rolePackageId || review.title}
      </td>
      <td style="padding:9px;border-bottom:1px solid var(--border-color,#eee)">
        <span
          style="display:inline-flex;border-radius:999px;padding:3px 8px;font-size:12px;${statusPillStyle(
            review.reviewStatus,
          )}"
          >${review.reviewStatus}</span
        >
      </td>
      <td style="padding:9px;border-bottom:1px solid var(--border-color,#eee)">
        <span
          title=${pendingToolSkillRequirements.length
            ? "具体待办请到「工具与 Skill」处理。"
            : productionStatus}
          style="display:inline-flex;border-radius:999px;padding:3px 8px;font-size:12px;${statusPillStyle(
            productionStatus,
          )}"
        >
          ${productionStatus}${totalRequirements
            ? ` ${completedRequirements}/${totalRequirements}`
            : ""}
        </span>
      </td>
      <td style="padding:9px;border-bottom:1px solid var(--border-color,#eee)">
        <span
          style="display:inline-flex;border-radius:999px;padding:3px 8px;font-size:12px;${statusPillStyle(
            activation,
          )}"
          >${activation}</span
        >
      </td>
      <td
        style="padding:9px;border-bottom:1px solid var(--border-color,#eee);font-size:12px;color:var(--text-secondary,#666)"
      >
        ${formatTime(review.updatedAt)}
      </td>
      <td style="padding:9px;border-bottom:1px solid var(--border-color,#eee)">
        <button
          type="button"
          style=${buttonStyle}
          @click=${(event: Event) => {
            event.stopPropagation();
            props.onSelectCategoryCapabilityReview(review.id);
          }}
        >
          查看
        </button>
      </td>
    </tr>
  `;
}

function categoryCoversRole(
  review: RolePreListingReview,
  category: CategoryCapabilityReview,
): boolean {
  if (review.developerId !== category.developerId) return false;
  const sameDraft =
    Boolean(review.listingDraftId) && review.listingDraftId === category.listingDraftId;
  const samePackage =
    Boolean(review.rolePackageId) && review.rolePackageId === category.rolePackageId;
  const categoryCapabilities = category.capabilityRefs.length
    ? category.capabilityRefs
    : category.requiredCapabilities;
  const coversCapabilities =
    review.requiredCapabilities.length > 0
      ? review.requiredCapabilities.every((capability) =>
          refsInclude(categoryCapabilities, capability),
        )
      : review.category === category.categoryRef;
  return sameDraft || samePackage || coversCapabilities;
}

function roleReviewBlockingGuidance(
  review: RolePreListingReview,
  props: ReviewCenterProps,
): string {
  if (review.reviewStatus === "已通过") return "";
  const relatedCategories = props.state.categoryCapabilityReviews.filter((category) =>
    categoryCoversRole(review, category),
  );
  const pendingCategories = relatedCategories.filter(
    (category) => category.reviewStatus !== "已通过" || category.cloudSyncStatus !== "已同步",
  );
  const pendingToolSkillCount = relatedCategories
    .filter((category) => category.cloudSyncStatus !== "已同步")
    .reduce((total, category) => total + category.toolSkillRequirements.length, 0);
  const steps: string[] = [];
  if (pendingCategories.length) {
    steps.push(
      `品类能力申请：${pendingCategories
        .map(
          (category) =>
            `${category.categoryName || category.title}（${category.reviewStatus}/${categoryActivationStatus(category.cloudSyncStatus)}）`,
        )
        .join("、")}`,
    );
  } else if (
    !relatedCategories.some(
      (category) => category.reviewStatus === "已通过" && category.cloudSyncStatus === "已同步",
    )
  ) {
    steps.push("品类能力申请：暂无已激活的正式品类能力包");
  }
  if (pendingToolSkillCount) {
    steps.push(`能力包待办：${pendingToolSkillCount} 项请到工具与 Skill 模块处理`);
  }
  if (!steps.length) {
    return "需要先通过本地审核中心。请点击一键综合检查，确认无阻塞后再人工通过。";
  }
  return `需要先处理 ${steps.join("；")}。完成后点击一键综合检查，再人工通过。`;
}

function roleHasActivatedBoundCategory(
  review: RolePreListingReview,
  props: ReviewCenterProps,
): boolean {
  if (!review.category) return false;
  return props.state.categoryCapabilityReviews.some((category) => {
    if (category.categoryRef !== review.category) return false;
    if (category.reviewStatus !== "已通过" || category.cloudSyncStatus !== "已同步") return false;
    const categoryCapabilities = category.capabilityRefs.length
      ? category.capabilityRefs
      : category.requiredCapabilities;
    return review.requiredCapabilities.every((capability) =>
      refsInclude(categoryCapabilities, capability),
    );
  });
}

function renderSelectedReview(review: RolePreListingReview | null, props: ReviewCenterProps) {
  if (!review) {
    return html`
      <div
        style="border:1px solid var(--border-color,#ddd);border-radius:8px;padding:18px;background:var(--bg-elevated,#fff)"
      >
        暂无待审核岗位。岗位包生成完成后会自动进入这里。
      </div>
    `;
  }
  const busyKey = props.state.actionBusyKey ?? "";
  const busy = busyKey.startsWith(`role:${review.id}:`);
  const readyForDeveloperListing = review.reviewStatus === "已通过";
  const blockingReason = readyForDeveloperListing
    ? null
    : roleReviewBlockingGuidance(review, props);
  const hasActivatedBoundCategory = roleHasActivatedBoundCategory(review, props);
  const events = props.state.eventsByReviewId[review.id] ?? [];
  return html`
    <div style="display:grid;gap:14px">
      <section
        style="border:1px solid var(--border-color,#ddd);border-radius:8px;padding:14px;background:var(--bg-elevated,#fff);display:grid;gap:12px"
      >
        <div style="display:grid;gap:6px">
          <h2 style="margin:0;font-size:20px">${review.rolePackageId}</h2>
          <div style="font-size:12px;color:var(--text-secondary,#666)">${review.packageDir}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${renderPill("审核状态", review.reviewStatus)}
            ${renderPill("验证", review.validationStatus)} ${renderPill("风险", review.riskLevel)}
            ${renderPill("上架状态", review.cloudSubmitStatus)}
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button
            type="button"
            style=${buttonStyle}
            ?disabled=${busy}
            @click=${() => props.onRunRoleValidation(review.id)}
          >
            ${busyKey.endsWith(":runValidation") ? "检查中" : "一键综合检查"}
          </button>
          <button
            type="button"
            style=${buttonStyle}
            ?disabled=${busy}
            @click=${() => props.onRequestRoleChanges(review.id)}
          >
            要求修改
          </button>
          <button
            type="button"
            style=${dangerButtonStyle}
            ?disabled=${busy}
            @click=${() => props.onRejectRole(review.id)}
          >
            拒绝
          </button>
          <button
            type="button"
            style=${primaryButtonStyle}
            ?disabled=${busy ||
            review.validationStatus !== "已通过" ||
            review.reviewFindings.some((finding) => finding.severity === "blocking") ||
            !hasActivatedBoundCategory}
            title=${!hasActivatedBoundCategory ? "请先由岗位开发者绑定已激活的正式品类。" : ""}
            @click=${() => props.onApproveRole(review.id)}
          >
            人工通过
          </button>
        </div>
        ${blockingReason
          ? html`<div style="font-size:12px;color:#b45309">${blockingReason}</div>`
          : html`<div style="font-size:12px;color:#047857">
              审核已通过；请岗位开发者回到开发者中心确认上架。
            </div>`}
        ${review.reviewStatus === "已提交上架"
          ? html`<div style="font-size:12px;color:#047857">岗位开发者已提交上架。</div>`
          : nothing}
        ${review.submitError
          ? html`<div style="font-size:12px;color:#b91c1c">上架错误：${review.submitError}</div>`
          : nothing}
        ${review.cloudRoleListingId
          ? html`
              <div style="font-size:12px;color:#047857">
                岗位商品：${review.cloudRoleListingId} · ${formatTime(review.submittedAt)}
              </div>
            `
          : nothing}
      </section>
      <section
        style="border:1px solid var(--border-color,#ddd);border-radius:8px;padding:14px;background:var(--bg-elevated,#fff);display:grid;gap:14px"
      >
        <h2 style="margin:0;font-size:16px">检查清单</h2>
        ${renderFindings("待审核岗位", findingsFor(review, "结构"))}
        ${renderFindings("能力绑定检查", findingsFor(review, "能力绑定"))}
        ${renderFindings("跑通性验证", findingsFor(review, "跑通性"))}
        ${renderFindings("风险与合格性", [
          ...findingsFor(review, "风险"),
          ...findingsFor(review, "合格性"),
        ])}
      </section>
      <section
        style="border:1px solid var(--border-color,#ddd);border-radius:8px;padding:14px;background:var(--bg-elevated,#fff);display:grid;gap:10px"
      >
        <h2 style="margin:0;font-size:16px">审核记录</h2>
        ${events.length
          ? events.map(
              (event) => html`
                <div
                  style="display:grid;gap:3px;border-bottom:1px solid var(--border-color,#eee);padding-bottom:8px"
                >
                  <strong style="font-size:12px">${event.action}</strong>
                  <span style="font-size:12px;color:var(--text-secondary,#666)"
                    >${event.summary}</span
                  >
                  <span style="font-size:11px;color:var(--text-tertiary,#888)"
                    >${formatTime(event.createdAt)}</span
                  >
                </div>
              `,
            )
          : html`<p style="margin:0;color:var(--text-secondary,#666);font-size:12px">
              暂无事件。
            </p>`}
      </section>
    </div>
  `;
}

function renderRoleQueueToolbar(props: ReviewCenterProps) {
  const pageInfo = rolePageInfo(props.state);
  const currentFilter = props.state.roleQueueFilter ?? "all";
  const currentSort = props.state.roleQueueSort ?? "updated_desc";
  return html`
    <div style="display:grid;gap:10px">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${ROLE_FILTERS.map(
          (filter) => html`
            <button
              type="button"
              aria-label=${filter.id === "ready_for_manual_approval"
                ? "筛选待最终确认岗位"
                : `筛选${filter.label}岗位`}
              style="border:1px solid ${currentFilter === filter.id
                ? "#efb5b5"
                : "var(--border-color,#ddd)"};border-radius:7px;padding:7px 10px;background:${currentFilter ===
              filter.id
                ? "#fff1f1"
                : "var(--bg-elevated,#fff)"};color:${currentFilter === filter.id
                ? "#b91c1c"
                : "var(--text-secondary,#666)"};font-size:12px;cursor:pointer"
              @click=${() => props.onRoleFilterChange(filter.id)}
            >
              ${filter.label}
            </button>
          `,
        )}
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input
          style="min-width:240px;flex:1;border:1px solid var(--border-color,#ddd);border-radius:999px;padding:8px 12px;background:var(--bg-elevated,#fff);color:var(--text-primary,#111)"
          placeholder="搜索岗位 / 开发者 / 品类"
          .value=${props.state.roleQueueSearch ?? ""}
          @change=${(event: Event) =>
            props.onRoleSearchChange((event.target as HTMLInputElement).value)}
        />
        <select
          style="border:1px solid var(--border-color,#ddd);border-radius:7px;padding:8px;background:var(--bg-elevated,#fff);color:var(--text-primary,#111)"
          .value=${currentSort}
          @change=${(event: Event) =>
            props.onRoleSortChange((event.target as HTMLSelectElement).value as ReviewQueueSort)}
        >
          ${ROLE_SORTS.map((sort) => html`<option value=${sort.id}>${sort.label}</option>`)}
        </select>
        <select
          style="border:1px solid var(--border-color,#ddd);border-radius:7px;padding:8px;background:var(--bg-elevated,#fff);color:var(--text-primary,#111)"
          .value=${String(pageInfo.pageSize)}
          @change=${(event: Event) =>
            props.onRolePageSizeChange(Number((event.target as HTMLSelectElement).value))}
        >
          ${[20, 50, 100].map((size) => html`<option value=${size}>每页 ${size}</option>`)}
        </select>
      </div>
    </div>
  `;
}

function renderRoleQueueTable(selected: RolePreListingReview | null, props: ReviewCenterProps) {
  const reviews = visibleRoleReviews(props.state);
  return html`
    <div
      style="border:1px solid var(--border-color,#eee);border-radius:8px;overflow:hidden;background:var(--bg-elevated,#fff)"
    >
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:var(--bg-subtle,#f7f7f7);color:var(--text-secondary,#666)">
            <th
              style="width:34px;text-align:left;padding:9px;border-bottom:1px solid var(--border-color,#eee)"
            ></th>
            <th
              style="text-align:left;padding:9px;border-bottom:1px solid var(--border-color,#eee)"
            >
              岗位
            </th>
            <th
              style="text-align:left;padding:9px;border-bottom:1px solid var(--border-color,#eee)"
            >
              绑定品类
            </th>
            <th
              style="text-align:left;padding:9px;border-bottom:1px solid var(--border-color,#eee)"
            >
              状态
            </th>
            <th
              style="text-align:left;padding:9px;border-bottom:1px solid var(--border-color,#eee)"
            >
              风险
            </th>
            <th
              style="text-align:left;padding:9px;border-bottom:1px solid var(--border-color,#eee)"
            >
              提交时间
            </th>
            <th
              style="text-align:left;padding:9px;border-bottom:1px solid var(--border-color,#eee)"
            >
              操作
            </th>
          </tr>
        </thead>
        <tbody>
          ${reviews.length
            ? reviews.map((review) => renderRoleTableRow(review, review.id === selected?.id, props))
            : html`
                <tr>
                  <td
                    colspan="7"
                    style="padding:18px;text-align:center;color:var(--text-secondary,#666)"
                  >
                    暂无符合条件的岗位审核单。
                  </td>
                </tr>
              `}
        </tbody>
      </table>
    </div>
  `;
}

function renderRoleQueuePager(props: ReviewCenterProps) {
  const info = rolePageInfo(props.state);
  return html`
    <div
      style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding-top:10px;color:var(--text-secondary,#666);font-size:12px"
    >
      <span>显示第 ${info.page} / ${info.totalPages} 页，共 ${info.total} 个岗位</span>
      <span style="display:flex;gap:8px;align-items:center">
        <button
          type="button"
          style=${buttonStyle}
          ?disabled=${!info.hasPreviousPage || props.state.loading}
          @click=${() => props.onRolePageChange(info.page - 1)}
        >
          上一页
        </button>
        <button
          type="button"
          style=${buttonStyle}
          ?disabled=${!info.hasNextPage || props.state.loading}
          @click=${() => props.onRolePageChange(info.page + 1)}
        >
          下一页
        </button>
      </span>
    </div>
  `;
}

function renderCategoryQueueToolbar(props: ReviewCenterProps) {
  const pageInfo = categoryPageInfo(props.state);
  const currentFilter = props.state.categoryQueueFilter ?? "all";
  const currentSort = props.state.categoryQueueSort ?? "updated_desc";
  return html`
    <div style="display:grid;gap:10px">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${CATEGORY_FILTERS.map(
          (filter) => html`
            <button
              type="button"
              aria-label=${`筛选${filter.label}品类申请`}
              style="border:1px solid ${currentFilter === filter.id
                ? "#bfdbfe"
                : "var(--border-color,#ddd)"};border-radius:7px;padding:7px 10px;background:${currentFilter ===
              filter.id
                ? "#eff6ff"
                : "var(--bg-elevated,#fff)"};color:${currentFilter === filter.id
                ? "#1d4ed8"
                : "var(--text-secondary,#666)"};font-size:12px;cursor:pointer"
              @click=${() => props.onCategoryFilterChange(filter.id)}
            >
              ${filter.label}
            </button>
          `,
        )}
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input
          style="min-width:240px;flex:1;border:1px solid var(--border-color,#ddd);border-radius:999px;padding:8px 12px;background:var(--bg-elevated,#fff);color:var(--text-primary,#111)"
          placeholder="搜索品类 / 岗位 / 开发者"
          .value=${props.state.categoryQueueSearch ?? ""}
          @change=${(event: Event) =>
            props.onCategorySearchChange((event.target as HTMLInputElement).value)}
        />
        <select
          style="border:1px solid var(--border-color,#ddd);border-radius:7px;padding:8px;background:var(--bg-elevated,#fff);color:var(--text-primary,#111)"
          .value=${currentSort}
          @change=${(event: Event) =>
            props.onCategorySortChange(
              (event.target as HTMLSelectElement).value as CategoryCapabilityQueueSort,
            )}
        >
          ${CATEGORY_SORTS.map((sort) => html`<option value=${sort.id}>${sort.label}</option>`)}
        </select>
        <select
          style="border:1px solid var(--border-color,#ddd);border-radius:7px;padding:8px;background:var(--bg-elevated,#fff);color:var(--text-primary,#111)"
          .value=${String(pageInfo.pageSize)}
          @change=${(event: Event) =>
            props.onCategoryPageSizeChange(Number((event.target as HTMLSelectElement).value))}
        >
          ${[20, 50, 100].map((size) => html`<option value=${size}>每页 ${size}</option>`)}
        </select>
      </div>
    </div>
  `;
}

function renderCategoryQueueTable(props: ReviewCenterProps) {
  const selectedCategoryCapabilityId = props.state.selectedCategoryCapabilityReviewId;
  const reviews = visibleCategoryCapabilityReviews(props.state);
  return html`
    <div
      style="border:1px solid var(--border-color,#eee);border-radius:8px;overflow:hidden;background:var(--bg-elevated,#fff)"
    >
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:var(--bg-subtle,#f7f7f7);color:var(--text-secondary,#666)">
            <th
              style="width:34px;text-align:left;padding:9px;border-bottom:1px solid var(--border-color,#eee)"
            ></th>
            <th
              style="text-align:left;padding:9px;border-bottom:1px solid var(--border-color,#eee)"
            >
              品类申请
            </th>
            <th
              style="text-align:left;padding:9px;border-bottom:1px solid var(--border-color,#eee)"
            >
              关联岗位
            </th>
            <th
              style="text-align:left;padding:9px;border-bottom:1px solid var(--border-color,#eee)"
            >
              审核
            </th>
            <th
              style="text-align:left;padding:9px;border-bottom:1px solid var(--border-color,#eee)"
            >
              能力包
            </th>
            <th
              style="text-align:left;padding:9px;border-bottom:1px solid var(--border-color,#eee)"
            >
              品类
            </th>
            <th
              style="text-align:left;padding:9px;border-bottom:1px solid var(--border-color,#eee)"
            >
              提交时间
            </th>
            <th
              style="text-align:left;padding:9px;border-bottom:1px solid var(--border-color,#eee)"
            >
              操作
            </th>
          </tr>
        </thead>
        <tbody>
          ${reviews.length
            ? reviews.map((review) =>
                renderCategoryTableRow(review, review.id === selectedCategoryCapabilityId, props),
              )
            : html`
                <tr>
                  <td
                    colspan="8"
                    style="padding:18px;text-align:center;color:var(--text-secondary,#666)"
                  >
                    暂无符合条件的品类能力申请。
                  </td>
                </tr>
              `}
        </tbody>
      </table>
    </div>
  `;
}

function renderCategoryQueuePager(props: ReviewCenterProps) {
  const info = categoryPageInfo(props.state);
  return html`
    <div
      style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding-top:10px;color:var(--text-secondary,#666);font-size:12px"
    >
      <span>显示第 ${info.page} / ${info.totalPages} 页，共 ${info.total} 个品类申请</span>
      <span style="display:flex;gap:8px;align-items:center">
        <button
          type="button"
          style=${buttonStyle}
          ?disabled=${!info.hasPreviousPage || props.state.loading}
          @click=${() => props.onCategoryPageChange(info.page - 1)}
        >
          上一页
        </button>
        <button
          type="button"
          style=${buttonStyle}
          ?disabled=${!info.hasNextPage || props.state.loading}
          @click=${() => props.onCategoryPageChange(info.page + 1)}
        >
          下一页
        </button>
      </span>
    </div>
  `;
}

export function renderReviewCenter(props: ReviewCenterProps) {
  const visibleRoles = visibleRoleReviews(props.state);
  const visibleCategoryCapabilities = visibleCategoryCapabilityReviews(props.state);
  const selected =
    props.state.roleReviews.find((review) => review.id === props.state.selectedRoleReviewId) ??
    null;
  const selectedCategory =
    props.state.categoryCapabilityReviews.find(
      (review) => review.id === props.state.selectedCategoryCapabilityReviewId,
    ) ?? null;
  const aside = selectedCategory
    ? renderCategoryCapabilityDetail(selectedCategory, props)
    : selected
      ? renderSelectedReview(selected, props)
      : html`
          <div
            style="border:1px solid var(--border-color,#ddd);border-radius:8px;padding:18px;background:var(--bg-elevated,#fff);color:var(--text-secondary,#666);font-size:13px"
          >
            从左侧队列选择一条审核单查看摘要和操作。队列不会自动展开长详情，适合 1000+
            条申请按页处理。
          </div>
        `;
  return html`
    <main
      data-testid="openclaw-review-center"
      style="display:grid;gap:16px;max-width:1440px;margin:0 auto;padding:24px"
    >
      <header style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start">
        <div style="display:grid;gap:6px">
          <h1 style="margin:0;font-size:28px">审核中心</h1>
          <p style="margin:0;color:var(--text-secondary,#666);font-size:13px">
            以队列方式审核岗位和品类能力申请；通过后通知岗位开发者确认上架。Skill、Tool、Provider/API
            的具体开发、安装和检查在「工具与 Skill」处理。
          </p>
        </div>
        <button
          type="button"
          style=${buttonStyle}
          ?disabled=${props.state.loading}
          @click=${props.onRefresh}
        >
          ${props.state.loading ? "刷新中" : "刷新"}
        </button>
      </header>
      ${props.state.error
        ? html`<div
            style="border:1px solid #fecaca;border-radius:8px;padding:10px;color:#b91c1c;background:#fff5f5"
          >
            ${props.state.error}
          </div>`
        : nothing}
      ${renderSupportContactCard(
        props.supportContact,
        "岗位资料、品类能力、工具/Skill 或上架审核卡住时，联系系统开发者处理。",
        props.onLoadSupportContact,
      )}
      <div
        style="display:grid;grid-template-columns:minmax(680px,1fr) 380px;gap:16px;align-items:start"
      >
        <section style="display:grid;gap:14px;min-width:0">
          <section
            style="border:1px solid var(--border-color,#ddd);border-radius:8px;padding:14px;background:var(--bg-elevated,#fff);display:grid;gap:12px"
          >
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
              <div>
                <h2 style="margin:0;font-size:17px">岗位审核队列</h2>
                <p style="margin:4px 0 0;color:var(--text-secondary,#666);font-size:12px">
                  支持 1000+ 个岗位按页处理；点击一行后，只在右侧展示当前岗位详情。
                </p>
              </div>
              <div style="font-size:12px;color:var(--text-secondary,#666)">
                当前页 ${visibleRoles.length} 条
              </div>
            </div>
            ${renderRoleQueueToolbar(props)} ${renderRoleQueueTable(selected, props)}
            ${renderRoleQueuePager(props)}
          </section>
          <section
            style="border:1px solid var(--border-color,#ddd);border-radius:8px;padding:14px;background:var(--bg-elevated,#fff);display:grid;gap:10px"
          >
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
              <div>
                <h2 style="margin:0;font-size:17px">品类能力申请队列</h2>
                <p style="margin:4px 0 0;color:var(--text-secondary,#666);font-size:12px">
                  与岗位审核队列同规格，支持 1000+ 个品类申请按页处理；这里只审核品类申请，具体 Tool
                  / Skill / Provider/API 仍在「工具与 Skill」处理。
                </p>
              </div>
              <div style="font-size:12px;color:var(--text-secondary,#666)">
                当前页 ${visibleCategoryCapabilities.length} 条
              </div>
            </div>
            ${renderCategoryQueueToolbar(props)} ${renderCategoryQueueTable(props)}
            ${renderCategoryQueuePager(props)}
          </section>
        </section>
        <aside style="position:sticky;top:16px;min-width:0">${aside}</aside>
      </div>
    </main>
  `;
}
