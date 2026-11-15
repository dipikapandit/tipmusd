// Records the TipMUSD demo with real transactions on Mezo Testnet.
//
//   SUPPORTER_PRIVATE_KEY=0x… APP_URL=http://localhost:3000 npx tsx demo/record/record.ts
//
// Two browser contexts, each with a Node-side EIP-1193 wallet announced as an injected wallet (EIP-6963) and connected
// through the Mezo Passport modal ("Browser Wallet"):
//   - creator: a throwaway key generated in memory for this run (it only signs in and receives; needs no funds);
//   - supporter: SUPPORTER_PRIVATE_KEY (needs a little BTC + MEZO; MUSD comes from the in-app BTC → MUSD swap).
// Every scene lasts at least as long as its narration (out/tts/<scene>.json from tts.py). Writes out/raw/<ctx>/*.webm
// and out/timeline.json for compose.py. Keys come from the environment / memory only and are never written anywhere.

import fs from "node:fs";
import path from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import type { Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { attachWallet } from "./wallet";

const APP = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
const OUT = path.join(__dirname, "out");
const VIEW = { width: 1440, height: 810 };
const USERNAME = process.env.DEMO_USERNAME || "maya";

const need = (k: string) => {
  const v = process.env[k];
  if (!v || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${k} must be set to a 0x-prefixed private key`);
  return v as Hex;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tts = (scene: string) => {
  const f = path.join(OUT, "tts", `${scene}.json`);
  if (!fs.existsSync(f)) {
    if (!process.env.STOP_AFTER && !process.env.NO_TTS) throw new Error(`missing narration for ${scene}: run tts.py first`);
    return { duration: 1 };
  }
  return JSON.parse(fs.readFileSync(f, "utf8")) as { duration: number };
};

// ---------------------------------------------------------------- recording + scenes
type Mark = { scene: string; ctx: string; start: number; end: number };
const marks: Mark[] = [];
const t0: Record<string, number> = {};
const pages: Record<string, Page> = {};
class Stop extends Error {}

async function newCtx(browser: Awaited<ReturnType<typeof chromium.launch>>, name: string, key: Hex) {
  const dir = path.join(OUT, "raw", name);
  fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 4 / 3, recordVideo: { dir, size: { width: 1920, height: 1080 } }, colorScheme: "light" });
  const address = await attachWallet(ctx, key);
  const page = await ctx.newPage();
  pages[name] = page;
  t0[name] = Date.now();
  return { ctx, page, address, name };
}

async function freshPage(ctx: Awaited<ReturnType<typeof newCtx>>["ctx"], name: string) {
  const p = await ctx.newPage();
  pages[name] = p;
  t0[name] = Date.now();
  return p;
}

async function scene(name: string, ctxName: string, fn: () => Promise<void>) {
  const start = Date.now();
  console.log(`▶ ${name}`);
  try {
    await fn();
  } catch (e) {
    for (const [k, pg] of Object.entries(pages)) await pg.screenshot({ path: path.join(OUT, `fail-${name}-${k}.png`) }).catch(() => undefined);
    throw e;
  }
  if (process.env.STOP_AFTER === name) {
    for (const [k, pg] of Object.entries(pages)) await pg.screenshot({ path: path.join(OUT, `stop-${name}-${k}.png`), fullPage: true }).catch(() => undefined);
    throw new Stop(`stopped after ${name}`);
  }
  const min = tts(name).duration * 1000 + 700;
  const spent = Date.now() - start;
  if (spent < min) await sleep(min - spent);
  marks.push({ scene: name, ctx: ctxName, start: (start - t0[ctxName]) / 1000, end: (Date.now() - t0[ctxName]) / 1000 });
}

/** Submission screenshots (docs/submission/N-name.png) when SHOTS=1. */
async function shot(page: Page, file: string) {
  if (!process.env.SHOTS) return;
  const dir = path.join(__dirname, "..", "..", "docs", "submission");
  fs.mkdirSync(dir, { recursive: true });
  await page.evaluate("document.getElementById('__mzcur')?.hidePopover?.()").catch(() => undefined);
  await page.screenshot({ path: path.join(dir, file) });
}

async function moveTo(page: Page, loc: Locator) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b) return;
  await page.evaluate(([x, y]) => (window as unknown as { __mzCursor: (x: number, y: number) => void }).__mzCursor(x, y), [b.x + b.width / 2, b.y + b.height / 2]);
  await sleep(650);
}

async function click(page: Page, loc: Locator) {
  await loc.waitFor({ state: "visible", timeout: 60_000 });
  await moveTo(page, loc);
  await loc.click();
  await sleep(350);
}

async function type(page: Page, loc: Locator, text: string) {
  await click(page, loc);
  await loc.fill("");
  await loc.pressSequentially(text, { delay: 60 });
}

async function smoothScroll(page: Page, y: number, ms = 1600) {
  // Plain string: tsx would inject a __name helper into a nested arrow function.
  await page.evaluate(`(() => {
    const to = Math.min(${y}, document.documentElement.scrollHeight - innerHeight), dur = ${ms};
    const from = window.scrollY, t = performance.now();
    function step(n) {
      const k = Math.min(1, (n - t) / dur);
      window.scrollTo(0, from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  })()`);
  await sleep(ms + 200);
}

async function scrollToEl(page: Page, loc: Locator, offset = 90, ms = 1500) {
  const y = await loc.evaluate((e) => e.getBoundingClientRect().top + window.scrollY);
  await smoothScroll(page, Math.max(0, y - offset), ms);
}

/** Connect through the Mezo Passport modal ("Browser Wallet" = the injected window.ethereum). */
async function connectPassport(page: Page, trigger: Locator, pause = 1800) {
  await click(page, trigger);
  const bw = page.getByRole("button", { name: /Browser Wallet/i }).first();
  await bw.waitFor({ state: "visible", timeout: 30_000 });
  await sleep(pause); // let the viewer see the Bitcoin + Ethereum wallet groups
  await click(page, bw);
}

// ---------------------------------------------------------------- main
async function main() {
  const supporterKey = need("SUPPORTER_PRIVATE_KEY");
  const creatorKey = generatePrivateKey(); // in memory only
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  // ======================= creator: landing + onboarding
  const C = await newCtx(browser, "creator", creatorKey);
  const c = C.page;
  await c.goto(APP, { waitUntil: "load" });

  await scene("intro", "creator", async () => {
    await sleep(1500);
    await shot(c, "1-landing.png");
    await sleep(1500);
  });
  await scene("how", "creator", async () => {
    const how = c.locator("#how-it-works, #how").first();
    if (await how.count()) await scrollToEl(c, how, 40, 2200);
    else await smoothScroll(c, 760, 2200);
    await sleep(3500);
    await smoothScroll(c, 0, 1400);
  });

  await scene("start", "creator", async () => {
    await click(c, c.getByRole("link", { name: /Create your tip link/ }).first());
    await c.waitForURL(/\/start/);
    await c.getByText("Start with your wallet").waitFor();
    await connectPassport(c, c.getByRole("button", { name: /Connect wallet/ }).last());
    const signIn = c.getByRole("button", { name: /^Sign in/ }).last();
    await signIn.waitFor({ state: "visible", timeout: 30_000 });
    await click(c, signIn);
    await c.getByText("Pick your link").waitFor({ timeout: 60_000 });
  });

  await scene("profile", "creator", async () => {
    await type(c, c.getByRole("textbox").first(), USERNAME);
    await c.getByText(/is yours|available/i).first().waitFor({ timeout: 20_000 }).catch(() => undefined);
    await sleep(900);
    await click(c, c.getByRole("button", { name: "Continue" }));
    await type(c, c.locator("#display-name"), "Maya Okafor");
    await type(c, c.locator("#bio"), "I make free Bitcoin explainers and open-source wallet tools.");
    await sleep(600);
    await click(c, c.getByRole("button", { name: "Continue" }));
    await c.getByText("Suggested amounts").first().waitFor();
    await sleep(1200);
    await click(c, c.getByRole("button", { name: /Create my tip page/ }));
    await c.getByText("You're live.").waitFor({ timeout: 60_000 });
  });

  await scene("live", "creator", async () => {
    await sleep(2500);
    await smoothScroll(c, 420, 1400);
    await sleep(2500);
  });

  // ======================= supporter
  const S = await newCtx(browser, "supporter", supporterKey);
  const s = S.page;
  await s.goto(`${APP}/${USERNAME}?src=qr`, { waitUntil: "load" });

  await scene("tip_page", "supporter", async () => {
    await s.getByText(/Support Maya/).first().waitFor();
    await sleep(3500);
  });

  await scene("pick", "supporter", async () => {
    await click(s, s.getByRole("radio", { name: /^5\s*MUSD/ }).first());
    await sleep(500);
    const name = s.getByLabel(/name/i).first();
    if (await name.isVisible().catch(() => false)) await type(s, name, "Leo");
    const msg = s.getByLabel(/message/i).first();
    if (await msg.isVisible().catch(() => false)) await type(s, msg, "Your BTC explainer finally made it click. Thank you!");
    await sleep(500);
  });

  await scene("connect", "supporter", async () => {
    // "Tip 5 MUSD" opens the Passport modal first when no wallet is connected, then carries on to review.
    await connectPassport(s, s.getByRole("button", { name: /^Tip / }).first());
    const review = s.getByText("Review your tip");
    if (!(await review.isVisible({ timeout: 6000 }).catch(() => false))) await click(s, s.getByRole("button", { name: /^Tip / }).first());
    await review.waitFor({ timeout: 60_000 });
  });

  await scene("review", "supporter", async () => {
    await sleep(2200);
    const fund = s.getByText(/Get it on Mezo without leaving this page/).first();
    await fund.waitFor({ timeout: 60_000 });
    await scrollToEl(s, fund, 260, 1400);
    await sleep(2500);
  });

  await scene("borrow_note", "supporter", async () => {
    const loan = s.getByText("Open a Mezo loan").first();
    if (await loan.isVisible().catch(() => false)) await moveTo(s, loan);
    await sleep(2500);
    await shot(s, "2-pay-with-bitcoin.png");
    const draw = s.getByText("Borrow from your Mezo loan").first();
    if (await draw.isVisible().catch(() => false)) await moveTo(s, draw);
    await sleep(1500);
  });

  await scene("swap", "supporter", async () => {
    await click(s, s.getByText("Swap a little BTC for MUSD").first());
    await sleep(800);
    await click(s, s.getByRole("button", { name: "Swap BTC for MUSD" }));
    await s.getByText("You have the MUSD now").waitFor({ timeout: 240_000 });
    await sleep(1500);
  });

  await scene("send", "supporter", async () => {
    await click(s, s.getByRole("button", { name: /^Send .*MUSD/ }));
    await s.getByText(/Confirmed on Mezo Testnet/).waitFor({ timeout: 240_000 });
  });

  await scene("confirmed", "supporter", async () => {
    await sleep(1500);
    const paid = s.getByText("Funded from Bitcoin via Mezo").first();
    for (let i = 0; i < 20 && !(await paid.isVisible().catch(() => false)); i++) await sleep(1500);
    if (await paid.isVisible().catch(() => false)) await moveTo(s, paid);
    await shot(s, "3-tip-confirmed.png");
    await sleep(2500);
  });
  // The MUSD tip's transaction, for the explorer scene.
  const musdTx = await s.locator('a[href*="explorer.test.mezo.org/tx/"]').first().getAttribute("href").catch(() => null);

  // MEZO tip on a fresh page (an idle page records no frames).
  const s2 = await freshPage(S.ctx, "supporter2");
  await s2.goto(`${APP}/${USERNAME}`, { waitUntil: "load" });
  await scene("mezo", "supporter2", async () => {
    await click(s2, s2.getByRole("radio", { name: /MEZO/ }).first());
    await sleep(700);
    await click(s2, s2.getByRole("radio", { name: /^10\s*MEZO/ }).first());
    await click(s2, s2.getByRole("button", { name: /^Tip / }).first());
    await s2.getByText("Review your tip").waitFor({ timeout: 60_000 });
    await sleep(1200);
    await click(s2, s2.getByRole("button", { name: /^Send .*MEZO/ }));
    await s2.getByText(/Confirmed on Mezo Testnet/).waitFor({ timeout: 240_000 });
    await sleep(2000);
  });

  // ======================= creator: dashboard, explorer, explore
  const d = await freshPage(C.ctx, "creator2");
  await d.goto(`${APP}/dashboard`, { waitUntil: "load" });
  await d.getByText(/MUSD/).first().waitFor({ timeout: 60_000 });

  await scene("dashboard", "creator2", async () => {
    await sleep(1500);
    await shot(d, "4-creator-dashboard.png");
    await sleep(2000);
    await smoothScroll(d, 520, 1600);
    await sleep(3000);
  });

  await scene("activity", "creator2", async () => {
    await click(d, d.getByRole("link", { name: /^Activity/ }).first());
    await d.waitForURL(/activity/);
    await sleep(3000);
  });

  const explorerUrl = musdTx;

  const e = await freshPage(C.ctx, "explorer");
  if (explorerUrl) await e.goto(explorerUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  await scene("explorer", "explorer", async () => {
    await sleep(4000);
    await smoothScroll(e, 500, 1800);
    await sleep(2500);
  });

  const x = await freshPage(C.ctx, "explore");
  await x.goto(`${APP}/dashboard/share`, { waitUntil: "load" });
  await scene("share", "explore", async () => {
    await sleep(3500);
    await smoothScroll(x, 480, 1500);
    await sleep(2000);
  });

  await scene("explore", "explore", async () => {
    await x.goto(`${APP}/explore`, { waitUntil: "load" });
    await sleep(2000);
    await shot(x, "5-explore.png");
    await sleep(1500);
    await smoothScroll(x, 520, 1600);
    await sleep(2500);
  });

  await scene("outro", "explore", async () => {
    await smoothScroll(x, 99999, 2400);
    await sleep(3500);
  });

  const recorded: Record<string, Page> = { creator: c, supporter: s, supporter2: s2, creator2: d, explorer: e, explore: x };
  const vids = Object.fromEntries(await Promise.all(Object.entries(recorded).map(async ([k, pg]) => [k, (await pg.video()!.path()) as string])));
  await C.ctx.close();
  await S.ctx.close();
  await browser.close();
  fs.writeFileSync(path.join(OUT, "timeline.json"), JSON.stringify({ videos: vids, marks }, null, 2));
  console.log("recorded", vids);
}

main().catch((e) => {
  if (e instanceof Stop) {
    console.log(e.message);
    process.exit(0);
  }
  console.error(e);
  process.exit(1);
});
