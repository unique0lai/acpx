import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const BUN_EXECUTABLE = process.env.BUN_EXEC_PATH ?? "bun";
const CLI_PATH = path.resolve(process.cwd(), "dist", "cli.js");
const MOCK_AGENT_PATH = path.resolve(process.cwd(), "dist-test", "test", "mock-agent.js");

function hasBunRuntime(): boolean {
  return spawnSync(BUN_EXECUTABLE, ["--version"], { encoding: "utf8" }).status === 0;
}

function quoteCommandArg(value: string): string {
  return JSON.stringify(value);
}

function runBunCli(args: string[], homeDir: string, cwd: string) {
  return spawnSync(BUN_EXECUTABLE, [CLI_PATH, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
    },
    timeout: 20_000,
  });
}

test("Bun runs the packaged CLI, TypeScript flows, ACP stdio, and queue owner", async (t) => {
  if (!hasBunRuntime()) {
    t.skip("Bun runtime is not installed");
    return;
  }

  const tempDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "acpx-bun-runtime-")));
  const homeDir = path.join(tempDir, "home");
  const cwd = path.join(tempDir, "cwd");
  await fs.mkdir(homeDir);
  await fs.mkdir(cwd);
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const version = runBunCli(["--version"], homeDir, cwd);
  assert.equal(version.status, 0, version.stderr);

  const flowPath = path.join(tempDir, "bun-smoke.flow.ts");
  await fs.writeFile(
    flowPath,
    [
      'import { compute, defineFlow } from "acpx/flows";',
      "",
      "export default defineFlow({",
      '  name: "bun-smoke",',
      '  startAt: "done",',
      "  nodes: { done: compute({ run: () => ({ ok: true }) }) },",
      "  edges: [],",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );

  const flow = runBunCli(["--format", "json", "flow", "run", flowPath], homeDir, cwd);
  assert.equal(flow.status, 0, flow.stderr || flow.stdout);
  const flowResult = JSON.parse(flow.stdout.trim()) as {
    status?: string;
    outputs?: { done?: { ok?: boolean } };
  };
  assert.equal(flowResult.status, "completed");
  assert.equal(flowResult.outputs?.done?.ok, true);

  const agentCommand = `${quoteCommandArg(BUN_EXECUTABLE)} ${quoteCommandArg(MOCK_AGENT_PATH)}`;
  const oneShot = runBunCli(
    ["--agent", agentCommand, "--format", "quiet", "exec", "echo bun-stdio"],
    homeDir,
    cwd,
  );
  assert.equal(oneShot.status, 0, oneShot.stderr || oneShot.stdout);
  assert.equal(oneShot.stdout.trim(), "bun-stdio");

  const session = runBunCli(
    ["--agent", agentCommand, "--format", "quiet", "sessions", "new"],
    homeDir,
    cwd,
  );
  assert.equal(session.status, 0, session.stderr || session.stdout);

  const queued = runBunCli(
    ["--agent", agentCommand, "--ttl", "0", "--format", "quiet", "echo bun-queue"],
    homeDir,
    cwd,
  );
  assert.equal(queued.status, 0, queued.stderr || queued.stdout);
  assert.equal(queued.stdout.trim(), "bun-queue");
});
