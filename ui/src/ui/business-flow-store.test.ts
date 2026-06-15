import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyBusinessFlowSelection,
  buildBusinessFlowProjection,
  loadBusinessFlowState,
  resolveBusinessFlowTaskRef,
  saveBusinessFlowState,
  type BusinessFlowState,
} from "./business-flow-store.ts";

function createStorageMock() {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", createStorageMock());
  localStorage.clear();
});

describe("business-flow-store", () => {
  it("loads a stable default operating selection", () => {
    expect(loadBusinessFlowState()).toEqual({
      selectedCadenceId: "quarter",
      selectedProjectId: "project-channel-growth",
    });
  });

  it("sanitizes invalid stored state", () => {
    localStorage.setItem(
      "openclaw.business-flow.v1",
      JSON.stringify({ selectedCadenceId: "day", selectedProjectId: "missing" }),
    );

    expect(loadBusinessFlowState()).toEqual({
      selectedCadenceId: "quarter",
      selectedProjectId: "project-channel-growth",
    });
  });

  it("persists and projects selected cadence and project", () => {
    const state: BusinessFlowState = applyBusinessFlowSelection(loadBusinessFlowState(), {
      selectedCadenceId: "week",
      selectedProjectId: "project-product-launch",
    });

    saveBusinessFlowState(state);

    const projection = buildBusinessFlowProjection(loadBusinessFlowState());
    expect(projection.selectedCadence.label).toBe("周经营例会");
    expect(projection.selectedGoals.map((goal) => goal.id)).toEqual(["goal-weekly-ops"]);
    expect(projection.selectedProject.name).toBe("新品上市项目");
    expect(projection.selectedProjectDepartment.name).toBe("市场与销售部");
    expect(projection.selectedProjectGoals.map((goal) => goal.id)).toEqual([
      "goal-quarter-growth",
      "goal-weekly-ops",
    ]);
  });

  it("resolves business context for existing task references", () => {
    const resolved = resolveBusinessFlowTaskRef({
      cadenceId: "quarter",
      projectId: "project-channel-growth",
      goalIds: ["goal-annual-revenue", "goal-quarter-growth"],
      departmentId: "dept-project",
      source: "planning",
    });

    expect(resolved?.project?.name).toBe("渠道增长项目");
    expect(resolved?.department?.name).toBe("项目部");
    expect(resolved?.goals.map((goal) => goal.id)).toEqual([
      "goal-annual-revenue",
      "goal-quarter-growth",
    ]);
  });

  it("projects operating facts, problem judgments, and planning signals", () => {
    const projection = buildBusinessFlowProjection({
      selectedCadenceId: "quarter",
      selectedProjectId: "project-product-launch",
    });

    expect(projection.selectedObservations.map((item) => item.id)).toContain(
      "obs-channel-conversion",
    );
    expect(projection.selectedAttributions.map((item) => item.id)).toContain(
      "attr-product-positioning",
    );
    expect(projection.selectedPlanningSignals.map((item) => item.id)).toContain(
      "plan-product-launch",
    );
    expect(projection.selectedProjectPlanningSignals.map((item) => item.id)).toContain(
      "plan-product-launch",
    );
  });
});
