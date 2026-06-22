import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closePipelineDb,
  closeRoleInstancesDb,
  getPipelineDb,
  resolveRoleInstancesDbPath,
} from "../../aics-main-flow/db.js";
import { publishLocalRoleListing } from "../../aics-main-flow/local-role-marketplace.js";
import { startRolePreListingReview } from "../../aics-main-flow/role-pre-listing-review.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";

const { coreGatewayHandlers } = await import("../server-methods.js");

let currentConfig: OpenClawConfig;
let tempDir: string;
const ORIGINAL_STATE_DIR = process.env.OPENCLAW_STATE_DIR;

beforeEach(async () => {
  vi.clearAllMocks();
  closePipelineDb();
  closeRoleInstancesDb();
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-aics-roles-"));
  process.env.OPENCLAW_STATE_DIR = tempDir;
  const secretPath = path.join(tempDir, "api-connections.json");
  await fs.writeFile(
    secretPath,
    JSON.stringify({
      marketplace: {
        dijieCloudBridge: "cloud-token-for-test",
      },
    }),
    "utf8",
  );
  currentConfig = {
    secrets: {
      providers: {
        "api-test": {
          source: "file",
          path: secretPath,
          mode: "json",
          allowInsecurePath: true,
        },
      },
    },
    apiConnections: {
      entries: {
        "marketplace-dijie-cloud-bridge": {
          id: "marketplace-dijie-cloud-bridge",
          name: "Dijie Cloud Bridge",
          kind: "marketplace",
          provider: "dijie-cloud-bridge",
          baseUrl: "https://cloud.example.test",
          enabled: true,
          secret: {
            source: "file",
            provider: "api-test",
            id: "/marketplace/dijieCloudBridge",
          },
          consumers: ["marketplace"],
        },
      },
    },
    plugins: {
      entries: {
        aics: {
          config: {
            defaultDeviceId: "device-local",
            defaultWorkspaceRef: "workspace-main",
          },
        },
      },
    },
  } as OpenClawConfig;
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(async () => {
  vi.unstubAllGlobals();
  closePipelineDb();
  closeRoleInstancesDb();
  if (ORIGINAL_STATE_DIR === undefined) {
    delete process.env.OPENCLAW_STATE_DIR;
  } else {
    process.env.OPENCLAW_STATE_DIR = ORIGINAL_STATE_DIR;
  }
  await fs.rm(tempDir, { recursive: true, force: true });
});

async function callRolesHandler(method: string, params: Record<string, unknown>) {
  const respond = vi.fn();
  const handler = coreGatewayHandlers[method];
  expect(handler).toBeTypeOf("function");
  await handler({
    req: { type: "req", id: `req-${method}`, method, params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond,
    context: {
      getRuntimeConfig: () => currentConfig,
    },
  } as never);
  expect(respond).toHaveBeenCalled();
  const [ok, payload, error] = respond.mock.calls.at(-1) ?? [];
  if (!ok) {
    throw new Error(JSON.stringify(error ?? payload));
  }
  return payload as Record<string, unknown>;
}

function fetchMock() {
  return vi.mocked(globalThis.fetch);
}

describe("aics roles cloud bridge handlers", () => {
  it("lists cloud marketplace roles through the API Management SecretRef connection", async () => {
    fetchMock().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        roles: [
          {
            roleListingId: "djrole_marketplace_ops",
            entitlementId: "djent_marketplace_ops",
            displayName: "商城运营诊断官",
          },
        ],
      }),
    } as Response);

    const payload = await callRolesHandler("dijie.marketplace.roles.list", {});

    expect(payload.ok).toBe(true);
    expect(payload.roles).toEqual([
      {
        roleListingId: "djrole_marketplace_ops",
        entitlementId: "djent_marketplace_ops",
        displayName: "商城运营诊断官",
      },
    ]);
    expect(fetchMock()).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock().mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://cloud.example.test/dijie/my-roles?deviceId=device-local&workspaceRef=workspace-main",
    );
    expect(init?.headers).toMatchObject({
      authorization: "Bearer cloud-token-for-test",
      "content-type": "application/json",
    });
  });

  it("creates a formal zero-yuan role authorization through the cloud authorization API", async () => {
    fetchMock().mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        ok: true,
        entitlement: {
          id: "djent_marketplace_ops",
          roleListingId: "djrole_marketplace_ops",
          source: "zero_price",
        },
      }),
    } as Response);

    const payload = await callRolesHandler("dijie.roleAuthorization.create", {
      roleListingId: "djrole_marketplace_ops",
    });

    expect(payload.ok).toBe(true);
    expect(payload.entitlement).toEqual({
      id: "djent_marketplace_ops",
      roleListingId: "djrole_marketplace_ops",
      source: "zero_price",
    });
    expect(fetchMock()).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock().mock.calls[0] ?? [];
    expect(String(url)).toBe("https://cloud.example.test/dijie/authorizations");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      authorization: "Bearer cloud-token-for-test",
      "content-type": "application/json",
    });
    expect(init?.body).toBe(JSON.stringify({ roleListingId: "djrole_marketplace_ops" }));
  });

  it("keeps local unentitled listings out of my roles unless explicitly requested", async () => {
    currentConfig = {};
    const review = startRolePreListingReview({
      packageDir: path.join(tempDir, "pkg-marketplace-ops"),
      category: "category:marketplace-ops@1",
      requiredCapabilities: ["marketplace.read"],
    });
    const listing = publishLocalRoleListing({
      reviewId: review.id,
      rolePackageId: "pkg-marketplace-ops",
      title: "商城运营诊断官",
      categoryRef: "category:marketplace-ops@1",
      requiredCapabilities: ["marketplace.read"],
    });

    const payload = await callRolesHandler("dijie.marketplace.roles.list", {});

    expect(payload).toMatchObject({
      ok: true,
      mode: "local",
      roles: [],
      localSummary: {
        total: 0,
        authorized: 0,
        unauthorized: 0,
      },
      summary: "本地暂无已授权岗位。",
    });
    expect(fetchMock()).not.toHaveBeenCalled();

    const catalogPayload = await callRolesHandler("dijie.marketplace.roles.list", {
      includeUnauthorized: true,
    });

    expect(catalogPayload).toMatchObject({
      ok: true,
      mode: "local",
      localSummary: {
        total: 1,
        authorized: 0,
        unauthorized: 1,
      },
      roles: [
        {
          roleListingId: listing.roleListingId,
          title: "商城运营诊断官",
          entitlementStatus: "missing",
          authorizationFeeCents: 0,
          source: "local",
        },
      ],
    });
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it("lists local authorized roles in my roles when cloud API is not configured", async () => {
    currentConfig = {};
    const review = startRolePreListingReview({
      packageDir: path.join(tempDir, "pkg-marketplace-ops"),
      category: "category:marketplace-ops@1",
      requiredCapabilities: ["marketplace.read"],
    });
    const listing = publishLocalRoleListing({
      reviewId: review.id,
      rolePackageId: "pkg-marketplace-ops",
      title: "商城运营诊断官",
      categoryRef: "category:marketplace-ops@1",
      requiredCapabilities: ["marketplace.read"],
    });
    const authorization = await callRolesHandler("dijie.roleAuthorization.create", {
      roleListingId: listing.roleListingId,
    });

    const payload = await callRolesHandler("dijie.marketplace.roles.list", {});

    expect(payload).toMatchObject({
      ok: true,
      mode: "local",
      localSummary: {
        total: 1,
        authorized: 1,
        unauthorized: 0,
      },
      roles: [
        {
          roleListingId: listing.roleListingId,
          title: "商城运营诊断官",
          entitlementId: authorization.entitlementId,
          entitlementStatus: "authorized",
          authorizationFeeCents: 0,
          source: "local",
        },
      ],
    });
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it("creates a formal local zero-yuan entitlement when cloud API is not configured", async () => {
    currentConfig = {};
    const review = startRolePreListingReview({
      packageDir: path.join(tempDir, "pkg-marketplace-ops"),
      category: "category:marketplace-ops@1",
      requiredCapabilities: ["marketplace.read"],
    });
    const listing = publishLocalRoleListing({
      reviewId: review.id,
      rolePackageId: "pkg-marketplace-ops",
      title: "商城运营诊断官",
      categoryRef: "category:marketplace-ops@1",
      requiredCapabilities: ["marketplace.read"],
    });

    const payload = await callRolesHandler("dijie.roleAuthorization.create", {
      roleListingId: listing.roleListingId,
    });

    expect(payload).toMatchObject({
      ok: true,
      mode: "local",
      roleListingId: listing.roleListingId,
      entitlement: {
        roleListingId: listing.roleListingId,
        status: "authorized",
        source: "zero_price",
      },
    });
    expect(String(payload.entitlementId)).toMatch(/^local_entitlement_/u);
    expect(fetchMock()).not.toHaveBeenCalled();

    const roles = await callRolesHandler("dijie.marketplace.roles.list", {});
    expect((roles.roles as Array<Record<string, unknown>>)[0]).toMatchObject({
      roleListingId: listing.roleListingId,
      entitlementId: payload.entitlementId,
      entitlementStatus: "authorized",
    });
  });

  it("uses the same local workspace account for zero-yuan authorization and my-role readback", async () => {
    currentConfig = {};
    const review = startRolePreListingReview({
      packageDir: path.join(tempDir, "pkg-marketplace-ops"),
      category: "category:marketplace-ops@1",
      requiredCapabilities: ["marketplace.read"],
    });
    const listing = publishLocalRoleListing({
      reviewId: review.id,
      rolePackageId: "pkg-marketplace-ops",
      title: "商城运营诊断官",
      categoryRef: "category:marketplace-ops@1",
      requiredCapabilities: ["marketplace.read"],
    });

    const payload = await callRolesHandler("dijie.roleAuthorization.create", {
      roleListingId: listing.roleListingId,
      workspace_ref: "workspace-main",
    });
    const roles = await callRolesHandler("dijie.marketplace.roles.list", {
      workspace_ref: "workspace-main",
    });
    const otherWorkspaceRoles = await callRolesHandler("dijie.marketplace.roles.list", {
      workspace_ref: "workspace-other",
      includeUnauthorized: true,
    });

    expect(payload).toMatchObject({
      ok: true,
      mode: "local",
      entitlement: {
        roleListingId: listing.roleListingId,
        accountId: "workspace-main",
        status: "authorized",
      },
    });
    expect((roles.roles as Array<Record<string, unknown>>)[0]).toMatchObject({
      roleListingId: listing.roleListingId,
      entitlementId: payload.entitlementId,
      entitlementStatus: "authorized",
    });
    expect((otherWorkspaceRoles.roles as Array<Record<string, unknown>>)[0]).toMatchObject({
      roleListingId: listing.roleListingId,
      entitlementStatus: "missing",
    });
  });

  it("blocks local zero-yuan authorization for non-zero-price local listings", async () => {
    currentConfig = {};
    const review = startRolePreListingReview({
      packageDir: path.join(tempDir, "pkg-marketplace-ops"),
      category: "category:marketplace-ops@1",
      requiredCapabilities: ["marketplace.read"],
    });
    const listing = publishLocalRoleListing({
      reviewId: review.id,
      rolePackageId: "pkg-marketplace-ops",
      title: "商城运营诊断官",
      categoryRef: "category:marketplace-ops@1",
      requiredCapabilities: ["marketplace.read"],
    });
    getPipelineDb()
      .prepare(
        "UPDATE local_role_listings SET authorization_fee_cents = ? WHERE role_listing_id = ?",
      )
      .run(9900, listing.roleListingId);

    const payload = await callRolesHandler("dijie.roleAuthorization.create", {
      roleListingId: listing.roleListingId,
    });

    expect(payload).toMatchObject({
      ok: false,
      mode: "local",
      status: "blocked",
      roleListingId: listing.roleListingId,
      authorizationFeeCents: 9900,
      blockedReasons: ["该岗位不是 0 元授权岗位，不能走本地 0 元授权。"],
      error: "该岗位不是 0 元授权岗位，不能走本地 0 元授权。",
      nextAction: "请走正式付费/checkout 授权链路，或联系审核中心调整岗位价格。",
    });
    expect(fetchMock()).not.toHaveBeenCalled();

    const roles = await callRolesHandler("dijie.marketplace.roles.list", {
      includeUnauthorized: true,
    });
    expect((roles.roles as Array<Record<string, unknown>>)[0]).toMatchObject({
      roleListingId: listing.roleListingId,
      entitlementStatus: "missing",
      authorizationFeeCents: 9900,
    });
  });

  it("keeps the mine read model scoped to authorized local roles by default", async () => {
    currentConfig = {};
    const review = startRolePreListingReview({
      packageDir: path.join(tempDir, "pkg-marketplace-ops"),
      category: "category:marketplace-ops@1",
      requiredCapabilities: ["marketplace.read"],
    });
    const listing = publishLocalRoleListing({
      reviewId: review.id,
      rolePackageId: "pkg-marketplace-ops",
      title: "商城运营诊断官",
      categoryRef: "category:marketplace-ops@1",
      requiredCapabilities: ["marketplace.read"],
    });

    const beforeAuthorization = await callRolesHandler("aics.roles.mine.readModel.get", {});
    expect((beforeAuthorization.summary as Record<string, unknown>).totalRoles).toBe(0);
    expect(beforeAuthorization.roles).toEqual([]);

    const withUnauthorized = await callRolesHandler("aics.roles.mine.readModel.get", {
      includeUnauthorized: true,
    });
    expect((withUnauthorized.summary as Record<string, unknown>).totalRoles).toBe(1);
    expect((withUnauthorized.roles as Array<Record<string, unknown>>)[0]).toMatchObject({
      roleListingId: listing.roleListingId,
      entitlementStatus: "missing",
    });

    await callRolesHandler("dijie.roleAuthorization.create", {
      roleListingId: listing.roleListingId,
    });
    const afterAuthorization = await callRolesHandler("aics.roles.mine.readModel.get", {});
    expect((afterAuthorization.summary as Record<string, unknown>).totalRoles).toBe(1);
    expect((afterAuthorization.roles as Array<Record<string, unknown>>)[0]).toMatchObject({
      roleListingId: listing.roleListingId,
      entitlementId: expect.stringMatching(/^local_entitlement_/u),
      entitlementStatus: "authorized",
      status: "not_run",
    });
  });

  it("keeps authorized roles visible when the role instance store cannot open", async () => {
    currentConfig = {};
    const review = startRolePreListingReview({
      packageDir: path.join(tempDir, "pkg-marketplace-ops"),
      category: "category:marketplace-ops@1",
      requiredCapabilities: ["marketplace.read"],
    });
    const listing = publishLocalRoleListing({
      reviewId: review.id,
      rolePackageId: "pkg-marketplace-ops",
      title: "商城运营诊断官",
      categoryRef: "category:marketplace-ops@1",
      requiredCapabilities: ["marketplace.read"],
    });
    await callRolesHandler("dijie.roleAuthorization.create", {
      roleListingId: listing.roleListingId,
    });
    closeRoleInstancesDb();
    await fs.mkdir(path.join(tempDir, "role-instances.db"));

    const readModel = await callRolesHandler("aics.roles.mine.readModel.get", {});

    expect((readModel.summary as Record<string, unknown>).totalRoles).toBe(1);
    expect((readModel.summary as Record<string, unknown>).instanceStoreError).toContain(
      "unable to open database file",
    );
    expect((readModel.roles as Array<Record<string, unknown>>)[0]).toMatchObject({
      title: "商城运营诊断官",
      roleListingId: listing.roleListingId,
      entitlementStatus: "authorized",
    });
  });

  it("repairs an unreadable role instance store by backing it up and reinitializing", async () => {
    currentConfig = {};
    const review = startRolePreListingReview({
      packageDir: path.join(tempDir, "pkg-marketplace-ops"),
      category: "category:marketplace-ops@1",
      requiredCapabilities: ["marketplace.read"],
    });
    const listing = publishLocalRoleListing({
      reviewId: review.id,
      rolePackageId: "pkg-marketplace-ops",
      title: "商城运营诊断官",
      categoryRef: "category:marketplace-ops@1",
      requiredCapabilities: ["marketplace.read"],
    });
    await callRolesHandler("dijie.roleAuthorization.create", {
      roleListingId: listing.roleListingId,
    });
    closeRoleInstancesDb();
    const dbPath = resolveRoleInstancesDbPath();
    await fs.mkdir(dbPath);

    const repair = await callRolesHandler("aics.roles.instanceStore.repair", {});

    expect(repair.ok).toBe(true);
    expect((repair.backupPaths as string[])[0]).toContain("role-instances.db.unreadable-");
    expect((repair.readModel as Record<string, unknown>).summary).toMatchObject({
      totalRoles: 1,
    });
    const afterRepair = await callRolesHandler("aics.roles.mine.readModel.get", {});
    expect((afterRepair.summary as Record<string, unknown>).instanceStoreError).toBeUndefined();
    expect((afterRepair.roles as Array<Record<string, unknown>>)[0]).toMatchObject({
      title: "商城运营诊断官",
      roleListingId: listing.roleListingId,
      entitlementStatus: "authorized",
    });
  });
});
