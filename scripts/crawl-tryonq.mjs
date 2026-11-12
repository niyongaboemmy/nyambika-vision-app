// Try-on quality pass: the seeded plain tee (dark colourway) on synthetic personas 3 and 5, from the maker page.
// Usage: BASE_URL=http://localhost:3102 node scripts/crawl-tryonq.mjs
import { BASE, signIn, start } from "./crawl-lib.mjs";

const { page, shot, finish } = await start("tryonq");

for (const persona of [3, 5]) {
  // Fresh shopper per persona: the daily look cap is per user.
  await signIn(page, `07884${String(Date.now()).slice(-5)}`);
  await page.goto(`${BASE}/mirror`);
  await page.getByRole("switch").check({ force: true });
  await page.getByText(/synthetic demo persona/i).click();
  await page.getByRole("button", { name: `Persona ${persona}` }).click();
  await page.getByText(/your twin is ready/i).waitFor({ timeout: 20000 });

  await page.goto(`${BASE}/m/kigali-kitenge-house`);
  // The collection is a 3D carousel (+-2 cards rendered): step right until the tee is centred, then tap it.
  for (let step = 0; step < 15; step++) {
    const tee = page.getByRole("option", { name: /Plain cotton tee/ });
    if (await tee.count()) {
      if ((await tee.getAttribute("aria-selected")) === "true") {
        await tee.click();
        break;
      }
      await tee.click();
    } else {
      await page.getByRole("option").last().click();
    }
    await page.waitForTimeout(350);
  }
  await page.getByRole("button", { name: /try on me/i }).waitFor();
  if (persona === 3) await shot("tee-product-sheet");
  await page.getByRole("button", { name: /try on me/i }).click();
  await page.waitForURL(/\/looks\//, { timeout: 15000 });
  await page.locator('img[alt*="AI preview"]').first().waitFor({ timeout: 45000 });
  await page.waitForTimeout(800);
  await shot(`tee-look-persona-${persona}`);
  await page.context().clearCookies();
}

await finish();
