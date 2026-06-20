import { describe, expect, it } from "vitest";
import { createMarketplaceAdapter } from "./marketplace-adapter.js";

describe("createMarketplaceAdapter", () => {
  it("collects real marketplace read models into evidence-backed signals", async () => {
    const calls: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      const path = new URL(url).pathname;
      const payloadByPath: Record<string, unknown> = {
        "/dijie/roles": {
          roles: [
            {
              id: "role_1",
              title: "岗位商城运营",
              status: "published",
              reviewStatus: "approved",
              callable: true,
            },
            {
              id: "role_2",
              title: "审核阻塞岗位",
              status: "draft",
              reviewStatus: "pending",
              callable: false,
            },
          ],
        },
        "/dijie/my-roles": {
          roles: [{ role: { title: "岗位商城运营" }, status: "authorized" }],
        },
        "/dijie/ledger/entries": {
          entries: [{ usage_kind: "role_execution", gross_amount_cents: 0, created_at: "now" }],
        },
        "/dijie/capabilities": {
          capabilities: [
            { id: "cap_1", status: "approved" },
            { id: "cap_2", status: "pending" },
          ],
        },
        "/dijie/audit/queue": {
          items: [{ id: "audit_1" }],
        },
        "/dijie/unique-capability-requests": {
          requests: [{ status: "pending" }, { status: "approved" }],
        },
        "/dijie/business-summary": {
          roleCount: 2,
          authorizedCount: 1,
          executionCount: 4,
          failedCount: 1,
          blockedCount: 1,
        },
        "/dijie/gateway/roles/read-model": {
          roles: [
            { callable: true, entitlementStatus: "authorized" },
            { callable: false, blockedReason: "missing_category_capability" },
          ],
        },
        "/dijie/api-health": {
          status: "healthy",
          blockedReasons: [],
        },
      };
      return new Response(JSON.stringify(payloadByPath[path] ?? {}), {
        status: payloadByPath[path] ? 200 : 404,
        headers: { "content-type": "application/json" },
      });
    };

    const adapter = createMarketplaceAdapter({
      baseUrl: "https://cloud.example.test",
      accessToken: "token",
      fetchFn,
    });

    const result = await adapter.fetch();

    expect(calls).toContain("https://cloud.example.test/dijie/roles");
    expect(result.error).toBeUndefined();
    expect(result.signals.map((signal) => signal.id)).toEqual(
      expect.arrayContaining([
        "published-role-count",
        "marketplace-callable-role-count",
        "authorized-role-count",
        "recent-execution-stats",
        "marketplace-capability-count",
        "marketplace-audit-queue",
        "marketplace-unique-capability-requests",
        "marketplace-business-summary",
        "marketplace-dispatcher-role-read-model",
        "marketplace-api-health",
      ]),
    );
    expect(result.evidenceRefs.map((evidence) => evidence.id)).toContain(
      "marketplace-dispatcher-role-read-model-endpoint",
    );
  });
});
