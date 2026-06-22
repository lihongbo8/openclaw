import { Compile } from "typebox/compile";
import { describe, expect, it } from "vitest";
import {
  DijieAuditSummarySchema,
  DijieDeviceBindRequestSchema,
  DijieEvolutionCandidateSchema,
  DijieExecutionGrantSchema,
  DijieExecutionTokenRequestSchema,
  DijieMemoryCandidateSchema,
  DijieRoleCapabilityProfileSchema,
  DijieRoleFeedbackPacketSchema,
  DijieRolePackageManifestSchema,
  DijieSchedulerStateSchema,
} from "./schema/dijie.js";
import { ProtocolSchemas } from "./schema/protocol-schemas.js";

describe("Dijie protocol schemas", () => {
  it("validates device binding requests", () => {
    const validate = Compile(DijieDeviceBindRequestSchema);

    expect(
      validate.Check({
        deviceId: "device_local_1",
        publicKey: "pubkey",
        displayName: "MacBook",
        platform: "darwin",
        workspaceRef: "workspace_local_1",
        nonce: "nonce",
        signedAt: Date.now(),
        signature: "signature",
      }),
    ).toBe(true);

    expect(
      validate.Check({
        deviceId: "device_local_1",
        publicKey: "pubkey",
        nonce: "nonce",
        signedAt: Date.now(),
        signature: "signature",
        extra: "not allowed",
      }),
    ).toBe(false);
  });

  it("validates execution token requests without runtime pricing mutation", () => {
    const validate = Compile(DijieExecutionTokenRequestSchema);

    expect(
      validate.Check({
        roleListingId: "role_developer_agent",
        entitlementId: "ent_123",
        deviceId: "device_local_1",
        workspaceRef: "workspace_local_1",
        localGatewayId: "gateway_local_1",
        requestedBy: {
          actorId: "cus_123",
          actorType: "customer",
        },
        intent: "run authorized role package",
      }),
    ).toBe(true);

    expect(
      validate.Check({
        roleListingId: "role_developer_agent",
        entitlementId: "ent_123",
        deviceId: "device_local_1",
        workspaceRef: "workspace_local_1",
        localGatewayId: "gateway_local_1",
        requestedBy: {
          actorId: "cus_123",
          actorType: "customer",
        },
        pricing: {
          kind: "metered_runtime",
        },
      }),
    ).toBe(false);
  });

  it("validates execution grants with zero marketplace platform fee", () => {
    const validate = Compile(DijieExecutionGrantSchema);
    const grant = {
      executionId: "exec_123",
      roleListingId: "role_customer_support_agent",
      packageId: "pkg_customer_support",
      packageVersion: "1.0.0",
      developerRef: "dev_001",
      listingOwnerRef: "seller_001",
      billingBeneficiaryRef: "dev_001",
      entitlementId: "ent_123",
      deviceId: "device_local_1",
      workspaceRef: "workspace_local_1",
      localGatewayId: "gateway_local_1",
      token: "token",
      issuedAt: "2026-05-31T03:00:00.000Z",
      expiresAt: "2026-05-31T03:05:00.000Z",
      pricing: {
        kind: "one_time_authorization",
        authorizationFeeCents: 29900,
        currency: "CNY",
        platformFeeBps: 0,
        developerReceivableCents: 29900,
      },
      roleTokenPricing: {
        inputTokenCentsPerMillion: 120,
        outputTokenCentsPerMillion: 480,
        currency: "CNY",
        developerReceivableBps: 10000,
        platformFeeBps: 0,
      },
      scopes: ["role.execute", "audit.write"],
    };

    expect(validate.Check(grant)).toBe(true);
    expect(
      validate.Check({
        ...grant,
        pricing: { ...grant.pricing, platformFeeBps: 1500 },
      }),
    ).toBe(false);
    expect(
      validate.Check({
        ...grant,
        roleTokenPricing: undefined,
      }),
    ).toBe(false);
    expect(
      validate.Check({
        ...grant,
        roleTokenPricing: { ...grant.roleTokenPricing, inputTokenCentsPerMillion: -1 },
      }),
    ).toBe(false);
    expect(
      validate.Check({
        ...grant,
        roleTokenPricing: { ...grant.roleTokenPricing, currency: "" },
      }),
    ).toBe(false);
    expect(
      validate.Check({
        ...grant,
        roleTokenPricing: { ...grant.roleTokenPricing, developerReceivableBps: 8500 },
      }),
    ).toBe(false);
    expect(
      validate.Check({
        ...grant,
        roleTokenPricing: { ...grant.roleTokenPricing, platformFeeBps: 1500 },
      }),
    ).toBe(false);
  });

  it("validates role package manifests and audit summaries", () => {
    const validateManifest = Compile(DijieRolePackageManifestSchema);
    const validateAudit = Compile(DijieAuditSummarySchema);
    const roleResult = {
      executionId: "exec_123",
      roleListingId: "role_customer_support_agent",
      packageId: "pkg_customer_support",
      packageVersion: "1.0.0",
      developerRef: "dev_001",
      listingOwnerRef: "seller_001",
      billingBeneficiaryRef: "dev_001",
      status: "completed",
      startedAt: "2026-05-31T03:00:00.000Z",
      endedAt: "2026-05-31T03:03:00.000Z",
      roleTokenPricing: {
        inputTokenCentsPerMillion: 120,
        outputTokenCentsPerMillion: 480,
        currency: "CNY",
        developerReceivableBps: 10000,
        platformFeeBps: 0,
      },
      modelProxyUsage: {
        requestCount: 3,
        inputTokens: 1200,
        outputTokens: 300,
      },
      summary: "Generated a role package.",
      changedFiles: ["role_package/manifest.json"],
      artifacts: [
        {
          id: "artifact_role_package",
          type: "role_package",
          title: "role_package.zip",
          sizeBytes: 1024,
          sha256: "sha256",
        },
      ],
    };

    expect(
      validateManifest.Check({
        manifestVersion: 1,
        rolePackageId: "pkg_123",
        version: "1.0.0",
        name: "客户支持岗位",
        entrypoint: "role_package/manifest.json",
        permissions: ["workspace.read", "workspace.write"],
        files: [
          {
            path: "role_package/manifest.json",
            sha256: "sha256",
            sizeBytes: 512,
          },
        ],
      }),
    ).toBe(true);

    expect(
      validateManifest.Check({
        manifestVersion: 1,
        rolePackageId: "pkg_123",
        roleListingId: "role_customer_support_agent",
        version: "1.0.0",
        name: "客户支持岗位",
        entrypoint: "role_package/manifest.json",
        permissions: ["workspace.read"],
        files: [],
      }),
    ).toBe(false);

    expect(
      validateAudit.Check({
        executionId: "exec_123",
        deviceId: "device_local_1",
        workspaceRef: "workspace_local_1",
        roleListingId: "role_developer_agent",
        packageId: "pkg_customer_support",
        packageVersion: "1.0.0",
        developerRef: "dev_001",
        listingOwnerRef: "seller_001",
        billingBeneficiaryRef: "dev_001",
        entitlementId: "ent_123",
        localGatewayId: "gateway_local_1",
        status: "completed",
        startedAt: "2026-05-31T03:00:00.000Z",
        endedAt: "2026-05-31T03:03:00.000Z",
        roleTokenPricing: {
          inputTokenCentsPerMillion: 120,
          outputTokenCentsPerMillion: 480,
          currency: "CNY",
          developerReceivableBps: 10000,
          platformFeeBps: 0,
        },
        modelProxyUsage: {
          requestCount: 3,
          inputTokens: 1200,
          outputTokens: 300,
        },
        toolUsage: {
          shellCommands: 2,
          testsRun: 1,
          filesRead: 8,
          filesChanged: 1,
        },
        result: roleResult,
      }),
    ).toBe(true);
  });

  it("validates scheduler backbone schemas", () => {
    const validateFeedbackPacket = Compile(DijieRoleFeedbackPacketSchema);
    const validateSchedulerState = Compile(DijieSchedulerStateSchema);
    const validateCapabilityProfile = Compile(DijieRoleCapabilityProfileSchema);
    const validateMemoryCandidate = Compile(DijieMemoryCandidateSchema);
    const validateEvolutionCandidate = Compile(DijieEvolutionCandidateSchema);
    const feedbackPacket = {
      packetVersion: 1,
      packetId: "packet_exec_123",
      mode: "authorized_execution",
      producedAt: "2026-06-01T03:00:00.000Z",
      role: {
        packageId: "pkg_customer_support",
        packageVersion: "1.0.0",
        roleListingId: "role_customer_support_agent",
        developerRef: "dev_001",
      },
      schedulerContext: {
        executionId: "exec_123",
        entitlementId: "ent_123",
        deviceId: "device_local_1",
        workspaceRef: "workspace_local_1",
        localGatewayId: "gateway_local_1",
      },
      status: "completed",
      startedAt: "2026-06-01T03:00:00.000Z",
      endedAt: "2026-06-01T03:03:00.000Z",
      summary: "Generated and validated a role package.",
      changedFiles: ["role_package/manifest.json"],
      artifacts: [
        {
          id: "artifact_manifest",
          type: "role_package_file",
          title: "role_package/manifest.json",
          sizeBytes: 512,
          sha256: "sha256",
        },
      ],
      toolUsage: {
        shellCommands: 1,
        testsRun: 1,
        filesRead: 0,
        filesChanged: 1,
      },
      modelProxyUsage: {
        requestCount: 1,
        inputTokens: 100,
        outputTokens: 50,
      },
      costUsage: {
        inputTokens: 100,
        outputTokens: 50,
        currency: "CNY",
        estimatedCents: 1,
      },
      riskEvents: [],
      evolutionSuggestions: [
        {
          target: "test_example_library",
          summary: "Add this successful smoke as a regression example.",
          evidenceRefs: ["packet_exec_123"],
        },
      ],
    };

    expect(validateFeedbackPacket.Check(feedbackPacket)).toBe(true);
    expect(validateFeedbackPacket.Check({ ...feedbackPacket, roleListingId: "role_leak" })).toBe(
      false,
    );
    expect(
      validateFeedbackPacket.Check({
        ...feedbackPacket,
        rawToken: "secret",
      }),
    ).toBe(false);

    expect(
      validateSchedulerState.Check({
        stateVersion: 1,
        conversationId: "conversation_123",
        mode: "developer",
        status: "running_role",
        updatedAt: "2026-06-01T03:00:00.000Z",
        currentTask: {
          taskId: "task_123",
          title: "生成商品图检查岗位",
          status: "running",
        },
        queue: [],
        waitingConfirmations: [],
        runningRoles: [
          {
            packageId: "pkg_customer_support",
            packageVersion: "1.0.0",
            executionId: "exec_123",
            status: "running",
            startedAt: "2026-06-01T03:00:00.000Z",
          },
        ],
        riskGates: [],
        costSummary: {
          inputTokens: 100,
          outputTokens: 50,
          estimatedCents: 1,
          currency: "CNY",
        },
        nextActions: ["等待岗位反馈资料包"],
      }),
    ).toBe(true);

    expect(
      validateCapabilityProfile.Check({
        profileVersion: 1,
        packageId: "pkg_customer_support",
        packageVersion: "1.0.0",
        roleListingId: "role_customer_support_agent",
        updatedAt: "2026-06-01T03:05:00.000Z",
        overallScore: 82,
        capabilities: [{ name: "role_package_generation", score: 90, evidenceCount: 1 }],
        failureModes: [],
        dispatchHints: ["适合生成公开岗位包"],
        evaluatorAdapters: {
          agentevals: "planned",
          deepeval: "planned",
          dspy: "planned",
          mem0: "planned",
        },
      }),
    ).toBe(true);

    expect(
      validateMemoryCandidate.Check({
        candidateVersion: 1,
        candidateId: "memory_exec_123",
        source: "scheduler_summary",
        createdAt: "2026-06-01T03:05:00.000Z",
        riskLevel: "low",
        text: "该岗位包的 manifest 校验已通过。",
        evidenceRefs: ["packet_exec_123"],
        status: "pending",
        executionId: "exec_123",
        packageId: "pkg_customer_support",
      }),
    ).toBe(true);

    expect(
      validateEvolutionCandidate.Check({
        candidateVersion: 1,
        candidateId: "evolution_exec_123",
        target: "role_improvement",
        createdAt: "2026-06-01T03:05:00.000Z",
        summary: "补充失败样例。",
        rationale: "当前 smoke 只覆盖成功路径。",
        evidenceRefs: ["packet_exec_123"],
        status: "pending",
        packageId: "pkg_customer_support",
        executionId: "exec_123",
      }),
    ).toBe(true);
  });

  it("exports Dijie schemas through the protocol registry", () => {
    expect(ProtocolSchemas.DijieExecutionTokenRequest).toBe(DijieExecutionTokenRequestSchema);
    expect(ProtocolSchemas.DijieRoleFeedbackPacket).toBe(DijieRoleFeedbackPacketSchema);
    expect(ProtocolSchemas.DijieSchedulerState).toBe(DijieSchedulerStateSchema);
    expect(ProtocolSchemas.DijieRoleCapabilityProfile).toBe(DijieRoleCapabilityProfileSchema);
    expect(ProtocolSchemas.DijieMemoryCandidate).toBe(DijieMemoryCandidateSchema);
    expect(ProtocolSchemas.DijieEvolutionCandidate).toBe(DijieEvolutionCandidateSchema);
    expect(ProtocolSchemas.DijieAuditSummary).toBe(DijieAuditSummarySchema);
  });
});
