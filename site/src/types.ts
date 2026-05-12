export type ArmoryKind = "extension" | "skill" | "persona" | "tone" | "agent";

export type ArmoryItem = {
  kind: ArmoryKind;
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  sourcePath: string;
  sourceUrl: string;
  installCommand: string;
  verifyCommand?: string;
  ociRef?: string;
  artifactType?: string;
  payloadDigest?: string;
  manifestId?: string;
  license?: string;
  minOmegon?: string;
  files: string[];
};
