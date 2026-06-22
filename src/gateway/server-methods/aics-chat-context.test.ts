import { describe, expect, it } from "vitest";
import {
  buildAicsMainWorkflowModelPrompt,
  buildAicsModelPrompt,
  normalizeChatSendAicsContext,
} from "./aics-chat-context.js";

describe("AICS chat context", () => {
  it("keeps developer mode focused on role package building", () => {
    const context = normalizeChatSendAicsContext({
      mode: "developer",
      stage: "intake",
      roleQuery: "should be ignored",
    });

    expect(context).toEqual({ mode: "developer", stage: "intake" });
    expect(
      buildAicsModelPrompt({
        context: context!,
        message: "我要开发一个岗位商城电商美工岗位",
      }),
    ).toContain("岗位开发专属助手");
  });

  it("builds OpenClaw main workflow prompts that keep role execution behind main flow dispatch", () => {
    const context = normalizeChatSendAicsContext({
      mode: "openclaw_main",
      stage: "planning",
      executionChannel: "local_openclaw",
      roleListingId: "role_image_review",
      roleTitle: "商品图检查岗位",
      workspaceDir: "/tmp/openclaw-workspace",
    });

    expect(context).toEqual({
      mode: "openclaw_main",
      stage: "planning",
      executionChannel: "local_openclaw",
      roleListingId: "role_image_review",
      roleTitle: "商品图检查岗位",
      workspaceDir: "/tmp/openclaw-workspace",
    });

    const prompt = buildAicsModelPrompt({
      context: context!,
      message: "用商品图检查岗位检查这张岗位商城主图",
    });

    expect(prompt).toContain("本地业务对话助手");
    expect(prompt).toContain("不要暴露内部状态机");
    expect(prompt).not.toContain("OpenClaw 主流程层对话框");
    expect(prompt).toContain("主对话不能直接调用岗位执行工具");
    expect(prompt).toContain("aics.mainFlow.*");
    expect(prompt).toContain("正式派发单和执行队列");
    expect(prompt).not.toContain("TaskPackage");
    expect(prompt).not.toContain("DispatchToRoleRequest");
    expect(prompt).not.toContain("dijie_role_task_run");
    expect(prompt).not.toContain("confirm_execution=true");
    expect(prompt).toContain("role_image_review");
    expect(prompt).toContain("/tmp/openclaw-workspace");
    expect(prompt).toContain("不要向用户复述原始编号");
    expect(prompt).toContain("不要主动复述完整路径");
    expect(prompt).toContain("不要要求用户粘贴 bearer token");
    expect(prompt).toContain("execution token");
    expect(prompt).toContain("entitlement");
  });

  it("guides company management as a goal breakdown status board without bypassing dispatch", () => {
    const prompt = buildAicsMainWorkflowModelPrompt({
      context: {
        mode: "openclaw_main",
        executionChannel: "local_openclaw",
      },
      message: "公司管理里看岗位商城首批岗位授权转化拆解后的详情页转化完成程度",
    });

    expect(prompt).toContain("经营拆解状态看板");
    expect(prompt).toContain("岗位供给");
    expect(prompt).toContain("详情页转化");
    expect(prompt).toContain("授权费用");
    expect(prompt).toContain("不要在这里重复展示公司目标页的总目标摘要");
    expect(prompt).toContain("不能生成正式派发单");
    expect(prompt).toContain("岗位工作块或派发预检");
    expect(prompt).not.toContain("TaskPackage");
    expect(prompt).not.toContain("DispatchProposal");
  });

  it("injects account operating data for status and next-step answers without granting execution", () => {
    const prompt = buildAicsMainWorkflowModelPrompt({
      context: {
        mode: "openclaw_main",
        executionChannel: "local_openclaw",
      },
      accountData: {
        statusLabel: "当前卡点：岗位未授权",
        currentGoal: "Q3 首批岗位授权转化率达到 20%",
        goalSummary: [
          "目标名称：Q3 首批岗位授权转化率达到 20%",
          "指标：授权转化率",
          "当前值：8%",
          "目标值：20%",
          "周期：Q3",
          "负责人：商城运营负责人",
          "来源观察 3 条，来源归因 2 条",
          "已确认，可进入规划方案",
        ],
        goalRecommendation: "Q3 首批岗位授权转化率达到 20%。当前应先去费用与授权完成岗位授权。",
        currentBlocker: "缺少岗位授权：需要去费用与授权确认",
        nextStep: "去费用与授权完成授权",
        nextTab: "usage",
        observationSummary: "可确认证据 3 条，待复核 1 条，缺失 0 项。",
        systemUsageSummary: [
          "云端商城/岗位能力：已有能力匹配记录",
          "API/模型连接：阻塞，DeepSeek provider 不可用",
          "调度执行：派发单已生成，执行队列已生成，不可直接运行",
        ],
        cloudMarketplaceSummary: ["岗位能力投影：3 条匹配记录", "云端授权：未确认本次执行授权"],
        localOpenClawSummary: ["Gateway/read model：可读取主流程状态", "当前阶段：role"],
        apiToolSkillSummary: [
          "API/模型：阻塞，DeepSeek provider 不可用",
          "工具/Skill：本次执行所需能力可用",
        ],
        roleUsageSummary: ["岗位授权：未确认", "费用确认：未确认", "执行队列：已生成"],
        planningSummary: [
          "当前规划：Q3 岗位商城增长规划，状态已确认",
          "渠道推广：承接岗位 渠道增长岗位，输出 渠道推广计划，验收 2 条，可进入调度检查",
        ],
        dispatchSummary: [
          "派发状态：暂不能派发",
          "可派发工作块：1 个",
          "缺少条件：岗位授权，去费用与授权处理岗位授权",
          "边界：任务调度只生成派发单和执行队列，不直接运行岗位",
        ],
        nextObservationSummary: [
          "上一轮执行结果可以用于新的数据分析：上一轮商城运营诊断已完成。",
          "产物：岗位执行业务产物 1",
          "审计完整，账本完整，模型费用证据已记录",
          "只作为观察候选，不会自动创建新目标，仍需用户确认后进入下一轮分析。",
        ],
        auditLedgerSummary: ["审计记录未完整读回", "账本记录未完整读回", "模型费用证据缺失"],
        blockedSummary: ["missing_api_binding: 模型连接缺失"],
        attributionSummary:
          "主要问题：API/模型连接缺失（高可信，引用 2 条观察证据）；影响说明：API/模型连接缺失：岗位执行无法调用真实模型；证据状态：每个归因都有观察证据引用；还缺数据：待复核 1 条，缺失 0 项",
        executionSummary: "上一轮商城运营诊断已完成。",
        evidenceSummary: ["执行结果已回写", "审计已读回", "账本已读回"],
        stageCards: [
          { label: "数据分析", statusLabel: "已完成", nextAction: "进入归因" },
          { label: "岗位执行", statusLabel: "待处理", nextAction: "确认并运行" },
        ],
      },
      message: "我现在系统哪里有问题，下一步做什么？",
    });

    expect(prompt).toContain("当前账号真实经营数据摘要");
    expect(prompt).toContain(
      "必须优先按四件事回答：当前状态、主要卡点、下一步去哪个页面、做完会得到什么结果",
    );
    expect(prompt).toContain("系统状态：当前卡点：岗位未授权");
    expect(prompt).toContain("当前经营目标：Q3 首批岗位授权转化率达到 20%");
    expect(prompt).toContain(
      "目标详情：目标名称：Q3 首批岗位授权转化率达到 20%；指标：授权转化率；当前值：8%；目标值：20%；周期：Q3；负责人：商城运营负责人；来源观察 3 条，来源归因 2 条；已确认，可进入规划方案",
    );
    expect(prompt).toContain(
      "当前最应该推进的目标：Q3 首批岗位授权转化率达到 20%。当前应先去费用与授权完成岗位授权。",
    );
    expect(prompt).toContain("当前卡点：缺少岗位授权");
    expect(prompt).toContain("建议下一步：去费用与授权完成授权（去 usage）");
    expect(prompt).toContain("观察数据：可确认证据 3 条");
    expect(prompt).toContain(
      "系统使用：云端商城/岗位能力：已有能力匹配记录；API/模型连接：阻塞，DeepSeek provider 不可用",
    );
    expect(prompt).toContain("云端商城：岗位能力投影：3 条匹配记录；云端授权：未确认本次执行授权");
    expect(prompt).toContain("本地 OpenClaw：Gateway/read model：可读取主流程状态；当前阶段：role");
    expect(prompt).toContain(
      "API/模型/工具/Skill：API/模型：阻塞，DeepSeek provider 不可用；工具/Skill：本次执行所需能力可用",
    );
    expect(prompt).toContain("岗位使用：岗位授权：未确认；费用确认：未确认；执行队列：已生成");
    expect(prompt).toContain(
      "规划方案：当前规划：Q3 岗位商城增长规划，状态已确认；渠道推广：承接岗位 渠道增长岗位，输出 渠道推广计划，验收 2 条，可进入调度检查",
    );
    expect(prompt).toContain(
      "任务调度：派发状态：暂不能派发；可派发工作块：1 个；缺少条件：岗位授权，去费用与授权处理岗位授权；边界：任务调度只生成派发单和执行队列，不直接运行岗位",
    );
    expect(prompt).toContain(
      "下一轮观察：上一轮执行结果可以用于新的数据分析：上一轮商城运营诊断已完成。；产物：岗位执行业务产物 1；审计完整，账本完整，模型费用证据已记录；只作为观察候选，不会自动创建新目标，仍需用户确认后进入下一轮分析。",
    );
    expect(prompt).toContain("审计账本：审计记录未完整读回；账本记录未完整读回；模型费用证据缺失");
    expect(prompt).toContain("当前阻塞：missing_api_binding: 模型连接缺失");
    expect(prompt).toContain(
      "归因结果：主要问题：API/模型连接缺失（高可信，引用 2 条观察证据）；影响说明：API/模型连接缺失：岗位执行无法调用真实模型；证据状态：每个归因都有观察证据引用；还缺数据：待复核 1 条，缺失 0 项",
    );
    expect(prompt).toContain("执行结果：上一轮商城运营诊断已完成。");
    expect(prompt).toContain("证据读回：执行结果已回写；审计已读回；账本已读回");
    expect(prompt).toContain("六层进度：数据分析 已完成 / 岗位执行 待处理");
    expect(prompt).toContain("不能替用户确认目标、确认规划、派发任务或执行岗位");
  });

  it("keeps personal cloud execution in user center instead of local OpenClaw", () => {
    const prompt = buildAicsMainWorkflowModelPrompt({
      context: {
        mode: "user",
        executionChannel: "cloud_user_center",
        roleQuery: "岗位商城美工岗位",
      },
      message: "帮我执行这个岗位任务",
    });

    expect(prompt).toContain("使用者中心云端执行");
    expect(prompt).toContain("不要调用本地 `dijie_role_task_run`");
    expect(prompt).toContain("回到使用者中心确认并执行");
  });

  it("rejects unknown AICS modes", () => {
    expect(normalizeChatSendAicsContext({ mode: "admin_review" })).toBeNull();
    expect(normalizeChatSendAicsContext(null)).toBeNull();
  });
});
