import os from "node:os";
import { commandLabel, ireeCompileCommandCandidates, scaleSimCommandCandidates } from "./externalToolCandidates";

export const EXTERNAL_ENVIRONMENT_REPORT_SCHEMA = "tileforge.external-environment-report.v1" as const;

export interface ExternalEnvironmentReportInput {
  scalesimVersion?: string;
  ireeVersion?: string;
  generatedAt?: string;
}

export interface ExternalEnvironmentReport {
  schema: typeof EXTERNAL_ENVIRONMENT_REPORT_SCHEMA;
  generatedAt: string;
  platform: {
    node: string;
    platform: NodeJS.Platform;
    arch: string;
    release: string;
    cwd: string;
  };
  configured: {
    scaleSimCommand: string | null;
    ireeCompileCommand: string | null;
    ireeBenchCommand: string | null;
    scaleSimUseLayout: string | null;
    scaleSimUseOutputArg: string | null;
  };
  resolvedCandidates: {
    scaleSim: string[];
    ireeCompile: string[];
  };
  observedVersions: {
    scalesim: string | null;
    iree: string | null;
  };
  riskNotes: string[];
  nextActions: string[];
}

function envOrNull(name: string) {
  const value = process.env[name];
  return value && value.trim() ? value : null;
}

export function buildExternalEnvironmentReport(input: ExternalEnvironmentReportInput = {}): ExternalEnvironmentReport {
  const scaleSimConfigured = envOrNull("TILEFORGE_SCALE_SIM_CMD");
  const ireeConfigured = envOrNull("TILEFORGE_IREE_COMPILE_CMD");
  const ireeBenchConfigured = envOrNull("TILEFORGE_IREE_BENCH_CMD");
  const scaleCandidates = scaleSimCommandCandidates(scaleSimConfigured ?? undefined).map(commandLabel);
  const ireeCandidates = ireeCompileCommandCandidates(ireeConfigured ?? undefined).map(commandLabel);
  const riskNotes: string[] = [];
  const nextActions: string[] = [];

  if (!scaleSimConfigured) {
    riskNotes.push("TILEFORGE_SCALE_SIM_CMD가 명시적으로 설정되지 않아 fallback 후보 순서에 의존합니다.");
    nextActions.push("재현 가능한 검증을 위해 `npm run setup:env` 후 .env의 TILEFORGE_SCALE_SIM_CMD를 확인하세요.");
  }
  if (!ireeConfigured) {
    riskNotes.push("TILEFORGE_IREE_COMPILE_CMD가 명시적으로 설정되지 않아 PATH 또는 Python module fallback에 의존합니다.");
    nextActions.push("IREE 버전 차이를 줄이려면 `npm run setup:iree` 후 `npm run doctor:external -- --require-external`을 실행하세요.");
  }
  if (!ireeBenchConfigured) {
    riskNotes.push("TILEFORGE_IREE_BENCH_CMD가 설정되지 않으면 IREE runtime A-B benchmark를 실행할 수 없습니다.");
    nextActions.push("runtime 성능 검증이 필요하면 TILEFORGE_IREE_BENCH_CMD=\"iree-benchmark-module\" 또는 wrapper script를 설정하세요.");
  }
  if (process.platform === "win32") {
    riskNotes.push("Windows 환경은 py/python/python3 alias와 공백/한글 경로 문제에 민감합니다.");
    nextActions.push("외부 도구 command는 가능하면 절대 경로 또는 `py -3 -m ...` 형태로 고정하세요.");
  }

  return {
    schema: EXTERNAL_ENVIRONMENT_REPORT_SCHEMA,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    platform: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      cwd: process.cwd(),
    },
    configured: {
      scaleSimCommand: scaleSimConfigured,
      ireeCompileCommand: ireeConfigured,
      ireeBenchCommand: ireeBenchConfigured,
      scaleSimUseLayout: envOrNull("TILEFORGE_SCALE_SIM_USE_LAYOUT"),
      scaleSimUseOutputArg: envOrNull("TILEFORGE_SCALE_SIM_USE_OUTPUT_ARG"),
    },
    resolvedCandidates: {
      scaleSim: scaleCandidates,
      ireeCompile: ireeCandidates,
    },
    observedVersions: {
      scalesim: input.scalesimVersion ?? null,
      iree: input.ireeVersion ?? null,
    },
    riskNotes,
    nextActions,
  };
}

export function externalEnvironmentReportJson(report: ExternalEnvironmentReport): string {
  return JSON.stringify(report, null, 2);
}

export function externalEnvironmentReportMarkdown(report: ExternalEnvironmentReport): string {
  const lines: string[] = [];
  lines.push("# External Environment Report", "");
  lines.push("이 파일은 SCALE-Sim/IREE 검증이 어떤 실행 환경과 command 후보에 의존하는지 기록합니다. mock 검증이 통과해도 실제 로컬 외부 도구가 같은 의미로 동작한다는 보장은 아니므로, 환경 차이를 여기서 확인합니다.", "");
  lines.push("## Platform", "");
  lines.push(`- Node: ${report.platform.node}`);
  lines.push(`- Platform: ${report.platform.platform} ${report.platform.arch} (${report.platform.release})`);
  lines.push(`- CWD: ${report.platform.cwd}`);
  lines.push("", "## Configured commands", "");
  lines.push(`- SCALE-Sim: ${report.configured.scaleSimCommand ?? "not configured"}`);
  lines.push(`- IREE compile: ${report.configured.ireeCompileCommand ?? "not configured"}`);
  lines.push(`- IREE benchmark: ${report.configured.ireeBenchCommand ?? "not configured"}`);
  lines.push(`- SCALE-Sim layout flag: ${report.configured.scaleSimUseLayout ?? "default"}`);
  lines.push(`- SCALE-Sim output arg flag: ${report.configured.scaleSimUseOutputArg ?? "default"}`);
  lines.push("", "## Resolved candidate commands", "", "### SCALE-Sim");
  for (const command of report.resolvedCandidates.scaleSim) lines.push(`- ${command}`);
  lines.push("", "### IREE compile");
  for (const command of report.resolvedCandidates.ireeCompile) lines.push(`- ${command}`);
  lines.push("", "## Observed versions", "");
  lines.push(`- SCALE-Sim: ${report.observedVersions.scalesim ?? "unknown"}`);
  lines.push(`- IREE: ${report.observedVersions.iree ?? "unknown"}`);
  if (report.riskNotes.length) {
    lines.push("", "## Risk notes", "");
    for (const note of report.riskNotes) lines.push(`- ${note}`);
  }
  if (report.nextActions.length) {
    lines.push("", "## Next actions", "");
    for (const action of report.nextActions) lines.push(`- ${action}`);
  }
  return lines.join("\n");
}
