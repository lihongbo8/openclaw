import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { ToolExecutionResponse } from "./tool-registry.js";

// ======================================================================
// 工具执行数据库
// ======================================================================
//
// 记录每次工具调用，支持按 role_run_ref 查询。
// 数据不属于 AICS 主事实源，属于工具层自己的运行过程库。

export type ToolExecutionRecord = {
  recordId: string;
  requestId: string;
  roleRunRef: string;
  workflowStepRef: string;
  toolRef: string;
  toolCapability: string;
  inputSummary: string;
  outputSummary: string;
  status: "ok" | "error" | "timeout" | "needs_human_confirm";
  durationMs: number;
  costCents: number;
  artifactRefs: string[];
  error?: string;
  createdAt: number;
};

function resolveDbPath(): string {
  const dir = path.join(resolveStateDir(), "tool-executions");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, "records.jsonl");
}

function loadRecords(): ToolExecutionRecord[] {
  const p = resolveDbPath();
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ToolExecutionRecord);
  } catch {
    return [];
  }
}

function appendRecord(record: ToolExecutionRecord): void {
  mkdirSync(path.dirname(resolveDbPath()), { recursive: true });
  writeFileSync(resolveDbPath(), JSON.stringify(record) + "\n", { flag: "a" });
}

export const ToolExecutionDb = {
  /** 记录一次工具调用 */
  record(params: {
    requestId: string;
    roleRunRef: string;
    workflowStepRef: string;
    toolRef: string;
    toolCapability: string;
    inputSummary: string;
    response: ToolExecutionResponse;
    durationMs: number;
  }): ToolExecutionRecord {
    const record: ToolExecutionRecord = {
      recordId: randomUUID(),
      requestId: params.requestId,
      roleRunRef: params.roleRunRef,
      workflowStepRef: params.workflowStepRef,
      toolRef: params.toolRef,
      toolCapability: params.toolCapability,
      inputSummary: params.inputSummary.slice(0, 200),
      outputSummary: params.response.executionSummary.slice(0, 200),
      status: params.response.needHumanConfirm
        ? "needs_human_confirm"
        : params.response.blockedReason
          ? "error"
          : "ok",
      durationMs: params.durationMs,
      costCents: params.response.costSummary.costCents,
      artifactRefs: params.response.artifactRefs,
      error: params.response.blockedReason,
      createdAt: Date.now(),
    };
    appendRecord(record);
    return record;
  },

  /** 按 roleRunRef 查询 */
  findByRun(roleRunRef: string): ToolExecutionRecord[] {
    return loadRecords()
      .filter((r) => r.roleRunRef === roleRunRef)
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  /** 查询最近 N 条记录 */
  recent(limit = 50): ToolExecutionRecord[] {
    return loadRecords()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },

  /** 错误统计 */
  errorStats(since: number): {
    total: number;
    errors: number;
    timeout: number;
    needsHumanConfirm: number;
  } {
    const records = loadRecords().filter((r) => r.createdAt >= since);
    return {
      total: records.length,
      errors: records.filter((r) => r.status === "error").length,
      timeout: records.filter((r) => r.status === "timeout").length,
      needsHumanConfirm: records.filter((r) => r.status === "needs_human_confirm").length,
    };
  },
};
