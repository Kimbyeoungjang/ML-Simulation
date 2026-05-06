import { test, expect } from "@playwright/test";

test("invalid tile input does not crash the page", async ({ page }) => {
  await page.goto("/");
  const tileM = page.getByLabel("tileM");
  await tileM.fill("0, -1");
  await page.getByText("Run server estimate").click();
  await expect(page.getByText(/Invalid|error|VALIDATION|No tile/i)).toBeVisible({ timeout: 10000 });
});
