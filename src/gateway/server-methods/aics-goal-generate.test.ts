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
    context: {
      getRuntimeConfig: () => ({}),
    },
  } as never);
  expect(respond).toHaveBeenCalled();
  const [ok, payload, error] = respond.mock.calls.at(-1) ?? [];
  if (!ok) {
    throw new Error(JSON.stringify(error ?? payload));
  }
  return payload as Record<string, unknown>;
}

describe("aics goal generation", () => {
  it("generates a candidate goal from confirmed observation and attribution only", async () => {
    await withStateDirEnv("openclaw-aics-goal-generate-", async () => {
      const observation = await callMainFlow("aics.mainFlow.observation.prepare", {
        title: "真实观察包",
        summary: "有证据的观察事实。",
        signals: [
          {
            id: "signal-api",
            title: "API 状态",
            summary: "模型 Provider 不可用，阻塞岗位执行。",
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
        summary: "API / 模型 / 工具 / Skill 问题影响执行闭环。",
        findings: [
          {
            id: "finding-api",
            title: "API / 模型 / 工具 / Skill 问题",
            summary: "模型 Provider 不可用，阻塞岗位执行。",
            confidence: "high",
            observationSignalIds: ["signal-api"],
          },
        ],
      });
      await callMainFlow("aics.mainFlow.attribution.confirm", {
        attributionReportId: attribution.id,
      });

      const result = await callMainFlow("aics.mainFlow.goal.generateFromLatest", {});
      const goal = result.goal as Record<string, unknown>;

      expect(goal.status).toBe("candidate");
      expect(goal.attributionReportId).toBe(attribution.id);
      expect(goal.observationPackageId).toBe(observation.id);
      expect(goal.title).toContain("岗位商城");
      expect(goal.rationale).toContain("模型 Provider 不可用");
    });
  });
});
