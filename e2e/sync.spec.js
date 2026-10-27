// Two "phones" sign in to the same account and sync through a fake Supabase (e2e/fake-supabase.mjs).
// The app's config is swapped at the network level so the real config stays untouched.
import { test, expect } from "@playwright/test";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const FAKE_CONFIG = `export const CLOUD = { supabaseUrl: "http://localhost:5998", supabaseAnonKey: "anon-test", vapidPublicKey: "" };`;

async function phone(browser, email) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 412, height: 915 } });
  await ctx.route("**/js/config.js", (route) => route.fulfill({ contentType: "text/javascript", body: FAKE_CONFIG }));
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  p.email = email;
  await p.goto("/");
  return p;
}

async function signIn(p) {
  await p.getByRole("button", { name: "Settings" }).click();
  await p.locator("#cloudEmail").fill(p.email);
  await p.getByRole("button", { name: "Send code" }).click();
  await p.locator("#cloudCode").fill("123456");
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(p.locator("#syncLine")).toContainText("Last synced", { timeout: 15000 });
  await p.getByRole("button", { name: "Done", exact: true }).click();
}

async function syncNow(p) {
  await p.getByRole("button", { name: "Settings" }).click();
  await p.getByRole("button", { name: "Sync now" }).click();
  await expect(p.locator("#syncLine")).toContainText("Last synced just now", { timeout: 15000 });
  await p.getByRole("button", { name: "Done", exact: true }).click();
}

test("tasks, jobs, photos, edits, deletions and settings sync between two devices", async ({ browser }) => {
  const email = `sync-${Date.now()}@example.com`;
  const A = await phone(browser, email);
  await A.getByRole("button", { name: "Choose common tasks" }).click();
  await A.getByRole("button", { name: "Add selected" }).click();
  await A.locator(".row", { hasText: "Clean gutters" }).locator(".main").click();
  await A.getByRole("button", { name: "Log a job" }).click();
  await A.locator("#jCost").fill("180");
  await A.locator('#jFiles input[type="file"]').setInputFiles({ name: "r.png", mimeType: "image/png", buffer: PNG });
  await expect(A.locator("#jFiles .thumb img")).toBeVisible();
  await A.getByRole("button", { name: "Save" }).click();
  await A.getByRole("button", { name: "Close" }).click();
  await signIn(A);

  const B = await phone(browser, email);
  await expect(B.getByRole("button", { name: "I use the app on another device" })).toBeVisible();
  await signIn(B);
  await expect(B.locator(".row")).toHaveCount(10);
  await B.locator(".row", { hasText: "Clean gutters" }).locator(".main").click();
  await expect(B.locator(".sheet .jobs")).toContainText("$180");
  await expect(B.locator(".sheet .jobs .thumb img")).toBeVisible({ timeout: 10000 });

  await B.getByRole("button", { name: "Edit task" }).click();
  await B.locator("#fName").fill("Clean gutters (front & back)");
  await B.getByRole("button", { name: "Save" }).click();
  await B.getByRole("button", { name: "Close" }).click();
  await B.locator(".row", { hasText: "Clean dishwasher filter" }).locator(".main").click();
  await B.getByRole("button", { name: "Edit task" }).click();
  await B.getByRole("button", { name: "Delete task" }).click();
  await B.getByRole("button", { name: "Tap again to delete" }).click();
  await syncNow(B);

  await syncNow(A);
  await expect(A.locator(".row", { hasText: "Clean gutters (front & back)" })).toHaveCount(1);
  await expect(A.locator(".row")).toHaveCount(9);

  await A.getByRole("button", { name: "Settings" }).click();
  await A.locator("#soonDays").selectOption("30");
  await A.getByRole("button", { name: "Done", exact: true }).click();
  await syncNow(A);
  await syncNow(B);
  expect(await B.evaluate(() => JSON.parse(localStorage.getItem("house-upkeep-log:v3")).prefs.soonDays)).toBe(30);

  await B.getByRole("button", { name: "Settings" }).click();
  await B.getByRole("button", { name: "Sign out" }).click();
  await expect(B.locator(".cloud-box")).toContainText("Sign in with your email");
  await B.getByRole("button", { name: "Done", exact: true }).click();
  await expect(B.locator(".row")).toHaveCount(9);

  expect([...A.errors, ...B.errors]).toEqual([]);
});

test("a wrong code shows a helpful message", async ({ browser }) => {
  const p = await phone(browser, `wrong-${Date.now()}@example.com`);
  await p.getByRole("button", { name: "Settings" }).click();
  await p.locator("#cloudEmail").fill(p.email);
  await p.getByRole("button", { name: "Send code" }).click();
  await p.locator("#cloudCode").fill("000000");
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(p.locator("#cloudStatus")).toHaveText("That code didn't work. Check it, or request a new one.");
});
