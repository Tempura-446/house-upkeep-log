// Sheets for a single task: details, logging a job (with cost and receipts), editing, and the starter list.
import {
  PRESETS, MONTHS, statusOf, todayISO, formatShort, describeSchedule, logJob, updateJob, removeJob,
  snooze, nextDue, lastDoneOf, isValidISO,
} from "./schedule.js";
import { AREAS, newId, normalizeTask } from "./store.js";
import { COMMON_TASKS } from "./starters.js";
import { state, putTask, removeTask, onChange, commit } from "./state.js";
import { addFile, deleteFile, fileURL, getFile } from "./files.js";
import { buildCalendar } from "./ics.js";
import { $, $$, esc, money, plural, openSheet, closeSheet, armButton, toast, download } from "./ui.js";
import { icon, areaIcon } from "./icons.js";

const cur = () => state.settings.currency;

/* ---------------- quick "Done" from the list ---------------- */
export function markDone(id) {
  const t = state.tasks.get(id);
  if (!t) return;
  const updated = logJob(t, { date: todayISO() });
  putTask(updated);
  const entry = updated.log.findLast((e) => e.date === todayISO());
  const due = nextDue(updated);
  toast(`Logged “${t.name}”.${due ? " Next due " + formatShort(due) + "." : ""}`, [
    { label: "Undo", run: () => putTask(t) },
    { label: "Add cost", run: () => openJobSheet(id, entry.id) },
  ]);
}

/* ---------------- receipt thumbnails ---------------- */
function thumbsHTML(fileIds, { removable = false } = {}) {
  return fileIds
    .map(
      (f) => `<span class="thumb" data-file="${esc(f)}"><button type="button" class="thumb-open" data-open-file="${esc(f)}" aria-label="Open receipt"></button>${
        removable ? `<button type="button" class="thumb-x" data-remove-file="${esc(f)}" aria-label="Remove receipt">×</button>` : ""
      }</span>`
    )
    .join("");
}

/** Fill thumbnail placeholders with images (or a PDF tile) once the files load. */
export async function hydrateThumbs(root) {
  for (const el of $$(".thumb[data-file]:not([data-ready])", root)) {
    el.dataset.ready = "1";
    const id = el.dataset.file;
    const rec = await getFile(id).catch(() => null);
    const btn = $(".thumb-open", el);
    if (!rec) {
      btn.textContent = "Missing";
      continue;
    }
    if (rec.type === "application/pdf") btn.innerHTML = `<span class="pdf">PDF</span>`;
    else btn.innerHTML = `<img alt="Receipt photo" src="${await fileURL(id)}">`;
  }
}

export async function openFile(id) {
  const rec = await getFile(id).catch(() => null);
  if (!rec) return toast("That receipt is no longer on this device.");
  const url = await fileURL(id);
  if (rec.type === "application/pdf") {
    openSheet(
      `<div class="sheet-form"><h3>${esc(rec.name)}</h3><p class="help">PDF receipt saved on this device.</p>
       <div class="actions"><div class="right"><button type="button" class="btn" data-close>Close</button><a class="btn primary" href="${url}" target="_blank" rel="noopener">Open PDF</a></div></div></div>`
    );
    return;
  }
  openSheet(
    `<div class="sheet-form"><h3>Receipt</h3><img class="viewer" alt="Receipt photo" src="${url}">
     <div class="actions"><div class="right"><button type="button" class="btn" data-close>Close</button></div></div></div>`
  );
}

/* ---------------- task details ---------------- */
export function openTaskDetail(id) {
  let off = null;
  const sheet = openSheet("", null, { onClose: () => off?.() });
  const draw = () => {
    const t = state.tasks.get(id);
    if (!t) return closeSheet(sheet);
    const s = statusOf(t);
    const jobs = [...t.log].reverse();
    const spent = t.log.reduce((n, e) => n + (e.cost || 0), 0);
    $(".sheet-body", sheet).innerHTML = `<div class="sheet-form">
      <div class="detail-head">
        <span class="area-badge lg" data-area="${esc(t.area)}">${areaIcon(t.area)}</span>
        <div class="detail-title">
          <h3>${esc(t.name)}</h3>
          <div class="meta"><span>${esc(t.area)}</span><span>${esc(describeSchedule(t))}</span>${s.snoozed ? "<span>snoozed</span>" : ""}</div>
        </div>
      </div>
      <div class="detail-status" data-status="${s.key}">
        <span class="due ${s.key}">${esc(s.key === "new" ? "No date yet" : s.label)}</span>
        <span class="muted">${t.log.length ? `Last done ${esc(formatShort(t.log.at(-1).date))}` : "Never logged"}</span>
      </div>
      ${t.notes ? `<p class="notes-block">${esc(t.notes)}</p>` : ""}
      <div class="action-grid">
        <button type="button" class="tile primary" data-do="log">${icon.check}<span>Log a job</span></button>
        <button type="button" class="tile" data-do="snooze" ${s.key === "new" ? "disabled" : ""}>${icon.snooze}<span>Snooze a week</span></button>
        <button type="button" class="tile" data-do="cal" ${s.key === "new" ? "disabled" : ""}>${icon.calendar}<span>Add to calendar</span></button>
        <button type="button" class="tile" data-do="edit">${icon.edit}<span>Edit task</span></button>
      </div>
      <div class="field">
        <span class="label">Job history${spent ? ` · ${money(spent, cur())} total` : ""}</span>
        ${
          jobs.length
            ? `<ul class="jobs">${jobs
                .map(
                  (e) => `<li>
                <button type="button" class="job" data-job="${esc(e.id)}">
                  <span class="d">${esc(formatShort(e.date))}</span>
                  <span class="job-main">${e.note ? esc(e.note) : '<span class="muted">No notes</span>'}</span>
                  <span class="job-cost">${e.cost != null ? esc(money(e.cost, cur())) : ""}</span>
                </button>
                ${e.files.length ? `<div class="thumbs">${thumbsHTML(e.files)}</div>` : ""}
              </li>`
                )
                .join("")}</ul>`
            : `<p class="help">No jobs logged yet. Tap “Log a job” to record when you did it, what it cost and the receipt.</p>`
        }
      </div>
      <div class="actions"><div class="right"><button type="button" class="btn" data-close>Close</button></div></div>
    </div>`;
    hydrateThumbs(sheet);
  };
  sheet.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const t = state.tasks.get(id);
    if (b.dataset.do === "log") openJobSheet(id);
    if (b.dataset.do === "edit") openTaskForm(t);
    if (b.dataset.do === "snooze") {
      const snoozed = snooze(t, 7);
      putTask(snoozed);
      toast(`Snoozed to ${formatShort(snoozed.snoozedUntil)}.`, [{ label: "Undo", run: () => putTask(t) }]);
    }
    if (b.dataset.do === "cal") exportCalendar([t], t.name);
    if (b.dataset.job) openJobSheet(id, b.dataset.job);
    if (b.dataset.openFile) openFile(b.dataset.openFile);
  });
  draw();
  off = onChange(draw);
}

/* ---------------- log or edit a job ---------------- */
export function openJobSheet(taskId, entryId = null, { prompt } = {}) {
  const t = state.tasks.get(taskId);
  if (!t) return;
  const entry = entryId ? t.log.find((e) => e.id === entryId) : null;
  const added = []; // files saved during this sheet, removed again if cancelled
  let files = entry ? [...entry.files] : [];
  let saved = false;

  const sheet = openSheet(
    `<form class="sheet-form" id="jobForm">
      <h3>${entry ? "Edit job" : prompt || "Log a job"}</h3>
      <p class="help">${esc(t.name)}</p>
      <div class="pair">
        <div class="field"><label for="jDate">Date done</label><input id="jDate" type="date" required value="${esc(entry?.date || todayISO())}" max="${todayISO()}"></div>
        <div class="field"><label for="jCost">Cost (${esc(cur())})</label><input id="jCost" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00" value="${entry?.cost ?? ""}"></div>
      </div>
      <div class="field"><label for="jNote">Notes</label><input id="jNote" maxlength="200" placeholder="Who did it, parts used, anything to remember" value="${esc(entry?.note || "")}"></div>
      <div class="field">
        <span class="label">Receipts</span>
        <div class="thumbs" id="jThumbs"></div>
        <label class="add-receipt" for="jFile">${icon.camera}<span>Add photo or PDF</span></label>
        <input id="jFile" type="file" accept="image/*,application/pdf" multiple hidden>
        <span class="help" id="jFileStatus" aria-live="polite"></span>
      </div>
      <div class="actions">
        ${entry ? `<button type="button" class="btn danger" id="jDelete">Delete job</button>` : ""}
        <div class="right"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div>
      </div>
    </form>`,
    null,
    { onClose: () => !saved && added.forEach((f) => deleteFile(f)) }
  );

  const drawThumbs = () => {
    $("#jThumbs", sheet).innerHTML = thumbsHTML(files, { removable: true });
    hydrateThumbs(sheet);
  };
  drawThumbs();

  sheet.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b?.dataset.removeFile) {
      files = files.filter((f) => f !== b.dataset.removeFile);
      drawThumbs();
    } else if (b?.dataset.openFile) openFile(b.dataset.openFile);
  });

  $("#jFile", sheet).addEventListener("change", async (e) => {
    const status = $("#jFileStatus", sheet);
    const picked = [...e.target.files];
    e.target.value = "";
    for (const file of picked) {
      status.textContent = `Saving ${file.name || "receipt"}…`;
      try {
        const id = await addFile(file);
        added.push(id);
        files.push(id);
        drawThumbs();
        status.textContent = "";
      } catch (err) {
        status.textContent = err.message;
      }
    }
  });

  const del = $("#jDelete", sheet);
  if (del)
    armButton(del, "Tap again to delete", () => {
      const before = state.tasks.get(taskId);
      putTask(removeJob(before, entry.id));
      saved = true;
      closeSheet();
      toast("Job deleted.", [{ label: "Undo", run: () => putTask(before) }]);
    });

  $("#jobForm", sheet).addEventListener("submit", (e) => {
    e.preventDefault();
    const date = $("#jDate", sheet).value;
    if (!isValidISO(date)) return;
    const costRaw = $("#jCost", sheet).value.trim();
    const cost = costRaw === "" ? null : Math.round(Math.max(0, Number(costRaw)) * 100) / 100;
    const note = $("#jNote", sheet).value.trim();
    const current = state.tasks.get(taskId);
    putTask(entry ? updateJob(current, entry.id, { date, cost, note, files }) : logJob(current, { date, cost, note, files }));
    saved = true;
    closeSheet();
    if (!entry) toast(`Logged “${t.name}” for ${formatShort(date)}.`);
  });
}

/* ---------------- add / edit task ---------------- */
function repeatOptions(t) {
  const isPreset = t.schedule === "interval" && PRESETS.some((p) => p[0] === t.intervalDays);
  const opts = PRESETS.map((p) => `<option value="${p[0]}" ${t.schedule === "interval" && p[0] === t.intervalDays ? "selected" : ""}>${p[1]}</option>`);
  opts.push(`<option value="custom" ${t.schedule === "interval" && !isPreset ? "selected" : ""}>Every … days</option>`);
  opts.push(`<option value="seasonal" ${t.schedule === "seasonal" ? "selected" : ""}>Once a year, in a set month</option>`);
  return opts.join("");
}

export function openTaskForm(task) {
  const isNew = !task;
  const t = task || { name: "", area: "HVAC", schedule: "interval", intervalDays: 91, month: new Date().getMonth() + 1, notes: "", log: [] };
  const names = new Set([...state.tasks.values()].map((x) => x.name));
  const ideas = COMMON_TASKS.filter((i) => !names.has(i.name)).slice(0, 10);

  const sheet = openSheet(`<form id="taskForm" class="sheet-form">
      <h3>${isNew ? "New task" : "Edit task"}</h3>
      ${isNew && ideas.length ? `<div class="field"><span class="label">Common tasks</span><div class="suggest">${ideas.map((i) => `<button type="button" class="chip" data-idea="${esc(i.name)}">${esc(i.name)}</button>`).join("")}</div></div>` : ""}
      <div class="field"><label for="fName">Task</label><input id="fName" required maxlength="80" value="${esc(t.name)}" placeholder="e.g. Replace HVAC air filter" autocomplete="off"></div>
      <div class="pair">
        <div class="field"><label for="fArea">Area</label><select id="fArea">${AREAS.map((a) => `<option ${a === t.area ? "selected" : ""}>${a}</option>`).join("")}</select></div>
        <div class="field"><label for="fEvery">Repeats</label><select id="fEvery">${repeatOptions(t)}</select></div>
      </div>
      <div class="field" id="fDaysField"><label for="fDays">Days between</label><input id="fDays" type="number" min="1" max="3650" inputmode="numeric" value="${t.intervalDays}"></div>
      <div class="field" id="fMonthField"><label for="fMonth">Month</label><select id="fMonth">${MONTHS.map((m, i) => `<option value="${i + 1}" ${i + 1 === Number(t.month) ? "selected" : ""}>${m}</option>`).join("")}</select>
        <span class="help">It shows as due during that month and stays quiet the rest of the year.</span></div>
      ${isNew ? `<div class="field"><label for="fLast">Last done</label><input id="fLast" type="date" max="${todayISO()}"><span class="help">Optional. Leave blank if you're not sure.</span></div>` : ""}
      <div class="field"><label for="fNotes">Notes</label><textarea id="fNotes" rows="2" maxlength="300" placeholder="Filter size, part number, who to call">${esc(t.notes || "")}</textarea></div>
      <div class="actions">
        ${isNew ? "" : `<button type="button" class="btn danger" id="delBtn">Delete task</button>`}
        <div class="right"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">${isNew ? "Add task" : "Save"}</button></div>
      </div>
    </form>`);

  const every = $("#fEvery", sheet), days = $("#fDays", sheet), month = $("#fMonth", sheet);
  const sync = () => {
    $("#fDaysField", sheet).hidden = every.value !== "custom";
    $("#fMonthField", sheet).hidden = every.value !== "seasonal";
    if (/^\d+$/.test(every.value)) days.value = every.value;
  };
  every.addEventListener("change", sync);
  sync();

  $$("[data-idea]", sheet).forEach((b) =>
    b.addEventListener("click", () => {
      const i = COMMON_TASKS.find((x) => x.name === b.dataset.idea);
      $("#fName", sheet).value = i.name;
      $("#fArea", sheet).value = i.area;
      every.value = i.schedule === "seasonal" ? "seasonal" : String(i.intervalDays);
      if (i.schedule === "seasonal") month.value = String(i.month);
      sync();
      if (i.notes && !$("#fNotes", sheet).value) $("#fNotes", sheet).value = i.notes;
    })
  );

  const del = $("#delBtn", sheet);
  if (del)
    armButton(del, "Tap again to delete", () => {
      closeSheet(sheet);
      removeTask(task.id); // the details sheet underneath closes itself when its task is gone
      toast(`Deleted “${task.name}”.`, [{ label: "Undo", run: () => putTask(task) }]);
    });

  $("#taskForm", sheet).addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#fName", sheet).value.trim();
    if (!name) return;
    const seasonal = every.value === "seasonal";
    let next = normalizeTask({
      ...t,
      id: t.id || newId(),
      name,
      area: $("#fArea", sheet).value,
      schedule: seasonal ? "seasonal" : "interval",
      intervalDays: seasonal ? 365 : parseInt(days.value, 10),
      month: Number(month.value),
      notes: $("#fNotes", sheet).value.trim(),
      sample: false,
    });
    const last = $("#fLast", sheet)?.value;
    if (isValidISO(last)) next = logJob(next, { date: last });
    putTask(next);
    closeSheet();
    if (isNew) toast(`Added “${name}”.`);
  });
  if (isNew) setTimeout(() => $("#fName", sheet).focus(), 30);
}

/* ---------------- starter list ---------------- */
export function openStarterSheet() {
  const names = new Set([...state.tasks.values()].map((x) => x.name));
  const items = COMMON_TASKS.filter((i) => !names.has(i.name));
  const sheet = openSheet(`<form id="starterForm" class="sheet-form">
      <h3>Common tasks</h3>
      <p class="help">Pick the ones that apply to your home. Seasonal ones are scheduled right away; for the rest you'll set when you last did them.</p>
      <div class="checklist">${items
        .map(
          (i, n) => `<label class="check-row"><input type="checkbox" value="${esc(i.name)}" ${n < 10 ? "checked" : ""}>
          <span><b>${esc(i.name)}</b><small>${esc(i.area)} · ${esc(describeSchedule(i))}</small></span></label>`
        )
        .join("")}</div>
      <div class="actions"><div class="right"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Add selected</button></div></div>
    </form>`);
  $("#starterForm", sheet).addEventListener("submit", (e) => {
    e.preventDefault();
    const picked = $$("input:checked", sheet).map((c) => c.value);
    COMMON_TASKS.filter((i) => picked.includes(i.name)).forEach((i) => {
      const t = normalizeTask({ ...i, id: newId() });
      state.tasks.set(t.id, t);
    });
    commit();
    closeSheet();
    if (picked.length) toast(`Added ${plural(picked.length, "task")}.`);
  });
}

/* ---------------- calendar export ---------------- */
export function exportCalendar(tasks, label = "Home maintenance") {
  const { text, count } = buildCalendar(tasks);
  if (!count) return toast("Nothing to add yet. Set a last-done date first.");
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "home-maintenance";
  download(new Blob([text], { type: "text/calendar;charset=utf-8" }), `${slug}.ics`);
  toast(`Calendar file ready with ${plural(count, "reminder")}. Open it to add to your calendar.`);
}
