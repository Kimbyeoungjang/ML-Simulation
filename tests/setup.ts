import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll } from "vitest";

let root: string | undefined;
let oldWorkspace: string | undefined;
let oldJobRoot: string | undefined;

beforeAll(async () => {
  oldWorkspace = process.env.TILEFORGE_WORKSPACE_ROOT;
  oldJobRoot = process.env.TILEFORGE_JOB_ROOT;
  root = await mkdtemp(path.join(os.tmpdir(), "tileforge-test-"));
  process.env.TILEFORGE_WORKSPACE_ROOT = path.join(root, "workspace");
  process.env.TILEFORGE_JOB_ROOT = path.join(root, "jobs");
});

afterAll(async () => {
  if (oldWorkspace === undefined) delete process.env.TILEFORGE_WORKSPACE_ROOT;
  else process.env.TILEFORGE_WORKSPACE_ROOT = oldWorkspace;
  if (oldJobRoot === undefined) delete process.env.TILEFORGE_JOB_ROOT;
  else process.env.TILEFORGE_JOB_ROOT = oldJobRoot;
  if (root) await rm(root, { recursive: true, force: true });
});
