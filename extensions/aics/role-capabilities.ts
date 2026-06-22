export type AicsRoleCapabilityGroupId =
  | "workspace"
  | "code"
  | "browser"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "image"
  | "network"
  | "audit"
  | "human";

export type AicsRoleCapabilityDefinition = {
  id: string;
  label: string;
  groupId: AicsRoleCapabilityGroupId;
  openClawTools: string[];
  policyGates: string[];
};

export type AicsRoleCapabilityResolution = {
  capability: string;
  supported: boolean;
  label?: string;
  groupId?: AicsRoleCapabilityGroupId;
  openClawTools: string[];
  policyGates: string[];
  supportSource?: "catalog" | "openclaw-tool-protocol" | "policy-gate";
  missingReason?: string;
};

export type AicsRoleCapabilityValidation = {
  required: string[];
  resolved: AicsRoleCapabilityResolution[];
  missing: AicsRoleCapabilityResolution[];
};

export type AicsRoleCapabilityResolutionOptions = {
  effectiveToolNames?: readonly string[];
};

export const AICS_ROLE_CAPABILITY_GROUPS: Array<{
  id: AicsRoleCapabilityGroupId;
  label: string;
}> = [
  { id: "workspace", label: "Workspace" },
  { id: "code", label: "Code execution" },
  { id: "browser", label: "Browser" },
  { id: "document", label: "Documents" },
  { id: "spreadsheet", label: "Spreadsheets" },
  { id: "presentation", label: "Presentations" },
  { id: "image", label: "Image and vision" },
  { id: "network", label: "Network and API" },
  { id: "audit", label: "Audit" },
  { id: "human", label: "Human confirmation" },
];

export const AICS_ROLE_CAPABILITY_CATALOG: AicsRoleCapabilityDefinition[] = [
  {
    id: "workspace.read",
    label: "Read workspace files",
    groupId: "workspace",
    openClawTools: ["read"],
    policyGates: [],
  },
  {
    id: "workspace.write",
    label: "Write workspace files",
    groupId: "workspace",
    openClawTools: ["write", "edit", "apply_patch"],
    policyGates: ["filesystem.workspace-write"],
  },
  {
    id: "code.execute",
    label: "Run local commands or code",
    groupId: "code",
    openClawTools: ["exec", "code_execution"],
    policyGates: ["execution.approval-policy"],
  },
  {
    id: "code.test",
    label: "Run local checks and tests",
    groupId: "code",
    openClawTools: ["exec"],
    policyGates: ["execution.approval-policy"],
  },
  {
    id: "browser.use",
    label: "Use a local browser",
    groupId: "browser",
    openClawTools: ["browser"],
    policyGates: ["browser.local-session-policy"],
  },
  {
    id: "document.write",
    label: "Create or update documents",
    groupId: "document",
    openClawTools: ["write", "edit"],
    policyGates: ["filesystem.workspace-write"],
  },
  {
    id: "spreadsheet.write",
    label: "Create or update spreadsheets",
    groupId: "spreadsheet",
    openClawTools: ["write", "edit"],
    policyGates: ["filesystem.workspace-write"],
  },
  {
    id: "presentation.write",
    label: "Create or update presentations",
    groupId: "presentation",
    openClawTools: ["write", "edit"],
    policyGates: ["filesystem.workspace-write"],
  },
  {
    id: "image.inspect",
    label: "Inspect image content",
    groupId: "image",
    openClawTools: ["image"],
    policyGates: [],
  },
  {
    id: "image.generate",
    label: "Generate image assets",
    groupId: "image",
    openClawTools: ["image_generate"],
    policyGates: ["media.provider-policy"],
  },
  {
    id: "network.fetch",
    label: "Fetch web or API content",
    groupId: "network",
    openClawTools: ["web_fetch"],
    policyGates: ["network.policy"],
  },
  {
    id: "network.search",
    label: "Search public web content",
    groupId: "network",
    openClawTools: ["web_search"],
    policyGates: ["network.policy"],
  },
  {
    id: "audit.record",
    label: "Record sanitized audit evidence",
    groupId: "audit",
    openClawTools: [],
    policyGates: ["audit.sanitized-summary"],
  },
  {
    id: "human.confirm",
    label: "Ask for human confirmation",
    groupId: "human",
    openClawTools: [],
    policyGates: ["approval.required"],
  },
];

const ROLE_CAPABILITY_BY_ID = new Map(
  AICS_ROLE_CAPABILITY_CATALOG.map((capability) => [capability.id, capability]),
);

export function resolveAicsRoleRequiredCapabilities(
  capabilities: readonly string[],
  options: AicsRoleCapabilityResolutionOptions = {},
): AicsRoleCapabilityValidation {
  const required = Array.from(
    new Set(capabilities.map((capability) => capability.trim()).filter(Boolean)),
  );
  const effectiveTools =
    options.effectiveToolNames === undefined
      ? undefined
      : new Set(options.effectiveToolNames.map((name) => name.trim()).filter(Boolean));
  const resolved = required.map((capability): AicsRoleCapabilityResolution => {
    const definition = ROLE_CAPABILITY_BY_ID.get(capability);
    if (!definition) {
      return {
        capability,
        supported: false,
        openClawTools: [],
        policyGates: [],
        missingReason:
          "No OpenClaw tool protocol bridge or policy gate is registered for this capability.",
      };
    }
    const matchingTool =
      effectiveTools === undefined
        ? undefined
        : definition.openClawTools.find((toolName) => effectiveTools.has(toolName));
    const hasToolSupport =
      effectiveTools === undefined ||
      definition.openClawTools.length === 0 ||
      matchingTool !== undefined;
    const supported = hasToolSupport;
    const supportSource =
      matchingTool !== undefined
        ? "openclaw-tool-protocol"
        : definition.openClawTools.length === 0 && definition.policyGates.length > 0
          ? "policy-gate"
          : "catalog";

    return {
      capability,
      supported,
      label: definition.label,
      groupId: definition.groupId,
      openClawTools: [...definition.openClawTools],
      policyGates: [...definition.policyGates],
      supportSource,
      ...(supported
        ? {}
        : {
            missingReason:
              "Required OpenClaw tool protocol entries are not present in tools.effective for this capability.",
          }),
    };
  });
  return {
    required,
    resolved,
    missing: resolved.filter((capability) => !capability.supported),
  };
}
