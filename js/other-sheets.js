// Sheets for Home info items and Settings (calendar, backup, storage, currency).
import { todayISO } from "./schedule.js";
import { newId, normalizeHomeItem, toBackup, fromBackup, referencedFiles, normalizeTask } from "./store.js";
import { HOME_INFO_IDEAS } from "./starters.js";
import { state, putHome, removeHome, commit, setSettings } from "./state.js";
import { exportFiles, importFiles, storageInfo, requestPersistence } from "./files.js";
import { exportCalendar } from "./task-sheets.js";
import { $, $$, esc, plural, openSheet, closeSheet, armButton, toast, download } from "./ui.js";

/* ---------------- Home info ---------------- */
export function openHomeForm(item, preset) {
  const isNew = !item;
  const h = item || { title: preset?.[0] || "", details: "", warrantyUntil: "" };
  const used = new Set([...state.home.values()].map((x) => x.title));
  const ideas = HOME_INFO_IDEAS.filter((i) => !used.has(i[0]));
  const sheet = openSheet(`<form class="sheet-form" id="homeForm">
      <h3>${isNew ? "Add home info" : "Edit home info"}</h3>
      ${isNew && !preset && ideas.length ? `<div class="field"><span class="label">Ideas</span><div class="suggest">${ideas.map((i) => `<button type="button" class="chip" data-idea="${esc(i[0])}">${esc(i[0])}</button>`).join("")}</div></div>` : ""}
      <div class="field"><label for="hTitle">Title</label><input id="hTitle" required maxlength="80" value="${esc(h.title)}" placeholder="e.g. Water heater"></div>
      <div class="field"><label for="hDetails">Details</label><textarea id="hDetails" rows="4" maxlength="1000" placeholder="${esc(preset?.[1] || "Model numbers, sizes, phone numbers, where things are")}">${esc(h.details)}</textarea></div>
      <div class="field"><label for="hWarranty">Warranty ends</label><input id="hWarranty" type="date" value="${esc(h.warrantyUntil)}"><span class="help">Optional. You'll see a warning when it's about to run out.</span></div>
      <div class="actions">
        ${isNew ? "" : `<button type="button" class="btn danger" id="hDelete">Delete</button>`}
        <div class="right"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div>
      </div>
    </form>`);
  $$("[data-idea]", sheet).forEach((b) =>
    b.addEventListener("click", () => {
      const idea = HOME_INFO_IDEAS.find((i) => i[0] === b.dataset.idea);
      $("#hTitle", sheet).value = idea[0];
      $("#hDetails", sheet).placeholder = idea[1];
      $("#hDetails", sheet).focus();
    })
  );
  const del = $("#hDelete", sheet);
  if (del)
    armButton(del, "Tap again to delete", () => {
      removeHome(item.id);
      closeSheet();
      toast(`Deleted “${item.title}”.`, [{ label: "Undo", run: () => putHome(item) }]);
    });
  $("#homeForm", sheet).addEventListener("submit", (e) => {
    e.preventDefault();
    const next = normalizeHomeItem({
      id: h.id || newId("h"),
      title: $("#hTitle", sheet).value,
      details: $("#hDetails", sheet).value,
      warrantyUntil: $("#hWarranty", sheet).value,
    });
    if (!next) return;
    putHome(next);
    closeSheet();
  });
  setTimeout(() => $(preset ? "#hDetails" : "#hTitle", sheet).focus(), 30);
}

/* ---------------- Settings ---------------- */
function formatBytes(n) {
  if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

export function openSettings() {
  const tasks = [...state.tasks.values()];
  const receipts = referencedFiles(tasks).size;
  const sheet = openSheet(`<div class="sheet-form">
      <h3>Settings</h3>

      <section class="setting">
        <div><b>Calendar reminders</b><small>Adds every scheduled task to your phone's calendar as a repeating event with a 9 am alert. Re-add after big changes, since the calendar doesn't update by itself.</small></div>
        <button class="btn" id="calAll" ${tasks.length ? "" : "disabled"}>Add all</button>
      </section>

      <section class="setting">
        <div><b>Download backup</b><small>${plural(tasks.length, "task")}, ${plural(state.home.size, "home info item")} and ${plural(receipts, "receipt")}, as one .json file</small></div>
        <button class="btn" id="exportBtn" ${tasks.length || state.home.size ? "" : "disabled"}>Download</button>
      </section>

      <section class="setting">
        <div><b>Restore from backup</b><small>Adds what's in the file and updates items you already have</small></div>
        <label class="btn" for="importFile">Choose file</label>
        <input type="file" id="importFile" accept="application/json,.json" hidden>
      </section>

      <section class="setting">
        <div><b>Storage</b><small id="storageLine">Checking…</small></div>
        <button class="btn" id="persistBtn" hidden>Protect</button>
      </section>

      <section class="setting">
        <div><label for="currency"><b>Currency symbol</b></label><small>Used for job costs</small></div>
        <input id="currency" class="short" maxlength="4" value="${esc(state.settings.currency)}">
      </section>

      <div class="actions"><div class="right"><button type="button" class="btn" data-close>Done</button></div></div>
    </div>`);

  $("#calAll", sheet).addEventListener("click", () => exportCalendar(tasks));

  $("#exportBtn", sheet).addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "Preparing…";
    try {
      const files = await exportFiles(referencedFiles(tasks));
      const text = toBackup({ tasks, home: [...state.home.values()], files });
      download(new Blob([text], { type: "application/json" }), `house-upkeep-backup-${todayISO()}.json`);
    } catch {
      toast("Couldn't build the backup. Try again.");
    }
    btn.disabled = false;
    btn.textContent = "Download";
  });

  $("#importFile", sheet).addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = fromBackup(await file.text());
      await importFiles(data.files);
      data.tasks.forEach((t) => state.tasks.set(t.id, normalizeTask(t)));
      data.home.forEach((h) => state.home.set(h.id, h));
      commit();
      closeSheet();
      toast(`Restored ${plural(data.tasks.length, "task")} and ${plural(data.home.length, "home info item")}.`);
    } catch (err) {
      toast(err.message || "Couldn't read that backup.");
    }
  });

  const drawStorage = async () => {
    const { persisted, usage } = await storageInfo();
    $("#storageLine", sheet).textContent = `${persisted ? "Protected from automatic clean-up." : "Your browser may clear this data if space runs low."} Using ${formatBytes(usage)}.`;
    $("#persistBtn", sheet).hidden = persisted || !navigator.storage?.persist;
  };
  drawStorage();
  $("#persistBtn", sheet).addEventListener("click", async () => {
    const ok = await requestPersistence();
    toast(ok ? "Storage protected." : "Your browser didn't allow it. Installing the app to your home screen usually helps.");
    drawStorage();
  });

  $("#currency", sheet).addEventListener("change", (e) => setSettings({ currency: e.target.value.trim() || "$" }));
}
