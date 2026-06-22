import type { AicsMainFlowReadModel } from "../types.js";
import type { AdapterFetchResult, ObservationAdapter } from "./types.js";

export type LocalReadModelAdapterConfig = {
  readModel: () => AicsMainFlowReadModel;
};

function blockerText(readModel: AicsMainFlowReadModel): string {
  if (!readModel.blockedReasons.length) return "当前主流程没有阻塞项。";
  return readModel.blockedReasons
    .slice(0, 3)
    .map((reason) => reason.message)
    .join("；");
}

export function createLocalReadModelAdapter(
  config: LocalReadModelAdapterConfig,
): ObservationAdapter {
  const sourceType = "aics_local_read_model";
  return {
    id: "aics-local-read-model",
    label: "本地 OpenClaw 主流程事实",
    sourceType,
    defaultConfidence: "high",

    async fetch(): Promise<AdapterFetchResult> {
      const collectedAt = Date.now();
      const readModel = config.readModel();
      const closure = readModel.executionClosure;
      const evidenceId = `aics-local-read-model:${readModel.updatedAt}`;
      const signals: AdapterFetchResult["signals"] = [
        {
          id: "local-main-flow-stage",
          title: "当前主流程阶段",
          summary: `当前停在${readModel.stageGuidance.title}，下一步是${readModel.stageGuidance.primaryActionLabel}。${blockerText(readModel)}`,
          evidenceRefs: [evidenceId],
        },
        {
          id: "local-main-flow-counts",
          title: "六层对象数量",
          summary: `已形成 ${readModel.counts.observations} 个观察包、${readModel.counts.attributions} 个归因报告、${readModel.counts.goals} 个目标、${readModel.counts.planningPackages} 个规划、${readModel.counts.dispatchToRoleRequests} 个执行队列、${readModel.counts.roleResults} 个执行结果。`,
          evidenceRefs: [evidenceId],
        },
        {
          id: "local-execution-closure",
          title: "岗位执行闭环状态",
          summary: closure.canRun
            ? "岗位执行闭环已满足运行条件，可以在岗位执行页由用户确认后运行。"
            : `岗位执行闭环尚未就绪：${closure.recoveryActions[0]?.reason ?? "需要先完成上游主流程条件。"}`,
          evidenceRefs: [evidenceId],
        },
      ];

      const missingEvidence = closure.missingEvidence.filter(Boolean);
      if (missingEvidence.length > 0) {
        signals.push({
          id: "local-execution-missing-evidence",
          title: "执行证据缺失",
          summary: `执行闭环缺少：${missingEvidence.join("、")}。缺失证据不能显示为完成。`,
          evidenceRefs: [evidenceId],
        });
      }

      return {
        sourceId: "aics-local-read-model",
        sourceType,
        signals,
        evidenceRefs: [
          {
            id: evidenceId,
            sourceId: "aics-local-read-model",
            sourceType,
            label: "AICS 主流程 read model",
            confidence: "high",
            freshness: "fresh",
            collectedAt,
          },
        ],
        freshness: "fresh",
        collectedAt,
      };
    },
  };
}
