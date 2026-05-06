import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { ProjectFileSchema } from "@/lib/validation";

describe("example projects", () => {
  it("all example project files validate", async () => {
    const dir = path.join(process.cwd(), "examples", "projects");
    const names = (await readdir(dir)).filter(n => n.endsWith(".json"));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) ProjectFileSchema.parse(JSON.parse(await readFile(path.join(dir, name), "utf8")));
  });
});
