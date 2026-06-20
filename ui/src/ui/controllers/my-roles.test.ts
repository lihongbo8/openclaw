import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppViewState } from "../app-view-state.ts";
import {
  createDefaultMyRolesState,
  refreshMyRolesReadModel,
  repairRoleInstanceStore,
  runExecution,
} from "./my-roles.ts";

describe("my roles controller", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("merges execution queue and authorized role assets when refreshing", async () => {
    const pageState = createDefaultMyRolesState();
    const request = vi.fn(async (method: string) => {
      if (method === "aics.executionConsole.readModel.get") {
        return { summary: { total: 0 }, executions: [], blockedReasons: [] };
      }
      if (method === "aics.roles.mine.readModel.get") {
        return {
          summary: { totalRoles: 1, availableRoles: 1 },
          roles: [
            {
              roleListingId: "local_rolelisting_marketplace_ops",
              title: "商城运营诊断官",
              entitlementId: "local_entitlement_marketplace_ops",
              entitlementStatus: "authorized",
            },
          ],
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state = {
      client: { request },
    } as unknown as AppViewState;

    await refreshMyRolesReadModel(state, pageState);

    expect(request).toHaveBeenCalledWith("aics.executionConsole.readModel.get", {});
    expect(request).toHaveBeenCalledWith("aics.roles.mine.readModel.get", {});
    expect(pageState.readModel).toEqual(
      expect.objectContaining({
        executions: [],
        roleAssets: [
          expect.objectContaining({
            roleListingId: "local_rolelisting_marketplace_ops",
            entitlementId: "local_entitlement_marketplace_ops",
            entitlementStatus: "authorized",
          }),
        ],
        roleAssetsSummary: { totalRoles: 1, availableRoles: 1 },
      }),
    );
  });

  it("also accepts wrapped my-role read models returned by older gateway mocks", async () => {
    const pageState = createDefaultMyRolesState();
    const request = vi.fn(async (method: string) => {
      if (method === "aics.executionConsole.readModel.get") {
        return { summary: { total: 0 }, executions: [], blockedReasons: [] };
      }
      if (method === "aics.roles.mine.readModel.get") {
        return {
          readModel: {
            summary: { totalRoles: 1, availableRoles: 1 },
            roleAssets: [
              {
                roleListingId: "local_rolelisting_marketplace_ops",
                title: "商城运营诊断官",
                entitlementId: "local_entitlement_marketplace_ops",
                entitlementStatus: "authorized",
              },
            ],
          },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state = {
      client: { request },
    } as unknown as AppViewState;

    await refreshMyRolesReadModel(state, pageState);

    expect(pageState.readModel).toEqual(
      expect.objectContaining({
        roleAssets: [
          expect.objectContaining({
            roleListingId: "local_rolelisting_marketplace_ops",
            entitlementId: "local_entitlement_marketplace_ops",
            entitlementStatus: "authorized",
          }),
        ],
        roleAssetsSummary: { totalRoles: 1, availableRoles: 1 },
      }),
    );
  });

  it("hydrates same-named artifacts separately for multiple executions", async () => {
    const pageState = createDefaultMyRolesState();
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === "aics.executionConsole.readModel.get") {
        return {
          summary: { total: 2, completed: 2 },
          executions: [
            {
              id: "dispatch-1",
              result: { id: "exec-1" },
              artifactRefs: [
                "/workspace/exec-1/hero.png",
                "/workspace/exec-1/detail.html",
                "external_record:ticket:T-100",
                "artifact:role-result:exec-1:summary",
                "memory_candidate:candidate-1",
              ],
            },
            {
              id: "dispatch-2",
              result: { id: "exec-2" },
              artifactRefs: ["/workspace/exec-2/hero.png", "/workspace/exec-2/artifacts.zip"],
            },
          ],
        };
      }
      if (method === "aics.roles.mine.readModel.get") {
        return { roles: [], summary: { totalRoles: 0 } };
      }
      if (method === "aics.execution.artifact.get") {
        const executionId = String(params.executionId);
        const artifactRef = String(params.artifactRef);
        const name = artifactRef.split("/").pop() || "artifact";
        return {
          ok: true,
          artifact: {
            executionId,
            ref: artifactRef,
            name,
            kind: name.endsWith(".png") ? "image" : name.endsWith(".zip") ? "archive" : "document",
            mimeType: name.endsWith(".png")
              ? "image/png"
              : name.endsWith(".zip")
                ? "application/zip"
                : "text/html; charset=utf-8",
            sizeBytes: executionId === "exec-1" ? 11 : 22,
            dataUrl: `data:application/octet-stream;base64,${executionId}`,
          },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state = {
      client: { request },
    } as unknown as AppViewState;

    await refreshMyRolesReadModel(state, pageState);

    expect(request).toHaveBeenCalledWith("aics.execution.artifact.get", {
      executionId: "exec-1",
      artifactRef: "/workspace/exec-1/hero.png",
    });
    expect(request).not.toHaveBeenCalledWith("aics.execution.artifact.get", {
      executionId: "exec-1",
      artifactRef: "memory_candidate:candidate-1",
    });
    expect(request).not.toHaveBeenCalledWith("aics.execution.artifact.get", {
      executionId: "exec-1",
      artifactRef: "external_record:ticket:T-100",
    });
    expect(request).not.toHaveBeenCalledWith("aics.execution.artifact.get", {
      executionId: "exec-1",
      artifactRef: "artifact:role-result:exec-1:summary",
    });
    expect(request).toHaveBeenCalledWith("aics.execution.artifact.get", {
      executionId: "exec-2",
      artifactRef: "/workspace/exec-2/hero.png",
    });
    expect(Object.keys(pageState.artifactPreviews)).toEqual(
      expect.arrayContaining([
        "exec-1::/workspace/exec-1/hero.png",
        "exec-1::/workspace/exec-1/detail.html",
        "exec-2::/workspace/exec-2/hero.png",
        "exec-2::/workspace/exec-2/artifacts.zip",
      ]),
    );
    expect(pageState.artifactPreviews["exec-1::/workspace/exec-1/hero.png"]).toMatchObject({
      executionId: "exec-1",
      name: "hero.png",
      sizeBytes: 11,
    });
    expect(pageState.artifactPreviews["exec-2::/workspace/exec-2/hero.png"]).toMatchObject({
      executionId: "exec-2",
      name: "hero.png",
      sizeBytes: 22,
    });
  });

  it("repairs the role instance store and keeps authorized role assets in the read model", async () => {
    const pageState = createDefaultMyRolesState();
    pageState.readModel = {
      summary: { totalRoles: 1, instanceStoreError: "unable to open database file" },
      roleAssets: [],
    };
    const request = vi.fn(async (method: string) => {
      if (method === "aics.roles.instanceStore.repair") {
        return {
          ok: true,
          message: "已备份不可读的运行历史库，并新建干净的运行历史库。",
          readModel: {
            summary: { totalRoles: 1, availableRoles: 0 },
            roles: [
              {
                roleListingId: "local_rolelisting_marketplace_ops",
                title: "商城运营诊断官",
                entitlementId: "local_entitlement_marketplace_ops",
                entitlementStatus: "authorized",
              },
            ],
          },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state = {
      client: { request },
    } as unknown as AppViewState;

    await repairRoleInstanceStore(state, pageState);

    expect(request).toHaveBeenCalledWith("aics.roles.instanceStore.repair", {});
    expect(pageState.error).toBeNull();
    expect(pageState.readModel).toEqual(
      expect.objectContaining({
        summary: { totalRoles: 1, availableRoles: 0 },
        roleAssets: [
          expect.objectContaining({
            roleListingId: "local_rolelisting_marketplace_ops",
            entitlementId: "local_entitlement_marketplace_ops",
          }),
        ],
      }),
    );
  });

  it("runs the selected dispatch queue item instead of falling back to the latest task", async () => {
    const pageState = createDefaultMyRolesState();
    const request = vi.fn(async (method: string) => {
      if (method === "aics.mainFlow.execution.confirmAndRun") {
        return { ok: true };
      }
      if (method === "aics.mainFlow.readModel.get") {
        return { latest: {}, executionClosure: { status: "completed" } };
      }
      if (method === "aics.executionConsole.readModel.get") {
        return { summary: { completed: 1 }, executions: [] };
      }
      if (method === "aics.roles.mine.readModel.get") {
        return { roles: [], summary: { totalRoles: 0 } };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const refreshAicsMainFlowReadModel = vi.fn(async () => {});
    const refreshAicsMarketplaceRoles = vi.fn(async () => {});
    const refreshApiConnectionsReadModel = vi.fn(async () => {});
    const checkClosedLoopReadiness = vi.fn(async () => {});
    const state = {
      client: { request },
      aicsMarketplace: {
        roles: [],
      },
      myRoles: {
        readModel: {
          roles: [
            {
              roleListingId: "local_rolelisting_marketplace_ops",
              entitlementId: "local_entitlement_marketplace_ops",
              entitlementStatus: "authorized",
            },
          ],
        },
      },
      refreshAicsMainFlowReadModel,
      refreshAicsMarketplaceRoles,
      refreshApiConnectionsReadModel,
      checkClosedLoopReadiness,
    } as unknown as AppViewState;

    await runExecution(state, pageState, {
      id: "dispatch_role_req_selected",
      dispatchRequestId: "dispatch_role_req_selected",
      taskPackageId: "task_pkg_selected",
      roleListingId: "local_rolelisting_marketplace_ops",
      roleTitle: "商城运营诊断官",
      taskText: "分析岗位授权、执行成功率和审计账本。",
      confirmExecution: true,
      costConfirmed: true,
      ledgerRef: "ledger:pending:local_entitlement_marketplace_ops",
    });

    expect(request).toHaveBeenCalledWith(
      "aics.mainFlow.execution.confirmAndRun",
      expect.objectContaining({
        dispatchToRoleRequestId: "dispatch_role_req_selected",
        roleListingId: "local_rolelisting_marketplace_ops",
        entitlementId: "local_entitlement_marketplace_ops",
        ledgerRef: "ledger:pending:local_entitlement_marketplace_ops",
      }),
    );
    expect(pageState.error).toBeNull();
    expect(pageState.message).toBe(
      "岗位任务已完成，执行结果、审计记录、账本记录和业务产物均已读回。",
    );
    expect(refreshAicsMainFlowReadModel).toHaveBeenCalled();
    expect(refreshAicsMarketplaceRoles).toHaveBeenCalled();
    expect(refreshApiConnectionsReadModel).toHaveBeenCalled();
    expect(checkClosedLoopReadiness).toHaveBeenCalled();
  });

  it("does not report success when a completed execution has no business artifact", async () => {
    const pageState = createDefaultMyRolesState();
    const request = vi.fn(async (method: string) => {
      if (method === "aics.mainFlow.execution.confirmAndRun") {
        throw new Error("岗位执行已返回，但业务产物缺失。请检查执行器产物回写。");
      }
      throw new Error(`unexpected method ${method}`);
    });
    const checkClosedLoopReadiness = vi.fn(async () => {});
    const state = {
      client: { request },
      aicsMarketplace: {
        roles: [
          {
            roleListingId: "local_rolelisting_marketplace_ops",
            entitlementId: "local_entitlement_marketplace_ops",
          },
        ],
      },
      checkClosedLoopReadiness,
      refreshAicsMainFlowReadModel: vi.fn(async () => {}),
    } as unknown as AppViewState;

    await runExecution(state, pageState, {
      id: "dispatch_role_req_no_artifact",
      dispatchRequestId: "dispatch_role_req_no_artifact",
      taskPackageId: "task_pkg_no_artifact",
      roleListingId: "local_rolelisting_marketplace_ops",
      roleTitle: "商城运营诊断官",
      taskText: "分析岗位授权、执行成功率和审计账本。",
      confirmExecution: true,
      costConfirmed: true,
      ledgerRef: "ledger:pending:local_entitlement_marketplace_ops",
    });

    expect(request).toHaveBeenCalledWith(
      "aics.mainFlow.execution.confirmAndRun",
      expect.anything(),
    );
    expect(request).not.toHaveBeenCalledWith("aics.execution.result.record", expect.anything());
    expect(request).not.toHaveBeenCalledWith(
      "aics.executionEvidence.readback.get",
      expect.anything(),
    );
    expect(checkClosedLoopReadiness).not.toHaveBeenCalled();
    expect(pageState.message).toBeNull();
    expect(pageState.error).toBe("岗位执行已返回，但业务产物缺失。请检查执行器产物回写。");
  });

  it("asks for final confirmation before a real role execution and cancels without running", async () => {
    const pageState = createDefaultMyRolesState();
    const request = vi.fn(async () => {
      throw new Error("execution should not run when the user cancels");
    });
    const confirm = vi.fn((_message: string) => false);
    vi.stubGlobal("window", { confirm });
    const state = {
      client: { request },
      aicsMarketplace: {
        roles: [
          {
            roleListingId: "local_rolelisting_marketplace_ops",
            entitlementId: "local_entitlement_marketplace_ops",
          },
        ],
      },
      myRoles: {
        readModel: {
          summary: {
            selectedModelRef: {
              provider: "deepseek",
              model: "deepseek-v4-flash",
            },
          },
        },
      },
      refreshAicsMainFlowReadModel: vi.fn(async () => {}),
    } as unknown as AppViewState;

    await runExecution(state, pageState, {
      id: "dispatch_role_req_cancelled",
      dispatchRequestId: "dispatch_role_req_cancelled",
      taskPackageId: "task_pkg_cancelled",
      roleListingId: "local_rolelisting_marketplace_ops",
      roleTitle: "商城运营诊断官",
      taskText: "分析岗位授权、执行成功率和审计账本。",
      confirmExecution: true,
      costConfirmed: true,
      ledgerRef: "ledger:pending:local_entitlement_marketplace_ops",
    });

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining(
        "将调用 API 管理里已绑定的真实模型、工具或 Skill 执行岗位任务，可能产生 API 费用。",
      ),
    );
    const confirmMessage = confirm.mock.calls[0]?.[0] ?? "";
    expect(confirmMessage).toContain("系统会按派发单要求生成业务结果、执行摘要和可读产物。");
    expect(confirmMessage).toContain("岗位：商城运营诊断官");
    expect(confirmMessage).toContain("执行连接：deepseek / deepseek-v4-flash");
    expect(confirmMessage).toContain("费用凭证：已生成");
    expect(confirmMessage).not.toContain("ledger:pending:local_entitlement_marketplace_ops");
    expect(confirmMessage).toContain(
      "执行成功后会自动检查业务产物、执行摘要、审计记录和账本记录。",
    );
    expect(confirmMessage).toContain("缺任一项都不会报成功，会显示阻塞原因。");
    expect(request).not.toHaveBeenCalled();
    expect(pageState.runningExecutionId).toBeNull();
    expect(pageState.error).toBeNull();
  });

  it("shows a blocked execution-token or preflight reason instead of recording an empty result", async () => {
    const pageState = createDefaultMyRolesState();
    const request = vi.fn(async (method: string) => {
      if (method === "aics.mainFlow.execution.confirmAndRun") {
        throw new Error("API 管理未给岗位执行绑定可用模型 Provider。");
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state = {
      client: { request },
      aicsMarketplace: {
        roles: [
          {
            roleListingId: "local_rolelisting_marketplace_ops",
            entitlementId: "local_entitlement_marketplace_ops",
          },
        ],
      },
      refreshAicsMainFlowReadModel: vi.fn(async () => {}),
    } as unknown as AppViewState;

    await runExecution(state, pageState, {
      id: "dispatch_role_req_blocked",
      dispatchRequestId: "dispatch_role_req_blocked",
      taskPackageId: "task_pkg_blocked",
      roleListingId: "local_rolelisting_marketplace_ops",
      roleTitle: "商城运营诊断官",
      taskText: "分析岗位授权、执行成功率和审计账本。",
      confirmExecution: true,
      costConfirmed: true,
      ledgerRef: "ledger:pending:local_entitlement_marketplace_ops",
    });

    expect(request).toHaveBeenCalledWith(
      "aics.mainFlow.execution.confirmAndRun",
      expect.anything(),
    );
    expect(request).not.toHaveBeenCalledWith("aics.execution.result.record", expect.anything());
    expect(pageState.error).toBe("API 管理未给岗位执行绑定可用模型 Provider。");
  });

  it("blocks instead of falling back to another authorized role when execution targets a specific listing", async () => {
    const pageState = createDefaultMyRolesState();
    const request = vi.fn(async () => {
      throw new Error("execution should not run with the wrong role");
    });
    const state = {
      client: { request },
      aicsMarketplace: {
        roles: [
          {
            roleListingId: "local_rolelisting_other",
            entitlementId: "local_entitlement_other",
          },
        ],
      },
      aicsRoleBuilder: {
        form: {
          roleListingId: "local_rolelisting_other",
          entitlementId: "local_entitlement_other",
        },
      },
      myRoles: {
        readModel: {
          roleAssets: [
            {
              roleListingId: "local_rolelisting_other_asset",
              entitlementId: "local_entitlement_other_asset",
              entitlementStatus: "authorized",
            },
          ],
        },
      },
      refreshAicsMainFlowReadModel: vi.fn(async () => {}),
    } as unknown as AppViewState;

    await runExecution(state, pageState, {
      id: "dispatch_role_req_requested",
      dispatchRequestId: "dispatch_role_req_requested",
      taskPackageId: "task_pkg_requested",
      roleListingId: "local_rolelisting_requested",
      roleTitle: "商城运营诊断官",
      taskText: "分析岗位授权、执行成功率和审计账本。",
      confirmExecution: true,
      costConfirmed: true,
      ledgerRef: "ledger:pending:local_entitlement_requested",
    });

    expect(request).not.toHaveBeenCalled();
    expect(pageState.error).toBe("岗位执行需要先到「费用与授权」完成岗位授权和费用确认。");
  });

  it("blocks locally before role execution when cost confirmation or ledger evidence is missing", async () => {
    const pageState = createDefaultMyRolesState();
    const request = vi.fn(async () => {
      throw new Error("execution should not request a token or run before cost confirmation");
    });
    const state = {
      client: { request },
      aicsMarketplace: {
        roles: [
          {
            roleListingId: "local_rolelisting_marketplace_ops",
            entitlementId: "local_entitlement_marketplace_ops",
          },
        ],
      },
      refreshAicsMainFlowReadModel: vi.fn(async () => {}),
    } as unknown as AppViewState;

    await runExecution(state, pageState, {
      id: "dispatch_role_req_unconfirmed_cost",
      dispatchRequestId: "dispatch_role_req_unconfirmed_cost",
      taskPackageId: "task_pkg_unconfirmed_cost",
      roleListingId: "local_rolelisting_marketplace_ops",
      roleTitle: "商城运营诊断官",
      taskText: "分析岗位授权、执行成功率和审计账本。",
      confirmExecution: true,
      costConfirmed: false,
    });

    expect(request).not.toHaveBeenCalled();
    expect(pageState.error).toBe("岗位执行需要先完成本次费用确认并生成费用凭证。");
  });

  it("shows result-recording blockers when audit and ledger writeback fail", async () => {
    const pageState = createDefaultMyRolesState();
    const request = vi.fn(async (method: string) => {
      if (method === "aics.mainFlow.execution.confirmAndRun") {
        throw new Error("费用确认缺失，不能写入账本。");
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state = {
      client: { request },
      aicsMarketplace: {
        roles: [
          {
            roleListingId: "local_rolelisting_marketplace_ops",
            entitlementId: "local_entitlement_marketplace_ops",
          },
        ],
      },
      refreshAicsMainFlowReadModel: vi.fn(async () => {}),
    } as unknown as AppViewState;

    await runExecution(state, pageState, {
      id: "dispatch_role_req_record_blocked",
      dispatchRequestId: "dispatch_role_req_record_blocked",
      taskPackageId: "task_pkg_record_blocked",
      roleListingId: "local_rolelisting_marketplace_ops",
      roleTitle: "商城运营诊断官",
      taskText: "分析岗位授权、执行成功率和审计账本。",
      confirmExecution: true,
      costConfirmed: true,
      ledgerRef: "ledger:pending:local_entitlement_marketplace_ops",
    });

    expect(request).toHaveBeenCalledWith(
      "aics.mainFlow.execution.confirmAndRun",
      expect.anything(),
    );
    expect(pageState.error).toBe("费用确认缺失，不能写入账本。");
  });

  it("blocks a successful role run when audit or ledger readback is incomplete", async () => {
    const pageState = createDefaultMyRolesState();
    const request = vi.fn(async (method: string) => {
      if (method === "aics.mainFlow.execution.confirmAndRun") {
        throw new Error("本地执行证据不完整：账本记录缺失。");
      }
      throw new Error(`unexpected method ${method}`);
    });
    const checkClosedLoopReadiness = vi.fn(async () => {});
    const state = {
      client: { request },
      aicsMarketplace: {
        roles: [
          {
            roleListingId: "local_rolelisting_marketplace_ops",
            entitlementId: "local_entitlement_marketplace_ops",
          },
        ],
      },
      refreshAicsMainFlowReadModel: vi.fn(async () => {}),
      checkClosedLoopReadiness,
    } as unknown as AppViewState;

    await runExecution(state, pageState, {
      id: "dispatch_role_req_missing_readback",
      dispatchRequestId: "dispatch_role_req_missing_readback",
      taskPackageId: "task_pkg_missing_readback",
      roleListingId: "local_rolelisting_marketplace_ops",
      roleTitle: "商城运营诊断官",
      taskText: "分析岗位授权、执行成功率和审计账本。",
      confirmExecution: true,
      costConfirmed: true,
      ledgerRef: "ledger:pending:local_entitlement_marketplace_ops",
    });

    expect(request).toHaveBeenCalledWith(
      "aics.mainFlow.execution.confirmAndRun",
      expect.objectContaining({
        dispatchToRoleRequestId: "dispatch_role_req_missing_readback",
      }),
    );
    expect(pageState.error).toBe("本地执行证据不完整：账本记录缺失。");
    expect(checkClosedLoopReadiness).not.toHaveBeenCalled();
  });

  it("records failed execution evidence while keeping provider API errors visible", async () => {
    const pageState = createDefaultMyRolesState();
    const request = vi.fn(async (method: string) => {
      if (method === "aics.mainFlow.execution.confirmAndRun") {
        throw new Error("deepseek API 401: Unauthorized");
      }
      if (method === "aics.executionConsole.readModel.get") {
        return { summary: { failed: 1 }, executions: [] };
      }
      if (method === "aics.roles.mine.readModel.get") {
        return { roles: [], summary: { totalRoles: 0 } };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state = {
      client: { request },
      aicsMarketplace: {
        roles: [
          {
            roleListingId: "local_rolelisting_marketplace_ops",
            entitlementId: "local_entitlement_marketplace_ops",
          },
        ],
      },
      refreshAicsMainFlowReadModel: vi.fn(async () => {}),
    } as unknown as AppViewState;

    await runExecution(state, pageState, {
      id: "dispatch_role_req_api_401",
      dispatchRequestId: "dispatch_role_req_api_401",
      taskPackageId: "task_pkg_api_401",
      roleListingId: "local_rolelisting_marketplace_ops",
      roleTitle: "商城运营诊断官",
      taskText: "分析岗位授权、执行成功率和审计账本。",
      confirmExecution: true,
      costConfirmed: true,
      ledgerRef: "ledger:pending:local_entitlement_marketplace_ops",
    });

    expect(request).toHaveBeenCalledWith(
      "aics.mainFlow.execution.confirmAndRun",
      expect.objectContaining({
        dispatchToRoleRequestId: "dispatch_role_req_api_401",
      }),
    );
    expect(pageState.error).toBe("deepseek API 401: Unauthorized");
  });
});
