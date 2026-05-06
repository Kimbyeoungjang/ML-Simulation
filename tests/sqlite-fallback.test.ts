import { describe, expect, it } from "vitest";
import { sqlitePrimary } from "@/server/sqliteStore";

describe("SQLite fallback switch", () => {
  it("can be disabled by environment", () => {
    const old = process.env.TILEFORGE_DISABLE_SQLITE;
    process.env.TILEFORGE_DISABLE_SQLITE = "1";
    expect(sqlitePrimary()).toBe(false);
    if (old === undefined) delete process.env.TILEFORGE_DISABLE_SQLITE;
    else process.env.TILEFORGE_DISABLE_SQLITE = old;
  });
});
