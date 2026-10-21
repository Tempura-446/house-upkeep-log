import { statusOf, todayISO, formatShort, describeSchedule, diffDays, totalCost } from "./schedule.js";
import { AREAS, referencedFiles } from "./store.js";
import { HOME_INFO_IDEAS } from "./starters.js";
import { state, onChange, onSaveFailed, reload } from "./state.js";
import { pruneFiles } from "./files.js";
import { markDone, openTaskDetail, openJobSheet, openTaskForm, openStarterSheet } from "./task-sheets.js";
import { openHomeForm, openSettings } from "./other-sheets.js";
import { $, esc, money, plural, toast, closeSheet, sheetOpen } from "./ui.js";

const VIEWS = ["tasks", "history", "home"];

/* ---------------- tasks ---------------- */
const GROUPS = [
  ["new", "Needs a start date", "Tap “Set last date” to tell the app when you last did these."],
  ["late", "Overdue", ""],
  ["soon", "Coming up", ""],
  ["ok", "Later", ""],
];

function taskRow({ t, s }) {
  const last = t.log.length ? `last ${esc(formatShort(t.log.at(-1).date))}` : "never logged";
  const receipts = t.log.reduce((n, e) => n + e.files.length, 0);
  const pill =
    s.key === "new"
      ? `<button class="due new" data-act="setdate" data-id="${esc(t.id)}">Set last date</button>`
      : `<span class="due ${s.key}">${esc(s.label)}</span>`;
  return `<li class="row">
    <button class="main" data-act="detail" data-id="${esc(t.id)}" aria-label="Details for ${esc(t.name)}">
      <span class="name">${esc(t.name)}${t.sample ? ' <span class="sample">example</span>' : ""}</span>
      <span class="meta"><span>${esc(t.area)}</span><span>${esc(describeSchedule(t))}</span><span class="mono">${last}</span>${
        s.snoozed ? '<span class="tag">snoozed</span>' : ""
      }${receipts ? `<span class="tag">${plural(receipts, "receipt")}</span>` : ""}</span>
      ${t.notes ? `<span class="notes">${esc(t.notes)}</span>` : ""}
    </button>
    <div class="side">
      ${pill}
      <span class="row-actions">
        ${s.key === "new" ? "" : `<button class="iconbtn done" data-act="done" data-id="${esc(t.id)}" aria-label="Mark ${esc(t.name)} done today">✓ Done</button>`}
        <button class="iconbtn" data-act="detail" data-id="${esc(t.id)}" aria-label="More for ${esc(t.name)}">More</button>
      </span>
    </div>
  </li>`;
}

function renderTasks(all, today) {
  if (!all.length)
    return `<div class="empty">
      <b>No tasks yet</b>
      <span>Start with a list of common chores, or add your own. Each task tells you when it's next due.</span>
      <div class="empty-actions"><button class="btn primary" data-act="starters">Choose common tasks</button><button class="btn" data-act="add">Add my own</button></div>
    </div>`;
  const shown = all.filter((t) => state.area === "All" || t.area === state.area);
  const rows = shown.map((t) => ({ t, s: statusOf(t, today) })).sort((a, b) => a.s.days - b.s.days || a.t.name.localeCompare(b.t.name));
  return (
    GROUPS.map(([key, title, hint]) => {
      const g = rows.filter((r) => r.s.key === key);
      if (!g.length) return "";
      return `<section class="group"><h2>${title} <small>${g.length}</small></h2>${hint ? `<p class="hint">${hint}</p>` : ""}<ul class="list">${g.map(taskRow).join("")}</ul></section>`;
    }).join("") || `<div class="empty"><b>Nothing in ${esc(state.area)}</b></div>`
  );
}

/* ---------------- history ---------------- */
function renderHistory(all, today) {
  const shown = all.filter((t) => state.area === "All" || t.area === state.area);
  const jobs = [];
  shown.forEach((t) => t.log.forEach((e) => jobs.push({ t, e })));
  if (!jobs.length) return `<div class="empty"><b>Nothing logged yet</b><span>When you mark a task done, it shows up here with its cost and receipts.</span></div>`;
  jobs.sort((a, b) => b.e.date.localeCompare(a.e.date));
  const years = [...new Set(jobs.map((j) => j.e.date.slice(0, 4)))];
  const cur = state.settings.currency;
  return years
    .map((y) => {
      const items = jobs.filter((j) => j.e.date.startsWith(y));
      const spent = totalCost(shown, Number(y));
      return `<section class="group">
        <h2>${y} <small>${plural(items.length, "job")}${spent ? " · " + esc(money(spent, cur)) + " spent" : ""}</small></h2>
        <ul class="hist">${items
          .slice(0, 300)
          .map(
            ({ t, e }) => `<li><button data-act="job" data-id="${esc(t.id)}" data-job="${esc(e.id)}">
              <span class="d">${esc(formatShort(e.date, today))}</span>
              <span class="h-main"><span>${esc(t.name)}</span><span class="a">${esc(t.area)}${e.note ? " · " + esc(e.note) : ""}${e.files.length ? " · " + plural(e.files.length, "receipt") : ""}</span></span>
              <span class="h-cost">${e.cost != null ? esc(money(e.cost, cur)) : ""}</span>
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
  if (d < 0) return `<span class="due late">Warranty ended ${esc(formatShort(iso, today))}</span>`;
  if (d <= 90) return `<span class="due soon">Warranty ends ${esc(formatShort(iso, today))}</span>`;
  return `<span class="due ok">Warranty to ${esc(formatShort(iso, today))}</span>`;
}

function renderHome(today) {
  const items = [...state.home.values()].sort((a, b) => a.title.localeCompare(b.title));
  const used = new Set(items.map((i) => i.title));
  const ideas = HOME_INFO_IDEAS.filter((i) => !used.has(i[0]));
  const ideaChips = ideas.length
    ? `<div class="suggest">${ideas.map((i) => `<button class="chip" data-act="homeidea" data-idea="${esc(i[0])}">+ ${esc(i[0])}</button>`).join("")}</div>`
    : "";
  if (!items.length)
    return `<div class="empty"><b>Keep your home's details in one place</b><span>Filter sizes, model numbers, warranty dates and who to call, ready when you're in the middle of a job.</span>${ideaChips}</div>`;
  return `<ul class="cards">${items
    .map(
      (h) => `<li><button class="card" data-act="home" data-id="${esc(h.id)}">
        <span class="name">${esc(h.title)}</span>
        ${h.details ? `<span class="details">${esc(h.details)}</span>` : ""}
        ${warrantyBadge(h.warrantyUntil, today)}
      </button></li>`
    )
    .join("")}</ul>${ideaChips ? `<div class="more-ideas"><span class="label">Add more</span>${ideaChips}</div>` : ""}`;
}

/* ---------------- shell ---------------- */
function render() {
  const today = todayISO();
  $("#today").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const all = [...state.tasks.values()];

  const onTasks = state.view === "tasks";
  $(".tally").hidden = !onTasks || !all.length;
  if (onTasks) {
    const keys = all.map((t) => statusOf(t, today).key);
    $("#nLate").textContent = keys.filter((k) => k === "late").length;
    $("#nSoon").textContent = keys.filter((k) => k === "soon").length;
    $("#nOk").textContent = keys.filter((k) => k === "ok").length;
  }
  $("#addBtn").textContent = state.view === "home" ? "+ Add info" : "+ Add task";

  VIEWS.forEach((v) => $(`[data-view="${v}"]`).setAttribute("aria-pressed", state.view === v));
  const used = AREAS.filter((a) => all.some((t) => t.area === a));
  if (state.area !== "All" && !used.includes(state.area)) state.area = "All";
  $("#areaChips").innerHTML =
    state.view !== "home" && used.length > 1
      ? ["All", ...used].map((a) => `<button class="chip" data-area="${esc(a)}" aria-pressed="${a === state.area}">${esc(a)}</button>`).join("")
      : "";

  $("#main").innerHTML = state.view === "history" ? renderHistory(all, today) : state.view === "home" ? renderHome(today) : renderTasks(all, today);
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.closest(".sheet") || b.closest(".toast")) return;
  if (b.dataset.area) {
    state.area = b.dataset.area;
    render();
  }
  if (b.dataset.view) {
    state.view = b.dataset.view;
    render();
    window.scrollTo({ top: 0 });
  }
  const { act, id } = b.dataset;
  if (act === "done") markDone(id);
  if (act === "detail") openTaskDetail(id);
  if (act === "setdate") openJobSheet(id, null, { prompt: "When did you last do this?" });
  if (act === "job") openJobSheet(id, b.dataset.job);
  if (act === "add") openTaskForm();
  if (act === "starters") openStarterSheet();
  if (act === "home") openHomeForm(state.home.get(id));
  if (act === "homeidea") openHomeForm(null, HOME_INFO_IDEAS.find((i) => i[0] === b.dataset.idea));
});

$("#addBtn").addEventListener("click", () => (state.view === "home" ? openHomeForm() : openTaskForm()));
$("#settingsBtn").addEventListener("click", openSettings);
document.addEventListener("keydown", (e) => e.key === "Escape" && sheetOpen() && closeSheet());
// Due dates move at midnight: re-render when the app comes back to the foreground.
document.addEventListener("visibilitychange", () => !document.hidden && render());
// Keep two open copies of the app in step.
window.addEventListener("storage", (e) => e.key?.startsWith("house-upkeep-log") && reload());

onChange(render);
onSaveFailed(() => toast("Couldn't save on this device. Your browser may be in private mode or out of space."));
render();

// Tidy up receipt files that no longer belong to any job (e.g. deleted jobs from an earlier visit).
pruneFiles(referencedFiles([...state.tasks.values()])).catch(() => {});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
