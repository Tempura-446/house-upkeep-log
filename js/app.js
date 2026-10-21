import { statusOf, todayISO, formatShort, describeSchedule, diffDays, totalCost } from "./schedule.js";
import { AREAS, referencedFiles } from "./store.js";
import { HOME_INFO_IDEAS } from "./starters.js";
import { state, onChange, onSaveFailed, reload } from "./state.js";
import { pruneFiles } from "./files.js";
import { markDone, openTaskDetail, openJobSheet, openTaskForm, openStarterSheet } from "./task-sheets.js";
import { openHomeForm, openSettings } from "./other-sheets.js";
import { $, $$, esc, money, plural, toast, closeSheet, sheetOpen } from "./ui.js";
import { icon, areaIcon } from "./icons.js";

const VIEWS = { tasks: "Tasks", history: "History", home: "Home info" };
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

/* ---------------- tasks ---------------- */
const GROUPS = [
  ["new", "Needs a start date", "Tap the circle to say when you last did it."],
  ["late", "Overdue", ""],
  ["soon", "Coming up", ""],
  ["ok", "Later", ""],
];

const areaBadge = (area) => `<span class="area-badge" data-area="${esc(area)}">${areaIcon(area)}</span>`;

function taskRow({ t, s }) {
  const receipts = t.log.reduce((n, e) => n + e.files.length, 0);
  const checkAct = s.key === "new" ? "setdate" : "done";
  const checkLabel = s.key === "new" ? `Set when you last did ${t.name}` : `Mark ${t.name} done today`;
  return `<li class="row" data-status="${s.key}">
    <button class="check" data-act="${checkAct}" data-id="${esc(t.id)}" aria-label="${esc(checkLabel)}">${icon.check}</button>
    <button class="main" data-act="detail" data-id="${esc(t.id)}" aria-label="Details for ${esc(t.name)}">
      <span class="name">${esc(t.name)}${t.sample ? ' <span class="tag">example</span>' : ""}</span>
      <span class="sub">${areaIcon(t.area, "ic sub-ic")}<span>${esc(t.area)} · ${esc(describeSchedule(t))}</span>${
        s.snoozed ? `<span class="tag">${icon.snooze}snoozed</span>` : ""
      }${receipts ? `<span class="tag">${icon.receipt}${receipts}</span>` : ""}</span>
    </button>
    <span class="due ${s.key}">${esc(s.key === "new" ? "No date yet" : s.label)}</span>
  </li>`;
}

function summaryHTML(all, today) {
  if (!all.length) return "";
  const rows = all.map((t) => ({ t, s: statusOf(t, today) }));
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
        <p>${upcoming ? `Nothing due in the next two weeks. Next up is <b>${esc(upcoming.t.name)}</b>, ${esc(upcoming.s.label.toLowerCase())}.` : "Set a date on your tasks to see what's next."}</p>
      </div>`;

  return `<div class="stats">
      <div class="stat" data-status="late"><b>${count("late")}</b><span>Overdue</span></div>
      <div class="stat" data-status="soon"><b>${count("soon")}</b><span>Coming up</span></div>
      <div class="stat" data-status="ok"><b>${count("ok")}</b><span>On track</span></div>
    </div>${hero}`;
}

function emptyState(title, text, actions = "") {
  return `<div class="empty"><span class="empty-ic">${icon.home}</span><b>${title}</b><span>${text}</span>${actions}</div>`;
}

function renderTasks(all, today) {
  if (!all.length)
    return emptyState(
      "Let's set up your home",
      "Pick from common chores or add your own. Each task tells you when it's next due.",
      `<div class="empty-actions"><button class="btn primary" data-act="starters">Choose common tasks</button><button class="btn" data-act="add">Add my own</button></div>`
    );
  const shown = all.filter((t) => state.area === "All" || t.area === state.area);
  const rows = shown.map((t) => ({ t, s: statusOf(t, today) })).sort((a, b) => a.s.days - b.s.days || a.t.name.localeCompare(b.t.name));
  return (
    GROUPS.map(([key, title, hint]) => {
      const g = rows.filter((r) => r.s.key === key);
      if (!g.length) return "";
      return `<section class="group" data-status="${key}"><h2><span class="dot"></span>${title}<small>${g.length}</small></h2>${hint ? `<p class="hint">${hint}</p>` : ""}<ul class="list">${g.map(taskRow).join("")}</ul></section>`;
    }).join("") || emptyState(`Nothing in ${esc(state.area)}`, "Try another area.")
  );
}

/* ---------------- history ---------------- */
function renderHistory(all, today) {
  const shown = all.filter((t) => state.area === "All" || t.area === state.area);
  const jobs = [];
  shown.forEach((t) => t.log.forEach((e) => jobs.push({ t, e })));
  if (!jobs.length) return emptyState("Nothing logged yet", "When you mark a task done, it shows up here with its cost and receipts.");
  jobs.sort((a, b) => b.e.date.localeCompare(a.e.date));
  const years = [...new Set(jobs.map((j) => j.e.date.slice(0, 4)))];
  const cur = state.settings.currency;
  return years
    .map((y) => {
      const items = jobs.filter((j) => j.e.date.startsWith(y));
      const spent = totalCost(shown, Number(y));
      return `<section class="group">
        <div class="year-head"><h2>${y}<small>${plural(items.length, "job")}</small></h2>${spent ? `<span class="year-spent">${esc(money(spent, cur))}<small>spent</small></span>` : ""}</div>
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
    .join("");
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
  const items = [...state.home.values()].sort((a, b) => a.title.localeCompare(b.title));
  const used = new Set(items.map((i) => i.title));
  const ideas = HOME_INFO_IDEAS.filter((i) => !used.has(i[0]));
  const ideaChips = ideas.length
    ? `<div class="suggest">${ideas.map((i) => `<button class="chip" data-act="homeidea" data-idea="${esc(i[0])}">${icon.plus}${esc(i[0])}</button>`).join("")}</div>`
    : "";
  if (!items.length)
    return emptyState(
      "Your home's details, in one place",
      "Filter sizes, model numbers, warranty dates and who to call, ready when you're in the middle of a job.",
      ideaChips
    );
  return `<ul class="cards">${items
    .map(
      (h) => `<li><button class="card" data-act="home" data-id="${esc(h.id)}">
        <span class="card-head"><span class="name">${esc(h.title)}</span>${icon.chevron}</span>
        ${h.details ? `<span class="details">${esc(h.details)}</span>` : ""}
        ${warrantyBadge(h.warrantyUntil, today)}
      </button></li>`
    )
    .join("")}</ul>${ideaChips ? `<div class="more-ideas"><h2>Add more</h2>${ideaChips}</div>` : ""}`;
}

/* ---------------- shell ---------------- */
function render() {
  const today = todayISO();
  $("#today").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  $("#pageTitle").textContent = VIEWS[state.view];
  const all = [...state.tasks.values()];

  $("#summary").innerHTML = state.view === "tasks" ? summaryHTML(all, today) : "";
  $("#addBtn").setAttribute("aria-label", state.view === "home" ? "Add home info" : "Add task");
  $$("[data-view]").forEach((b) => b.setAttribute("aria-pressed", state.view === b.dataset.view));

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
function completeWithAnimation(btn, id) {
  if (reduceMotion.matches) return markDone(id);
  btn.closest(".row, .hero")?.classList.add("completing");
  btn.disabled = true;
  setTimeout(() => markDone(id), 320);
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.closest(".sheet") || b.closest(".toast")) return;
  if (b.dataset.area) {
    state.area = b.dataset.area;
    render();
  }
  if (b.dataset.view && b.dataset.view !== state.view) {
    state.view = b.dataset.view;
    render();
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
});

$("#settingsBtn").innerHTML = icon.settings;
$("#addBtn").innerHTML = icon.plus;
$$("[data-icon]").forEach((el) => (el.innerHTML = icon[el.dataset.icon]));
$("#addBtn").addEventListener("click", () => (state.view === "home" ? openHomeForm() : openTaskForm()));
$("#settingsBtn").addEventListener("click", openSettings);
document.addEventListener("keydown", (e) => e.key === "Escape" && sheetOpen() && closeSheet());
// Due dates move at midnight: re-render when the app comes back to the foreground.
document.addEventListener("visibilitychange", () => !document.hidden && render());
// Keep two open copies of the app in step.
window.addEventListener("storage", (e) => e.key?.startsWith("house-upkeep-log") && reload());
// Shrink the large title into the bar once the page scrolls.
const appbar = $(".appbar");
addEventListener("scroll", () => appbar.classList.toggle("scrolled", scrollY > 8), { passive: true });

onChange(render);
onSaveFailed(() => toast("Couldn't save on this device. Your browser may be in private mode or out of space."));
render();

// Tidy up receipt files that no longer belong to any job (e.g. deleted jobs from an earlier visit).
pruneFiles(referencedFiles([...state.tasks.values()])).catch(() => {});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
