import type { AppViewState } from "../app-view-state.js";
import { aicsMainFlow } from "./aics-main-flow.ts";

// ═══ GoalsPageState — lightweight UI state for the CompanyGoal list ═══

export type GoalsPageState = {
  loading: boolean;
  error: string | null;
  selectedGoalId: string | null;
  formOpen: boolean;
  form: {
    title: string;
    owner: string;
    metric: string;
    target: string;
    rationale: string;
  };
};

export function createDefaultGoalsPageState(): GoalsPageState {
  return {
    loading: false,
    error: null,
    selectedGoalId: null,
    formOpen: false,
    form: {
      title: "",
      owner: "迭界AI",
      metric: "",
      target: "",
      rationale: "",
    },
  };
}

// ═══ Helpers ═══

/**
 * Derive the CompanyGoal status display fields from the read model.
 * Returns the latest goal (if any), the total count, and the readiness flags.
 */
export function deriveGoalView(readModel: Record<string, unknown> | null) {
  const latest = readModel?.latest as Record<string, unknown> | null;
  const goal = (latest?.companyGoal ?? null) as Record<string, unknown> | null;
  const counts = (readModel?.counts ?? {}) as Record<string, number>;
  const readiness = (readModel?.readiness ?? {}) as Record<string, boolean>;
  const blockedReasons = (readModel?.blockedReasons ?? []) as Array<{
    stage: string;
    code: string;
    message: string;
  }>;

  return {
    goal,
    totalGoals: counts.goals ?? 0,
    canCreate: readiness.canCreateGoalCandidate ?? false,
    canConfirm: Boolean(goal && goal.status !== "confirmed"),
    blockedReasons: blockedReasons.filter((r) => r.stage === "goal"),
  };
}

// ═══ Gateway-backed operations ═══

export function openGoalForm(state: GoalsPageState): void {
  state.formOpen = true;
  state.form = {
    title: "",
    owner: "迭界AI",
    metric: "",
    target: "",
    rationale: "",
  };
}

export function closeGoalForm(state: GoalsPageState): void {
  state.formOpen = false;
}

export function updateGoalFormField(
  state: GoalsPageState,
  field: keyof GoalsPageState["form"],
  value: string,
): void {
  state.form[field] = value;
}

export async function createGoalCandidate(
  appState: AppViewState,
  pageState: GoalsPageState,
): Promise<boolean> {
  const { title, owner, metric, target, rationale } = pageState.form;
  if (!title.trim()) return false;

  const ok = await aicsMainFlow.createGoalCandidate(
    appState,
    title.trim(),
    owner.trim() || "迭界AI",
    metric.trim(),
    target.trim(),
    rationale.trim() || "由归因报告支撑的公司目标候选。",
  );

  if (ok) {
    closeGoalForm(pageState);
  }
  return ok;
}

export async function confirmGoal(appState: AppViewState, goalId: string): Promise<boolean> {
  return aicsMainFlow.confirmGoal(appState, goalId);
}
