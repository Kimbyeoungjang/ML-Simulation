import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { runExternalCommand } from "@/server/externalCommand";
import { commandLabel, csvRows, formatCandidateErrors, getStringOpt, hasFlag, ireeCompileCommandCandidates, makeDemoArtifacts, numberFromRow, parseArgs, runScaleSimUntilReport, scaleSimArgs, scaleSimCommandCandidates } from "./external-utils";

async function fileSizeStrict(file: string, label: string): Promise<number> {
  let s: Awaited<ReturnType<typeof stat>>;
  try {
    s = await stat(file);
  } catch {
    throw new Error(`${label} 파일이 생성되지 않았습니다: ${file}`);
  }
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
  const root = path.resolve(getStringOpt(opts, "out", path.join(".tileforge", "external-validation")));
  const artifactDir = path.join(root, "artifact");
  const scaleDir = path.join(root, "scalesim");
  const ireeDir = path.join(root, "iree");
  const requireExternal = hasFlag(opts, "require-external");
  const timeoutMs = Number(getStringOpt(opts, "timeout-ms", "120000"));
  const preferredScaleCmd = getStringOpt(opts, "scalesim-cmd", process.env.TILEFORGE_SCALE_SIM_CMD ?? "");
  const scaleCommands = scaleSimCommandCandidates(preferredScaleCmd);
  const preferredIreeCmd = getStringOpt(opts, "iree-cmd", process.env.TILEFORGE_IREE_COMPILE_CMD ?? "");
  const ireeCommands = ireeCompileCommandCandidates(preferredIreeCmd);

  await mkdir(root, { recursive: true });
  const response = await makeDemoArtifacts(artifactDir, hasFlag(opts, "full") ? "default" : "smoke");

  let scaleSummary: any = { ok: false, skipped: true };
  let ireeSummary: any = { ok: false, skipped: true };

  await mkdir(scaleDir, { recursive: true });
  try {
    const startedAt = Date.now();
    const run = await runScaleSimUntilReport(scaleCommands, scaleSimArgs({ config: path.join(artifactDir, "scalesim.cfg"), topology: path.join(artifactDir, "topology.csv"), layout: path.join(artifactDir, "layout.csv"), outDir: scaleDir }), scaleDir, (command: string) => ({
      cwd: scaleDir,
      timeoutMs,
      logPath: path.join(scaleDir, `scalesim-${commandLabel(command).replace(/[^a-zA-Z0-9_.-]+/g, "_")}.log`),
      env: { TILEFORGE_MOCK_OUTPUT_DIR: scaleDir }
    }));
    const scaleCmd = run.command;
    const computeReport = run.computeReport;
    const rows = csvRows(await readFile(computeReport, "utf8"));
    const totalCycles = rows.reduce((sum, row) => sum + (numberFromRow(row, ["Cycles", "Total Cycles", "Total cycles", "Compute cycles"]) ?? 0), 0);
    scaleSummary = { ok: true, skipped: false, command: commandLabel(scaleCmd), triedCommands: scaleCommands.map(commandLabel), elapsedMs: Date.now() - startedAt, computeReport, layerCount: rows.length, totalCycles };
  } catch (error) {
    scaleSummary = { ok: false, skipped: !requireExternal, command: scaleCommands.map(commandLabel).join(" | "), triedCommands: scaleCommands.map(commandLabel), error: error instanceof Error ? error.message : String(error), installHint: "npm run setup:scalesim -- --force" };
  }

  await mkdir(ireeDir, { recursive: true });
  const vmfb = path.join(ireeDir, "model.vmfb");
  const ireeErrors: Array<{ command: string; message: string }> = [];
  for (const ireeCmd of ireeCommands) {
    try {
      const startedAt = Date.now();
      const logPath = path.join(ireeDir, `iree-compile-${commandLabel(ireeCmd).replace(/[^a-zA-Z0-9_.-]+/g, "_")}.log`);
      await runExternalCommand(ireeCmd, [path.join(artifactDir, "generated.mlir"), "--iree-hal-target-backends=llvm-cpu", "--iree-llvmcpu-target-cpu=host", "-o", vmfb], {
        cwd: process.cwd(),
        timeoutMs,
        logPath,
        env: { TILEFORGE_MOCK_VMFB: vmfb }
      });
      const vmfbBytes = await fileSizeStrict(vmfb, "IREE VMFB");
      ireeSummary = { ok: true, skipped: false, command: commandLabel(ireeCmd), triedCommands: ireeCommands.map(commandLabel), elapsedMs: Date.now() - startedAt, vmfb, vmfbBytes };
      break;
    } catch (error) {
      const files = await listFiles(ireeDir);
      ireeErrors.push({ command: commandLabel(ireeCmd), message: `${error instanceof Error ? error.message : String(error)}; files under iree: ${files.length ? files.join(", ") : "(none)"}` });
    }
  }
  if (!ireeSummary.ok) {
    ireeSummary = {
      ok: false,
      skipped: !requireExternal,
      command: ireeCommands.map(commandLabel).join(" | "),
      triedCommands: ireeCommands.map(commandLabel),
      error: formatCandidateErrors(ireeErrors),
      installHint: "npm run setup:iree"
    };
    // Do not exit here; write final summaries/reports below so CI artifacts include both SCALE-Sim and IREE diagnostics.
  }

  await writeFile(path.join(scaleDir, "scalesim_summary.json"), JSON.stringify(scaleSummary, null, 2), "utf8");
  await writeFile(path.join(ireeDir, "iree_summary.json"), JSON.stringify(ireeSummary, null, 2), "utf8");
  await writeReport(root, response.summary.totalCycles, scaleSummary, ireeSummary);
  console.log(`외부 검증 보고서: ${path.join(root, "external_validation_report.md")}`);

  if (requireExternal && (!scaleSummary.ok || !ireeSummary.ok)) {
    await printFailureDiagnostics(root);
    process.exit(1);
  }
}

async function printFailureDiagnostics(root: string): Promise<void> {
  try {
    const reportPath = path.join(root, "external_validation_report.md");
    const report = await readFile(reportPath, "utf8");
    console.error("\n--- 외부 검증 보고서 ---");
    console.error(report);
    console.error(`보고서 경로: ${reportPath}`);
  } catch {
    console.error(`보고서를 읽기 전에 외부 검증이 실패했습니다. Root: ${root}`);
  }
}

async function writeReport(root: string, tileForgeCycles: number, scaleSummary: any, ireeSummary: any): Promise<void> {
  const scaleCycles = typeof scaleSummary.totalCycles === "number" ? scaleSummary.totalCycles : undefined;
  const cycleRatio = scaleCycles ? scaleCycles / tileForgeCycles : undefined;
  const scaleApplied = Boolean(scaleSummary.ok && scaleSummary.computeReport);
  const ireeApplied = Boolean(ireeSummary.ok && ireeSummary.vmfb && (ireeSummary.vmfbBytes ?? 0) > 0);
  const markdown = [
    "# TileForge 외부 검증 보고서",
    "",
    `생성 시각: ${new Date().toISOString()}`,
    "",
    "## 0. 적용 여부 한눈에 보기",
    `- 최종 판정: ${scaleApplied && ireeApplied ? "실제 SCALE-Sim + IREE 결과가 검증 보고서에 반영됨" : "일부 외부 도구 결과가 반영되지 않음"}`,
    `- SCALE-Sim 반영: ${scaleApplied ? `예 (${scaleSummary.computeReport})` : "아니오"}`,
    `- IREE compile 반영: ${ireeApplied ? `예 (${ireeSummary.vmfb}, ${ireeSummary.vmfbBytes?.toLocaleString()} bytes)` : "아니오"}`,
    "",
    "## TileForge estimator",
    `- 전체 사이클: ${tileForgeCycles}`,
    "",
    "## SCALE-Sim",
    `- 상태: ${scaleSummary.ok ? "성공" : scaleSummary.skipped ? "건너뜀" : "실패"}`,
    `- 명령어: ${scaleSummary.command ?? "해당 없음"}`,
    scaleCycles !== undefined ? `- 파싱된 전체 사이클: ${scaleCycles}` : "- 파싱된 전체 사이클: 해당 없음",
    cycleRatio !== undefined ? `- SCALE-Sim / TileForge 사이클 비율: ${cycleRatio.toFixed(4)}` : "- SCALE-Sim / TileForge 사이클 비율: 해당 없음",
    scaleSummary.error ? `- 오류: ${scaleSummary.error}` : "",
    "",
    "## IREE",
    `- 상태: ${ireeSummary.ok ? "성공" : ireeSummary.skipped ? "건너뜀" : "실패"}`,
    `- 명령어: ${ireeSummary.command ?? "해당 없음"}`,
    ireeSummary.vmfb ? `- VMFB: ${ireeSummary.vmfb}` : "- VMFB: 해당 없음",
    ireeSummary.vmfbBytes !== undefined ? `- VMFB 크기: ${ireeSummary.vmfbBytes.toLocaleString()} bytes` : "- VMFB 크기: 해당 없음",
    ireeSummary.error ? `- 오류: ${ireeSummary.error}` : "",
    "",
    "## 참고 사항",
    "- 외부 도구가 없으면 기본적으로 해당 단계를 건너뜁니다.",
    "- SCALE-Sim 또는 IREE가 없을 때 실패 처리하려면 `--require-external`을 전달하세요.",
    "- 외부 도구 설치 없이 CI 연결만 확인하려면 mock mode를 사용하세요."
  ].filter(line => line !== "").join("\n") + "\n";
  await writeFile(path.join(root, "external_validation_report.md"), markdown, "utf8");
  await writeFile(path.join(root, "external_validation_summary.json"), JSON.stringify({ tileForgeCycles, scaleSummary, ireeSummary, cycleRatio }, null, 2), "utf8");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
