/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type {
  CategoryCapabilityReview,
  ReviewCenterState,
  RolePreListingReview,
} from "../controllers/review-center.ts";
import { renderReviewCenter, type ReviewCenterProps } from "./review-center.ts";

function roleReview(overrides: Partial<RolePreListingReview> = {}): RolePreListingReview {
  return {
    id: "review-1",
    rolePackageId: "pkg-image-review",
    listingDraftId: null,
    developerId: "local-developer",
    category: "image",
    packageDir: "/tmp/pkg-image-review",
    requiredCapabilities: ["image.generation"],
    boundCommonCapabilities: ["image.generation"],
    validationStatus: "未检查",
    riskLevel: "未评估",
    reviewStatus: "待审核",
    reviewFindings: [],
    reviewDecision: null,
    approvedAt: null,
    cloudRolePackageId: null,
    cloudPackageId: null,
    cloudPackageVersion: null,
    cloudRoleListingId: null,
    submittedAt: null,
    submitError: null,
    cloudSubmitStatus: "未提交",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function categoryCapabilityReview(
  overrides: Partial<CategoryCapabilityReview> = {},
): CategoryCapabilityReview {
  return {
    id: "category-review-1",
    requestId: "request-1",
    rolePackageId: "pkg-marketplace-ops",
    listingDraftId: null,
    developerId: "local-developer",
    title: "商城运营",
    categoryRef: "category:marketplace-ops@1",
    categoryName: "商城运营",
    roleDescription: "商城运营岗位。",
    targetUser: "运营者",
    roleMaterials: {
      roleTitle: "商城运营",
      roleDescription: "商城运营岗位。",
      targetUser: "运营者",
      sopFlow: "读取商城经营数据，输出诊断。",
      dailyPlan: "每天查看授权转化。",
      weeklyPlan: "每周复盘品类能力缺口。",
      monthlyPlan: "每月输出经营报告。",
      inputOutput: "输入商城数据，输出诊断。",
      riskBoundaries: ["不自动上架"],
    },
    requiredCapabilities: ["marketplace.read"],
    inputOutput: "输入商城数据，输出诊断。",
    toolSkillRequirements: ["tool.platform.marketplace_read_model"],
    riskBoundaries: ["不自动上架"],
    capabilityRefs: [],
    skillPackRef: "",
    toolPackRef: "",
    categoryPackRef: "",
    catalogRefs: [],
    workflowStatus: "waiting_category_review",
    reviewStatus: "待审核",
    reviewFindings: [],
    reviewDecision: null,
    reviewedBy: null,
    reviewedAt: null,
    cloudSyncStatus: "未同步",
    cloudSyncError: null,
    cloudSyncedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function props(overrides: Partial<ReviewCenterProps> = {}): ReviewCenterProps {
  const state: ReviewCenterState = {
    loading: false,
    actionBusyKey: null,
    error: null,
    roleReviews: [roleReview()],
    categoryCapabilityReviews: [],
    selectedRoleReviewId: "review-1",
    selectedCategoryCapabilityReviewId: null,
    eventsByReviewId: {},
    roleQueueFilter: "all",
    roleQueueSearch: "",
    roleQueueSort: "updated_desc",
    roleQueuePageInfo: {
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
      hasPreviousPage: false,
      hasNextPage: false,
    },
    categoryQueueFilter: "all",
    categoryQueueSearch: "",
    categoryQueueSort: "updated_desc",
    categoryQueuePageInfo: {
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 1,
      hasPreviousPage: false,
      hasNextPage: false,
    },
  };
  return {
    state,
    supportContact: {
      loading: false,
      error: null,
      contact: null,
    },
    onRefresh: vi.fn(),
    onLoadSupportContact: vi.fn(),
    onSelectRoleReview: vi.fn(),
    onSelectCategoryCapabilityReview: vi.fn(),
    onRoleFilterChange: vi.fn(),
    onRoleSearchChange: vi.fn(),
    onRoleSortChange: vi.fn(),
    onRolePageChange: vi.fn(),
    onRolePageSizeChange: vi.fn(),
    onCategoryFilterChange: vi.fn(),
    onCategorySearchChange: vi.fn(),
    onCategorySortChange: vi.fn(),
    onCategoryPageChange: vi.fn(),
    onCategoryPageSizeChange: vi.fn(),
    onRunRoleValidation: vi.fn(),
    onApproveRole: vi.fn(),
    onRequestRoleChanges: vi.fn(),
    onRejectRole: vi.fn(),
    onApproveCategoryCapability: vi.fn(),
    onRequestCategoryCapabilityChanges: vi.fn(),
    onRejectCategoryCapability: vi.fn(),
    onSyncCategoryCapabilityToCloud: vi.fn(),
    ...overrides,
  };
}

function renderView(p: ReviewCenterProps): HTMLElement {
  const host = document.createElement("div");
  render(renderReviewCenter(p), host);
  return host;
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const buttons = [...host.querySelectorAll("button")];
  const button = buttons.find((item) => item.textContent?.trim() === text);
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

describe("renderReviewCenter", () => {
  it("uses local-version review wording instead of cloud-submit wording", () => {
    const host = renderView(props());

    expect(host.textContent).toContain("通过后通知岗位开发者确认上架");
    expect(host.textContent).not.toContain("通过后才允许提交云端商城");
    expect(host.textContent).toContain("上架");
  });

  it("renders a paged role review workbench for large queues", () => {
    const p = props();
    p.state.roleReviews = [
      roleReview({
        id: "ready-review",
        rolePackageId: "pkg-ready-for-human",
        validationStatus: "已通过",
        reviewFindings: [],
        category: "category:marketplace-ops@1",
      }),
      ...Array.from({ length: 24 }, (_, index) =>
        roleReview({
          id: `overflow-role-review-${String(index + 2).padStart(3, "0")}`,
          rolePackageId: `pkg-overflow-${String(index + 2).padStart(3, "0")}`,
        }),
      ),
    ];
    p.state.selectedRoleReviewId = "ready-review";
    p.state.roleQueuePageInfo = {
      page: 3,
      pageSize: 20,
      total: 1000,
      totalPages: 50,
      hasPreviousPage: true,
      hasNextPage: true,
    };

    const host = renderView(p);

    expect(host.textContent).toContain("岗位审核队列");
    expect(host.textContent).toContain("支持 1000+ 个岗位按页处理");
    expect(host.textContent).toContain("当前页 20 条");
    expect(host.textContent).toContain("pkg-ready-for-human");
    expect(host.textContent).not.toContain("pkg-overflow-021");
    expect(host.textContent).toContain("待人工通过");
    expect(host.textContent).toContain("显示第 3 / 50 页，共 1000 个岗位");
    expect(host.textContent).not.toContain("可通过");
  });

  it("does not let the review center submit listings before local review passes", () => {
    const host = renderView(props());

    expect(host.textContent).toContain("需要先处理 品类能力申请");
    expect(host.textContent).toContain("完成后点击一键综合检查，再人工通过");
    expect(host.textContent).not.toContain("提交上架");
  });

  it("keeps role approval disabled until the role has an activated bound category", () => {
    const p = props();
    p.state.roleReviews = [
      roleReview({
        category: "",
        validationStatus: "已通过",
        reviewFindings: [
          {
            id: "finding-pass",
            section: "合格性",
            severity: "pass",
            message: "综合检查通过。",
          },
        ],
      }),
    ];

    const host = renderView(p);
    const approveButton = buttonByText(host, "人工通过");

    expect(approveButton.disabled).toBe(true);
    expect(approveButton.title).toBe("请先由岗位开发者绑定已激活的正式品类。");
  });

  it("enables role approval after validation passes and the bound category is activated", () => {
    const p = props();
    p.state.roleReviews = [
      roleReview({
        category: "category:image-review@1",
        validationStatus: "已通过",
        reviewFindings: [
          {
            id: "finding-pass",
            section: "合格性",
            severity: "pass",
            message: "综合检查通过。",
          },
        ],
      }),
    ];
    p.state.categoryCapabilityReviews = [
      categoryCapabilityReview({
        categoryRef: "category:image-review@1",
        categoryName: "图片审核",
        reviewStatus: "已通过",
        cloudSyncStatus: "已同步",
        capabilityRefs: ["image.generation"],
      }),
    ];

    const host = renderView(p);
    const approveButton = buttonByText(host, "人工通过");

    expect(approveButton.disabled).toBe(false);
  });

  it("tells developers to return to developer center after approval", () => {
    const p = props();
    p.state.roleReviews = [
      roleReview({
        reviewStatus: "已通过",
        validationStatus: "已通过",
        riskLevel: "低",
        reviewFindings: [
          { id: "finding-1", section: "合格性", severity: "pass", message: "综合检查通过。" },
        ],
      }),
    ];
    const host = renderView(p);

    expect(host.textContent).toContain("请岗位开发者回到开发者中心确认上架");
    expect(host.textContent).not.toContain("提交上架");
  });

  it("shows configured human support contact", () => {
    const host = renderView(
      props({
        supportContact: {
          loading: false,
          error: null,
          contact: {
            displayName: "系统开发者",
            wechatId: "openclaw-helper",
            audience: "all",
            purpose: "岗位审核卡住时联系。",
          },
        },
      }),
    );

    expect(host.textContent).toContain("遇到问题可联系");
    expect(host.textContent).toContain("微信：openclaw-helper");
  });

  it("shows category requests as review objects and points production work to Tool & Skill", () => {
    const onApproveCategoryCapability = vi.fn();
    const p = props({ onApproveCategoryCapability });
    p.state.categoryCapabilityReviews = [
      categoryCapabilityReview({
        reviewStatus: "已通过",
      }),
    ];
    p.state.selectedCategoryCapabilityReviewId = "category-review-1";

    const host = renderView(p);

    expect(host.textContent).toContain("能力包状态：待工具与 Skill 1 项");
    expect(host.textContent).toContain("岗位说明：商城运营岗位。");
    expect(host.textContent).toContain("岗位资料");
    expect(host.textContent).toContain("SOP：读取商城经营数据，输出诊断。");
    expect(host.textContent).toContain(
      "日/周/月：每天查看授权转化。 · 每周复盘品类能力缺口。 · 每月输出经营报告。",
    );
    expect(host.textContent).toContain("具体开发、创建、安装和检查在「工具与 Skill」模块完成");
    expect(host.textContent).not.toContain("待完成：tool.platform.marketplace_read_model");
    expect(buttonByText(host, "通过").disabled).toBe(true);
    expect(buttonByText(host, "激活品类").disabled).toBe(false);
    expect(buttonByText(host, "激活品类").title).toBe(
      "系统会检查工具与 Skill 待办；未完成时保持 blocked。",
    );
  });

  it("renders category capability requests as a paged workbench for large queues", () => {
    const p = props();
    p.state.categoryCapabilityReviews = [
      categoryCapabilityReview({
        id: "category-review-page-041",
        categoryName: "商城运营",
        categoryRef: "category:marketplace-ops@1",
        rolePackageId: "pkg-marketplace-ops-041",
        reviewStatus: "待审核",
        cloudSyncStatus: "未同步",
      }),
      ...Array.from({ length: 24 }, (_, index) =>
        categoryCapabilityReview({
          id: `category-review-overflow-${String(index + 2).padStart(3, "0")}`,
          categoryName: `溢出品类-${String(index + 2).padStart(3, "0")}`,
          categoryRef: `category:overflow-${String(index + 2).padStart(3, "0")}@1`,
          rolePackageId: `pkg-overflow-category-${String(index + 2).padStart(3, "0")}`,
        }),
      ),
    ];
    p.state.selectedCategoryCapabilityReviewId = "category-review-page-041";
    p.state.categoryQueuePageInfo = {
      page: 41,
      pageSize: 20,
      total: 1000,
      totalPages: 50,
      hasPreviousPage: true,
      hasNextPage: true,
    };

    const host = renderView(p);

    expect(host.textContent).toContain("品类能力申请队列");
    expect(host.textContent).toContain("支持 1000+ 个品类申请按页处理");
    expect(host.textContent).toContain("当前页 20 条");
    expect(host.textContent).toContain("pkg-marketplace-ops-041");
    expect(host.textContent).not.toContain("pkg-overflow-category-021");
    expect(host.textContent).toContain("显示第 41 / 50 页，共 1000 个品类申请");
    expect(host.querySelector('input[placeholder="搜索品类 / 岗位 / 开发者"]')).toBeTruthy();
  });

  it("keeps long category request details out of the queue until a row is selected", () => {
    const p = props();
    p.state.selectedRoleReviewId = null;
    p.state.selectedCategoryCapabilityReviewId = null;
    p.state.categoryCapabilityReviews = [categoryCapabilityReview()];
    p.state.categoryQueuePageInfo = {
      page: 1,
      pageSize: 20,
      total: 1000,
      totalPages: 50,
      hasPreviousPage: false,
      hasNextPage: true,
    };

    const host = renderView(p);

    expect(host.textContent).toContain("品类能力申请队列");
    expect(host.textContent).toContain("显示第 1 / 50 页，共 1000 个品类申请");
    expect(host.textContent).toContain("从左侧队列选择一条审核单查看摘要和操作");
    expect(host.textContent).not.toContain("岗位说明：商城运营岗位。");
    expect(host.textContent).not.toContain("SOP：读取商城经营数据，输出诊断。");
    expect(host.textContent).not.toContain(
      "Tool / Skill / Provider：tool.platform.marketplace_read_model",
    );
  });

  it("keeps category capability queue controls separate from the role queue controls", () => {
    const onCategoryFilterChange = vi.fn();
    const onCategorySearchChange = vi.fn();
    const onCategorySortChange = vi.fn();
    const onCategoryPageChange = vi.fn();
    const onCategoryPageSizeChange = vi.fn();
    const onRoleFilterChange = vi.fn();
    const onRoleSearchChange = vi.fn();
    const onRoleSortChange = vi.fn();
    const onRolePageChange = vi.fn();
    const onRolePageSizeChange = vi.fn();
    const p = props({
      onCategoryFilterChange,
      onCategorySearchChange,
      onCategorySortChange,
      onCategoryPageChange,
      onCategoryPageSizeChange,
      onRoleFilterChange,
      onRoleSearchChange,
      onRoleSortChange,
      onRolePageChange,
      onRolePageSizeChange,
    });
    p.state.categoryCapabilityReviews = [categoryCapabilityReview()];
    p.state.categoryQueuePageInfo = {
      page: 7,
      pageSize: 20,
      total: 1000,
      totalPages: 50,
      hasPreviousPage: true,
      hasNextPage: true,
    };

    const host = renderView(p);
    const categoryFilter = host.querySelector(
      'button[aria-label="筛选激活失败品类申请"]',
    ) as HTMLButtonElement;
    const categorySearch = host.querySelector(
      'input[placeholder="搜索品类 / 岗位 / 开发者"]',
    ) as HTMLInputElement;
    const selects = [...host.querySelectorAll("select")] as HTMLSelectElement[];
    const categorySort = selects[2];
    const categoryPageSize = selects[3];
    const nextButtons = [...host.querySelectorAll("button")].filter(
      (button) => button.textContent?.trim() === "下一页",
    ) as HTMLButtonElement[];

    categoryFilter.click();
    categorySearch.value = "商城运营";
    categorySearch.dispatchEvent(new Event("change"));
    expect([...categorySort.options].map((option) => option.textContent)).toContain("激活状态优先");
    expect([...categorySort.options].map((option) => option.textContent)).not.toContain("风险优先");
    categorySort.value = "activation_status_asc";
    categorySort.dispatchEvent(new Event("change"));
    categoryPageSize.value = "100";
    categoryPageSize.dispatchEvent(new Event("change"));
    nextButtons[1]?.click();

    expect(onCategoryFilterChange).toHaveBeenCalledWith("sync_failed");
    expect(onCategorySearchChange).toHaveBeenCalledWith("商城运营");
    expect(onCategorySortChange).toHaveBeenCalledWith("activation_status_asc");
    expect(onCategoryPageSizeChange).toHaveBeenCalledWith(100);
    expect(onCategoryPageChange).toHaveBeenCalledWith(8);
    expect(onRoleFilterChange).not.toHaveBeenCalled();
    expect(onRoleSearchChange).not.toHaveBeenCalled();
    expect(onRoleSortChange).not.toHaveBeenCalled();
    expect(onRolePageChange).not.toHaveBeenCalled();
    expect(onRolePageSizeChange).not.toHaveBeenCalled();
  });

  it("uses local activation wording for approved category capabilities", () => {
    const p = props();
    p.state.categoryCapabilityReviews = [
      categoryCapabilityReview({
        reviewStatus: "已通过",
        cloudSyncStatus: "未同步",
        toolSkillRequirements: ["tool.platform.marketplace_read_model"],
      }),
    ];
    p.state.selectedCategoryCapabilityReviewId = "category-review-1";

    const host = renderView(p);

    expect(host.textContent).toContain("激活品类");
    expect(host.textContent).toContain("未激活");
    expect(host.textContent).toContain("能力包状态：待工具与 Skill 1 项");
    expect(host.textContent).not.toContain("同步云端");
    expect(host.textContent).not.toContain("未同步");
    expect(buttonByText(host, "激活品类").disabled).toBe(false);
  });

  it("keeps activated category capability details compact and hides destructive actions", () => {
    const p = props();
    p.state.categoryCapabilityReviews = [
      categoryCapabilityReview({
        reviewStatus: "已通过",
        cloudSyncStatus: "已同步",
        capabilityRefs: ["marketplace.read"],
        toolSkillRequirements: ["tool.platform.marketplace_read_model"],
      }),
    ];
    p.state.selectedCategoryCapabilityReviewId = "category-review-1";
    p.state.selectedRoleReviewId = null;

    const host = renderView(p);
    const text = host.textContent ?? "";

    expect(text).toContain("正式品类已激活，开发者可在开发者中心绑定");
    expect(text).toContain("能力包状态：已准备");
    expect(text).toContain("已完成：该品类可被岗位开发者绑定。危险操作已收起");
    expect(text).toContain("岗位资料");
    expect(text).toContain("能力与待办");
    expect(text).toContain("审核事件");
    expect(
      [...host.querySelectorAll("button")].map((button) => button.textContent?.trim()),
    ).not.toEqual(expect.arrayContaining(["通过", "退回补充资料", "驳回"]));
  });

  it("treats dotted and underscored capability refs as the same in review guidance", () => {
    const p = props();
    p.state.roleReviews = [
      roleReview({
        id: "role-review-1",
        rolePackageId: "pkg-marketplace-ops",
        category: "category:marketplace-ops@1",
        requiredCapabilities: ["gateway.role.read.model"],
      }),
    ];
    p.state.selectedRoleReviewId = "role-review-1";
    p.state.categoryCapabilityReviews = [
      categoryCapabilityReview({
        id: "category-review-1",
        rolePackageId: "pkg-marketplace-ops",
        categoryRef: "category:marketplace-ops@1",
        categoryName: "商城运营",
        requiredCapabilities: ["gateway.role_read_model"],
        capabilityRefs: ["gateway.role_read_model"],
        toolSkillRequirements: ["tool.platform.gateway_role_read_model"],
        reviewStatus: "已通过",
        cloudSyncStatus: "已同步",
      }),
    ];
    p.state.selectedCategoryCapabilityReviewId = null;

    const host = renderView(p);
    const text = host.textContent ?? "";

    expect(text).not.toContain("品类能力申请：暂无已激活的正式品类能力包");
    expect(text).not.toContain("能力包待办：1 项请到工具与 Skill 模块处理");
    expect(text).toContain("需要先通过本地审核中心");
  });

  it("shows local listing result as a role listing instead of a cloud-only listing", () => {
    const p = props();
    p.state.roleReviews = [
      roleReview({
        reviewStatus: "已提交上架",
        validationStatus: "已通过",
        cloudSubmitStatus: "已提交",
        cloudRoleListingId: "local_rolelisting_marketplace_ops",
        submittedAt: 2,
      }),
    ];

    const host = renderView(p);

    expect(host.textContent).toContain("岗位商品：local_rolelisting_marketplace_ops");
    expect(host.textContent).not.toContain("云端 listing");
  });

  it("keeps the review center to two queues and no Tool Skill Provider review module", () => {
    const p = props();

    const host = renderView(p);
    const headings = [...host.querySelectorAll("h2")].map((heading) => heading.textContent?.trim());

    expect(headings).toContain("岗位审核队列");
    expect(headings).toContain("品类能力申请队列");
    expect(host.textContent).not.toContain("Provider/API · provider.platform.model_chat_analysis");
    expect(host.textContent).not.toContain("provider-api");
    expect(host.textContent).not.toContain("声明能力：model.chat.analysis");
    expect(host.textContent).not.toContain("工具与 Skill 审核");
  });

  it("explains role review blockers using related category and tool Skill todos", () => {
    const p = props();
    p.state.roleReviews = [
      roleReview({
        id: "role-review-1",
        rolePackageId: "pkg-marketplace-ops",
        listingDraftId: "draft-marketplace-ops",
        category: "category:marketplace-ops@1",
        requiredCapabilities: ["marketplace.read"],
      }),
    ];
    p.state.selectedRoleReviewId = "role-review-1";
    p.state.categoryCapabilityReviews = [
      categoryCapabilityReview({
        id: "category-review-1",
        rolePackageId: "pkg-marketplace-ops",
        listingDraftId: "draft-marketplace-ops",
        categoryRef: "category:marketplace-ops@1",
        categoryName: "商城运营",
        reviewStatus: "待审核",
        cloudSyncStatus: "未同步",
        toolSkillRequirements: ["tool.platform.marketplace_read_model"],
      }),
    ];

    const host = renderView(p);
    const text = host.textContent ?? "";

    expect(text).toContain("需要先处理 品类能力申请：商城运营（待审核/未激活）");
    expect(text).toContain("能力包待办：1 项请到工具与 Skill 模块处理");
    expect(text).not.toContain("工具与 Skill 审核：tool.platform.marketplace_read_model");
    expect(text).toContain("完成后点击一键综合检查，再人工通过");
  });

  it("does not recommend or bind categories for the role developer from review center", () => {
    const p = props();
    p.state.roleReviews = [
      roleReview({
        id: "role-review-1",
        category: "",
      }),
    ];
    p.state.selectedRoleReviewId = "role-review-1";
    p.state.categoryCapabilityReviews = [
      categoryCapabilityReview({
        id: "category-review-1",
        rolePackageId: "pkg-image-review",
        categoryRef: "category:image-review@1",
        categoryName: "图片审核",
        reviewStatus: "已通过",
        cloudSyncStatus: "已同步",
        workflowStatus: "category_review_approved",
        capabilityRefs: ["image.generation"],
      }),
    ];

    const host = renderView(p);

    expect(host.textContent).not.toContain("推荐品类可绑定");
    expect(host.textContent).toContain("图片审核");
    expect(host.textContent).toContain("已激活");
    expect(host.textContent).not.toContain("已同步");
    expect(
      [...host.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "绑定推荐品类",
      ),
    ).toBe(false);
  });

  it("does not offer synced categories that do not cover the selected role", () => {
    const p = props();
    p.state.roleReviews = [
      roleReview({
        id: "role-review-1",
        category: "",
      }),
    ];
    p.state.selectedRoleReviewId = "role-review-1";
    p.state.categoryCapabilityReviews = [
      categoryCapabilityReview({
        id: "category-review-1",
        reviewStatus: "已通过",
        cloudSyncStatus: "已同步",
        workflowStatus: "category_review_approved",
        capabilityRefs: ["marketplace.read"],
      }),
    ];

    const host = renderView(p);

    expect(host.textContent).not.toContain("推荐品类可绑定");
    expect(
      [...host.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "绑定推荐品类",
      ),
    ).toBe(false);
  });

  it("returns category capability requests for more developer materials without rejecting them", () => {
    const onRequestCategoryCapabilityChanges = vi.fn();
    const p = props({ onRequestCategoryCapabilityChanges });
    p.state.categoryCapabilityReviews = [categoryCapabilityReview()];
    p.state.selectedCategoryCapabilityReviewId = "category-review-1";

    const host = renderView(p);
    buttonByText(host, "退回补充资料").click();

    expect(onRequestCategoryCapabilityChanges).toHaveBeenCalledWith("category-review-1");
  });
});
