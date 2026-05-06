import { test, expect } from "@playwright/test";

test("loads the TileForge workbench and exposes core controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/TileForge/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /estimate|run/i }).first()).toBeVisible();
});
