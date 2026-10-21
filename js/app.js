import { PRESETS, statusOf, todayISO, addDays, formatShort, describeInterval, logCompletion, isValidISO } from "./schedule.js";
import { AREAS, load, save, newId, normalizeTask, toBackup, fromBackup } from "./store.js";
import { COMMON_TASKS } from "./starters.js";

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const state = {
  tasks: new Map(load().map((t) => [t.id, t])),
  area: "All",
  view: "tasks",
};
let toastTimer = null;

/* ---------------- persistence ---------------- */
function commit() {
  if (!save([...state.tasks.values()])) toast("Couldn't save on this device. Your browser may be in private mode or out of space.");
  render();
}
function put(task) {
  state.tasks.set(task.id, task);
  commit();
}
function remove(id) {
  state.tasks.delete(id);
  commit();
}

/* ---------------- rendering ---------------- */
const GROUPS = [
  ["new", "Needs a start date", "Set when you last did these so the app can schedule them."],
  ["late", "Overdue", ""],
  ["soon", "Coming up", ""],
  ["ok", "Later", ""],
];

function render() {
  const today = todayISO();
  $("#today").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const all = [...state.tasks.values()];
  const keys = all.map((t) => statusOf(t, today).key);
  $("#nLate").textContent = keys.filter((k) => k === "late").length;
  $("#nSoon").textContent = keys.filter((k) => k === "soon").length;
  $("#nOk").textContent = keys.filter((k) => k === "ok").length;

  const used = AREAS.filter((a) => all.some((t) => t.area === a));
  if (state.area !== "All" && !used.includes(state.area)) state.area = "All";
  $("#areaChips").innerHTML =
    used.length > 1
      ? ["All", ...used].map((a) => `<button class="chip" data-area="${esc(a)}" aria-pressed="${a === state.area}">${esc(a)}</button>`).join("")
      : "";
  $("#tabTasks").setAttribute("aria-pressed", state.view === "tasks");
  $("#tabHist").setAttribute("aria-pressed", state.view === "hist");

  const main = $("#main");
  if (!all.length) {
    main.innerHTML = `<div class="empty">
      <b>No tasks yet</b>
      <span>Start with a list of common chores, or add your own. Each task tells you when it's next due.</span>
      <div class="empty-actions"><button class="btn primary" data-act="starters">Choose common tasks</button><button class="btn" data-act="add">Add my own</button></div>
    </div>`;
    return;
  }

  const shown = all.filter((t) => state.area === "All" || t.area === state.area);

  if (state.view === "hist") {
    const events = [];
    shown.forEach((t) => (t.history || []).forEach((d) => events.push({ d, t })));
    events.sort((a, b) => b.d.localeCompare(a.d));
    main.innerHTML = events.length
      ? `<ul class="hist">${events
          .slice(0, 200)
          .map((e) => `<li><span class="d">${esc(formatShort(e.d, today))}</span><span>${esc(e.t.name)} <span class="a">· ${esc(e.t.area)}</span></span></li>`)
          .join("")}</ul>`
      : `<div class="empty"><b>Nothing logged yet</b><span>When you mark a task done, it shows up here.</span></div>`;
    return;
  }

  const rows = shown
    .map((t) => ({ t, s: statusOf(t, today) }))
    .sort((a, b) => a.s.days - b.s.days || a.t.name.localeCompare(b.t.name));

  main.innerHTML =
    GROUPS.map(([key, title, hint]) => {
      const g = rows.filter((r) => r.s.key === key);
      if (!g.length) return "";
      return `<section class="group">
        <h2>${title} <small>${g.length}</small></h2>
        ${hint ? `<p class="hint">${hint}</p>` : ""}
        <ul class="list">${g.map(rowHTML).join("")}</ul>
      </section>`;
    }).join("") || `<div class="empty"><b>Nothing in ${esc(state.area)}</b></div>`;
}

function rowHTML({ t, s }) {
  const last = t.lastDone ? `last ${esc(formatShort(t.lastDone))}` : "never logged";
  const doneLabel = s.key === "new" ? "Did it today" : "✓ Done";
  return `<li class="row">
    <div class="main">
      <div class="name">${esc(t.name)}${t.sample ? ' <span class="sample">example</span>' : ""}</div>
      <div class="meta"><span>${esc(t.area)}</span><span>${esc(describeInterval(t.intervalDays))}</span><span class="mono">${last}</span></div>
      ${t.notes ? `<div class="notes">${esc(t.notes)}</div>` : ""}
    </div>
    <div class="side">
      <span class="due ${s.key}">${esc(s.label)}</span>
      <span class="row-actions">
        <button class="iconbtn done" data-act="done" data-id="${esc(t.id)}" aria-label="Mark ${esc(t.name)} done today">${doneLabel}</button>
        <button class="iconbtn" data-act="edit" data-id="${esc(t.id)}" aria-label="Edit ${esc(t.name)}">Edit</button>
      </span>
    </div>
  </li>`;
}

/* ---------------- actions ---------------- */
function markDone(id) {
  const t = state.tasks.get(id);
  if (!t) return;
  const before = structuredClone(t);
  const today = todayISO();
  const updated = logCompletion(t, today);
  put(updated);
  toast(`Logged “${t.name}”. Next due ${formatShort(addDays(updated.lastDone, updated.intervalDays))}.`, () => put(before));
}

/* ---------------- sheets ---------------- */
function openSheet(html, onMount) {
  $("#sheetHost").innerHTML = `<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">${html}</div></div>`;
  $("#scrim").addEventListener("click", (e) => e.target.id === "scrim" && closeSheet());
  onMount?.($(".sheet"));
}
function closeSheet() {
  $("#sheetHost").innerHTML = "";
}

function openTaskSheet(task) {
  const isNew = !task;
  const t = task || { name: "", area: "HVAC", intervalDays: 91, lastDone: todayISO(), notes: "", history: [] };
  const isPreset = PRESETS.some((p) => p[0] === Number(t.intervalDays));
  const existingNames = new Set([...state.tasks.values()].map((x) => x.name));
  const ideas = COMMON_TASKS.filter((i) => !existingNames.has(i[0])).slice(0, 10);

  openSheet(
    `<form id="taskForm" class="sheet-form">
      <h3 id="sheetTitle">${isNew ? "New task" : "Edit task"}</h3>
      ${isNew && ideas.length ? `<div class="field"><span class="label">Common tasks</span><div class="suggest">${ideas.map((i) => `<button type="button" class="chip" data-idea="${esc(i[0])}">${esc(i[0])}</button>`).join("")}</div></div>` : ""}
      <div class="field"><label for="fName">Task</label><input id="fName" required maxlength="80" value="${esc(t.name)}" placeholder="e.g. Replace HVAC air filter" autocomplete="off"></div>
      <div class="pair">
        <div class="field"><label for="fArea">Area</label><select id="fArea">${AREAS.map((a) => `<option ${a === t.area ? "selected" : ""}>${a}</option>`).join("")}</select></div>
        <div class="field"><label for="fEvery">Repeats</label><div class="interval">
          <select id="fEvery">${PRESETS.map((p) => `<option value="${p[0]}" ${p[0] === Number(t.intervalDays) ? "selected" : ""}>${p[1]}</option>`).join("")}<option value="custom" ${isPreset ? "" : "selected"}>Custom…</option></select>
          <input id="fDays" type="number" min="1" max="3650" value="${Number(t.intervalDays)}" aria-label="Days between" ${isPreset ? "hidden" : ""}>
        </div></div>
      </div>
      <div class="field"><label for="fLast">Last done</label><input id="fLast" type="date" value="${esc(t.lastDone || "")}" max="${todayISO()}"><span class="help">Leave blank if you're not sure.</span></div>
      <div class="field"><label for="fNotes">Notes</label><textarea id="fNotes" rows="2" maxlength="300" placeholder="Filter size, part number, who to call">${esc(t.notes || "")}</textarea></div>
      <div class="actions">
        ${isNew ? "" : `<button type="button" class="btn danger" id="delBtn">Delete</button>`}
        <div class="right"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary" type="submit">${isNew ? "Add task" : "Save"}</button></div>
      </div>
    </form>`,
    (sheet) => {
      const every = $("#fEvery", sheet), days = $("#fDays", sheet);
      every.addEventListener("change", () => {
        const custom = every.value === "custom";
        days.hidden = !custom;
        if (!custom) days.value = every.value;
      });
      sheet.querySelectorAll("[data-idea]").forEach((b) =>
        b.addEventListener("click", () => {
          const [name, area, interval, note] = COMMON_TASKS.find((x) => x[0] === b.dataset.idea);
          $("#fName", sheet).value = name;
          $("#fArea", sheet).value = area;
          every.value = String(interval);
          days.value = interval;
          days.hidden = true;
          if (note && !$("#fNotes", sheet).value) $("#fNotes", sheet).value = note;
        })
      );
      const del = $("#delBtn", sheet);
      del?.addEventListener("click", () => {
        if (!del.classList.contains("armed")) {
          del.classList.add("armed");
          del.textContent = "Tap again to delete";
          return;
        }
        closeSheet();
        const before = structuredClone(task);
        remove(task.id);
        toast(`Deleted “${task.name}”.`, () => put(before));
      });
      $("#taskForm", sheet).addEventListener("submit", (e) => {
        e.preventDefault();
        const name = $("#fName", sheet).value.trim();
        if (!name) return;
        const last = $("#fLast", sheet).value;
        const history = [...(t.history || [])];
        if (isValidISO(last) && !history.includes(last)) history.push(last);
        const next = normalizeTask({
          ...t,
          id: t.id || newId(),
          name,
          area: $("#fArea", sheet).value,
          intervalDays: parseInt(days.value, 10),
          notes: $("#fNotes", sheet).value.trim(),
          history,
          sample: false,
        });
        // The date in the form is what the schedule counts from, even if it's older than history.
        next.lastDone = isValidISO(last) ? last : "";
        put(next);
        closeSheet();
      });
      setTimeout(() => $("#fName", sheet).focus(), 30);
    }
  );
}

function openStarterSheet() {
  const existing = new Set([...state.tasks.values()].map((x) => x.name));
  const items = COMMON_TASKS.filter((i) => !existing.has(i[0]));
  openSheet(
    `<form id="starterForm" class="sheet-form">
      <h3 id="sheetTitle">Common tasks</h3>
      <p class="help">Pick the ones that apply to your home. You'll set when you last did each one after adding them.</p>
      <div class="checklist">${items
        .map(
          ([name, area, interval], i) => `<label class="check"><input type="checkbox" value="${esc(name)}" ${i < 10 ? "checked" : ""}>
          <span><b>${esc(name)}</b><small>${esc(area)} · ${esc(describeInterval(interval))}</small></span></label>`
        )
        .join("")}</div>
      <div class="actions"><div class="right"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary" type="submit">Add selected</button></div></div>
    </form>`,
    (sheet) => {
      $("#starterForm", sheet).addEventListener("submit", (e) => {
        e.preventDefault();
        const picked = [...sheet.querySelectorAll("input:checked")].map((c) => c.value);
        COMMON_TASKS.filter((i) => picked.includes(i[0])).forEach(([name, area, intervalDays, notes]) => {
          const t = normalizeTask({ id: newId(), name, area, intervalDays, notes: notes || "" });
          state.tasks.set(t.id, t);
        });
        commit();
        closeSheet();
        if (picked.length) toast(`Added ${picked.length} ${picked.length === 1 ? "task" : "tasks"}.`);
      });
    }
  );
}

function openBackupSheet() {
  const count = state.tasks.size;
  openSheet(
    `<div class="sheet-form">
      <h3 id="sheetTitle">Backup</h3>
      <p class="help">Your tasks are saved in this browser on this device. Download a backup now and then, and use it to move your log to another phone or computer.</p>
      <div class="backup-row">
        <div><b>Download backup</b><small>${count} ${count === 1 ? "task" : "tasks"} as a .json file</small></div>
        <button class="btn" id="exportBtn" ${count ? "" : "disabled"}>Download</button>
      </div>
      <div class="backup-row">
        <div><b>Restore from backup</b><small>Adds tasks from the file and updates ones you already have</small></div>
        <label class="btn" for="importFile">Choose file</label>
        <input type="file" id="importFile" accept="application/json,.json" hidden>
      </div>
      <div class="actions"><div class="right"><button type="button" class="btn" data-act="close">Close</button></div></div>
    </div>`,
    (sheet) => {
      $("#exportBtn", sheet).addEventListener("click", () => {
        const blob = new Blob([toBackup([...state.tasks.values()])], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `house-upkeep-backup-${todayISO()}.json`;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });
      $("#importFile", sheet).addEventListener("change", async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const tasks = fromBackup(await file.text());
          tasks.forEach((t) => state.tasks.set(t.id, t));
          commit();
          closeSheet();
          toast(`Restored ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}.`);
        } catch (err) {
          toast(err.message);
        }
      });
    }
  );
}

/* ---------------- toast ---------------- */
function toast(msg, undo) {
  clearTimeout(toastTimer);
  $("#toastHost").innerHTML = `<div class="toast" role="status"><span>${esc(msg)}</span>${undo ? '<button id="undoBtn">Undo</button>' : ""}</div>`;
  if (undo)
    $("#undoBtn").addEventListener("click", () => {
      undo();
      $("#toastHost").innerHTML = "";
    });
  toastTimer = setTimeout(() => ($("#toastHost").innerHTML = ""), 6000);
}

/* ---------------- wiring ---------------- */
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.area) {
    state.area = b.dataset.area;
    render();
  }
  const act = b.dataset.act;
  if (act === "done") markDone(b.dataset.id);
  if (act === "edit") openTaskSheet(state.tasks.get(b.dataset.id));
  if (act === "add") openTaskSheet();
  if (act === "starters") openStarterSheet();
  if (act === "close") closeSheet();
});
document.addEventListener("keydown", (e) => e.key === "Escape" && closeSheet());
$("#addBtn").addEventListener("click", () => openTaskSheet());
$("#backupBtn").addEventListener("click", openBackupSheet);
$("#tabTasks").addEventListener("click", () => ((state.view = "tasks"), render()));
$("#tabHist").addEventListener("click", () => ((state.view = "hist"), render()));
// Due dates move at midnight: re-render when the app comes back to the foreground.
document.addEventListener("visibilitychange", () => !document.hidden && render());
// Keep tabs in sync if the app is open twice.
window.addEventListener("storage", () => {
  state.tasks = new Map(load().map((t) => [t.id, t]));
  render();
});

render();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
