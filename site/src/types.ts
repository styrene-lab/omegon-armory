export type ArmoryDistribution = "oci" | "registry" | "external";

export type ArmoryKind = "extension" | "skill" | "persona" | "tone" | "agent" | "profile" | "forge-template";

export type ArmoryCompatibilityMode = {
  runtime: string;
  mode: string;
  installCommand?: string;
  entrypoints?: string[];
};

export type ArmoryCompatibility = {
  tier: number;
  native: ArmoryCompatibilityMode[];
  degraded: ArmoryCompatibilityMode[];
  notes: string[];
};

export type ArmoryInterface = {
  status: "supported" | "planned" | "none" | string;
  install?: string;
  binary?: string;
  commands?: string[];
  tools?: string[];
  transport?: string;
  [key: string]: unknown;
};

export type ArmoryInterfaces = {
  omegon?: ArmoryInterface;
  mcp?: ArmoryInterface;
  cli?: ArmoryInterface;
  oci?: ArmoryInterface;
};

export type ArmoryItem = {
  kind: ArmoryKind;
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  sourcePath: string;
  sourceUrl: string;
  repositoryUrl: string;
  homepageUrl: string;
  armoryUrl: string;
  installCommand: string;
  installNote: string;
  verifyCommand?: string;
  ociRef?: string;
  artifactType?: string;
  payloadDigest?: string;
  manifestId?: string;
  license?: string;
  minOmegon?: string;
  minNex?: string;
  canonicalFormat?: string;
  destructiveCapabilities?: string[];
  networkRequirements?: string[];
  publisher: string;
  official: boolean;
  capabilities: string[];
  keywords: string[];
  files: string[];
  dependencies: ArmoryDependency[];
  compatibility: ArmoryCompatibility;
  interfaces?: ArmoryInterfaces;
  distribution: ArmoryDistribution;
};

export type ArmoryDependencyCompatibility = {
  tier: number;
  mode: string;
  nativeOnly?: boolean;
};

export type ArmoryDependency = {
  kind: ArmoryKind;
  id: string;
  version?: string;
  required: boolean;
  enabled?: boolean;
  installCommand?: string;
  compatibility?: ArmoryDependencyCompatibility;
};

export type ArmoryData = {
  generatedAt: string;
  items: ArmoryItem[];
  registry: string;
};
