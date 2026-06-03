import { Type } from "typebox";
import { NonEmptyString } from "./primitives.js";

const TimestampSchema = Type.Union([Type.String(), Type.Integer({ minimum: 0 })]);

const DijieExecutionStatusSchema = Type.Union([
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
  Type.Literal("timed_out"),
]);

const DijieRoleArtifactSchema = Type.Object(
  {
    id: NonEmptyString,
    type: NonEmptyString,
    title: NonEmptyString,
    sizeBytes: Type.Optional(Type.Integer({ minimum: 0 })),
    sha256: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

const DijieToolUsageSchema = Type.Object(
  {
    shellCommands: Type.Integer({ minimum: 0 }),
    testsRun: Type.Integer({ minimum: 0 }),
    filesRead: Type.Integer({ minimum: 0 }),
    filesChanged: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

const DijieRiskLevelSchema = Type.Union([
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("critical"),
]);

export const DijieOneTimeAuthorizationPricingSchema = Type.Object(
  {
    kind: Type.Literal("one_time_authorization"),
    authorizationFeeCents: Type.Integer({ minimum: 0 }),
    currency: NonEmptyString,
    platformFeeBps: Type.Literal(0),
    developerReceivableCents: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const DijieRoleTokenPricingSchema = Type.Object(
  {
    inputTokenCentsPerMillion: Type.Integer({ minimum: 0 }),
    outputTokenCentsPerMillion: Type.Integer({ minimum: 0 }),
    currency: NonEmptyString,
    developerReceivableBps: Type.Literal(10000),
    platformFeeBps: Type.Literal(0),
  },
  { additionalProperties: false },
);

export const DijieModelProxyUsageSchema = Type.Object(
  {
    requestCount: Type.Integer({ minimum: 0 }),
    inputTokens: Type.Integer({ minimum: 0 }),
    outputTokens: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const DijieDeviceBindRequestSchema = Type.Object(
  {
    deviceId: NonEmptyString,
    publicKey: NonEmptyString,
    displayName: Type.Optional(NonEmptyString),
    platform: Type.Optional(NonEmptyString),
    workspaceRef: Type.Optional(NonEmptyString),
    nonce: NonEmptyString,
    signedAt: Type.Integer({ minimum: 0 }),
    signature: NonEmptyString,
  },
  { additionalProperties: false },
);

export const DijieDeviceBindResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    deviceId: NonEmptyString,
    cloudActorId: Type.Optional(NonEmptyString),
    deviceToken: Type.Optional(NonEmptyString),
    expiresAt: Type.Optional(TimestampSchema),
    error: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const DijieExecutionTokenRequestSchema = Type.Object(
  {
    roleListingId: NonEmptyString,
    entitlementId: NonEmptyString,
    deviceId: NonEmptyString,
    workspaceRef: NonEmptyString,
    localGatewayId: NonEmptyString,
    requestedBy: Type.Object(
      {
        actorId: NonEmptyString,
        actorType: Type.Union([
          Type.Literal("customer"),
          Type.Literal("member"),
          Type.Literal("admin"),
        ]),
      },
      { additionalProperties: false },
    ),
    intent: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const DijieExecutionGrantSchema = Type.Object(
  {
    executionId: NonEmptyString,
    roleListingId: NonEmptyString,
    packageId: NonEmptyString,
    packageVersion: NonEmptyString,
    developerRef: NonEmptyString,
    listingOwnerRef: NonEmptyString,
    billingBeneficiaryRef: NonEmptyString,
    entitlementId: NonEmptyString,
    deviceId: NonEmptyString,
    workspaceRef: NonEmptyString,
    localGatewayId: NonEmptyString,
    token: NonEmptyString,
    issuedAt: TimestampSchema,
    expiresAt: TimestampSchema,
    pricing: DijieOneTimeAuthorizationPricingSchema,
    roleTokenPricing: DijieRoleTokenPricingSchema,
    scopes: Type.Array(NonEmptyString),
  },
  { additionalProperties: false },
);

export const DijieExecutionTokenResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    grant: Type.Optional(DijieExecutionGrantSchema),
    error: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const DijieRolePackageManifestSchema = Type.Object(
  {
    manifestVersion: Type.Literal(1),
    rolePackageId: NonEmptyString,
    version: NonEmptyString,
    name: NonEmptyString,
    entrypoint: NonEmptyString,
    permissions: Type.Array(NonEmptyString),
    files: Type.Array(
      Type.Object(
        {
          path: NonEmptyString,
          sha256: NonEmptyString,
          sizeBytes: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const DijieRoleResultSchema = Type.Object(
  {
    executionId: NonEmptyString,
    roleListingId: NonEmptyString,
    packageId: NonEmptyString,
    packageVersion: NonEmptyString,
    developerRef: NonEmptyString,
    listingOwnerRef: NonEmptyString,
    billingBeneficiaryRef: NonEmptyString,
    status: DijieExecutionStatusSchema,
    startedAt: TimestampSchema,
    endedAt: TimestampSchema,
    roleTokenPricing: DijieRoleTokenPricingSchema,
    modelProxyUsage: DijieModelProxyUsageSchema,
    summary: Type.Optional(Type.String()),
    changedFiles: Type.Array(NonEmptyString),
    artifacts: Type.Array(DijieRoleArtifactSchema),
    error: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const DijieRoleFeedbackPacketSchema = Type.Object(
  {
    packetVersion: Type.Literal(1),
    packetId: NonEmptyString,
    mode: Type.Union([Type.Literal("developer_package"), Type.Literal("authorized_execution")]),
    producedAt: TimestampSchema,
    role: Type.Object(
      {
        packageId: NonEmptyString,
        packageVersion: NonEmptyString,
        roleListingId: Type.Optional(NonEmptyString),
        developerRef: Type.Optional(NonEmptyString),
      },
      { additionalProperties: false },
    ),
    schedulerContext: Type.Object(
      {
        schedulerRunId: Type.Optional(NonEmptyString),
        executionId: Type.Optional(NonEmptyString),
        entitlementId: Type.Optional(NonEmptyString),
        deviceId: Type.Optional(NonEmptyString),
        workspaceRef: Type.Optional(NonEmptyString),
        localGatewayId: Type.Optional(NonEmptyString),
      },
      { additionalProperties: false },
    ),
    status: DijieExecutionStatusSchema,
    startedAt: TimestampSchema,
    endedAt: TimestampSchema,
    summary: Type.Optional(Type.String()),
    changedFiles: Type.Array(NonEmptyString),
    artifacts: Type.Array(DijieRoleArtifactSchema),
    toolUsage: DijieToolUsageSchema,
    modelProxyUsage: Type.Optional(DijieModelProxyUsageSchema),
    costUsage: Type.Optional(
      Type.Object(
        {
          inputTokens: Type.Integer({ minimum: 0 }),
          outputTokens: Type.Integer({ minimum: 0 }),
          currency: Type.Optional(NonEmptyString),
          estimatedCents: Type.Optional(Type.Integer({ minimum: 0 })),
        },
        { additionalProperties: false },
      ),
    ),
    riskEvents: Type.Array(
      Type.Object(
        {
          level: DijieRiskLevelSchema,
          category: NonEmptyString,
          summary: NonEmptyString,
          requiresHumanConfirmation: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
    ),
    evolutionSuggestions: Type.Array(
      Type.Object(
        {
          target: Type.Union([
            Type.Literal("capability_rubric"),
            Type.Literal("failure_mode_library"),
            Type.Literal("test_example_library"),
            Type.Literal("dispatch_strategy"),
            Type.Literal("role_package"),
          ]),
          summary: NonEmptyString,
          evidenceRefs: Type.Array(NonEmptyString),
        },
        { additionalProperties: false },
      ),
    ),
    error: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const DijieSchedulerStateSchema = Type.Object(
  {
    stateVersion: Type.Literal(1),
    conversationId: NonEmptyString,
    mode: Type.Union([Type.Literal("user"), Type.Literal("developer")]),
    status: Type.Union([
      Type.Literal("idle"),
      Type.Literal("planning"),
      Type.Literal("waiting_for_confirmation"),
      Type.Literal("running_role"),
      Type.Literal("evaluating"),
      Type.Literal("persisting"),
      Type.Literal("failed"),
    ]),
    updatedAt: TimestampSchema,
    currentTask: Type.Optional(
      Type.Object(
        {
          taskId: NonEmptyString,
          title: NonEmptyString,
          status: NonEmptyString,
        },
        { additionalProperties: false },
      ),
    ),
    queue: Type.Array(
      Type.Object(
        {
          taskId: NonEmptyString,
          title: NonEmptyString,
          status: NonEmptyString,
        },
        { additionalProperties: false },
      ),
    ),
    waitingConfirmations: Type.Array(
      Type.Object(
        {
          confirmationId: NonEmptyString,
          summary: NonEmptyString,
          riskLevel: DijieRiskLevelSchema,
        },
        { additionalProperties: false },
      ),
    ),
    runningRoles: Type.Array(
      Type.Object(
        {
          packageId: NonEmptyString,
          packageVersion: NonEmptyString,
          executionId: Type.Optional(NonEmptyString),
          status: NonEmptyString,
          startedAt: TimestampSchema,
        },
        { additionalProperties: false },
      ),
    ),
    riskGates: Type.Array(
      Type.Object(
        {
          gateId: NonEmptyString,
          summary: NonEmptyString,
          riskLevel: DijieRiskLevelSchema,
          status: Type.Union([
            Type.Literal("open"),
            Type.Literal("approved"),
            Type.Literal("rejected"),
            Type.Literal("resolved"),
          ]),
        },
        { additionalProperties: false },
      ),
    ),
    costSummary: Type.Object(
      {
        inputTokens: Type.Integer({ minimum: 0 }),
        outputTokens: Type.Integer({ minimum: 0 }),
        estimatedCents: Type.Integer({ minimum: 0 }),
        currency: NonEmptyString,
      },
      { additionalProperties: false },
    ),
    nextActions: Type.Array(NonEmptyString),
  },
  { additionalProperties: false },
);

export const DijieRoleCapabilityProfileSchema = Type.Object(
  {
    profileVersion: Type.Literal(1),
    packageId: NonEmptyString,
    packageVersion: NonEmptyString,
    roleListingId: Type.Optional(NonEmptyString),
    updatedAt: TimestampSchema,
    overallScore: Type.Integer({ minimum: 0, maximum: 100 }),
    capabilities: Type.Array(
      Type.Object(
        {
          name: NonEmptyString,
          score: Type.Integer({ minimum: 0, maximum: 100 }),
          evidenceCount: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
    ),
    failureModes: Type.Array(
      Type.Object(
        {
          code: NonEmptyString,
          summary: NonEmptyString,
          occurrences: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
    ),
    dispatchHints: Type.Array(NonEmptyString),
    evaluatorAdapters: Type.Object(
      {
        agentevals: Type.Union([
          Type.Literal("planned"),
          Type.Literal("not_configured"),
          Type.Literal("enabled"),
        ]),
        deepeval: Type.Union([
          Type.Literal("planned"),
          Type.Literal("not_configured"),
          Type.Literal("enabled"),
        ]),
        dspy: Type.Union([
          Type.Literal("planned"),
          Type.Literal("not_configured"),
          Type.Literal("enabled"),
        ]),
        mem0: Type.Union([
          Type.Literal("planned"),
          Type.Literal("not_configured"),
          Type.Literal("enabled"),
        ]),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const DijieMemoryCandidateSchema = Type.Object(
  {
    candidateVersion: Type.Literal(1),
    candidateId: NonEmptyString,
    source: Type.Union([
      Type.Literal("scheduler_summary"),
      Type.Literal("role_feedback_packet"),
      Type.Literal("human_confirmation"),
    ]),
    createdAt: TimestampSchema,
    riskLevel: DijieRiskLevelSchema,
    text: NonEmptyString,
    evidenceRefs: Type.Array(NonEmptyString),
    status: Type.Union([
      Type.Literal("pending"),
      Type.Literal("auto_approved"),
      Type.Literal("approved"),
      Type.Literal("rejected"),
      Type.Literal("archived"),
    ]),
    executionId: Type.Optional(NonEmptyString),
    packageId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const DijieEvolutionCandidateSchema = Type.Object(
  {
    candidateVersion: Type.Literal(1),
    candidateId: NonEmptyString,
    target: Type.Union([
      Type.Literal("capability_rubric"),
      Type.Literal("failure_mode_library"),
      Type.Literal("test_example_library"),
      Type.Literal("dispatch_strategy"),
      Type.Literal("role_improvement"),
      Type.Literal("judge_prompt"),
      Type.Literal("few_shot"),
    ]),
    createdAt: TimestampSchema,
    summary: NonEmptyString,
    rationale: NonEmptyString,
    evidenceRefs: Type.Array(NonEmptyString),
    status: Type.Union([
      Type.Literal("pending"),
      Type.Literal("approved"),
      Type.Literal("rejected"),
      Type.Literal("applied"),
    ]),
    packageId: Type.Optional(NonEmptyString),
    executionId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const DijieAuditSummarySchema = Type.Object(
  {
    executionId: NonEmptyString,
    deviceId: NonEmptyString,
    workspaceRef: NonEmptyString,
    roleListingId: NonEmptyString,
    packageId: NonEmptyString,
    packageVersion: NonEmptyString,
    developerRef: NonEmptyString,
    listingOwnerRef: NonEmptyString,
    billingBeneficiaryRef: NonEmptyString,
    entitlementId: NonEmptyString,
    localGatewayId: NonEmptyString,
    status: DijieExecutionStatusSchema,
    startedAt: TimestampSchema,
    endedAt: TimestampSchema,
    roleTokenPricing: DijieRoleTokenPricingSchema,
    modelProxyUsage: DijieModelProxyUsageSchema,
    toolUsage: DijieToolUsageSchema,
    result: DijieRoleResultSchema,
  },
  { additionalProperties: false },
);
