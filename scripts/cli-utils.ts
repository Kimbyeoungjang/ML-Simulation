export function parseCliArgs(argv: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      out[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[body] = "true";
      continue;
    }
    out[body] = next;
    i++;
  }
  return out;
}

export function printHelpAndExit(text: string): never {
  console.log(text.trimStart());
  process.exit(0);
}
