import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { runExternalCommand } from "@/server/externalCommand";
import { commandLabel, ensureArtifactInputs, getStringOpt, hasFlag, ireeCompileCommandCandidates, makeDemoArtifacts, parseArgs } from "./external-utils";

async function fileSizeStrict(file: string, label: string): Promise<number> {
  let s: Awaited<ReturnType<typeof stat>>;
  try { s = await stat(file); } catch { throw new Error(`${label} 파일이 생성되지 않았습니다: ${file}`); }
  if (!s.isFile()) throw new Error(`${label} 경로가 파일이 아닙니다: ${file}`);
  if (s.size <= 0 && process.env.TILEFORGE_ALLOW_EMPTY_VMFB !== "1") throw new Error(`${label} 파일이 0 bytes입니다: ${file}`);
  return s.size;
}

async function listFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter(e => e.isFile()).map(e => e.name).sort();
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const artifactDir = path.resolve(getStringOpt(opts, "artifact", path.join(".tileforge", "external", "artifact")));
  const outDir = path.resolve(getStringOpt(opts, "out", path.join(artifactDir, "iree")));
  const requireExternal = hasFlag(opts, "require-external");
  const timeoutMs = Number(getStringOpt(opts, "timeout-ms", "120000"));
  const preferredCommand = getStringOpt(opts, "cmd", process.env.TILEFORGE_IREE_COMPILE_CMD ?? "");
  const commands = ireeCompileCommandCandidates(preferredCommand);

  const withTransform = hasFlag(opts, "with-transform");
  const required = withTransform ? ["generated.mlir", "transform.mlir"] : ["generated.mlir"];
  const artifactPrep = await ensureArtifactInputs(artifactDir, required, {
    demoMode: hasFlag(opts, "smoke") ? "smoke" : "default",
    forceDemo: hasFlag(opts, "demo"),
    allowDemoIfMissing: !hasFlag(opts, "no-demo"),
  });
  if (artifactPrep.createdDemo) {
    console.log(`demo artifact 생성: ${artifactDir} (missing: ${artifactPrep.missingBefore.join(", ") || "forced"})`);
  }
  await mkdir(outDir, { recursive: true });

  const inputMlir = path.join(artifactDir, "generated.mlir");
  const transform = path.join(artifactDir, "transform.mlir");
  const vmfb = path.join(outDir, "model.vmfb");
  const args = [inputMlir, "--iree-hal-target-backends=llvm-cpu", "--iree-llvmcpu-target-cpu=host", "-o", vmfb];
  if (withTransform) args.splice(args.length - 2, 0, `--iree-codegen-transform-dialect-library=${transform}`);

  const errors: Array<{ command: string; message: string }> = [];
  for (const command of commands) {
    const logPath = path.join(outDir, `iree-compile-${commandLabel(command).replace(/[^a-zA-Z0-9_.-]+/g, "_")}.log`);
    try {
      const startedAt = Date.now();
      await runExternalCommand(command, args, {
        cwd: process.cwd(),
        timeoutMs,
        logPath,
        env: { TILEFORGE_MOCK_VMFB: vmfb }
      });
      const elapsedMs = Date.now() - startedAt;
      const vmfbBytes = await fileSizeStrict(vmfb, "IREE VMFB");
      const summary = {
        ok: true,
        skipped: false,
        command: commandLabel(command),
        triedCommands: commands.map(commandLabel),
        artifactDir,
        outDir,
        elapsedMs,
        inputMlir,
        vmfb,
        vmfbBytes,
        withTransform
      };
      await writeFile(path.join(outDir, "iree_summary.json"), JSON.stringify(summary, null, 2), "utf8");
      console.log(`IREE compile 완료 (${commandLabel(command)}): ${vmfb}`);
      console.log(`VMFB size: ${summary.vmfbBytes} bytes`);
      return;
    } catch (error) {
      const files = await listFiles(outDir);
      errors.push({ command: commandLabel(command), message: `${error instanceof Error ? error.message : String(error)}; files under output: ${files.length ? files.join(", ") : "(none)"}` });
    }
  }

  const message = errors.map(e => `${e.command}: ${e.message}`).join("\n");
  const summary = {
    ok: false,
    skipped: !requireExternal,
    command: commands.map(commandLabel).join(" | "),
    triedCommands: commands.map(commandLabel),
    artifactDir,
    outDir,
    inputMlir,
    error: message,
    withTransform,
    installHint: "npm run setup:iree"
  };
  await writeFile(path.join(outDir, "iree_summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(`${requireExternal ? "IREE compile 실패" : "IREE compile 건너뜀"}: ${message}`);
  if (requireExternal) process.exit(1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
