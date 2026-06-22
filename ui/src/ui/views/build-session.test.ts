/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { AppViewState } from "../app-view-state.ts";
import { createDefaultBuildSessionState } from "../controllers/build-session.ts";
import { createDefaultReviewCenterState } from "../controllers/review-center.ts";
import { createDefaultToolSupplyControlState } from "../controllers/tool-supply-control.ts";
import { renderBuildSessionWizard } from "./build-session.ts";

function renderView(state: Partial<AppViewState>) {
  const host = document.createElement("div");
  const appState = {
    submitDeveloperRoleForListing: vi.fn(async () => {}),
    submitCategoryCapabilityRequest: vi.fn(async () => {}),
    refreshReviewCenter: vi.fn(async () => {}),
    refreshSupportContact: vi.fn(async () => {}),
    refreshBuildSessionBindableCategories: vi.fn(async () => {}),
    bindRoleReviewCategory: vi.fn(async () => {}),
    runRoleReviewValidation: vi.fn(async () => {}),
    approveRoleReview: vi.fn(async () => {}),
    setTab: vi.fn(),
    ...state,
  } as unknown as AppViewState;
  render(renderBuildSessionWizard(appState, appState.buildSession, vi.fn()), host);
  return { host, state: appState };
}

function listingButton(host: HTMLElement): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes("开发者确认上架"),
  );
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

describe("renderBuildSessionWizard", () => {
  it("shows production role material fields in the existing brief form", () => {
    const buildSession = createDefaultBuildSessionState();
    buildSession.step = "confirming";
    buildSession.briefForm = {
      roleTitle: "商城运营诊断官",
      roleDescription: "观察授权转化、执行成功率、审计和账本。",
      targetUser: "岗位商城运营者",
      targetCategory: "商城运营",
      dailySop: ["查看授权转化"],
      weeklySop: ["复盘能力缺口"],
      monthlySop: ["输出月度经营报告"],
      inputTypes: ["商城经营数据"],
      outputTypes: ["诊断报告", "审计摘要"],
      forbiddenActions: ["不自动上架"],
      qualityStandards: ["必须有审计记录"],
    };

    const { host } = renderView({ buildSession });

    expect(host.querySelector('input[placeholder="目标用户"]')).toBeTruthy();
    expect(
      host.querySelector('textarea[placeholder="每日 SOP / 日规划（每行一项）"]'),
    ).toBeTruthy();
    expect(
      host.querySelector('textarea[placeholder="每周 SOP / 周规划（每行一项）"]'),
    ).toBeTruthy();
    expect(
      host.querySelector('textarea[placeholder="每月 SOP / 月规划（每行一项）"]'),
    ).toBeTruthy();
    expect(host.querySelector('textarea[placeholder="输入（每行一项）"]')).toBeTruthy();
    expect(host.querySelector('textarea[placeholder="输出 / 执行产物（每行一项）"]')).toBeTruthy();
    expect(
      host.querySelector('textarea[placeholder="风险边界 / 禁止事项（每行一项）"]'),
    ).toBeTruthy();
    expect(
      host.querySelector('textarea[placeholder="完成标准 / 质量标准（每行一项）"]'),
    ).toBeTruthy();
  });

  it("shows human-readable execution and delivery preview for the role brief", () => {
    const buildSession = createDefaultBuildSessionState();
    buildSession.step = "confirming";
    buildSession.briefForm = {
      roleTitle: "电商美工岗位",
      roleDescription: "生成产品主图、详情页和运营报告。",
      taskExamples: ["设计图片", "生成详情页"],
      outputTypes: ["图片", "详情页", "报告"],
    };

    const { host } = renderView({ buildSession });

    expect(host.textContent).toContain("执行与交付预览");
    expect(host.textContent).toContain("生成创作");
    expect(host.textContent).toContain("分析诊断");
    expect(host.textContent).toContain("组合执行");
    expect(host.textContent).toContain("图片文件");
    expect(host.textContent).toContain("页面/详情页");
    expect(host.textContent).toContain("文档/报告");
    expect(host.textContent).toContain("通用执行方式和输出契约");
  });

  it("does not show category production todos when an activated category already covers the role", () => {
    const buildSession = createDefaultBuildSessionState();
    buildSession.step = "confirming";
    buildSession.briefForm = {
      roleTitle: "商城运营诊断官",
      roleDescription: "观察授权转化、执行成功率、审计和账本。",
      targetUser: "岗位商城运营者",
    };
    const capabilityAnalysis = {
      analysis: {
        categoryName: "商城运营",
        requiredCapabilities: ["marketplace.read", "audit.record"],
        neededTools: [],
        neededSkills: [],
        neededProviders: [],
        missingCapabilities: [],
        categoryCapabilityReview: {
          workflowStatus: "category_review_approved",
          reviewStatus: "已通过",
          cloudSyncStatus: "已同步",
        },
        toolSkillReviews: [],
      },
    };
    buildSession.capabilityAnalysis = capabilityAnalysis;

    const { host } = renderView({ buildSession });

    expect(host.textContent).toContain("能力分析已生成");
    expect(host.textContent).toContain("识别品类：商城运营");
    expect(host.textContent).toContain("缺失能力：无");
    expect(host.textContent).toContain("品类制作待办：无");
    expect(host.textContent).not.toContain("具体在工具与 Skill 模块处理");
  });

  it("does not treat a locally approved but inactive category as bindable", async () => {
    const setTab = vi.fn();
    const buildSession = createDefaultBuildSessionState();
    buildSession.step = "confirming";
    const capabilityAnalysis = {
      analysis: {
        categoryName: "商城运营",
        requiredCapabilities: ["marketplace.read", "audit.record"],
        neededTools: ["tool.platform.marketplace_read_model"],
        neededSkills: ["skill.platform.marketplace_ops_diagnosis"],
        neededProviders: [],
        missingCapabilities: [],
        categoryCapabilityReview: {
          id: "category-review-1",
          requestId: "role-capability:marketplace-ops",
          workflowStatus: "category_review_approved",
          reviewStatus: "已通过",
          cloudSyncStatus: "未同步",
        },
      },
    };
    buildSession.capabilityAnalysis = capabilityAnalysis;

    const { host } = renderView({ buildSession, setTab });

    expect(host.textContent).toContain("品类能力申请：审核已通过，等待工具与 Skill 激活");
    expect(host.textContent).toContain("品类申请已通过，但还不能绑定。");
    expect(host.textContent).not.toContain("品类能力申请：已有可绑定品类");
    expect(host.textContent).not.toContain(
      "开发者可在岗位生成完成后，从可选品类里自行绑定该品类。",
    );
    const button = [...host.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("去工具与 Skill"),
    ) as HTMLButtonElement | undefined;
    expect(button?.disabled).toBe(false);

    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(setTab).toHaveBeenCalledWith("skills");
  });

  it("shows related tool and skill development todos for a pending category capability", async () => {
    const setTab = vi.fn();
    const refreshToolSupplyControlReadModel = vi.fn(async () => {});
    const buildSession = createDefaultBuildSessionState();
    buildSession.step = "confirming";
    buildSession.sessionId = "session-marketplace-ops";
    buildSession.briefForm = {
      roleTitle: "商城运营诊断官",
      roleDescription: "观察授权转化、执行成功率、审计和账本。",
      targetCategory: "商城运营",
    };
    const capabilityAnalysis = {
      analysis: {
        categoryName: "商城运营",
        categoryRef: "category:marketplace-ops@1",
        requiredCapabilities: ["marketplace.read", "audit.record"],
        neededTools: ["tool.platform.marketplace_read_model"],
        neededSkills: ["skill.platform.marketplace_ops_diagnosis"],
        missingCapabilities: ["marketplace.read"],
        categoryCapabilityReview: {
          id: "category-review-1",
          requestId: "role-capability:marketplace-ops",
          workflowStatus: "category_review_approved",
          reviewStatus: "已通过",
          cloudSyncStatus: "未同步",
        },
      },
    };
    buildSession.capabilityAnalysis = capabilityAnalysis;

    const { host } = renderView({
      buildSession,
      setTab,
      refreshToolSupplyControlReadModel,
      toolSupplyControl: {
        ...createDefaultToolSupplyControlState(),
        readModel: {
          systemDevelopmentTodos: [
            {
              id: "todo-tool-1",
              assetType: "tool",
              assetId: "tool.platform.marketplace_read_model",
              source: "category_capability_request",
              sourceListingDraftId: "session-marketplace-ops",
              sourceRolePackageId: "商城运营诊断官",
              sourceRequestId: "role-capability:marketplace-ops",
              categoryCapabilityReviewId: "category-review-1",
              targetCategoryRef: "category:marketplace-ops@1",
              targetCategoryName: "商城运营",
              declaredCapabilities: ["marketplace.read"],
              requiredCapabilities: ["marketplace.read", "audit.record"],
              riskLevel: "medium",
              reviewStatus: "待审核",
              reviewDecision: null,
              reviewFindings: [],
              nextAction: {
                label: "补齐工具实现并送审",
                reason: "岗位缺少商城读取能力",
              },
            },
          ],
        } as unknown as NonNullable<AppViewState["toolSupplyControl"]["readModel"]>,
      },
    });

    expect(host.textContent).toContain("工具与 Skill 待办：1 项");
    expect(host.textContent).toContain("Tool/API · 商城数据读取工具");
    expect(host.textContent).toContain("补齐工具实现并送审");
    const button = [...host.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("去工具与 Skill处理"),
    ) as HTMLButtonElement | undefined;
    expect(button?.disabled).toBe(false);

    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refreshToolSupplyControlReadModel).toHaveBeenCalledOnce();
    expect(setTab).toHaveBeenCalledWith("skills");
  });

  it("lets the role developer submit a missing category capability request from the existing capability analysis block", async () => {
    const submitCategoryCapabilityRequest = vi.fn(async () => {});
    const reduceRoleDevelopmentScopeToBasic = vi.fn(async () => {});
    const refreshReviewCenter = vi.fn(async () => {});
    const setTab = vi.fn();
    const buildSession = createDefaultBuildSessionState();
    buildSession.step = "confirming";
    buildSession.briefForm = {
      roleTitle: "商城运营诊断官",
      roleDescription: "观察授权转化、执行成功率、审计和账本。",
      targetUser: "岗位商城运营者",
      targetCategory: "商城运营",
      dailySop: ["查看授权转化"],
      weeklySop: ["复盘能力缺口"],
      monthlySop: ["输出月度经营报告"],
      inputTypes: ["岗位商品、授权、执行摘要"],
      outputTypes: ["运营诊断报告", "审计摘要"],
      forbiddenActions: ["不自动上架"],
      qualityStandards: ["必须有审计记录"],
    };
    const capabilityAnalysis = {
      analysis: {
        categoryName: "商城运营",
        categoryRef: "category:marketplace-ops@1",
        requiredCapabilities: ["marketplace.read", "audit.record"],
        neededTools: ["tool.platform.marketplace_read_model"],
        neededSkills: ["skill.platform.marketplace_ops_diagnosis"],
        neededProviders: ["provider.platform.model_chat_analysis"],
        missingCapabilities: ["marketplace.read"],
        categoryCapabilityReview: {
          requestId: "role-capability:marketplace-ops",
          workflowStatus: "waiting_category_review",
          reviewStatus: "待审核",
          cloudSyncStatus: "未同步",
        },
      },
    };
    buildSession.capabilityAnalysis = capabilityAnalysis;
    buildSession.roleDevelopment = {
      sessionId: "session-1",
      status: "need_capability_decision",
      userStatusLabel: "发现缺失能力，等待开发决策",
      roleTitle: "商城运营诊断官",
      categoryName: "商城运营",
      categoryRef: "category:marketplace-ops@1",
      briefReady: true,
      canGenerateRolePackage: false,
      capability: {
        required: ["marketplace.read", "audit.record"],
        existing: ["audit.record"],
        missing: ["marketplace.read"],
        disabled: [],
        neededTools: ["tool.platform.marketplace_read_model"],
        neededSkills: ["skill.platform.marketplace_ops_diagnosis"],
        neededProviders: ["provider.platform.model_chat_analysis"],
        humanConfirmationCapabilities: [],
        nonAutomaticCapabilities: [],
      },
      categoryCapabilityReview: {
        requestId: "role-capability:marketplace-ops",
        workflowStatus: "waiting_category_review",
        reviewStatus: "待审核",
        cloudSyncStatus: "未同步",
      },
      toolSkillDevelopment: {
        required: [],
        todos: [],
        total: 0,
        approved: 0,
        pending: 0,
        ready: true,
      },
      nextActions: [
        {
          kind: "use_basic_version",
          label: "先做基础版",
          reason: "保留已具备能力：audit.record；暂时关闭缺失能力。",
          enabled: true,
        },
        {
          kind: "submit_capability_request",
          label: "提交能力开发申请",
          reason: "缺失能力：marketplace.read。",
          enabled: true,
        },
      ],
      analysis: capabilityAnalysis.analysis as Record<string, unknown>,
    };

    const { host } = renderView({
      buildSession,
      submitCategoryCapabilityRequest,
      reduceRoleDevelopmentScopeToBasic,
      refreshReviewCenter,
      setTab,
    });

    expect(host.textContent).toContain("品类能力申请：等待开发者提交申请");
    expect(host.textContent).toContain("申请编号：role-capability:marketplace-ops");
    expect(host.textContent).toContain("现在还不能生成完整岗位包");
    expect(host.textContent).toContain("系统不会把缺失能力伪装成已具备能力");
    expect(host.textContent).toContain("需要先处理：商城数据读取");
    expect(host.textContent).toContain("下一步：先做基础版、提交能力开发申请");
    expect(host.textContent).not.toContain("需要先处理：marketplace.read");
    const basicButton = [...host.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("先做基础版"),
    ) as HTMLButtonElement | undefined;
    expect(basicButton?.disabled).toBe(false);
    basicButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reduceRoleDevelopmentScopeToBasic).toHaveBeenCalledOnce();

    const button = [...host.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("提交/刷新品类申请"),
    ) as HTMLButtonElement | undefined;
    expect(button?.disabled).toBe(false);

    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(submitCategoryCapabilityRequest).toHaveBeenCalledOnce();
    expect(refreshReviewCenter).toHaveBeenCalled();
    expect(setTab).toHaveBeenCalledWith("reviewCenter");
  });

  it("shows returned category capability request reasons and keeps the resubmit entry available", () => {
    const buildSession = createDefaultBuildSessionState();
    buildSession.step = "confirming";
    buildSession.capabilityAnalysis = {
      analysis: {
        categoryName: "商城运营",
        categoryRef: "category:marketplace-ops@1",
        requiredCapabilities: ["marketplace.read", "audit.record"],
        neededTools: ["tool.platform.marketplace_read_model"],
        neededSkills: ["skill.platform.marketplace_ops_diagnosis"],
        neededProviders: [],
        missingCapabilities: ["marketplace.read"],
        categoryCapabilityReview: {
          id: "category-review-1",
          requestId: "role-capability:marketplace-ops",
          workflowStatus: "waiting_category_review",
          reviewStatus: "待开发者修改",
          reviewDecision: "品类能力申请资料不完整，请补充 SOP 和风险边界。",
          cloudSyncStatus: "未同步",
        },
      },
    };

    const { host } = renderView({ buildSession });

    expect(host.textContent).toContain("品类能力申请：已退回，等待补充资料");
    expect(host.textContent).toContain(
      "审核中心退回原因：品类能力申请资料不完整，请补充 SOP 和风险边界。",
    );
    expect(host.textContent).toContain(
      "请补充岗位说明、SOP、输入输出或风险边界后，再点击“提交/刷新品类申请”。",
    );
    const button = [...host.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("提交/刷新品类申请"),
    ) as HTMLButtonElement | undefined;
    expect(button?.disabled).toBe(false);
  });

  it("shows support contact info for role developers in the build flow", () => {
    const buildSession = createDefaultBuildSessionState();
    buildSession.step = "idle";

    const { host } = renderView({
      buildSession,
      supportContact: {
        loading: false,
        error: null,
        contact: {
          displayName: "系统开发者",
          wechatId: "openclaw-support",
          audience: "developer",
          purpose: "处理岗位创建和上架问题",
          serviceHours: "工作日",
        },
      },
    });

    expect(host.textContent).toContain("遇到问题可联系");
    expect(host.textContent).toContain("系统开发者");
    expect(host.textContent).toContain("微信：openclaw-support");
    expect(host.textContent).toContain("岗位创建、品类能力、审核或上架卡住时");
  });

  it("shows and enforces the three-role developer limit in the existing idle form", () => {
    const buildSession = createDefaultBuildSessionState();
    buildSession.step = "idle";
    buildSession.requirements = "创建第四个岗位。";
    buildSession.sessions = [
      {
        sessionId: "session-1",
        state: "created",
        createdAt: 1,
        updatedAt: 1,
        userRequirements: "岗位一",
        userConfirmations: [],
        validationErrors: [],
      },
      {
        sessionId: "session-2",
        state: "completed",
        createdAt: 2,
        updatedAt: 2,
        userRequirements: "岗位二",
        userConfirmations: [],
        validationErrors: [],
      },
      {
        sessionId: "session-3",
        state: "confirming",
        createdAt: 3,
        updatedAt: 3,
        userRequirements: "岗位三",
        userConfirmations: [],
        validationErrors: [],
      },
      {
        sessionId: "session-cancelled",
        state: "cancelled",
        createdAt: 4,
        updatedAt: 4,
        userRequirements: "取消的岗位",
        userConfirmations: [],
        validationErrors: [],
      },
    ];

    const { host } = renderView({ buildSession });
    const startButton = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("开始匹配"),
    ) as HTMLButtonElement | undefined;

    expect(host.textContent).toContain("开发席位：3 / 3");
    expect(host.textContent).toContain("请先取消或清理已有岗位后再创建新岗位");
    expect(startButton?.disabled).toBe(true);
  });

  it("keeps developer listing disabled until local review is approved", () => {
    const buildSession = createDefaultBuildSessionState();
    buildSession.step = "completed";
    buildSession.session = {
      sessionId: "session-1",
      state: "completed",
      createdAt: 1,
      updatedAt: 1,
      userRequirements: "创建商城运营岗位。",
      userConfirmations: [],
      validationErrors: [],
    };
    buildSession.generateResult = {
      packageDir: "/tmp/pkg-marketplace-ops",
      files: ["manifest.json"],
      validationErrors: [],
      review: {
        id: "role-review-1",
        rolePackageId: "商城运营诊断官",
        reviewStatus: "待审核",
      },
    };

    const { host } = renderView({ buildSession });

    const button = listingButton(host);
    expect(button.disabled).toBe(true);
    expect(button.title).toContain("需要先绑定正式品类");
    expect(button.title).toContain("本地审核中心人工通过");
    expect(host.textContent).toContain("下一步：去审核中心处理本地审核。");
    expect(host.textContent).toContain("暂未绑定正式品类");
    expect(host.textContent).toContain("上架准备清单");
    expect(host.textContent).toContain("已完成 · 岗位包已生成");
    expect(host.textContent).toContain("待处理 · 正式品类已绑定");
    expect(host.textContent).toContain(
      "暂未绑定正式品类，岗位不能上架。请先刷新列表并绑定已激活品类。",
    );
  });

  it("sends the role developer to review center when local review is still blocked", async () => {
    const refreshReviewCenter = vi.fn(async () => {});
    const setTab = vi.fn();
    const buildSession = createDefaultBuildSessionState();
    buildSession.step = "completed";
    buildSession.session = {
      sessionId: "session-1",
      state: "completed",
      createdAt: 1,
      updatedAt: 1,
      userRequirements: "创建商城运营岗位。",
      userConfirmations: [],
      validationErrors: [],
    };
    buildSession.generateResult = {
      packageDir: "/tmp/pkg-marketplace-ops",
      files: ["manifest.json"],
      validationErrors: [],
      review: {
        id: "role-review-1",
        rolePackageId: "商城运营诊断官",
        reviewStatus: "待审核",
        requiredCapabilities: ["marketplace.read", "audit.record"],
      },
    };

    const { host } = renderView({ buildSession, refreshReviewCenter, setTab });
    const button = [...host.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("去审核中心"),
    ) as HTMLButtonElement | undefined;
    expect(button).toBeTruthy();
    expect(host.textContent).toContain("能力需求：商城数据读取、审计记录");

    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refreshReviewCenter).toHaveBeenCalled();
    expect(setTab).toHaveBeenCalledWith("reviewCenter");
  });

  it("lets the role developer submit a bound role into the listing review queue", async () => {
    const refreshReviewCenter = vi.fn(async () => {});
    const runRoleReviewValidation = vi.fn(async () => {});
    const setTab = vi.fn();
    const buildSession = createDefaultBuildSessionState();
    buildSession.step = "completed";
    buildSession.session = {
      sessionId: "session-1",
      state: "completed",
      createdAt: 1,
      updatedAt: 1,
      userRequirements: "创建商城运营岗位。",
      userConfirmations: [],
      validationErrors: [],
    };
    buildSession.generateResult = {
      packageDir: "/tmp/pkg-marketplace-ops",
      files: ["manifest.json"],
      validationErrors: [],
      review: {
        id: "role-review-1",
        rolePackageId: "商城运营诊断官",
        category: "category:marketplace-ops@1",
        reviewStatus: "待审核",
        requiredCapabilities: ["marketplace.read", "audit.record"],
      },
    };

    const { host } = renderView({
      buildSession,
      refreshReviewCenter,
      runRoleReviewValidation,
      setTab,
    });
    const button = [...host.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("提交岗位上架审核"),
    ) as HTMLButtonElement | undefined;

    expect(host.textContent).toContain("下一步：提交岗位上架审核。");
    expect(host.textContent).toContain("正式品类已绑定");
    expect(host.textContent).toContain("待处理 · 本地综合检查已通过");
    expect(host.textContent).toContain("提交岗位上架审核后会运行综合检查。");
    expect(button).toBeTruthy();
    expect(button?.title).toContain("审核中心检查岗位资料、正式品类和风险边界");

    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runRoleReviewValidation).toHaveBeenCalledWith("role-review-1");
    expect(refreshReviewCenter).not.toHaveBeenCalled();
    expect(setTab).toHaveBeenCalledWith("reviewCenter");
  });

  it("lets the role developer confirm listing after local review approval", async () => {
    const submitDeveloperRoleForListing = vi.fn(async () => {});
    const buildSession = createDefaultBuildSessionState();
    buildSession.step = "completed";
    buildSession.session = {
      sessionId: "session-1",
      state: "completed",
      createdAt: 1,
      updatedAt: 1,
      userRequirements: "创建商城运营岗位。",
      userConfirmations: [],
      validationErrors: [],
    };
    buildSession.generateResult = {
      packageDir: "/tmp/pkg-marketplace-ops",
      files: ["manifest.json"],
      validationErrors: [],
      review: {
        id: "role-review-1",
        rolePackageId: "商城运营诊断官",
        reviewStatus: "已通过",
        category: "category:marketplace-ops@1",
      },
    };

    const { host } = renderView({ buildSession, submitDeveloperRoleForListing });

    const button = listingButton(host);
    expect(button.disabled).toBe(false);
    expect(button.title).toContain("生成正式岗位商品");
    button.click();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(submitDeveloperRoleForListing).toHaveBeenCalledWith("role-review-1");
  });

  it("lets the role developer manually approve local review after validation passes", async () => {
    const approveRoleReview = vi.fn(async () => {});
    const refreshReviewCenter = vi.fn(async () => {});
    const buildSession = createDefaultBuildSessionState();
    buildSession.step = "completed";
    buildSession.session = {
      sessionId: "session-1",
      state: "completed",
      createdAt: 1,
      updatedAt: 1,
      userRequirements: "创建商城运营岗位。",
      userConfirmations: [],
      validationErrors: [],
    };
    buildSession.generateResult = {
      packageDir: "/tmp/pkg-marketplace-ops",
      files: ["manifest.json"],
      validationErrors: [],
      review: {
        id: "role-review-1",
        rolePackageId: "商城运营诊断官",
        reviewStatus: "检查中",
        validationStatus: "已通过",
        category: "category:marketplace-ops@1",
        reviewFindings: [
          {
            section: "合格性",
            severity: "pass",
            message: "综合检查通过，可提交人工最终审核。",
          },
        ],
      },
    };

    const { host } = renderView({ buildSession, approveRoleReview, refreshReviewCenter });

    expect(host.textContent).toContain("下一步：人工通过本地审核。");
    expect(host.textContent).toContain("已完成 · 本地综合检查已通过");
    expect(host.textContent).toContain("待处理 · 人工审核已通过");
    const approveButton = [...host.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("人工通过本地审核"),
    ) as HTMLButtonElement | undefined;
    const submitButton = [...host.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("提交岗位上架审核"),
    ) as HTMLButtonElement | undefined;
    expect(approveButton).toBeTruthy();
    expect(submitButton).toBeFalsy();

    approveButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(approveRoleReview).toHaveBeenCalledWith("role-review-1");
    expect(refreshReviewCenter).toHaveBeenCalled();
  });

  it("keeps listing confirmation disabled when an approved review has no formal category", () => {
    const buildSession = createDefaultBuildSessionState();
    buildSession.step = "completed";
    buildSession.session = {
      sessionId: "session-1",
      state: "completed",
      createdAt: 1,
      updatedAt: 1,
      userRequirements: "创建商城运营岗位。",
      userConfirmations: [],
      validationErrors: [],
    };
    buildSession.generateResult = {
      packageDir: "/tmp/pkg-marketplace-ops",
      files: ["manifest.json"],
      validationErrors: [],
      review: {
        id: "role-review-1",
        rolePackageId: "商城运营诊断官",
        reviewStatus: "已通过",
        category: "",
      },
    };

    const { host } = renderView({ buildSession });

    const button = listingButton(host);
    expect(button.disabled).toBe(true);
    expect(button.title).toContain("需要先绑定正式品类");
    expect(host.textContent).toContain("暂未绑定正式品类，岗位不能上架");
  });

  it("uses live review center status when returning from local approval", () => {
    const buildSession = createDefaultBuildSessionState();
    buildSession.step = "completed";
    buildSession.session = {
      sessionId: "session-1",
      state: "completed",
      createdAt: 1,
      updatedAt: 1,
      userRequirements: "创建商城运营岗位。",
      userConfirmations: [],
      validationErrors: [],
    };
    buildSession.generateResult = {
      packageDir: "/tmp/pkg-marketplace-ops",
      files: ["manifest.json"],
      validationErrors: [],
      review: {
        id: "role-review-1",
        rolePackageId: "商城运营诊断官",
        reviewStatus: "待审核",
      },
    };

    const { host } = renderView({
      buildSession,
      reviewCenter: {
        ...createDefaultReviewCenterState(),
        loading: false,
        actionBusyKey: null,
        error: null,
        roleReviews: [
          {
            id: "role-review-1",
            rolePackageId: "商城运营诊断官",
            listingDraftId: "session-1",
            developerId: "local-developer",
            category: "category:marketplace-ops@1",
            packageDir: "/tmp/pkg-marketplace-ops",
            requiredCapabilities: ["marketplace.read"],
            boundCommonCapabilities: ["marketplace.read"],
            validationStatus: "pass",
            riskLevel: "low",
            reviewStatus: "已通过",
            reviewFindings: [],
            reviewDecision: "本地审核通过，等待岗位开发者确认上架。",
            approvedAt: 1,
            cloudRolePackageId: null,
            cloudPackageId: null,
            cloudPackageVersion: null,
            cloudRoleListingId: null,
            submittedAt: null,
            submitError: null,
            cloudSubmitStatus: "未提交",
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        categoryCapabilityReviews: [],
        selectedRoleReviewId: "role-review-1",
        selectedCategoryCapabilityReviewId: null,
        eventsByReviewId: {},
      },
    } as Partial<AppViewState>);

    const button = listingButton(host);
    expect(button.disabled).toBe(false);
    expect(host.textContent).toContain("下一步：岗位开发者确认上架。");
    expect(host.textContent).toContain("绑定品类：category:marketplace-ops@1");
  });

  it("shows the local role listing id and execution path after developer confirmation", () => {
    const setTab = vi.fn();
    const buildSession = createDefaultBuildSessionState();
    buildSession.step = "completed";
    buildSession.session = {
      sessionId: "session-1",
      state: "completed",
      createdAt: 1,
      updatedAt: 1,
      userRequirements: "创建商城运营岗位。",
      userConfirmations: [],
      validationErrors: [],
    };
    buildSession.generateResult = {
      packageDir: "/tmp/pkg-marketplace-ops",
      files: ["manifest.json"],
      validationErrors: [],
      review: {
        id: "role-review-1",
        rolePackageId: "商城运营诊断官",
        reviewStatus: "已提交上架",
        cloudRoleListingId: "local_rolelisting_marketplace_ops",
      },
      listingResult: {
        cloud: {
          mode: "local",
          roleListingId: "local_rolelisting_marketplace_ops",
        },
      },
    };

    const { host } = renderView({ buildSession, setTab });

    expect(host.textContent).toContain("下一步：去费用与授权创建 0 元正式授权。");
    expect(host.textContent).toContain("岗位商品：local_rolelisting_marketplace_ops");
    expect(host.textContent).toContain("首个真实可执行岗位按 0 元正式授权处理");
    expect(host.textContent).toContain("已完成 · 正式岗位商品已生成");
    expect(host.textContent).toContain("已上架，可进入费用与授权。");
    expect(host.textContent).toContain("执行拿结果路径");
    expect(host.textContent).toContain("到岗位执行派发真实任务");
    expect(host.textContent).toContain("图片、详情页、执行摘要、打包文件、审计记录和账本记录");
    const listedButton = [...host.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("已上架"),
    );
    expect(listedButton).toBeTruthy();
    const executeButton = [...host.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("去岗位执行"),
    ) as HTMLButtonElement | undefined;
    expect(executeButton).toBeTruthy();
    executeButton?.click();
    expect(setTab).toHaveBeenCalledWith("aics");
  });

  it("lets the role developer bind an approved category from developer center", async () => {
    const bindRoleReviewCategory = vi.fn(async () => {});
    const refreshReviewCenter = vi.fn(async () => {});
    const refreshBuildSessionBindableCategories = vi.fn(async () => {});
    const buildSession = createDefaultBuildSessionState();
    buildSession.step = "completed";
    buildSession.session = {
      sessionId: "session-1",
      state: "completed",
      createdAt: 1,
      updatedAt: 1,
      userRequirements: "创建商城运营岗位。",
      userConfirmations: [],
      validationErrors: [],
    };
    buildSession.generateResult = {
      packageDir: "/tmp/pkg-marketplace-ops",
      files: ["manifest.json"],
      validationErrors: [],
      review: {
        id: "role-review-1",
        rolePackageId: "pkg-marketplace-ops",
        developerId: "local-developer",
        category: "",
        reviewStatus: "待审核",
        requiredCapabilities: ["marketplace.read", "gateway.role.read.model"],
      },
    };

    const { host } = renderView({
      buildSession,
      bindRoleReviewCategory,
      refreshReviewCenter,
      refreshBuildSessionBindableCategories,
      reviewCenter: {
        ...createDefaultReviewCenterState(),
        loading: false,
        actionBusyKey: null,
        error: null,
        roleReviews: [],
        categoryCapabilityReviews: [
          {
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
              roleTitle: "商城运营诊断官",
              roleDescription: "商城运营岗位。",
              targetUser: "运营者",
              targetCategory: "商城运营",
              requiredCapabilities: ["marketplace.read", "gateway.role.read.model"],
              inputOutput: "输入商城数据，输出诊断。",
            },
            requiredCapabilities: ["marketplace.read", "gateway.role.read.model"],
            inputOutput: "输入商城数据，输出诊断。",
            toolSkillRequirements: [],
            riskBoundaries: [],
            capabilityRefs: ["marketplace.read", "gateway.role_read_model"],
            skillPackRef: "skillpack:marketplace-ops",
            toolPackRef: "toolpack:marketplace-ops",
            categoryPackRef: "categorypack:marketplace-ops",
            catalogRefs: [],
            workflowStatus: "category_review_approved",
            reviewStatus: "已通过",
            reviewFindings: [],
            reviewDecision: "本地正式品类能力已激活，开发者可绑定。",
            reviewedBy: "local-reviewer",
            reviewedAt: 1,
            cloudSyncStatus: "已同步",
            cloudSyncError: null,
            cloudSyncedAt: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        selectedRoleReviewId: "role-review-1",
        selectedCategoryCapabilityReviewId: null,
        eventsByReviewId: {},
      },
    } as Partial<AppViewState>);

    expect(host.textContent).toContain("可选品类");
    expect(host.textContent).toContain(
      "正式品类已激活，可以绑定。岗位开发者需要先绑定品类，再提交岗位上架审核。",
    );
    expect(host.textContent).toContain("商城运营 · category:marketplace-ops@1");
    const button = [...host.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("绑定品类"),
    ) as HTMLButtonElement | undefined;
    expect(button?.disabled).toBe(false);

    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(bindRoleReviewCategory).toHaveBeenCalledWith("role-review-1", "category-review-1");
    expect(refreshReviewCenter).toHaveBeenCalled();
    expect(refreshBuildSessionBindableCategories).toHaveBeenCalledWith("role-review-1");
  });

  it("shows bindable categories loaded for the build session even when the review-center page does not contain them", () => {
    const buildSession = createDefaultBuildSessionState();
    buildSession.step = "completed";
    buildSession.generateResult = {
      packageDir: "/tmp/pkg-marketplace-ops",
      files: ["manifest.json"],
      validationErrors: [],
      review: {
        id: "role-review-1",
        rolePackageId: "pkg-marketplace-ops",
        developerId: "local-developer",
        category: "",
        reviewStatus: "待审核",
        requiredCapabilities: ["marketplace.read"],
      },
    };
    buildSession.bindableCategoryReviews = [
      {
        id: "category-review-from-search",
        requestId: "request-from-search",
        rolePackageId: "pkg-marketplace-ops",
        listingDraftId: null,
        developerId: "local-developer",
        title: "商城运营",
        categoryRef: "category:marketplace-ops@1",
        categoryName: "商城运营",
        roleDescription: "商城运营岗位。",
        targetUser: "运营者",
        roleMaterials: {},
        requiredCapabilities: ["marketplace.read"],
        inputOutput: "输入商城数据，输出诊断。",
        toolSkillRequirements: [],
        riskBoundaries: [],
        capabilityRefs: ["marketplace.read"],
        skillPackRef: "skillpack:marketplace-ops",
        toolPackRef: "toolpack:marketplace-ops",
        categoryPackRef: "categorypack:marketplace-ops",
        catalogRefs: [],
        workflowStatus: "category_review_approved",
        reviewStatus: "已通过",
        reviewFindings: [],
        reviewDecision: "本地正式品类能力已激活，开发者可绑定。",
        reviewedBy: "local-reviewer",
        reviewedAt: 1,
        cloudSyncStatus: "已同步",
        cloudSyncError: null,
        cloudSyncedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const { host } = renderView({
      buildSession,
      reviewCenter: {
        ...createDefaultReviewCenterState(),
        categoryCapabilityReviews: [],
      },
    } as Partial<AppViewState>);

    expect(host.textContent).toContain("可选品类");
    expect(host.textContent).toContain("商城运营 · category:marketplace-ops@1");
    expect(host.textContent).toContain("刷新列表");
  });
});
