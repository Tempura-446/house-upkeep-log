// Screen tests for the main flows. Each test starts with empty storage unless it seeds some.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
// A tiny valid PNG, used as a receipt photo.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/** Fail the test on any script error in the page. */
test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|ERR_/.test(m.text()) && errors.push(m.text()));
  test.info().errors_ = errors;
});
test.afterEach(async () => {
  expect(test.info().errors_, "page errors").toEqual([]);
});

async function seed(page, data) {
  await page.addInitScript((d) => {
    if (!localStorage.getItem("seeded")) {
      localStorage.setItem("house-upkeep-log:v3", JSON.stringify(d));
      localStorage.setItem("seeded", "1");
    }
  }, data);
}

const sampleData = () => ({
  version: 3,
  homes: [{ id: "home", name: "My home" }],
  tasks: [
    { id: "t1", homeId: "home", name: "Clean gutters", area: "Exterior", schedule: "interval", intervalDays: 30, log: [{ id: "j1", date: daysAgo(40), cost: 180, note: "Gutter Pros" }] },
    { id: "t2", homeId: "home", name: "Replace HVAC air filter", area: "HVAC", schedule: "interval", intervalDays: 91, log: [{ id: "j2", date: daysAgo(10), cost: 38.5 }], notes: "16x25x1" },
    { id: "t3", homeId: "home", name: "Clean refrigerator coils", area: "Appliances", schedule: "interval", intervalDays: 182, log: [] },
  ],
  home: [{ id: "h1", homeId: "home", title: "Water heater", details: "Rheem 50 gal" }],
  local: { currentHomeId: "home", firstUseAt: Date.now(), lastBackupAt: Date.now(), swipeHintSeen: true },
});

test("first run: pick common tasks, then set a start date", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Let's set up your home")).toBeVisible();
  await page.getByRole("button", { name: "Choose common tasks" }).click();
  await page.getByRole("button", { name: "Add selected" }).click();
  await expect(page.locator(".row")).toHaveCount(10);
  await expect(page.getByText("Needs a start date")).toBeVisible();

  const row = page.locator(".row", { hasText: "Clean gutters" });
  await row.locator(".check").click();
  await page.locator("#jDate").fill(daysAgo(200));
  await page.getByRole("button", { name: "Save" }).click();
  await expect(row.locator(".due")).toHaveClass(/late/);
});

test("mark done from the list updates status and history, with undo", async ({ page }) => {
  await seed(page, sampleData());
  await page.goto("/");
  await expect(page.locator(".stat[data-status=late] b")).toHaveText("1");
  await page.locator(".row", { hasText: "Clean gutters" }).locator(".check").click();
  await expect(page.locator(".toast")).toContainText("Logged “Clean gutters”");
  await expect(page.locator(".stat[data-status=late] b")).toHaveText("0");
  await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".stat[data-status=late] b")).toHaveText("1");
});

test("log a job with cost and a labeled photo, then see it in history and the spending chart", async ({ page }) => {
  await seed(page, sampleData());
  await page.goto("/");
  await page.locator(".row", { hasText: "Replace HVAC" }).locator(".main").click();
  await page.getByRole("button", { name: "Log a job" }).click();
  await page.locator("#jCost").fill("42");
  await page.locator("#jNote").fill("Bought filters");
  await page.getByRole("button", { name: "Before", exact: true }).click();
  await page.locator('#jFiles input[type="file"]').setInputFiles({ name: "before.png", mimeType: "image/png", buffer: PNG });
  await expect(page.locator("#jFiles .thumb img")).toBeVisible();
  await expect(page.locator("#jFiles .thumb-label")).toHaveText("Before");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".sheet .jobs")).toContainText("Bought filters");
  await page.getByRole("button", { name: "Close" }).click();

  await page.locator(".tabbar").getByRole("button", { name: "History" }).click();
  await expect(page.locator(".spend-card")).toContainText("$260.50");
  await expect(page.locator(".hrow").first()).toContainText("Bought filters");
});

test("snooze options push the due date and can be undone", async ({ page }) => {
  await seed(page, sampleData());
  await page.goto("/");
  await page.locator(".row", { hasText: "Clean gutters" }).locator(".main").click();
  await page.locator(".sheet").getByRole("button", { name: "Snooze" }).click();
  await page.getByRole("button", { name: /^1 week/ }).click();
  await expect(page.locator(".sheet .detail-status")).toContainText("Snoozed");
  await expect(page.locator(".sheet .detail-status .due")).toHaveText("Due in 7 days");
  await page.getByRole("button", { name: "Undo snooze" }).click();
  await expect(page.locator(".sheet .detail-status .due")).toContainText("late");
});

test("search filters tasks, history and Home info", async ({ page }) => {
  await seed(page, sampleData());
  await page.goto("/");
  await page.locator("#search").fill("filter");
  await expect(page.locator(".row")).toHaveCount(1);
  await expect(page.locator(".row")).toContainText("Replace HVAC air filter");
  await page.locator("#search").fill("zzz");
  await expect(page.getByText("No matches")).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.locator(".row")).toHaveCount(3);
  await page.locator(".tabbar").getByRole("button", { name: "Home info" }).click();
  await page.locator("#search").fill("rheem");
  await expect(page.locator(".card")).toHaveCount(1);
});

test("Home info item with a manual attachment", async ({ page }) => {
  await seed(page, sampleData());
  await page.goto("/");
  await page.locator(".tabbar").getByRole("button", { name: "Home info" }).click();
  await page.locator(".card", { hasText: "Water heater" }).click();
  await page.locator('#hFiles input[type="file"]').setInputFiles({ name: "manual.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF") });
  await expect(page.locator("#hFiles .thumb .pdf")).toBeVisible();
  await expect(page.locator("#hFiles .thumb-label")).toHaveText("Manual");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".card", { hasText: "Water heater" })).toContainText("1 file");
});

test("multiple homes keep separate tasks", async ({ page }) => {
  await seed(page, sampleData());
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Manage" }).click();
  await page.getByLabel("New home name").fill("Lake cabin");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Nothing set up for Lake cabin yet")).toBeVisible();
  await expect(page.locator(".home-switch")).toContainText("Lake cabin");

  await page.locator(".home-switch").click();
  await page.locator("[data-switch=home]").click();
  await expect(page.locator(".row")).toHaveCount(3);
  await page.reload();
  await expect(page.locator(".home-switch")).toContainText("My home");
});

test("Coming up window setting changes task status", async ({ page }) => {
  const data = sampleData();
  data.tasks.push({ id: "t4", homeId: "home", name: "Test smoke detectors", area: "Safety", schedule: "interval", intervalDays: 30, log: [{ id: "j4", date: daysAgo(10) }] });
  await seed(page, data);
  await page.goto("/");
  const row = page.locator(".row", { hasText: "Test smoke detectors" });
  await expect(row).toHaveAttribute("data-status", "ok"); // due in 20 days, outside the default 14
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator("#soonDays").selectOption("30");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(row).toHaveAttribute("data-status", "soon");
  await page.reload();
  await expect(row).toHaveAttribute("data-status", "soon");
});

test("backup downloads a file that restores into a fresh browser, and older v2 data migrates", async ({ page, browser }) => {
  await seed(page, sampleData());
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator("#backupBtn").click();
  const save = page.getByRole("button", { name: "Save backup" });
  await expect(save).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent("download"), save.click()]);
  const path = await download.path();
  const backup = JSON.parse(readFileSync(path, "utf8"));
  expect(backup.version).toBe(3);
  expect(backup.tasks).toHaveLength(3);

  const fresh = await browser.newContext({ serviceWorkers: "block" });
  const p2 = await fresh.newPage();
  await p2.addInitScript(() => {
    if (!localStorage.getItem("seeded")) {
      localStorage.setItem("house-upkeep-log:v2", JSON.stringify({ version: 2, tasks: [{ id: "old", name: "Old v2 task", intervalDays: 30, log: [] }], home: [], settings: { currency: "€" } }));
      localStorage.setItem("seeded", "1");
    }
  });
  await p2.goto("/");
  await expect(p2.locator(".row")).toHaveCount(1);
  await p2.getByRole("button", { name: "Settings" }).click();
  await p2.locator("#importFile").setInputFiles(path);
  await expect(p2.locator(".toast")).toContainText("Restored 3 tasks");
  await expect(p2.locator(".row")).toHaveCount(4);
  await fresh.close();
});

test("CSV export downloads a spreadsheet of jobs", async ({ page }) => {
  await seed(page, sampleData());
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export" }).click()]);
  const csv = readFileSync(await download.path(), "utf8");
  expect(csv).toContain("Date,Task,Area,Home,Cost,Notes,Attachments");
  expect(csv).toContain("Clean gutters,Exterior,My home,180,Gutter Pros");
});

test("backup reminder appears after a while and can be postponed", async ({ page }) => {
  const data = sampleData();
  data.local = { currentHomeId: "home", firstUseAt: Date.now() - 10 * 86400000, lastBackupAt: 0 };
  await seed(page, data);
  await page.goto("/");
  await expect(page.locator(".banner")).toContainText("Back up your log");
  await page.locator(".banner").getByRole("button", { name: "Later" }).click();
  await expect(page.locator(".banner")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".banner")).toHaveCount(0);
});

test("no sideways scrolling on a small phone, in light and dark", async ({ page }) => {
  await seed(page, sampleData());
  await page.setViewportSize({ width: 320, height: 640 });
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const view of ["Tasks", "History", "Home info"]) {
      await page.goto("/");
      await page.locator(".tabbar").getByRole("button", { name: view }).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(overflow, `${view} in ${scheme}`).toBeLessThanOrEqual(0);
    }
  }
});

/** Drag a row horizontally with the mouse (pointer events work the same for touch). */
async function swipe(page, rowText, dx) {
  const li = page.locator(".swipe", { hasText: rowText });
  await li.evaluate((el) => el.scrollIntoView({ block: "center" })); // keep clear of the + button and tab bar
  await page.waitForTimeout(100);
  const box = await li.boundingBox();
  const y = box.y + box.height / 2;
  const x = box.x + box.width * (dx > 0 ? 0.2 : 0.8); // start near one edge so the whole drag stays on screen
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y + i * 0.5);
  await page.mouse.up();
}

test("swipe right marks a task done, swipe left snoozes it, short swipes do nothing", async ({ page }) => {
  await seed(page, sampleData());
  await page.goto("/");
  await expect(page.locator(".stat[data-status=late] b")).toHaveText("1");

  await swipe(page, "Clean gutters", 60); // not far enough
  await expect(page.locator(".toast")).toHaveCount(0);
  await expect(page.locator(".sheet")).toHaveCount(0); // and no click on the row
  await expect(page.locator(".stat[data-status=late] b")).toHaveText("1");

  await swipe(page, "Clean gutters", 260);
  await expect(page.locator(".toast")).toContainText("Logged “Clean gutters”");
  await expect(page.locator(".stat[data-status=late] b")).toHaveText("0");

  await swipe(page, "Replace HVAC air filter", -260);
  await expect(page.locator(".toast")).toContainText("Snoozed “Replace HVAC air filter”");
  await expect(page.locator(".swipe", { hasText: "Replace HVAC air filter" })).toContainText("snoozed");
  await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".swipe", { hasText: "Replace HVAC air filter" })).not.toContainText("snoozed");
});

test("swiping a task without a date asks for the date instead", async ({ page }) => {
  await seed(page, sampleData());
  await page.goto("/");
  await swipe(page, "Clean refrigerator coils", 260);
  await expect(page.getByRole("heading", { name: "When did you last do this?" })).toBeVisible();
  await swipe(page, "Clean refrigerator coils", -260).catch(() => {}); // covered by the sheet; nothing should break
});

test("the swipe tip shows once and can be dismissed", async ({ page }) => {
  const data = sampleData();
  data.local.swipeHintSeen = false;
  await seed(page, data);
  await page.goto("/");
  await expect(page.locator(".swipe-tip")).toBeVisible();
  await page.locator(".swipe-tip").getByRole("button", { name: "Got it" }).click();
  await expect(page.locator(".swipe-tip")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".swipe-tip")).toHaveCount(0);
});
