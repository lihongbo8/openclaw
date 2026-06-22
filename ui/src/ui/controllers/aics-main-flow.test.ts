import { describe, expect, it, vi } from "vitest";
import type { AppViewState } from "../app-view-state.ts";
import { aicsMainFlow, selectAuthorizedRoleForDispatch } from "./aics-main-flow.ts";

describe("aics main flow controller", () => {
  it("selects an authorized role from synced my-role assets", () => {
    const state = {
      aicsMainFlow: {
        readModel: {
          latest: {
            dispatchToRoleRequest: {
              roleListingId: "local_rolelisting_marketplace_ops",
            },
          },
        },
      },
      aicsMarketplace: { roles: [] },
      aicsRoleBuilder: { form: {} },
      myRoles: {
        readModel: {
          roleAssets: [
            {
              roleListingId: "local_rolelisting_marketplace_ops",
              title: "商城运营诊断官",
              entitlementId: "local_entitlement_marketplace_ops",
              entitlementStatus: "authorized",
            },
          ],
        },
      },
    } as unknown as AppViewState;

    expect(selectAuthorizedRoleForDispatch(state)).toEqual({
      roleListingId: "local_rolelisting_marketplace_ops",
      roleTitle: "商城运营诊断官",
      entitlementId: "local_entitlement_marketplace_ops",
    });
  });

  it("selects an authorized role from the new synced my-role roles model", () => {
    const state = {
      aicsMainFlow: {
        readModel: {
          latest: {
            dispatchToRoleRequest: {
              roleListingId: "local_rolelisting_marketplace_ops",
            },
          },
        },
      },
      aicsMarketplace: { roles: [] },
      aicsRoleBuilder: { form: {} },
      myRoles: {
        readModel: {
          roles: [
            {
              roleListingId: "local_rolelisting_marketplace_ops",
              title: "商城运营诊断官",
              entitlementId: "local_entitlement_marketplace_ops",
              entitlementStatus: "authorized",
            },
          ],
        },
      },
    } as unknown as AppViewState;

    expect(selectAuthorizedRoleForDispatch(state)).toEqual({
      roleListingId: "local_rolelisting_marketplace_ops",
      roleTitle: "商城运营诊断官",
      entitlementId: "local_entitlement_marketplace_ops",
    });
  });

  it("does not fall back to another authorized role when dispatch requests a specific listing", () => {
    const state = {
      aicsMainFlow: {
        readModel: {
          latest: {
            dispatchToRoleRequest: {
              roleListingId: "local_rolelisting_requested",
            },
          },
        },
      },
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
    } as unknown as AppViewState;

    expect(selectAuthorizedRoleForDispatch(state)).toBeNull();
  });

  it("passes the synced entitlement when materializing a task package", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "aics.mainFlow.dispatch.materializeTaskPackage") {
        return { ok: true };
      }
      if (method === "aics.mainFlow.readModel.get") {
        return { latest: {}, objects: {}, readiness: {} };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state = {
      client: { request },
      aicsMainFlow: {
        readModel: {
          latest: {},
        },
      },
      aicsMarketplace: { roles: [] },
      aicsRoleBuilder: { form: {} },
      myRoles: {
        readModel: {
          roleAssets: [
            {
              roleListingId: "local_rolelisting_marketplace_ops",
              title: "商城运营诊断官",
              entitlementId: "local_entitlement_marketplace_ops",
              entitlementStatus: "authorized",
            },
          ],
        },
      },
      requestUpdate: vi.fn(),
      requestHostUpdate: vi.fn(),
    } as unknown as AppViewState;

    await aicsMainFlow.materializeTaskPackage(state, "商城运营岗位任务", "生成岗位运营诊断。");

    expect(request).toHaveBeenCalledWith(
      "aics.mainFlow.dispatch.materializeTaskPackage",
      expect.objectContaining({
        request: {
          roleListingId: "local_rolelisting_marketplace_ops",
          roleTitle: "商城运营诊断官",
          entitlementId: "local_entitlement_marketplace_ops",
        },
      }),
    );
  });

  it("runs observation tool plans through the production observation runner", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "aics.observation.toolPlan.run") {
        return {
          runResult: {
            planId: "plan-1",
            status: "completed",
            evidence: [{ statement: "本地主流程状态已读取。" }],
            qualityResults: [{ status: "accepted" }],
            blockedReasons: [],
            userMessage: "观察采集已完成。",
          },
          observationPackage: {
            id: "obs_pkg_1",
            status: "prepared",
            title: "观察包候选",
          },
          readModel: { latest: {}, objects: {}, readiness: {} },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state = {
      client: { request },
      aicsMainFlow: { loading: false, error: null, readModel: null },
      requestUpdate: vi.fn(),
      requestHostUpdate: vi.fn(),
    } as unknown as AppViewState;

    await aicsMainFlow.runObservationToolPlan(state, "plan-1", {
      externalSources: [
        {
          id: "manual_external_source_1",
          label: "手动外部观察来源",
          url: "https://example.com/changelog",
          kind: "technology_tool_model",
        },
      ],
    });

    expect(request).toHaveBeenCalledWith("aics.observation.toolPlan.run", {
      externalSources: [
        {
          id: "manual_external_source_1",
          label: "手动外部观察来源",
          url: "https://example.com/changelog",
          kind: "technology_tool_model",
        },
      ],
      toolPlanId: "plan-1",
    });
    expect(state.aicsMainFlow.lastObservationRun).toMatchObject({
      status: "completed",
      evidence: [{ statement: "本地主流程状态已读取。" }],
    });
    expect(state.aicsMainFlow.lastObservationPackage).toMatchObject({
      id: "obs_pkg_1",
      status: "prepared",
    });
    expect(state.aicsMainFlow.loading).toBe(false);
  });
});
