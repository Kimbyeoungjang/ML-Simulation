import { test, expect } from "@playwright/test";

test("job panel can be opened and refreshed", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Refresh jobs").click();
  await expect(page.getByText(/Jobs include|Click Refresh|\[/i)).toBeVisible({ timeout: 10000 });
});
