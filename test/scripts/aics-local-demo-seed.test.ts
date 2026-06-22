import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requireNodeSqlite } from "../../src/infra/node-sqlite.js";

const scriptPath = path.resolve("scripts/aics-local-demo-seed.ts");

const roots: string[] = [];

function makeRoot(): { root: string; stateDir: string; homeDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-aics-demo-seed-"));
  roots.push(root);
  const stateDir = path.join(root, "state");
  const homeDir = path.join(root, "home");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  return { root, stateDir, homeDir };
}

function runSeed(params: {
  stateDir: string;
  homeDir: string;
  reset?: boolean;
}): Record<string, unknown> {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", scriptPath, ...(params.reset ? ["--reset-demo"] : [])],
    {
      cwd: path.resolve("."),
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: params.homeDir,
        OPENCLAW_STATE_DIR: params.stateDir,
        OPENCLAW_TEST_FAST: "1",
      },
    },
  );
  expect(result.status, result.stderr || result.stdout).toBe(0);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function openPipelineDb(
  stateDir: string,
): InstanceType<ReturnType<typeof requireNodeSqlite>["DatabaseSync"]> {
  const sqlite = requireNodeSqlite();
  return new sqlite.DatabaseSync(path.join(stateDir, "aics-pipeline.db"));
}

function scalar(db: ReturnType<typeof openPipelineDb>, sql: string): number {
  const row = db.prepare(sql).get() as { count: number } | undefined;
  return row?.count ?? 0;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("scripts/aics-local-demo-seed", () => {
  it("prepares the local demo without fake execution results and resets stale demo readback facts", () => {
    const { stateDir, homeDir } = makeRoot();

    const first = runSeed({ stateDir, homeDir });
    expect(first).toMatchObject({
      ok: true,
      resetDemo: false,
      mode: "local",
      categoryCapabilityId: "category:marketplace-ops-local@1",
      taskCreated: true,
      nextPages: ["/api-management", "/review-center", "/usage", "/aics"],
    });
    expect(String(first.nextAction ?? "")).toContain("API 管理填写岗位执行模型 Key");
    expect(String(first.nextAction ?? "")).toContain("业务产物、审计和账本");

    const firstDb = openPipelineDb(stateDir);
    try {
      expect(scalar(firstDb, "SELECT COUNT(*) AS count FROM local_role_listings")).toBe(1);
      expect(scalar(firstDb, "SELECT COUNT(*) AS count FROM local_role_entitlements")).toBe(1);
      expect(scalar(firstDb, "SELECT COUNT(*) AS count FROM dispatch_to_role_requests")).toBe(1);
      const dispatch = firstDb
        .prepare("SELECT category_capability_id FROM dispatch_to_role_requests LIMIT 1")
        .get() as { category_capability_id?: string } | undefined;
      expect(dispatch?.category_capability_id).toBe("category:marketplace-ops-local@1");
      expect(scalar(firstDb, "SELECT COUNT(*) AS count FROM role_results")).toBe(0);
      expect(scalar(firstDb, "SELECT COUNT(*) AS count FROM local_role_execution_audits")).toBe(0);
      expect(scalar(firstDb, "SELECT COUNT(*) AS count FROM local_role_ledger_entries")).toBe(0);

      firstDb
        .prepare(
          "INSERT INTO local_role_ledger_entries(ledger_ref,execution_id,role_listing_id,entitlement_id,authorization_fee_cents,execution_fee_cents,source,status,created_at) VALUES('ledger:stale','exec-stale',?,?,0,0,'local_zero_price','posted',1)",
        )
        .run(first.roleListingId as string, first.entitlementId as string);
      firstDb
        .prepare(
          "INSERT INTO local_role_execution_audits(audit_record_id,execution_id,role_listing_id,entitlement_id,status,summary,ledger_ref,billing_summary,created_at) VALUES('audit:stale','exec-stale',?,?,'completed','stale','ledger:stale','{}',1)",
        )
        .run(first.roleListingId as string, first.entitlementId as string);
    } finally {
      firstDb.close();
    }

    const second = runSeed({ stateDir, homeDir, reset: true });
    expect(second).toMatchObject({
      ok: true,
      resetDemo: true,
      mode: "local",
      taskCreated: true,
    });

    const secondDb = openPipelineDb(stateDir);
    try {
      expect(scalar(secondDb, "SELECT COUNT(*) AS count FROM local_role_listings")).toBe(1);
      expect(scalar(secondDb, "SELECT COUNT(*) AS count FROM local_role_entitlements")).toBe(1);
      expect(scalar(secondDb, "SELECT COUNT(*) AS count FROM dispatch_to_role_requests")).toBe(1);
      expect(scalar(secondDb, "SELECT COUNT(*) AS count FROM role_results")).toBe(0);
      expect(scalar(secondDb, "SELECT COUNT(*) AS count FROM local_role_execution_audits")).toBe(0);
      expect(scalar(secondDb, "SELECT COUNT(*) AS count FROM local_role_ledger_entries")).toBe(0);
    } finally {
      secondDb.close();
    }
  });
});
