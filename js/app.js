import { statusOf, todayISO, formatShort, describeSchedule, diffDays, snooze } from "./schedule.js";
import { AREAS, referencedFiles, spendingByYear } from "./store.js";
import { HOME_INFO_IDEAS } from "./starters.js";
import { state, onChange, onSaveFailed, reload, homeTasks, homeInfoItems, currentHome, setLocal, putTask } from "./state.js";
import { pruneFiles } from "./files.js";
import { markDone, openTaskDetail, openJobSheet, openTaskForm, openStarterSheet } from "./task-sheets.js";
import { openHomeForm, openSettings, openHomesSheet, openBackupSheet } from "./other-sheets.js";
import { $, $$, esc, money, plural, toast, closeSheet, sheetOpen } from "./ui.js";
import { icon, areaIcon } from "./icons.js";
import { enableSwipe, hintSwipe, celebrate } from "./swipe.js";

const VIEWS = { tasks: "Tasks", history: "History", home: "Home info" };
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const DAY = 86400000;
let historyYear = null;

/** Modules that change what counts as "backed up" (sync) register here. */
export const hooks = { isBackedUp: () => false, canSignIn: () => false };

/* ---------------- search ---------------- */
const norm = (s) => String(s || "").toLowerCase();
const matches = (...fields) => {
  const q = norm(state.query).trim();
  if (!q) return true;
  return q.split(/\s+/).every((word) => fields.some((f) => norm(f).includes(word)));
};

/* ---------------- tasks ---------------- */
const GROUPS = [
  ["new", "Needs a start date", "Tap the circle to say when you last did it."],
  ["late", "Overdue", ""],
  ["soon", "Coming up", ""],
  ["ok", "Later", ""],
];

const areaBadge = (area) => `<span class="area-badge" data-area="${esc(area)}">${areaIcon(area)}</span>`;

function taskRow({ t, s }) {
  const files = t.log.reduce((n, e) => n + e.files.length, 0);
  const checkAct = s.key === "new" ? "setdate" : "done";
  const checkLabel = s.key === "new" ? `Set when you last did ${t.name}` : `Mark ${t.name} done today`;
  return `<li class="swipe" data-id="${esc(t.id)}">
    <div class="swipe-bg" aria-hidden="true">
      <span class="sw sw-right">${icon.check}<span>${s.key === "new" ? "Set date" : "Done"}</span></span>
      <span class="sw sw-left"><span>Snooze</span>${icon.snooze}</span>
    </div>
    <div class="row" data-status="${s.key}">
    <button class="check" data-act="${checkAct}" data-id="${esc(t.id)}" aria-label="${esc(checkLabel)}">${icon.check}</button>
    <button class="main" data-act="detail" data-id="${esc(t.id)}" aria-label="Details for ${esc(t.name)}">
      <span class="name">${esc(t.name)}${t.sample ? ' <span class="tag">example</span>' : ""}</span>
      <span class="sub">${areaIcon(t.area, "ic sub-ic")}<span>${esc(t.area)} · ${esc(describeSchedule(t))}</span>${
        s.snoozed ? `<span class="tag">${icon.snooze}snoozed</span>` : ""
      }${files ? `<span class="tag">${icon.receipt}${files}</span>` : ""}</span>
    </button>
    <span class="due ${s.key}">${esc(s.key === "new" ? "No date yet" : s.label)}</span>
    </div>
  </li>`;
}

function backupBanner(all) {
  if (!all.length || hooks.isBackedUp()) return "";
  const { lastBackupAt, backupNudgeAt, firstUseAt } = state.local;
  const since = Date.now() - (lastBackupAt || firstUseAt || Date.now());
  const due = lastBackupAt ? since > 30 * DAY : since > 3 * DAY;
  if (!due || Date.now() - backupNudgeAt < 14 * DAY) return "";
  return `<div class="banner">
    <span class="banner-ic">${icon.backup}</span>
    <div><b>${lastBackupAt ? "Time for a backup" : "Back up your log"}</b><small>Your log lives only on this device. Save a copy somewhere safe${lastBackupAt ? "" : " in case your phone is lost or reset"}.</small></div>
    <div class="banner-actions"><button class="btn primary" data-act="backup">Back up</button><button class="btn" data-act="nudge-later">Later</button></div>
  </div>`;
}

function summaryHTML(all, today) {
  if (!all.length) return "";
  const rows = all.map((t) => ({ t, s: statusOf(t, today, state.prefs.soonDays) }));
  const count = (k) => rows.filter((r) => r.s.key === k).length;
  const urgent = rows.filter((r) => r.s.key === "late" || r.s.key === "soon").sort((a, b) => a.s.days - b.s.days)[0];
  const upcoming = rows.filter((r) => r.s.key === "ok").sort((a, b) => a.s.days - b.s.days)[0];

  const hero = urgent
    ? `<div class="hero" data-status="${urgent.s.key}">
        <div class="hero-top"><span class="hero-label">Up next</span><span class="due ${urgent.s.key}">${esc(urgent.s.label)}</span></div>
        <button class="hero-main" data-act="detail" data-id="${esc(urgent.t.id)}">
          ${areaBadge(urgent.t.area)}
          <span><b>${esc(urgent.t.name)}</b><small>${esc(urgent.t.area)} · ${esc(describeSchedule(urgent.t))}</small></span>
        </button>
        <button class="btn primary hero-done" data-act="done" data-id="${esc(urgent.t.id)}">${icon.check} Mark done</button>
      </div>`
    : `<div class="hero calm">
        <div class="hero-top"><span class="hero-label">All caught up</span></div>
        <p>${upcoming ? `Nothing due in the next ${plural(state.prefs.soonDays, "day")}. Next up is <b>${esc(upcoming.t.name)}</b>, ${esc(upcoming.s.label.toLowerCase())}.` : "Set a date on your tasks to see what's next."}</p>
      </div>`;

  return `${backupBanner(all)}<div class="stats">
      <div class="stat" data-status="late"><b>${count("late")}</b><span>Overdue</span></div>
      <div class="stat" data-status="soon"><b>${count("soon")}</b><span>Coming up</span></div>
      <div class="stat" data-status="ok"><b>${count("ok")}</b><span>On track</span></div>
    </div>${hero}`;
}

function emptyState(title, text, actions = "") {
  return `<div class="empty"><span class="empty-ic">${icon.home}</span><b>${title}</b><span>${text}</span>${actions}</div>`;
}
const noResults = () => emptyState(`No matches for “${esc(state.query)}”`, "Try a different word.");

function renderTasks(all, today) {
  if (!all.length)
    return emptyState(
      state.homes.size > 1 ? `Nothing set up for ${esc(currentHome().name)} yet` : "Let's set up your home",
      "Pick from common chores or add your own. Each task tells you when it's next due.",
      `<div class="empty-actions"><button class="btn primary" data-act="starters">Choose common tasks</button><button class="btn" data-act="add">Add my own</button></div>${
        hooks.canSignIn() && state.homes.size < 2 ? `<button class="link" data-act="signin">I use the app on another device</button>` : ""
      }`
    );
  const shown = all.filter((t) => (state.area === "All" || t.area === state.area) && matches(t.name, t.area, t.notes, describeSchedule(t)));
  if (!shown.length && state.query) return noResults();
  const rows = shown.map((t) => ({ t, s: statusOf(t, today, state.prefs.soonDays) })).sort((a, b) => a.s.days - b.s.days || a.t.name.localeCompare(b.t.name));
  const tip =
    !state.local.swipeHintSeen && rows.some((r) => r.s.key !== "new")
      ? `<div class="swipe-tip"><span>Swipe a task <b>right</b> to mark it done, <b>left</b> to snooze it a week.</span><button class="link" data-act="tip-ok">Got it</button></div>`
      : "";
  return (
    tip +
    GROUPS.map(([key, title, hint]) => {
      const g = rows.filter((r) => r.s.key === key);
      if (!g.length) return "";
      return `<section class="group" data-status="${key}"><h2><span class="dot"></span>${title}<small>${g.length}</small></h2>${hint ? `<p class="hint">${hint}</p>` : ""}<ul class="list">${g.map(taskRow).join("")}</ul></section>`;
    }).join("") || emptyState(`Nothing in ${esc(state.area)}`, "Try another area.")
  );
}

/* ---------------- history ---------------- */
function spendingCard(shown) {
  const years = spendingByYear(shown);
  if (!years.length) return "";
  if (!years.some((y) => y.year === historyYear)) historyYear = years[0].year;
  const y = years.find((x) => x.year === historyYear);
  const max = Math.max(...y.areas.map((a) => a.total));
  const cur = state.prefs.currency;
  return `<section class="spend-card" aria-label="Spending">
    <div class="spend-head">
      <div><span class="hero-label">Spent in ${y.year}</span><b class="spend-total">${esc(money(y.total, cur))}</b></div>
      ${years.length > 1 ? `<div class="segmented small" role="group" aria-label="Year">${years.slice(0, 4).map((x) => `<button data-year="${x.year}" aria-pressed="${x.year === y.year}">${x.year}</button>`).join("")}</div>` : ""}
    </div>
    <ul class="bars">${y.areas
      .map(
        (a) => `<li data-area="${esc(a.area)}">
          <span class="bar-label">${areaIcon(a.area)}${esc(a.area)}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${Math.max(4, (a.total / max) * 100).toFixed(1)}%"></span></span>
          <span class="bar-value">${esc(money(a.total, cur))}</span>
        </li>`
      )
      .join("")}</ul>
  </section>`;
}

function renderHistory(all, today) {
  const inArea = all.filter((t) => state.area === "All" || t.area === state.area);
  const jobs = [];
  inArea.forEach((t) => t.log.forEach((e) => matches(t.name, t.area, e.note, e.date) && jobs.push({ t, e })));
  if (!jobs.length) return state.query ? noResults() : emptyState("Nothing logged yet", "When you mark a task done, it shows up here with its cost, photos and receipts.");
  jobs.sort((a, b) => b.e.date.localeCompare(a.e.date));
  const years = [...new Set(jobs.map((j) => j.e.date.slice(0, 4)))];
  const cur = state.prefs.currency;
  return (
    (state.query ? "" : spendingCard(inArea)) +
    years
      .map((y) => {
        const items = jobs.filter((j) => j.e.date.startsWith(y));
        return `<section class="group">
        <h2>${y}<small>${plural(items.length, "job")}</small></h2>
        <ul class="list">${items
          .slice(0, 300)
          .map(
            ({ t, e }) => `<li class="hrow"><button data-act="job" data-id="${esc(t.id)}" data-job="${esc(e.id)}">
              ${areaBadge(t.area)}
              <span class="h-main"><span class="name">${esc(t.name)}</span><span class="sub">${esc(formatShort(e.date, today))}${e.note ? " · " + esc(e.note) : ""}</span></span>
              <span class="h-end">${e.cost != null ? `<span class="h-cost">${esc(money(e.cost, cur))}</span>` : ""}${e.files.length ? `<span class="tag">${icon.receipt}${e.files.length}</span>` : ""}</span>
            </button></li>`
          )
          .join("")}</ul>
      </section>`;
      })
      .join("")
  );
}

/* ---------------- home info ---------------- */
function warrantyBadge(iso, today) {
  if (!iso) return "";
  const d = diffDays(iso, today);
  if (d < 0) return `<span class="due late">${icon.shield}Warranty ended ${esc(formatShort(iso, today))}</span>`;
  if (d <= 90) return `<span class="due soon">${icon.shield}Warranty ends ${esc(formatShort(iso, today))}</span>`;
  return `<span class="due ok">${icon.shield}Warranty to ${esc(formatShort(iso, today))}</span>`;
}

function renderHome(today) {
  const all = homeInfoItems().sort((a, b) => a.title.localeCompare(b.title));
  const items = all.filter((h) => matches(h.title, h.details));
  const used = new Set(all.map((i) => i.title));
  const ideas = HOME_INFO_IDEAS.filter((i) => !used.has(i[0]));
  const ideaChips = ideas.length
    ? `<div class="suggest">${ideas.map((i) => `<button class="chip" data-act="homeidea" data-idea="${esc(i[0])}">${icon.plus}${esc(i[0])}</button>`).join("")}</div>`
    : "";
  if (!all.length)
    return emptyState(
      "Your home's details, in one place",
      "Filter sizes, model numbers, manuals, warranty dates and who to call, ready when you're in the middle of a job.",
      ideaChips
    );
  if (!items.length) return noResults();
  return `<ul class="cards">${items
    .map(
      (h) => `<li><button class="card" data-act="home" data-id="${esc(h.id)}">
        <span class="card-head"><span class="name">${esc(h.title)}</span>${icon.chevron}</span>
        ${h.details ? `<span class="details">${esc(h.details)}</span>` : ""}
        <span class="card-foot">${warrantyBadge(h.warrantyUntil, today)}${h.files?.length ? `<span class="tag">${icon.receipt}${plural(h.files.length, "file")}</span>` : ""}</span>
      </button></li>`
    )
    .join("")}</ul>${ideaChips && !state.query ? `<div class="more-ideas"><h2>Add more</h2>${ideaChips}</div>` : ""}`;
}

/* ---------------- shell ---------------- */
function render() {
  const today = todayISO();
  const date = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  $("#today").innerHTML =
    state.homes.size > 1
      ? `<button class="home-switch" data-act="homes">${icon.home}<span>${esc(currentHome().name)}</span>${icon.down}</button>`
      : esc(date);
  $("#pageTitle").textContent = VIEWS[state.view];
  const all = homeTasks();

  $("#summary").innerHTML = state.view === "tasks" && !state.query ? summaryHTML(all, today) : "";
  $("#addBtn").setAttribute("aria-label", state.view === "home" ? "Add home info" : "Add task");
  $$("[data-view]").forEach((b) => b.setAttribute("aria-pressed", state.view === b.dataset.view));
  moveIndicator();

  const hasContent = state.view === "home" ? homeInfoItems().length > 0 : all.length > 0;
  $("#searchBar").hidden = !hasContent;
  const input = $("#search");
  input.placeholder = state.view === "home" ? "Search Home info" : state.view === "history" ? "Search history" : "Search tasks";
  if (input.value !== state.query) input.value = state.query;
  $("#clearSearch").hidden = !state.query;

  const used = AREAS.filter((a) => all.some((t) => t.area === a));
  if (state.area !== "All" && !used.includes(state.area)) state.area = "All";
  $("#areaChips").innerHTML =
    state.view !== "home" && used.length > 1
      ? ["All", ...used]
          .map((a) => `<button class="chip" data-area="${esc(a)}" aria-pressed="${a === state.area}">${a === "All" ? "" : areaIcon(a)}${esc(a)}</button>`)
          .join("")
      : "";

  $("#main").innerHTML = state.view === "history" ? renderHistory(all, today) : state.view === "home" ? renderHome(today) : renderTasks(all, today);
}

/** Fill the check circle briefly before the row moves, so the tap feels acknowledged. */
const overdueCount = () => homeTasks().filter((t) => statusOf(t, todayISO(), state.prefs.soonDays).key === "late").length;

/* ---------------- liquid tab indicator ---------------- */
let indicatorAt = null;
function moveIndicator() {
  const ind = $(".tab-indicator");
  const btn = $(`.tabbar [data-view="${state.view}"]`);
  if (!ind || !btn) return;
  const to = { left: btn.offsetLeft, width: btn.offsetWidth };
  const from = indicatorAt;
  indicatorAt = to;
  ind.style.left = `${to.left}px`;
  ind.style.width = `${to.width}px`;
  if (!from || reduceMotion.matches || (from.left === to.left && from.width === to.width)) return;
  // Stretch across both tabs, then pull into the new one, like a drop of liquid.
  const span = { left: Math.min(from.left, to.left), width: Math.abs(to.left - from.left) + Math.max(from.width, to.width) };
  ind.animate(
    [
      { left: `${from.left}px`, width: `${from.width}px` },
      { left: `${span.left}px`, width: `${span.width * 0.82}px`, offset: 0.45 },
      { left: `${to.left}px`, width: `${to.width}px` },
    ],
    { duration: 520, easing: "cubic-bezier(.3,1.25,.4,1)" }
  );
}
addEventListener("resize", () => {
  indicatorAt = null;
  moveIndicator();
});

/** Mark done, with confetti; a bigger burst when that clears the last overdue task. */
function finish(id, fromEl) {
  const before = overdueCount();
  celebrate(fromEl);
  markDone(id);
  if (before > 0 && overdueCount() === 0)
    setTimeout(() => celebrate(null, { big: true }), 450); // the Undo toast stays put
}

/** Fill the check circle briefly before the row moves, so the tap feels acknowledged. */
function completeWithAnimation(btn, id) {
  if (reduceMotion.matches) return markDone(id);
  btn.closest(".row, .hero")?.classList.add("completing");
  btn.disabled = true;
  setTimeout(() => finish(id, btn), 320);
}

function snoozeWeek(id) {
  const t = state.tasks.get(id);
  if (!t) return;
  const snoozed = snooze(t, 7);
  putTask(snoozed);
  toast(`Snoozed “${t.name}” to ${formatShort(snoozed.snoozedUntil)}.`, [{ label: "Undo", run: () => putTask(t) }]);
}

const statusKey = (id) => {
  const t = state.tasks.get(id);
  return t ? statusOf(t, todayISO(), state.prefs.soonDays).key : null;
};

enableSwipe($("#main"), {
  canRight: (id) => Boolean(statusKey(id)),
  canLeft: (id) => statusKey(id) !== "new" && Boolean(statusKey(id)),
  rightLeaves: (id) => statusKey(id) !== "new",
  right: (id, li) => (statusKey(id) === "new" ? openJobSheet(id, null, { prompt: "When did you last do this?" }) : finish(id, li)),
  left: (id) => snoozeWeek(id),
  onFirstSwipe: () => !state.local.swipeHintSeen && setLocal({ swipeHintSeen: true }),
});

let hinted = false;
function maybeHint() {
  if (hinted || state.local.swipeHintSeen || state.view !== "tasks" || state.query || sheetOpen()) return;
  const li = [...document.querySelectorAll("#main .swipe")].find((x) => x.querySelector('.row:not([data-status="new"])'));
  if (!li) return;
  hinted = true;
  hintSwipe(li);
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.closest(".sheet") || b.closest(".toast")) return;
  if (b.dataset.area) {
    state.area = b.dataset.area;
    render();
  }
  if (b.dataset.year) {
    historyYear = Number(b.dataset.year);
    render();
  }
  if (b.dataset.view && b.dataset.view !== state.view) {
    state.view = b.dataset.view;
    state.query = "";
    render();
    const main = $("#main");
    main.classList.remove("view-enter");
    void main.offsetWidth; // restart the entrance animation
    main.classList.add("view-enter");
    window.scrollTo({ top: 0 });
  }
  const { act, id } = b.dataset;
  if (act === "done") completeWithAnimation(b, id);
  if (act === "detail") openTaskDetail(id);
  if (act === "setdate") openJobSheet(id, null, { prompt: "When did you last do this?" });
  if (act === "job") openJobSheet(id, b.dataset.job);
  if (act === "add") openTaskForm();
  if (act === "starters") openStarterSheet();
  if (act === "home") openHomeForm(state.home.get(id));
  if (act === "homeidea") openHomeForm(null, HOME_INFO_IDEAS.find((i) => i[0] === b.dataset.idea));
  if (act === "homes") openHomesSheet();
  if (act === "backup") openBackupSheet();
  if (act === "tip-ok") setLocal({ swipeHintSeen: true });
  if (act === "signin") {
    openSettings();
    setTimeout(() => $("#cloudEmail")?.focus(), 60);
  }
  if (act === "nudge-later") {
    setLocal({ backupNudgeAt: Date.now() });
    toast("OK. I'll remind you again in two weeks.");
  }
});

$("#search").addEventListener("input", (e) => {
  state.query = e.target.value;
  render();
});
$("#clearSearch").addEventListener("click", () => {
  state.query = "";
  render();
  $("#search").focus();
});

$("#settingsBtn").innerHTML = icon.settings;
$("#addBtn").innerHTML = icon.plus;
$("#searchIcon").innerHTML = icon.search;
$("#clearSearch").innerHTML = icon.close;
$$("[data-icon]").forEach((el) => (el.innerHTML = icon[el.dataset.icon]));
$("#addBtn").addEventListener("click", () => (state.view === "home" ? openHomeForm() : openTaskForm()));
$("#settingsBtn").addEventListener("click", openSettings);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && sheetOpen()) closeSheet();
  else if (e.key === "/" && !sheetOpen() && document.activeElement?.tagName !== "INPUT" && !$("#searchBar").hidden) {
    e.preventDefault();
    $("#search").focus();
  }
});
// Due dates move at midnight: re-render when the app comes back to the foreground.
document.addEventListener("visibilitychange", () => !document.hidden && render());
// Keep two open copies of the app in step.
window.addEventListener("storage", (e) => e.key?.startsWith("house-upkeep-log") && reload());
// Shrink the large title into the bar once the page scrolls.
const appbar = $(".appbar");
addEventListener("scroll", () => appbar.classList.toggle("scrolled", scrollY > 8), { passive: true });

onChange(render);
onChange(() => setTimeout(maybeHint, 50));
onSaveFailed(() => toast("Couldn't save on this device. Your browser may be in private mode or out of space."));
render();
setTimeout(maybeHint, 600);

// Tidy up attachments that no longer belong to any job or Home info item.
pruneFiles(referencedFiles([...state.tasks.values()], [...state.home.values()])).catch(() => {});

// Optional features that load after first paint.
import("./cloud.js").then((m) => m.start?.({ hooks, render })).catch(() => {});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
