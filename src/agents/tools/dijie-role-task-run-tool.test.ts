import { describe, expect, it } from "vitest";
import { createOpenClawTools } from "../openclaw-tools.js";
import {
  createDijieRoleTaskRunTool,
  testing as dijieRoleTaskRunTesting,
} from "./dijie-role-task-run-tool.js";

const roleTokenPricing = {
  inputTokenCentsPerMillion: 120,
  outputTokenCentsPerMillion: 360,
  currency: "CNY",
  developerReceivableBps: 10000,
  platformFeeBps: 0,
} as const;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function requestHeader(init: RequestInit | undefined, key: string): string | undefined {
  const headers = init?.headers;
  if (!headers) {
    return undefined;
  }
  if (headers instanceof Headers) {
    return headers.get(key) ?? undefined;
  }
  if (Array.isArray(headers)) {
    const entry = headers.find(([name]) => name.toLowerCase() === key.toLowerCase());
    return entry?.[1];
  }
  const record = headers as Record<string, string>;
  return record[key] ?? record[key.toLowerCase()];
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== "string") {
    return {};
  }
  const parsed = JSON.parse(init.body) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

describe("dijie_role_task_run tool", () => {
  it("runs an authorized AICS role, uploads audit, and reads execution back", async () => {
    const workspaceDir = "/tmp/openclaw-aics-workspace";
    const workspaceRef = dijieRoleTaskRunTesting.workspaceRefForDir(workspaceDir);
    const requests: Array<{ url: string; method: string; authorization?: string; body?: unknown }> =
      [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      const authorization = requestHeader(init, "authorization");
      const body = requestBody(init);
      requests.push({
        url,
        method,
        authorization,
        ...(Object.keys(body).length > 0 ? { body } : {}),
      });

      if (url.startsWith("https://cloud.example/dijie/gateway/roles/read-model")) {
        expect(authorization).toBe("Bearer cloud_actor_token");
        expect(url).toContain(`workspaceRef=${encodeURIComponent(workspaceRef)}`);
        return jsonResponse({
          ok: true,
          readModel: {
            roles: [
              {
                roleListingId: "djrole_image_review",
                title: "智能门锁电商美工岗位",
                packageId: "djpkg_image_review",
                packageVersion: "1.0.0",
                callable: true,
                unavailableReasons: [],
                entitlement: {
                  id: "djent_image_review",
                  status: "authorized",
                },
              },
            ],
          },
        });
      }

      if (url === "https://cloud.example/dijie/execution-token") {
        expect(authorization).toBe("Bearer cloud_actor_token");
        expect(body).toMatchObject({
          roleListingId: "djrole_image_review",
          entitlementId: "djent_image_review",
          deviceId: "device_local_1",
          workspaceRef,
          localGatewayId: "gateway_local_1",
        });
        return jsonResponse({
          ok: true,
          grant: {
            executionId: "exec_123",
            roleListingId: "djrole_image_review",
            packageId: "djpkg_image_review",
            packageVersion: "1.0.0",
            developerRef: "dev_001",
            listingOwnerRef: "seller_001",
            billingBeneficiaryRef: "dev_001",
            entitlementId: "djent_image_review",
            deviceId: "device_local_1",
            workspaceRef,
            localGatewayId: "gateway_local_1",
            token: "execution_token_123",
            issuedAt: "2026-06-07T01:00:00.000Z",
            expiresAt: "2026-06-07T01:05:00.000Z",
            roleTokenPricing,
            scopes: ["role.execute", "audit.write"],
          },
        });
      }

      if (url === "https://cloud.example/dijie/audit") {
        expect(authorization).toBe("Bearer execution_token_123");
        const auditSummary = body.auditSummary as Record<string, unknown>;
        expect(auditSummary).toMatchObject({
          executionId: "exec_123",
          roleListingId: "djrole_image_review",
          entitlementId: "djent_image_review",
          localGatewayId: "gateway_local_1",
          status: "completed",
          modelProxyUsage: {
            requestCount: 1,
          },
        });
        expect(auditSummary.result).toMatchObject({
          executionId: "exec_123",
          roleListingId: "djrole_image_review",
          status: "completed",
          roleTokenPricing,
        });
        return jsonResponse({
          ok: true,
          executionId: "exec_123",
          auditRecordId: "djaudit_123",
        });
      }

      if (url === "https://cloud.example/dijie/executions/exec_123") {
        expect(authorization).toBe("Bearer cloud_actor_token");
        return jsonResponse({
          ok: true,
          execution: {
            executionId: "exec_123",
            status: "completed",
          },
        });
      }

      return jsonResponse({ ok: false, error: `unexpected URL: ${url}` }, 404);
    };

    const tool = createDijieRoleTaskRunTool({
      workspaceDir,
      fetch: fetchImpl,
      env: {
        DIJIE_CLOUD_BASE_URL: "https://cloud.example",
        DIJIE_CLOUD_ACCESS_TOKEN: "cloud_actor_token",
        DIJIE_DEVICE_ID: "device_local_1",
        DIJIE_LOCAL_GATEWAY_ID: "gateway_local_1",
      },
    });

    const result = await tool.execute("call_1", {
      task_text: "检查智能门锁商品主图是否适合上架",
      role_listing_id: "djrole_image_review",
      workspace_dir: workspaceDir,
      confirm_execution: true,
    });

    expect(result.details).toMatchObject({
      status: "completed",
      executionId: "exec_123",
      role: {
        roleListingId: "djrole_image_review",
        entitlementId: "djent_image_review",
        packageId: "djpkg_image_review",
      },
      auditUpload: {
        ok: true,
        auditRecordId: "djaudit_123",
      },
      executionReadback: {
        ok: true,
      },
    });
    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual(
      [
        "GET /dijie/gateway/roles/read-model",
        "POST /dijie/execution-token",
        "POST /dijie/audit",
        "GET /dijie/executions/exec_123",
      ],
    );
  });

  it("requires explicit user confirmation before execution", async () => {
    const tool = createDijieRoleTaskRunTool({
      workspaceDir: "/tmp/openclaw-aics-workspace",
      env: {
        DIJIE_CLOUD_BASE_URL: "https://cloud.example",
        DIJIE_CLOUD_ACCESS_TOKEN: "cloud_actor_token",
      },
    });

    await expect(
      tool.execute("call_1", {
        task_text: "执行岗位任务",
        role_listing_id: "djrole_image_review",
        confirm_execution: false,
      }),
    ).rejects.toThrow("confirm_execution=true is required");
  });

  it("is registered in the OpenClaw tool set for model-triggered main chat runs", () => {
    const tools = createOpenClawTools({
      workspaceDir: "/tmp/openclaw-aics-workspace",
      disablePluginTools: true,
      wrapBeforeToolCallHook: false,
    });

    expect(tools.some((tool) => tool.name === "dijie_role_task_run")).toBe(true);
  });
});
