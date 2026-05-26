import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { commandLabel, csvRows, getStringOpt, hasFlag, ensureArtifactInputs, makeDemoArtifacts, numberFromRow, parseArgs, runScaleSimUntilReport, scaleSimArgs, scaleSimCommandCandidates } from "./external-utils";

async function main(): Promise<void> {
  const opts = parseArgs();
  const artifactDir = path.resolve(getStringOpt(opts, "artifact", path.join(".tileforge", "external", "artifact")));
  const outDir = path.resolve(getStringOpt(opts, "out", path.join(artifactDir, "scalesim")));
  const requireExternal = hasFlag(opts, "require-external");
  const timeoutMs = Number(getStringOpt(opts, "timeout-ms", "120000"));
  const preferredCommand = getStringOpt(opts, "cmd", process.env.TILEFORGE_SCALE_SIM_CMD ?? "");
  const commands = scaleSimCommandCandidates(preferredCommand);

  const useTopK = hasFlag(opts, "top-k");
  const required = useTopK ? ["scalesim.cfg", "topology_top3.csv"] : ["scalesim.cfg", "topology.csv"];
  const demoMode = hasFlag(opts, "full") ? "default" : "smoke";
  const artifactPrep = await ensureArtifactInputs(artifactDir, required, {
    demoMode,
    forceDemo: hasFlag(opts, "demo"),
    allowDemoIfMissing: !hasFlag(opts, "no-demo"),
  });
  if (artifactPrep.createdDemo) {
    console.log(`demo artifact 생성: ${artifactDir} (missing: ${artifactPrep.missingBefore.join(", ") || "forced"})`);
  }
  await mkdir(outDir, { recursive: true });

  const cfg = path.join(artifactDir, "scalesim.cfg");
  const topology = path.join(artifactDir, useTopK ? "topology_top3.csv" : "topology.csv");
  const layout = path.join(artifactDir, useTopK ? "layout_top3.csv" : "layout.csv");
  try {
    const startedAt = Date.now();
    const run = await runScaleSimUntilReport(commands, scaleSimArgs({ config: cfg, topology, layout, outDir }), outDir, (command: string) => ({
      cwd: outDir,
      timeoutMs,
      logPath: path.join(outDir, `scalesim-${commandLabel(command).replace(/[^a-zA-Z0-9_.-]+/g, "_")}.log`),
      env: { TILEFORGE_MOCK_OUTPUT_DIR: outDir }
    }));
    const command = run.command;
    const elapsedMs = Date.now() - startedAt;
    const computeReport = run.computeReport;
    const rows = csvRows(await readFile(computeReport, "utf8"));
    const totalCycles = rows.reduce((sum, row) => sum + (numberFromRow(row, ["Cycles", "Total Cycles", "Total cycles", "Compute cycles"]) ?? 0), 0);
    const summary = {
      ok: true,
      skipped: false,
      command: commandLabel(command),
      triedCommands: commands.map(commandLabel),
      artifactDir,
      outDir,
      elapsedMs,
      computeReport,
      layerCount: rows.length,
      totalCycles
    };
    await writeFile(path.join(outDir, "scalesim_summary.json"), JSON.stringify(summary, null, 2), "utf8");
    console.log(`SCALE-Sim 완료: ${computeReport}`);
    console.log(`파싱된 SCALE-Sim 전체 사이클: ${totalCycles}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const summary = { ok: false, skipped: !requireExternal, command: commands.map(commandLabel).join(" | "), triedCommands: commands.map(commandLabel), artifactDir, outDir, error: message };
    await writeFile(path.join(outDir, "scalesim_summary.json"), JSON.stringify(summary, null, 2), "utf8");
    console.log(`${requireExternal ? "SCALE-Sim 실패" : "SCALE-Sim 건너뜀"}: ${message}`);
    if (requireExternal) process.exit(1);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
