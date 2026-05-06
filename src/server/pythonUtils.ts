import { spawnSync } from "node:child_process";

export interface PythonCommand {
  command: string;
  argsPrefix: string[];
  label: string;
}

function runProbe(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, { stdio: "ignore", shell: false });
  return result.status === 0;
}

function normalizeCommandToken(token: string): string {
  return token.trim().replace(/^(\"|\')(.*)\1$/, "$2");
}

function quoteCommandToken(token: string): string {
  const normalized = normalizeCommandToken(token);
  // Do not use JSON.stringify here: Windows paths such as C:\foo would be
  // written as C:\\foo in .env and then parsed as a literal command token by
  // splitCommand(). Plain shell-style double quotes are enough for our splitter.
  return /\s/.test(normalized) ? `"${normalized.replace(/"/g, '\\"')}"` : normalized;
}

export function commandLineFor(candidate: PythonCommand, suffixArgs: string[]): string {
  return [quoteCommandToken(candidate.command), ...candidate.argsPrefix, ...suffixArgs.map(quoteCommandToken)].join(" ");
}

export function pythonCommandCandidates(): PythonCommand[] {
  const candidates: PythonCommand[] = [];

  const explicit = process.env.TILEFORGE_PYTHON;
  if (explicit?.trim()) {
    const command = normalizeCommandToken(explicit);
    candidates.push({ command, argsPrefix: [], label: command });
  }

  if (process.platform === "win32") {
    candidates.push(
      { command: "py", argsPrefix: ["-3"], label: "py -3" },
      { command: "python", argsPrefix: [], label: "python" }
    );

    // Do not add plain `python3` on Windows by default. On many Windows
    // installations it resolves to the Store launcher or to no executable at
    // all, producing noisy 9009/command-not-found diagnostics in job history.
    // Users who really need it can set TILEFORGE_PYTHON=python3 explicitly.
  } else {
    candidates.push(
      { command: "python3", argsPrefix: [], label: "python3" },
      { command: "python", argsPrefix: [], label: "python" },
      { command: "py", argsPrefix: ["-3"], label: "py -3" }
    );
  }

  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = [candidate.command, ...candidate.argsPrefix].join(" ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function findPythonCommand(): PythonCommand {
  for (const candidate of pythonCommandCandidates()) {
    if (runProbe(candidate.command, [...candidate.argsPrefix, "--version"])) return candidate;
  }

  const tried = pythonCommandCandidates().map(c => c.label).join(", ");
  throw new Error(
    `Python 3 실행 파일을 찾지 못했습니다. 시도한 명령: ${tried}. ` +
    "Windows에서는 Python 설치 시 'Add python.exe to PATH'를 켜거나, py 런처가 설치되어 있어야 합니다. " +
    "또는 TILEFORGE_PYTHON 환경 변수로 Python 경로를 지정하세요."
  );
}

export function pythonModuleCommandCandidates(moduleName: string, preferred?: string): string[] {
  const raw = preferred?.trim();
  const commands = [
    raw,
    ...pythonCommandCandidates().map(candidate => commandLineFor(candidate, ["-m", moduleName]))
  ].filter((value): value is string => Boolean(value && value.trim()));
  return Array.from(new Set(commands.map(value => value.trim())));
}

export function pipArgs(python: PythonCommand, args: string[]): string[] {
  return [...python.argsPrefix, "-m", "pip", ...args];
}
