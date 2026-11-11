import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export async function signIn(page: Page, phone: string) {
  await page.goto("/signin");
  await page.getByLabel(/phone/i).fill(phone);
  await page.getByRole("button", { name: /send code|ohereza|envoyer/i }).click();
  await page.locator("button.font-mono").click();
  await page.getByRole("button", { name: /continue|komeza|continuer/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/signin"));
}

/** WCAG 2.2 AA: fail on critical and serious violations only. */
export async function expectAccessible(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  const bad = r.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(bad.map((v) => `${v.id}: ${v.nodes.length} node(s) · ${v.help}`)).toEqual([]);
}
