import { describe, expect, it, vi } from "vitest";
import { withStateDirEnv } from "../../test-helpers/state-dir-env.js";

const { coreGatewayHandlers } = await import("../server-methods.js");

async function callMainFlow(
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const respond = vi.fn();
  const handler = coreGatewayHandlers[method];
  expect(handler).toBeTypeOf("function");
  await handler({
    req: { type: "req", id: `req-${method}`, method, params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond,
    context: { getRuntimeConfig: () => ({}) },
  } as never);
  expect(respond).toHaveBeenCalled();
  const [ok, payload, error] = respond.mock.calls.at(-1) ?? [];
  if (!ok) throw new Error(JSON.stringify(error ?? payload));
  return payload as Record<string, unknown>;
}

describe("aics dispatch queue generation", () => {
  it("creates dispatch proposals and task queue from confirmed planning without executing roles", async () => {
    await withStateDirEnv("openclaw-aics-dispatch-queue-", async () => {
      const observation = await callMainFlow("aics.mainFlow.observation.prepare", {
        title: "真实观察包",
        summary: "有证据的观察事实。",
        signals: [
          {
            id: "signal-api",
            title: "API 状态",
            summary: "模型阻塞",
            evidenceRefs: ["evidence-api"],
          },
        ],
      });
      await callMainFlow("aics.mainFlow.observation.confirm", {
        observationPackageId: observation.id,
      });
      const attribution = await callMainFlow("aics.mainFlow.attribution.prepare", {
        observationPackageId: observation.id,
        title: "归因报告",
        summary: "模型 Provider 不可用，影响岗位执行。",
        findings: [
          {
            id: "finding-api",
            title: "API / 模型 / 工具 / Skill 问题",
            summary: "模型 Provider 不可用。",
            confidence: "high",
            observationSignalIds: ["signal-api"],
          },
        ],
      });
      await callMainFlow("aics.mainFlow.attribution.confirm", {
        attributionReportId: attribution.id,
      });
      const goal = await callMainFlow("aics.mainFlow.goal.candidate.create", {
        title: "提升岗位商城首批岗位授权转化与执行成功率",
        owner: "迭界AI",
        metric: "执行成功率",
        target: "85%",
        rationale: "由归因报告支撑。",
        observationPackageId: observation.id,
        attributionReportId: attribution.id,
      });
      await callMainFlow("aics.mainFlow.goal.confirm", { goalId: goal.id });
      const planning = await callMainFlow("aics.mainFlow.planning.generateFromLatest", {});
      await callMainFlow("aics.mainFlow.planning.confirm", { planningPackageId: planning.id });

      const result = await callMainFlow("aics.mainFlow.dispatch.checkAndCreateQueue", {});
      const readModel = result.readModel as Record<string, unknown>;
      const objects = readModel.objects as Record<string, unknown[]>;

      expect((result.materialized as unknown[]).length).toBeGreaterThan(0);
      expect(objects.dispatchProposalReviews?.length).toBeGreaterThan(0);
      expect(objects.taskPackages?.length).toBeGreaterThan(0);
      expect(objects.dispatchToRoleRequests?.length).toBeGreaterThan(0);
      expect(objects.roleResults?.length ?? 0).toBe(0);
    });
  });
});
