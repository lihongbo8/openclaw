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
        message: "我要开发一个智能门锁电商美工岗位",
      }),
    ).toContain("岗位开发专属助手");
  });

  it("builds OpenClaw main workflow prompts that route execution through the local role task tool", () => {
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
      message: "用商品图检查岗位检查这张智能门锁主图",
    });

    expect(prompt).toContain("OpenClaw 主流程层对话框");
    expect(prompt).toContain("dijie_role_task_run");
    expect(prompt).toContain("confirm_execution=true");
    expect(prompt).toContain("role_image_review");
    expect(prompt).toContain("/tmp/openclaw-workspace");
    expect(prompt).toContain("不要要求用户粘贴 bearer token");
    expect(prompt).toContain("execution token");
    expect(prompt).toContain("entitlement");
  });

  it("keeps personal cloud execution in user center instead of local OpenClaw", () => {
    const prompt = buildAicsMainWorkflowModelPrompt({
      context: {
        mode: "user",
        executionChannel: "cloud_user_center",
        roleQuery: "智能门锁美工岗位",
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
