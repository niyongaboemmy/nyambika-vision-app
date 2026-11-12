import { expect, test } from "@playwright/test";
import { expectAccessible, signIn } from "./helpers";

/** Plan §15.1 critical path: Mirror → Ask → Looks → Hold-to-buy → paid to maker. */
test("shopper core loop", async ({ page, context }) => {
  const phone = `07887${String(Date.now()).slice(-5)}`;
  await signIn(page, phone);

  await page.goto("/mirror");
  await page.getByRole("switch").check({ force: true });
  await page.getByText(/synthetic demo persona/i).click();
  await page.getByRole("button", { name: "Persona 2" }).click();
  await expect(page.getByText(/your twin is ready/i)).toBeVisible({ timeout: 20_000 });

  await page.goto("/");
  await page.locator("footer button[title]").click();
  await page.getByRole("textbox").fill("Wedding outfit for Saturday under 50k");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/what i understood/i)).toBeVisible();
  const started = Date.now();
  await page.waitForURL(/\/looks\//, { timeout: 20_000 });
  const first = page.locator('section[aria-label="Look 1 of 9"]');
  await expect(first.locator('img[alt*="AI preview on your twin"]')).toBeVisible({ timeout: 30_000 });
  expect(Date.now() - started).toBeLessThan(15_000); // plan §7.5: first look p50 ≤ 15 s

  await first.getByRole("button", { name: /buy/i }).click();
  await page.getByRole("button", { name: /pickup/i }).click();
  const hold = page.getByRole("button", { name: /hold to buy/i });
  const box = (await hold.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
  await page.waitForURL(/\/orders\//);

  const handset = await context.newPage();
  await handset.goto("/dev/handset");
  await handset.getByLabel("PIN").fill("13579");
  await handset.getByRole("button", { name: "Approve" }).click();
  await handset.close();
  await expect(page.getByText(/paid directly to/i).first()).toBeVisible({ timeout: 15_000 });
});

test("a short hold does not buy", async ({ page }) => {
  await signIn(page, `07886${String(Date.now()).slice(-5)}`);
  await page.goto("/m/kanombe-kitenge-corner");
  await page.getByRole("option", { selected: true }).click();
  await page.getByRole("button", { name: /try on me/i }).click();
  await expect(page.locator('img[alt*="AI preview"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /buy/i }).click();
  await page.getByRole("button", { name: /pickup/i }).click();
  const hold = page.getByRole("button", { name: /hold to buy/i });
  const box = (await hold.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.up();
  await page.waitForTimeout(1200);
  await expect(page).not.toHaveURL(/\/orders\//);
});

test.describe("accessibility (WCAG 2.2 AA, critical/serious)", () => {
  for (const path of ["/", "/signin", "/makers", "/m/umurage-wear"]) {
    test(`public ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expectAccessible(page);
    });
  }
});
