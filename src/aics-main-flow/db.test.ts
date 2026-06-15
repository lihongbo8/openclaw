import { sql } from "kysely";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getPipelineDb,
  getPipelineKysely,
  closePipelineDb,
  createPipelineTables,
  bootstrapPipelineDb,
} from "./db.js";

describe("aics-pipeline.db", () => {
  beforeAll(() => {
    // bootstrapPipelineDb 会建表 + 自动迁移
    bootstrapPipelineDb();
  });

  afterAll(() => {
    closePipelineDb();
  });

  it("creates tables without error", () => {
    const db = getPipelineDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain("observations");
    expect(names).toContain("observation_signals");
    expect(names).toContain("attributions");
    expect(names).toContain("attribution_findings");
    expect(names).toContain("goals");
    expect(names).toContain("work_blocks");
    expect(names).toContain("work_block_roles");
    expect(names).toContain("work_block_task_candidates");
    expect(names).toContain("planning_packages");
    expect(names).toContain("role_plan_items");
    expect(names).toContain("dispatch_proposal_reviews");
    expect(names).toContain("task_packages");
    expect(names).toContain("dispatch_to_role_requests");
    expect(names).toContain("role_results");
  });

  it("keeps capability routing columns in the pipeline tables", () => {
    const db = getPipelineDb();
    const columns = (table: string) =>
      (
        db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
          name: string;
        }>
      ).map((row) => row.name);

    expect(columns("role_plan_items")).toContain("category");
    expect(columns("task_packages")).toEqual(
      expect.arrayContaining(["category", "required_capability_refs"]),
    );
    expect(columns("dispatch_to_role_requests")).toEqual(
      expect.arrayContaining([
        "category",
        "required_capability_refs",
        "allowed_tools",
        "allowed_skills",
        "capability_request_id",
      ]),
    );
  });

  it("inserts and reads an observation", async () => {
    const kysely = getPipelineKysely();
    const now = Date.now();
    const obsId = `obs_test_${now}`;

    await kysely
      .insertInto("observations")
      .values({
        id: obsId,
        status: "prepared",
        title: "测试观察包",
        summary: "来自单元测试",
        created_at: now,
        updated_at: now,
        audit_refs: "[]",
      })
      .execute();

    const row = await kysely
      .selectFrom("observations")
      .selectAll()
      .where("id", "=", obsId)
      .executeTakeFirst();

    expect(row).toBeTruthy();
    expect(row!.title).toBe("测试观察包");
    expect(row!.status).toBe("prepared");
  });

  it("enforces foreign key constraint", async () => {
    const kysely = getPipelineKysely();

    // attribution 应该失败因为没有 observation
    await expect(
      kysely
        .insertInto("attributions")
        .values({
          id: "attr_no_parent",
          status: "prepared",
          observation_package_id: "nonexistent_obs",
          title: "孤儿归因",
          summary: "",
          created_at: Date.now(),
          updated_at: Date.now(),
          audit_refs: "[]",
        })
        .execute(),
    ).rejects.toThrow();
  });

  it("runs migration from old JSON", () => {
    const db = getPipelineDb();
    const count = db.prepare("SELECT COUNT(*) as cnt FROM observations").get() as { cnt: number };
    // 如果 migration 跑了，至少有一个 observation
    expect(count.cnt).toBeGreaterThanOrEqual(1);
  });
});
