import { describe, expect, it, vi } from "vitest";
import type { AppViewState } from "../app-view-state.ts";
import {
  bindRoleReviewCategory,
  createDefaultReviewCenterState,
  refreshReviewCenter,
  setReviewCenterCategoryFilter,
  setReviewCenterRoleFilter,
  syncCategoryCapabilityReviewToCloud,
} from "./review-center.ts";

describe("review center controller", () => {
  it("loads review queues without auto-selecting or expanding any review detail", async () => {
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === "aics.rolePreListingReview.list") {
        return { reviews: [{ id: "role-review-1", rolePackageId: "商城运营诊断官" }] };
      }
      if (method === "aics.categoryCapabilityReview.list") {
        return { reviews: [{ id: "category-review-1", categoryName: "商城运营" }] };
      }
      void params;
      throw new Error(`unexpected method ${method}`);
    });
    const state = {
      client: { request },
      reviewCenter: createDefaultReviewCenterState(),
      requestHostUpdate: vi.fn(),
    } as unknown as AppViewState;

    await refreshReviewCenter(state);

    expect(state.reviewCenter.selectedRoleReviewId).toBeNull();
    expect(state.reviewCenter.selectedCategoryCapabilityReviewId).toBeNull();
    expect(request).not.toHaveBeenCalledWith("aics.toolSkillReview.list", expect.anything());
    expect(request).not.toHaveBeenCalledWith("aics.rolePreListingReview.events", expect.anything());
    expect(request).not.toHaveBeenCalledWith(
      "aics.categoryCapabilityReview.events",
      expect.anything(),
    );
    expect(state.reviewCenter.eventsByReviewId).toEqual({});
  });

  it("sends pagination, search, filter, and sort params to the role review queue", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === "aics.rolePreListingReview.list") {
        return {
          reviews: [],
          pageInfo: {
            page: 2,
            pageSize: 50,
            total: 1000,
            totalPages: 20,
            hasPreviousPage: true,
            hasNextPage: true,
          },
        };
      }
      if (method === "aics.categoryCapabilityReview.list") {
        return {
          reviews: [],
          pageInfo: {
            page: 4,
            pageSize: 100,
            total: 1000,
            totalPages: 10,
            hasPreviousPage: true,
            hasNextPage: true,
          },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state = {
      client: { request },
      reviewCenter: {
        ...createDefaultReviewCenterState(),
        roleQueueFilter: "high_risk",
        roleQueueSearch: "商城运营",
        roleQueueSort: "risk_desc",
        roleQueuePageInfo: {
          page: 2,
          pageSize: 50,
          total: 1000,
          totalPages: 20,
          hasPreviousPage: true,
          hasNextPage: true,
        },
        categoryQueueFilter: "sync_failed",
        categoryQueueSearch: "商城运营",
        categoryQueueSort: "activation_status_asc",
        categoryQueuePageInfo: {
          page: 4,
          pageSize: 100,
          total: 1000,
          totalPages: 10,
          hasPreviousPage: true,
          hasNextPage: true,
        },
      },
      requestHostUpdate: vi.fn(),
    } as unknown as AppViewState;

    await refreshReviewCenter(state);

    expect(calls.find((call) => call.method === "aics.rolePreListingReview.list")?.params).toEqual({
      page: 2,
      pageSize: 50,
      filter: "high_risk",
      search: "商城运营",
      sort: "risk_desc",
    });
    expect(
      calls.find((call) => call.method === "aics.categoryCapabilityReview.list")?.params,
    ).toEqual({
      page: 4,
      pageSize: 100,
      filter: "sync_failed",
      search: "商城运营",
      sort: "activation_status_asc",
    });
    expect(state.reviewCenter.roleQueuePageInfo.total).toBe(1000);
    expect(state.reviewCenter.categoryQueuePageInfo.total).toBe(1000);
  });

  it("resets the role queue page when changing filters", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "aics.rolePreListingReview.list") return { reviews: [] };
      if (method === "aics.categoryCapabilityReview.list") return { reviews: [] };
      throw new Error(`unexpected method ${method}`);
    });
    const state = {
      client: { request },
      reviewCenter: {
        ...createDefaultReviewCenterState(),
        roleQueuePageInfo: {
          page: 8,
          pageSize: 20,
          total: 1000,
          totalPages: 50,
          hasPreviousPage: true,
          hasNextPage: true,
        },
      },
      requestHostUpdate: vi.fn(),
    } as unknown as AppViewState;

    setReviewCenterRoleFilter(state, "missing_category");
    await vi.waitFor(() => expect(request).toHaveBeenCalled());

    expect(state.reviewCenter.roleQueueFilter).toBe("missing_category");
    expect(state.reviewCenter.roleQueuePageInfo.page).toBe(1);
  });

  it("resets the category queue page when changing filters", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "aics.rolePreListingReview.list") return { reviews: [] };
      if (method === "aics.categoryCapabilityReview.list") return { reviews: [] };
      throw new Error(`unexpected method ${method}`);
    });
    const state = {
      client: { request },
      reviewCenter: {
        ...createDefaultReviewCenterState(),
        categoryQueuePageInfo: {
          page: 8,
          pageSize: 20,
          total: 1000,
          totalPages: 50,
          hasPreviousPage: true,
          hasNextPage: true,
        },
      },
      requestHostUpdate: vi.fn(),
    } as unknown as AppViewState;

    setReviewCenterCategoryFilter(state, "activated");
    await vi.waitFor(() => expect(request).toHaveBeenCalled());

    expect(state.reviewCenter.categoryQueueFilter).toBe("activated");
    expect(state.reviewCenter.categoryQueuePageInfo.page).toBe(1);
  });

  it("runs local validation after binding an approved category", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === "aics.rolePreListingReview.bindCategory") {
        return { ok: true };
      }
      if (method === "aics.rolePreListingReview.runValidation") {
        return { ok: true };
      }
      if (method === "aics.rolePreListingReview.list") {
        return { reviews: [{ id: "role-review-1", validationStatus: "已通过" }] };
      }
      if (method === "aics.categoryCapabilityReview.list") {
        return { reviews: [] };
      }
      if (method === "aics.rolePreListingReview.events") {
        return { events: [] };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state = {
      client: { request },
      reviewCenter: createDefaultReviewCenterState(),
      requestHostUpdate: vi.fn(),
    } as unknown as AppViewState;

    await bindRoleReviewCategory(state, "role-review-1", "category-review-1");

    expect(calls.slice(0, 2)).toEqual([
      {
        method: "aics.rolePreListingReview.bindCategory",
        params: { reviewId: "role-review-1", categoryCapabilityReviewId: "category-review-1" },
      },
      {
        method: "aics.rolePreListingReview.runValidation",
        params: { reviewId: "role-review-1" },
      },
    ]);
    expect(state.reviewCenter.roleReviews[0]?.validationStatus).toBe("已通过");
  });

  it("activates category capability through the local review interface", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === "aics.categoryCapabilityReview.activateLocal") {
        return { ok: true };
      }
      if (method === "aics.rolePreListingReview.list") {
        return { reviews: [] };
      }
      if (method === "aics.categoryCapabilityReview.list") {
        return { reviews: [{ id: "category-review-1", cloudSyncStatus: "已同步" }] };
      }
      if (method === "aics.categoryCapabilityReview.events") {
        return { events: [] };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state = {
      client: { request },
      reviewCenter: createDefaultReviewCenterState(),
      requestHostUpdate: vi.fn(),
    } as unknown as AppViewState;

    await syncCategoryCapabilityReviewToCloud(state, "category-review-1");

    expect(calls[0]).toEqual({
      method: "aics.categoryCapabilityReview.activateLocal",
      params: { reviewId: "category-review-1" },
    });
    expect(state.reviewCenter.categoryCapabilityReviews[0]?.cloudSyncStatus).toBe("已同步");
  });
});
