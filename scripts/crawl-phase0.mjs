import { BASE, signIn, start } from "./crawl-lib.mjs";

const { page, shot, finish } = await start("phase0");
await page.goto(BASE);
await shot("home-anon");
await page.goto(`${BASE}/signin`);
await shot("signin");
await signIn(page, "0788000001");
await shot("home-signed-in");
await page.goto(`${BASE}/studio`);
await page.getByText(/your pages/i).waitFor();
await shot("studio-empty");
await finish();
