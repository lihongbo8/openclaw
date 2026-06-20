import { describe, expect, it, vi } from "vitest";
import type { AppViewState } from "../app-view-state.ts";
import {
  checkClosedLoopReadiness,
  createDefaultApiConnectionsPageState,
  syncApiConnectionCloudVariables,
} from "./api-connections.ts";

describe("api-connections controller", () => {
  it("reports ready-with-next-action as continuable instead of complete", async () => {
    const request = vi.fn(async () => ({
      checks: [
        { id: "localMode", label: "本地闭环模式", status: "pass", message: "本地模式。" },
        {
          id: "roleExecutionModel",
          label: "岗位执行模型",
          status: "pass",
          message: "模型已绑定。",
        },
        {
          id: "localExecutionQueue",
          label: "本地执行队列",
          status: "pass",
          message: "队列已准备。",
        },
      ],
      nextActions: [
        {
          id: "localEvidenceReadback",
          label: "本地审计账本读回",
          action: "到岗位执行页点击“运行任务”，确认真实 API 费用提示。",
        },
      ],
      status: "ready",
      mode: "local",
    }));
    const state = {
      apiConnections: createDefaultApiConnectionsPageState(),
      client: { request },
      requestUpdate: vi.fn(),
    } as unknown as AppViewState;

    await checkClosedLoopReadiness(state);

    expect(request).toHaveBeenCalledWith("aics.closedLoop.readiness.get", { mode: "local" });
    expect(state.apiConnections.error).toBeNull();
    expect(state.apiConnections.message).toContain("闭环检查可继续：3 项检查已通过。下一步：");
    expect(state.apiConnections.message).toContain("岗位执行页");
    expect(state.apiConnections.message).not.toContain("闭环检查通过");
    expect(state.apiConnections.closedLoopReadiness).toMatchObject({
      status: "ready",
      mode: "local",
    });
  });

  it("reports completed local closed-loop evidence as complete", async () => {
    const request = vi.fn(async () => ({
      checks: [
        { id: "localMode", label: "本地闭环模式", status: "pass", message: "本地模式。" },
        {
          id: "roleExecutionModel",
          label: "岗位执行模型",
          status: "pass",
          message: "模型已绑定。",
        },
        { id: "localAuthorizedRole", label: "本地已授权岗位", status: "pass", message: "已授权。" },
        { id: "localExecutionQueue", label: "本地执行队列", status: "pass", message: "已执行。" },
        {
          id: "localEvidenceReadback",
          label: "本地审计账本读回",
          status: "pass",
          message:
            "本地执行结果、业务产物、审计记录、账本记录，以及模型费用证据或未调用模型说明均可读回。",
        },
      ],
      nextActions: [],
      status: "ready",
      mode: "local",
      context: {
        executionId: "exec-marketplace-ops",
        auditRecordId: "local_audit_exec-marketplace-ops",
        ledgerRef: "ledger:role_execution:local_entitlement_marketplace_ops:exec-marketplace-ops",
        artifactRefs: [
          "artifact:role-result:exec-marketplace-ops:summary",
          "audit:local_audit_exec-marketplace-ops",
        ],
        modelUsage: { totalTokens: 100, costCents: 0 },
      },
    }));
    const state = {
      apiConnections: createDefaultApiConnectionsPageState(),
      client: { request },
      requestUpdate: vi.fn(),
    } as unknown as AppViewState;

    await checkClosedLoopReadiness(state);

    expect(state.apiConnections.error).toBeNull();
    expect(state.apiConnections.message).toBe(
      "闭环检查已完成：执行结果、审计记录、账本记录、业务产物，以及模型费用证据或未调用模型说明均已读回。",
    );
  });

  it("reports completed local closed-loop evidence as complete when model usage is not applicable", async () => {
    const request = vi.fn(async () => ({
      checks: [
        { id: "localMode", label: "本地闭环模式", status: "pass", message: "本地模式。" },
        {
          id: "roleExecutionModel",
          label: "岗位执行模型",
          status: "pass",
          message: "本次未调用模型。",
        },
        { id: "localAuthorizedRole", label: "本地已授权岗位", status: "pass", message: "已授权。" },
        { id: "localExecutionQueue", label: "本地执行队列", status: "pass", message: "已执行。" },
        {
          id: "localEvidenceReadback",
          label: "本地审计账本读回",
          status: "pass",
          message:
            "本地执行结果、业务产物、审计记录、账本记录，以及模型费用证据或未调用模型说明均可读回。",
        },
      ],
      nextActions: [],
      status: "ready",
      mode: "local",
      context: {
        executionId: "exec-marketplace-ops",
        auditRecordId: "local_audit_exec-marketplace-ops",
        ledgerRef: "ledger:role_execution:local_entitlement_marketplace_ops:exec-marketplace-ops",
        artifactRefs: [
          "artifact:role-result:exec-marketplace-ops:summary",
          "audit:local_audit_exec-marketplace-ops",
        ],
        modelUsageNotApplicableReason: "本次文件打包由本地工具完成，未调用模型。",
      },
    }));
    const state = {
      apiConnections: createDefaultApiConnectionsPageState(),
      client: { request },
      requestUpdate: vi.fn(),
    } as unknown as AppViewState;

    await checkClosedLoopReadiness(state);

    expect(state.apiConnections.error).toBeNull();
    expect(state.apiConnections.message).toBe(
      "闭环检查已完成：执行结果、审计记录、账本记录、业务产物，以及模型费用证据或未调用模型说明均已读回。",
    );
  });

  it("does not report complete when closed-loop evidence lacks model usage", async () => {
    const request = vi.fn(async () => ({
      checks: [
        { id: "localMode", label: "本地闭环模式", status: "pass", message: "本地模式。" },
        {
          id: "roleExecutionModel",
          label: "岗位执行模型",
          status: "pass",
          message: "模型已绑定。",
        },
        { id: "localExecutionQueue", label: "本地执行队列", status: "pass", message: "已执行。" },
      ],
      nextActions: [],
      status: "ready",
      mode: "local",
      context: {
        executionId: "exec-marketplace-ops",
        auditRecordId: "local_audit_exec-marketplace-ops",
        ledgerRef: "ledger:role_execution:local_entitlement_marketplace_ops:exec-marketplace-ops",
        artifactRefs: [
          "artifact:role-result:exec-marketplace-ops:summary",
          "audit:local_audit_exec-marketplace-ops",
        ],
      },
    }));
    const state = {
      apiConnections: createDefaultApiConnectionsPageState(),
      client: { request },
      requestUpdate: vi.fn(),
    } as unknown as AppViewState;

    await checkClosedLoopReadiness(state);

    expect(state.apiConnections.error).toBeNull();
    expect(state.apiConnections.message).toBe("闭环检查通过：3 项检查已通过。");
    expect(state.apiConnections.message).not.toContain("闭环检查已完成");
  });

  it("does not report complete when closed-loop evidence lacks business artifact refs", async () => {
    const request = vi.fn(async () => ({
      checks: [
        { id: "localMode", label: "本地闭环模式", status: "pass", message: "本地模式。" },
        {
          id: "roleExecutionModel",
          label: "岗位执行模型",
          status: "pass",
          message: "模型已绑定。",
        },
        { id: "localExecutionQueue", label: "本地执行队列", status: "pass", message: "已执行。" },
      ],
      nextActions: [],
      status: "ready",
      mode: "local",
      context: {
        executionId: "exec-marketplace-ops",
        auditRecordId: "local_audit_exec-marketplace-ops",
        ledgerRef: "ledger:role_execution:local_entitlement_marketplace_ops:exec-marketplace-ops",
        artifactRefs: ["audit:local_audit_exec-marketplace-ops"],
        modelUsage: { totalTokens: 100, costCents: 0 },
      },
    }));
    const state = {
      apiConnections: createDefaultApiConnectionsPageState(),
      client: { request },
      requestUpdate: vi.fn(),
    } as unknown as AppViewState;

    await checkClosedLoopReadiness(state);

    expect(state.apiConnections.error).toBeNull();
    expect(state.apiConnections.message).toBe("闭环检查通过：3 项检查已通过。");
    expect(state.apiConnections.message).not.toContain("闭环检查已完成");
  });

  it("keeps cloud variable sync failure as a local-mode warning instead of blocking API management", async () => {
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      expect(method).toBe("aics.apiConnections.entry.syncCloudVariables");
      expect(params).toEqual({ id: "model-openai" });
      return {
        ok: false,
        cloudVariableSync: {
          status: "failed",
          message: "401 Unauthorized",
        },
        readModel: {
          entries: [
            {
              id: "model-openai",
              metadata: {
                cloudVariableSync: {
                  status: "failed",
                  message: "401 Unauthorized",
                },
              },
            },
          ],
        },
      };
    });
    const state = {
      apiConnections: createDefaultApiConnectionsPageState(),
      client: { request },
      requestUpdate: vi.fn(),
    } as unknown as AppViewState;

    await syncApiConnectionCloudVariables(state, "model-openai");

    expect(state.apiConnections.error).toBeNull();
    expect(state.apiConnections.message).toContain("云端变量同步未完成：401 Unauthorized");
    expect(state.apiConnections.message).toContain("本地版岗位创建和岗位执行不受影响");
    expect(state.apiConnections.readModel).toMatchObject({
      entries: [
        {
          id: "model-openai",
          metadata: {
            cloudVariableSync: {
              status: "failed",
              message: "401 Unauthorized",
            },
          },
        },
      ],
    });
  });
});
