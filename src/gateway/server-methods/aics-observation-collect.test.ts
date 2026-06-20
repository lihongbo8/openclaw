import { describe, expect, it, vi } from "vitest";
import { withStateDirEnv } from "../../test-helpers/state-dir-env.js";

const { coreGatewayHandlers } = await import("../server-methods.js");

async function callObservationCollect(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const respond = vi.fn();
  const handler = coreGatewayHandlers["aics.mainFlow.observation.collect"];
  expect(handler).toBeTypeOf("function");
  await handler({
    req: {
      type: "req",
      id: "req-observation-collect",
      method: "aics.mainFlow.observation.collect",
      params,
    },
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

describe("aics observation collection", () => {
  it("collects local read-model facts without requiring external connection fields", async () => {
    await withStateDirEnv("openclaw-aics-observation-collect-", async () => {
      const result = await callObservationCollect({ title: "当前账号真实数据分析包" });
      const observationPackage = result.observationPackage as {
        title?: string;
        summary?: string;
        signals?: Array<{ title: string; evidenceRefs: string[] }>;
      };

      expect(observationPackage.title).toBe("当前账号真实数据分析包");
      expect(observationPackage.summary).toContain("1/1 个数据源成功采集");
      expect(observationPackage.signals?.map((signal) => signal.title)).toEqual(
        expect.arrayContaining(["当前主流程阶段", "六层对象数量", "岗位执行闭环状态"]),
      );
      expect(observationPackage.signals?.every((signal) => signal.evidenceRefs.length > 0)).toBe(
        true,
      );
      expect(result.readModel).toMatchObject({
        counts: { observations: 1 },
      });
    });
  });
});
