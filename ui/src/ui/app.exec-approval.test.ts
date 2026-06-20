/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorageMock } from "../test-helpers/storage.ts";
import type { ExecApprovalRequest } from "./controllers/exec-approval.ts";

type RequestFn = (method: string, params?: unknown) => Promise<unknown>;

function createExecApproval(overrides: Partial<ExecApprovalRequest> = {}): ExecApprovalRequest {
  return {
    id: "approval-1",
    kind: "exec",
    request: { command: "echo hello" },
    createdAtMs: 1000,
    expiresAtMs: Date.now() + 60_000,
    ...overrides,
  };
}

function createGatewayError(message: string, details?: unknown): Error {
  const err = new Error(message);
  Object.defineProperty(err, "gatewayCode", {
    value: "INVALID_REQUEST",
    enumerable: true,
  });
  Object.defineProperty(err, "details", {
    value: details,
    enumerable: true,
  });
  return err;
}

function createApiConnectionsState() {
  const cloudEntry = {
    id: "marketplace-dijie-cloud-bridge",
    name: "迭界AI云端",
    kind: "marketplace",
    provider: "dijie-cloud-bridge",
    consumers: ["marketplace", "role_execution"],
  };
  return {
    loading: false,
    saving: false,
    error: null,
    message: null,
    readModel: { entries: [cloudEntry] },
    form: {
      templateId: "dijie-cloud-bridge",
      connectionMode: "env",
      editingId: null,
      advancedOpen: false,
      name: "迭界AI云端",
      kind: "marketplace",
      provider: "dijie-cloud-bridge",
      baseUrl: "http://127.0.0.1:9000",
      secretValue: "",
      secretEnvId: "DIJIE_CLOUD_ACCESS_TOKEN",
      existingSecretRef: null,
      consumers: ["marketplace", "role_execution"],
      modelId: "",
      inputTokenPriceCnyPerMillion: "",
      outputTokenPriceCnyPerMillion: "",
      dailyBudgetCny: "",
      bindingPath: "plugins.entries.aics.config.cloudAccessToken",
      smokeJson: "",
    },
  };
}

async function createApp(
  request: RequestFn,
  queue: ExecApprovalRequest[] = [createExecApproval()],
) {
  const { OpenClawApp } = await import("./app.ts");
  const app = Object.create(OpenClawApp.prototype) as InstanceType<typeof OpenClawApp>;
  Object.defineProperties(app, {
    client: { value: { request }, writable: true },
    execApprovalBusy: { value: false, writable: true },
    execApprovalError: { value: null, writable: true },
    execApprovalQueue: { value: queue, writable: true },
  });
  return app;
}

async function createMarketplaceApp(request: RequestFn) {
  const { OpenClawApp } = await import("./app.ts");
  const app = Object.create(OpenClawApp.prototype) as InstanceType<typeof OpenClawApp>;
  Object.defineProperties(app, {
    client: { value: { request }, writable: true },
    connected: { value: true, writable: true },
    aicsMarketplace: {
      value: {
        roles: [{ id: "role-listing-1", roleListingId: "role-listing-1" }],
        loading: false,
        result: null,
        error: null,
      },
      writable: true,
    },
    apiConnections: {
      value: createApiConnectionsState(),
      writable: true,
    },
    aicsRoleBuilder: {
      value: {
        form: {
          roleListingId: "",
          entitlementId: "",
          cloudAccessToken: "",
          workspaceRef: "",
          deviceId: "",
        },
        result: null,
        error: null,
      },
      writable: true,
    },
    buildSession: {
      value: {
        loading: false,
        error: null,
        step: "completed",
        sessionId: "session-1",
        session: null,
        sessions: [],
        requirements: "",
        briefForm: {},
        availableTemplates: [],
        capabilityAnalysis: null,
        generateResult: {
          review: { id: "role-review-1", reviewStatus: "已通过" },
        },
      },
      writable: true,
    },
    refreshAicsMarketplaceRoles: { value: vi.fn(async () => {}), writable: true },
    refreshMyRolesReadModel: { value: vi.fn(async () => {}), writable: true },
    refreshAicsMainFlowReadModel: { value: vi.fn(async () => {}), writable: true },
    refreshToolSupplyControlReadModel: { value: vi.fn(async () => {}), writable: true },
    refreshReviewCenter: { value: vi.fn(async () => {}), writable: true },
    refreshBuildSessionBindableCategories: { value: vi.fn(async () => {}), writable: true },
    setTab: { value: vi.fn(), writable: true },
    requestHostUpdate: { value: vi.fn(), writable: true },
    requestUpdate: { value: vi.fn(), writable: true },
  });
  return app;
}

function installReviewCenterState(app: Record<string, unknown>) {
  Object.defineProperty(app, "reviewCenter", {
    value: {
      loading: false,
      actionBusyKey: null,
      error: null,
      roleReviews: [],
      categoryCapabilityReviews: [],
      selectedRoleReviewId: null,
      selectedCategoryCapabilityReviewId: null,
      eventsByReviewId: {},
    },
    writable: true,
  });
}

function reviewRefreshResponse(method: string) {
  if (
    method === "aics.rolePreListingReview.list" ||
    method === "aics.categoryCapabilityReview.list" ||
    method === "aics.toolSkillReview.list"
  ) {
    return { reviews: [] };
  }
  return null;
}

describe("OpenClawApp exec approval decisions", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorageMock());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("dismisses the active approval after same-decision idempotent success", async () => {
    const request = vi.fn<RequestFn>(async () => ({ ok: true }));
    const app = await createApp(request);

    await app.handleExecApprovalDecision("allow-once");

    expect(request).toHaveBeenCalledWith("exec.approval.resolve", {
      id: "approval-1",
      decision: "allow-once",
    });
    expect(app.execApprovalQueue).toEqual([]);
    expect(app.execApprovalError).toBeNull();
    expect(app.execApprovalBusy).toBe(false);
  });

  it("dismisses and refreshes when the backend reports an already resolved approval", async () => {
    const request = vi.fn<RequestFn>(async (method) => {
      if (method === "exec.approval.resolve") {
        throw createGatewayError("approval already resolved", {
          reason: "APPROVAL_ALREADY_RESOLVED",
        });
      }
      if (method === "exec.approval.list") {
        return [];
      }
      if (method === "plugin.approval.list") {
        return [];
      }
      return {};
    });
    const app = await createApp(request);

    await app.handleExecApprovalDecision("deny");

    expect(app.execApprovalQueue).toEqual([]);
    expect(app.execApprovalError).toBeNull();
    expect(app.execApprovalBusy).toBe(false);
    expect(request).toHaveBeenCalledWith("exec.approval.list", {});
    expect(request).toHaveBeenCalledWith("plugin.approval.list", {});
  });

  it("keeps the active approval open for unrelated errors", async () => {
    const request = vi.fn<RequestFn>(async () => {
      throw createGatewayError("gateway unavailable");
    });
    const active = createExecApproval();
    const app = await createApp(request, [active]);

    await app.handleExecApprovalDecision("deny");

    expect(app.execApprovalQueue).toEqual([active]);
    expect(app.execApprovalError).toBe("Approval failed: Error: gateway unavailable");
    expect(app.execApprovalBusy).toBe(false);
  });
});

describe("OpenClawApp marketplace authorization", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorageMock());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("refreshes marketplace, my roles, and main flow after zero-yuan authorization", async () => {
    const request = vi.fn<RequestFn>(async () => ({
      ok: true,
      entitlementId: "entitlement-zero-yuan-1",
    }));
    const app = await createMarketplaceApp(request);

    await app.authorizeAicsMarketplaceRole("role-listing-1");

    expect(request).toHaveBeenCalledWith("dijie.roleAuthorization.create", {
      role_listing_id: "role-listing-1",
    });
    expect(app.aicsRoleBuilder.form.entitlementId).toBe("entitlement-zero-yuan-1");
    expect(app.refreshAicsMarketplaceRoles).toHaveBeenCalledOnce();
    expect(app.refreshMyRolesReadModel).toHaveBeenCalledOnce();
    expect(app.refreshAicsMainFlowReadModel).toHaveBeenCalledOnce();
    expect(app.setTab).toHaveBeenCalledWith("workboard");
  });

  it("releases marketplace loading and refreshes roles after local zero-yuan authorization", async () => {
    const request = vi.fn<RequestFn>(async (method) => {
      if (method === "dijie.roleAuthorization.create") {
        return {
          ok: true,
          mode: "local",
          roleListingId: "local_rolelisting_marketplace_ops",
          entitlementId: "local_entitlement_marketplace_ops",
        };
      }
      if (method === "dijie.marketplace.roles.list") {
        return {
          ok: true,
          mode: "local",
          roles: [
            {
              id: "local_rolelisting_marketplace_ops",
              roleListingId: "local_rolelisting_marketplace_ops",
              title: "商城运营诊断官",
              entitlementId: "local_entitlement_marketplace_ops",
              entitlementStatus: "authorized",
              authorizationFeeCents: 0,
              priceLabel: "0 元",
              source: "local",
            },
          ],
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const app = await createMarketplaceApp(request);
    app.refreshAicsMarketplaceRoles = Object.getPrototypeOf(app).refreshAicsMarketplaceRoles;
    app.aicsMarketplace = {
      roles: [
        {
          id: "local_rolelisting_marketplace_ops",
          roleListingId: "local_rolelisting_marketplace_ops",
          title: "商城运营诊断官",
        },
      ],
      loading: false,
      result: null,
      error: null,
    };

    await app.authorizeAicsMarketplaceRole("local_rolelisting_marketplace_ops");

    expect(request).toHaveBeenCalledWith("dijie.roleAuthorization.create", {
      role_listing_id: "local_rolelisting_marketplace_ops",
    });
    expect(request).toHaveBeenCalledWith("dijie.marketplace.roles.list", {
      includeUnauthorized: true,
    });
    expect(app.aicsMarketplace.loading).toBe(false);
    expect(app.aicsMarketplace.roles[0]).toMatchObject({
      roleListingId: "local_rolelisting_marketplace_ops",
      entitlementId: "local_entitlement_marketplace_ops",
      entitlementStatus: "authorized",
    });
    expect(app.aicsRoleBuilder.form.entitlementId).toBe("local_entitlement_marketplace_ops");
    expect(app.refreshMyRolesReadModel).toHaveBeenCalledTimes(2);
    expect(app.refreshAicsMainFlowReadModel).toHaveBeenCalledOnce();
    expect(app.setTab).toHaveBeenCalledWith("workboard");
  });

  it("blocks authorization success responses that do not return an entitlement id", async () => {
    const request = vi.fn<RequestFn>(async (method) => {
      if (method === "dijie.roleAuthorization.create") {
        return {
          ok: true,
          mode: "local",
          roleListingId: "local_rolelisting_marketplace_ops",
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const app = await createMarketplaceApp(request);

    await app.authorizeAicsMarketplaceRole("local_rolelisting_marketplace_ops");

    expect(request).toHaveBeenCalledWith("dijie.roleAuthorization.create", {
      role_listing_id: "local_rolelisting_marketplace_ops",
    });
    expect(app.aicsMarketplace.loading).toBe(false);
    expect(app.aicsMarketplace.error).toBe(
      "岗位正式授权没有返回 entitlementId，不能继续任务调度。",
    );
    expect(app.aicsRoleBuilder.form.entitlementId).toBe("");
    expect(app.refreshAicsMarketplaceRoles).not.toHaveBeenCalled();
    expect(app.refreshMyRolesReadModel).not.toHaveBeenCalled();
    expect(app.refreshAicsMainFlowReadModel).not.toHaveBeenCalled();
    expect(app.setTab).not.toHaveBeenCalled();
  });

  it("shows blocked reasons and next action when local authorization is not allowed", async () => {
    const request = vi.fn<RequestFn>(async (method) => {
      if (method === "dijie.roleAuthorization.create") {
        return {
          ok: false,
          mode: "local",
          status: "blocked",
          roleListingId: "local_rolelisting_paid",
          blockedReasons: ["该岗位不是 0 元授权岗位，不能走本地 0 元授权。"],
          nextAction: "请走正式付费/checkout 授权链路，或联系审核中心调整岗位价格。",
          error: "该岗位不是 0 元授权岗位，不能走本地 0 元授权。",
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const app = await createMarketplaceApp(request);

    await app.authorizeAicsMarketplaceRole("local_rolelisting_paid");

    expect(request).toHaveBeenCalledWith("dijie.roleAuthorization.create", {
      role_listing_id: "local_rolelisting_paid",
    });
    expect(app.aicsMarketplace.loading).toBe(false);
    expect(app.aicsMarketplace.error).toBe(
      "该岗位不是 0 元授权岗位，不能走本地 0 元授权。 下一步：请走正式付费/checkout 授权链路，或联系审核中心调整岗位价格。",
    );
    expect(app.aicsRoleBuilder.form.entitlementId).toBe("");
    expect(app.refreshAicsMarketplaceRoles).not.toHaveBeenCalled();
    expect(app.refreshMyRolesReadModel).not.toHaveBeenCalled();
    expect(app.refreshAicsMainFlowReadModel).not.toHaveBeenCalled();
    expect(app.setTab).not.toHaveBeenCalled();
  });

  it("requests unauthorized local listings when refreshing marketplace roles", async () => {
    const request = vi.fn<RequestFn>(async (method) => {
      if (method === "dijie.marketplace.roles.list") {
        return {
          ok: true,
          mode: "local",
          roles: [
            {
              roleListingId: "local_rolelisting_marketplace_ops",
              title: "商城运营诊断官",
              entitlementStatus: "missing",
              authorizationFeeCents: 0,
              priceLabel: "0 元",
              source: "local",
            },
          ],
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const app = await createMarketplaceApp(request);
    app.refreshAicsMarketplaceRoles = Object.getPrototypeOf(app).refreshAicsMarketplaceRoles;

    await app.refreshAicsMarketplaceRoles();

    expect(request).toHaveBeenCalledWith("dijie.marketplace.roles.list", {
      includeUnauthorized: true,
    });
    expect(app.refreshMyRolesReadModel).toHaveBeenCalledOnce();
    expect(app.aicsMarketplace.roles).toEqual([
      expect.objectContaining({
        roleListingId: "local_rolelisting_marketplace_ops",
        title: "商城运营诊断官",
        entitlementStatus: "missing",
        authorizationFeeCents: 0,
        priceLabel: "0 元",
        source: "local",
      }),
    ]);
    expect(app.aicsMarketplace.error).toBeNull();
  });

  it("refreshes marketplace, my roles, and main flow after developer submits a listing", async () => {
    const request = vi.fn<RequestFn>(async (method) => {
      if (method === "aics.roleDeveloper.submitForListing") {
        return {
          review: { id: "role-review-1", reviewStatus: "已提交上架" },
          cloud: { mode: "local", roleListingId: "local_rolelisting_1" },
        };
      }
      const refresh = reviewRefreshResponse(method);
      if (refresh) return refresh;
      throw new Error(`unexpected method ${method}`);
    });
    const app = await createMarketplaceApp(request);
    installReviewCenterState(app as unknown as Record<string, unknown>);

    await app.submitDeveloperRoleForListing("role-review-1");

    expect(request).toHaveBeenCalledWith("aics.roleDeveloper.submitForListing", {
      reviewId: "role-review-1",
    });
    expect(app.aicsRoleBuilder.form.roleListingId).toBe("local_rolelisting_1");
    expect(app.refreshAicsMarketplaceRoles).toHaveBeenCalledOnce();
    expect(app.refreshMyRolesReadModel).toHaveBeenCalledOnce();
    expect(app.refreshAicsMainFlowReadModel).toHaveBeenCalledOnce();
    expect(app.refreshReviewCenter).toHaveBeenCalledOnce();
    expect(app.refreshBuildSessionBindableCategories).toHaveBeenCalledWith("role-review-1");
    expect(app.setTab).toHaveBeenCalledWith("usage");
  });

  it("uses the developer-listed role listing id for the following zero-yuan authorization", async () => {
    const request = vi.fn<RequestFn>(async (method) => {
      if (method === "aics.roleDeveloper.submitForListing") {
        return {
          ok: true,
          review: { id: "role-review-1", reviewStatus: "已提交上架" },
          cloud: { mode: "local", roleListingId: "local_rolelisting_marketplace_ops" },
        };
      }
      if (method === "dijie.roleAuthorization.create") {
        return {
          ok: true,
          mode: "local",
          roleListingId: "local_rolelisting_marketplace_ops",
          entitlementId: "local_entitlement_marketplace_ops",
        };
      }
      const refresh = reviewRefreshResponse(method);
      if (refresh) return refresh;
      throw new Error(`unexpected method ${method}`);
    });
    const app = await createMarketplaceApp(request);
    installReviewCenterState(app as unknown as Record<string, unknown>);

    await app.submitDeveloperRoleForListing("role-review-1");
    await app.authorizeAicsMarketplaceRole();

    expect(request).toHaveBeenCalledWith("aics.roleDeveloper.submitForListing", {
      reviewId: "role-review-1",
    });
    expect(request).toHaveBeenCalledWith("dijie.roleAuthorization.create", {
      role_listing_id: "local_rolelisting_marketplace_ops",
    });
    expect(app.aicsRoleBuilder.form.roleListingId).toBe("local_rolelisting_marketplace_ops");
    expect(app.aicsRoleBuilder.form.entitlementId).toBe("local_entitlement_marketplace_ops");
    expect(app.setTab).toHaveBeenCalledWith("usage");
    expect(app.setTab).toHaveBeenCalledWith("workboard");
  });

  it("refreshes tool supply after approving a tool or Skill review", async () => {
    const request = vi.fn<RequestFn>(async (method) => {
      if (method === "aics.toolSkillReview.approve") {
        return { ok: true };
      }
      const refresh = reviewRefreshResponse(method);
      if (refresh) return refresh;
      throw new Error(`unexpected method ${method}`);
    });
    const app = await createMarketplaceApp(request);
    installReviewCenterState(app as unknown as Record<string, unknown>);

    await app.approveToolSkillReview("tool-review-1");

    expect(request).toHaveBeenCalledWith("aics.toolSkillReview.approve", {
      reviewId: "tool-review-1",
    });
    expect(app.refreshToolSupplyControlReadModel).toHaveBeenCalledOnce();
  });

  it("refreshes tool supply and main flow after approving or syncing a category capability", async () => {
    const request = vi.fn<RequestFn>(async (method) => {
      if (
        method === "aics.categoryCapabilityReview.approve" ||
        method === "aics.categoryCapabilityReview.activateLocal"
      ) {
        return { ok: true };
      }
      const refresh = reviewRefreshResponse(method);
      if (refresh) return refresh;
      throw new Error(`unexpected method ${method}`);
    });
    const app = await createMarketplaceApp(request);
    installReviewCenterState(app as unknown as Record<string, unknown>);

    await app.approveCategoryCapabilityReview("category-review-1");
    await app.syncCategoryCapabilityReviewToCloud("category-review-1");

    expect(request).toHaveBeenCalledWith("aics.categoryCapabilityReview.approve", {
      reviewId: "category-review-1",
    });
    expect(request).toHaveBeenCalledWith("aics.categoryCapabilityReview.activateLocal", {
      reviewId: "category-review-1",
    });
    expect(app.refreshToolSupplyControlReadModel).toHaveBeenCalledTimes(2);
    expect(app.refreshAicsMainFlowReadModel).toHaveBeenCalledTimes(2);
  });

  it("refreshes role development state after activating a ready category package", async () => {
    const request = vi.fn<RequestFn>(async (method) => {
      if (method === "aics.toolSupply.categoryCapability.activateReadyPackage") {
        return { ok: true };
      }
      if (method === "aics.roleDevelopment.status.get") {
        return {
          development: {
            sessionId: "session-1",
            status: "ready_to_generate",
            userStatusLabel: "能力可用，可以生成岗位包",
            roleTitle: "商城运营诊断官",
            categoryName: "商城运营",
            categoryRef: "category:marketplace-ops@1",
            briefReady: true,
            canGenerateRolePackage: true,
            capability: {
              required: ["marketplace.read"],
              existing: ["marketplace.read"],
              missing: [],
              neededTools: [],
              neededSkills: [],
              neededProviders: [],
              humanConfirmationCapabilities: [],
              nonAutomaticCapabilities: [],
            },
            categoryCapabilityReview: null,
            toolSkillDevelopment: {
              required: [],
              todos: [],
              total: 0,
              approved: 0,
              pending: 0,
              ready: true,
            },
            nextActions: [],
            analysis: null,
          },
        };
      }
      if (method === "aics.rolePreListingReview.get") {
        return {
          review: {
            id: "role-review-1",
            rolePackageId: "商城运营诊断官",
            listingDraftId: "session-1",
          },
        };
      }
      const refresh = reviewRefreshResponse(method);
      if (refresh) return refresh;
      throw new Error(`unexpected method ${method}`);
    });
    const app = await createMarketplaceApp(request);
    installReviewCenterState(app as unknown as Record<string, unknown>);

    await app.activateToolSupplyCategoryCapabilityPackage("category-review-1");

    expect(request).toHaveBeenCalledWith(
      "aics.toolSupply.categoryCapability.activateReadyPackage",
      { categoryCapabilityReviewId: "category-review-1" },
    );
    expect(request).toHaveBeenCalledWith("aics.roleDevelopment.status.get", {
      sessionId: "session-1",
    });
    expect(app.refreshToolSupplyControlReadModel).toHaveBeenCalledOnce();
    expect(app.buildSession.roleDevelopment).toMatchObject({
      status: "ready_to_generate",
      canGenerateRolePackage: true,
    });
  });

  it("returns a category capability request for more materials without rejecting it", async () => {
    const request = vi.fn<RequestFn>(async (method) => {
      if (method === "aics.categoryCapabilityReview.requestChanges") {
        return { ok: true };
      }
      const refresh = reviewRefreshResponse(method);
      if (refresh) return refresh;
      throw new Error(`unexpected method ${method}`);
    });
    const app = await createMarketplaceApp(request);
    installReviewCenterState(app as unknown as Record<string, unknown>);

    await app.requestCategoryCapabilityChanges("category-review-1");

    expect(request).toHaveBeenCalledWith("aics.categoryCapabilityReview.requestChanges", {
      reviewId: "category-review-1",
    });
  });

  it("refreshes marketplace, my roles, and main flow after saving a cloud API connection", async () => {
    const request = vi.fn<RequestFn>(async (method) => {
      if (method === "aics.apiConnections.entry.create") {
        return { readModel: { entries: [{ id: "marketplace-dijie-cloud-bridge" }] } };
      }
      if (method === "aics.apiConnections.entry.materialize") {
        return { readModel: { entries: [{ id: "marketplace-dijie-cloud-bridge" }] } };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const app = await createMarketplaceApp(request);

    await app.createApiConnectionEntry();

    expect(request).toHaveBeenCalledWith(
      "aics.apiConnections.entry.create",
      expect.objectContaining({
        provider: "dijie-cloud-bridge",
        kind: "marketplace",
        secretEnvId: "DIJIE_CLOUD_ACCESS_TOKEN",
      }),
    );
    expect(request).toHaveBeenCalledWith("aics.apiConnections.entry.materialize", {
      id: "marketplace-dijie-cloud-bridge",
    });
    expect(app.refreshAicsMarketplaceRoles).toHaveBeenCalledOnce();
    expect(app.refreshMyRolesReadModel).toHaveBeenCalledOnce();
    expect(app.refreshAicsMainFlowReadModel).toHaveBeenCalledOnce();
  });

  it("refreshes execution read models after testing or applying an API connection", async () => {
    const request = vi.fn<RequestFn>(async (method) => {
      if (method === "aics.apiConnections.entry.test") {
        return {
          ok: true,
          connectionTest: { status: "passed", message: "连接后端检查通过。" },
          readModel: { entries: [{ id: "marketplace-dijie-cloud-bridge" }] },
        };
      }
      if (method === "aics.apiConnections.entry.materialize") {
        return { readModel: { entries: [{ id: "marketplace-dijie-cloud-bridge" }] } };
      }
      if (method === "aics.apiConnections.entry.syncCloudVariables") {
        return {
          ok: true,
          cloudVariableSync: { status: "synced", message: "云端变量同步完成。" },
          readModel: { entries: [{ id: "marketplace-dijie-cloud-bridge" }] },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const app = await createMarketplaceApp(request);

    await app.testApiConnectionEntry("marketplace-dijie-cloud-bridge");
    await app.materializeApiConnectionEntry("marketplace-dijie-cloud-bridge");
    await app.syncApiConnectionCloudVariables("marketplace-dijie-cloud-bridge");

    expect(request).toHaveBeenCalledWith("aics.apiConnections.entry.test", {
      id: "marketplace-dijie-cloud-bridge",
    });
    expect(request).toHaveBeenCalledWith("aics.apiConnections.entry.materialize", {
      id: "marketplace-dijie-cloud-bridge",
    });
    expect(request).toHaveBeenCalledWith("aics.apiConnections.entry.syncCloudVariables", {
      id: "marketplace-dijie-cloud-bridge",
    });
    expect(app.refreshAicsMarketplaceRoles).toHaveBeenCalledOnce();
    expect(app.refreshMyRolesReadModel).toHaveBeenCalledTimes(3);
    expect(app.refreshAicsMainFlowReadModel).toHaveBeenCalledTimes(3);
  });
});
