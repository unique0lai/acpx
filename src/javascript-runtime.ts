export type JavaScriptRuntime = "bun" | "node";

export function detectJavaScriptRuntime(
  versions: NodeJS.ProcessVersions = process.versions,
): JavaScriptRuntime {
  return "bun" in versions ? "bun" : "node";
}
