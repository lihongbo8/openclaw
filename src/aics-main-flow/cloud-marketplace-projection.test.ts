import { describe, expect, it } from "vitest";
import {
  createCloudMarketplaceProjection,
  defaultActorContext,
  validateActorContext,
} from "./cloud-marketplace-projection.js";
import { createAicsMainFlowReadModel, createEmptyAicsMainFlowState } from "./store.js";

describe("cloud marketplace projection", () => {
  it("requires actor_context for cloud marketplace management calls", () => {
    expect(validateActorContext(null)).toBe("missing_actor_context");
    expect(validateActorContext({ ...defaultActorContext(), audit_ref: "" })).toBe(
      "missing_actor_context",
    );
    expect(
      validateActorContext({
        ...defaultActorContext(),
        caller_context: "dispatcher",
        requested_scope: "platform_operator.admin",
      }),
    ).toBe("actor_scope_mismatch");
    expect(validateActorContext(defaultActorContext())).toBeNull();
  });

  it("marks cloud marketplace as the authority without copying raw cloud data", () => {
    const projection = createCloudMarketplaceProjection(
      createAicsMainFlowReadModel(createEmptyAicsMainFlowState(1)),
    );

    expect(projection.authority).toBe("cloud_marketplace");
    expect(projection.apiHealth.blockedReasons).toContain("api_boundary_required");
    expect(projection.businessSummary.ledgerSummary).toContain("不同步原始账本");
  });
});
