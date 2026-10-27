// Sheets for Home info items, homes, backup and Settings.
import { todayISO } from "./schedule.js";
import { newId, normalizeHomeItem, toBackup, fromBackup, referencedFiles, jobsToCSV, normalizeData } from "./store.js";
import { HOME_INFO_IDEAS } from "./starters.js";
import {
  state, snapshot, putHome, removeHome, setPrefs, setLocal, replaceAll, currentHome, currentHomeId, homeTasks,
  addHome, renameHome, removeHomeAndContents, switchHome,
} from "./state.js";
import { exportFiles, importFiles, storageInfo, requestPersistence } from "./files.js";
import { exportCalendar } from "./task-sheets.js";
import { attachmentField } from "./attachments.js";
import { $, $$, esc, plural, openSheet, closeSheet, armButton, toast, saveFile } from "./ui.js";
import { icon } from "./icons.js";

/* ---------------- Home info ---------------- */
export function openHomeForm(item, preset) {
  const isNew = !item;
  const h = item || { title: preset?.[0] || "", details: "", warrantyUntil: "", files: [] };
  const used = new Set(state.home.size ? [...state.home.values()].filter((x) => x.homeId === currentHomeId()).map((x) => x.title) : []);
  const ideas = HOME_INFO_IDEAS.filter((i) => !used.has(i[0]));
  let attach = null;
  const sheet = openSheet(
    `<form class="sheet-form" id="homeForm">
      <h3>${isNew ? "Add home info" : "Edit home info"}</h3>
      ${isNew && !preset && ideas.length ? `<div class="field"><span class="label">Ideas</span><div class="suggest">${ideas.map((i) => `<button type="button" class="chip" data-idea="${esc(i[0])}">${esc(i[0])}</button>`).join("")}</div></div>` : ""}
      <div class="field"><label for="hTitle">Title</label><input id="hTitle" required maxlength="80" value="${esc(h.title)}" placeholder="e.g. Water heater"></div>
      <div class="field"><label for="hDetails">Details</label><textarea id="hDetails" rows="4" maxlength="1000" placeholder="${esc(preset?.[1] || "Model numbers, sizes, phone numbers, where things are")}">${esc(h.details)}</textarea></div>
      <div class="field"><label for="hWarranty">Warranty ends</label><input id="hWarranty" type="date" value="${esc(h.warrantyUntil)}"><span class="help">Optional. You'll see a warning when it's about to run out.</span></div>
      <div class="field" id="hFiles"></div>
      <div class="actions">
        ${isNew ? "" : `<button type="button" class="btn danger" id="hDelete">Delete</button>`}
        <div class="right"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div>
      </div>
    </form>`,
    null,
    { onClose: () => attach?.discard() }
  );
  attach = attachmentField($("#hFiles", sheet), h.files || [], { labels: ["manual", "warranty", "photo", "receipt"], title: "Manuals, warranties & photos" });
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
      attach.commit();
      closeSheet(sheet);
      toast(`Deleted “${item.title}”.`, [{ label: "Undo", run: () => putHome(item) }]);
    });
  $("#homeForm", sheet).addEventListener("submit", (e) => {
    e.preventDefault();
    const next = normalizeHomeItem({
      ...h,
      id: h.id || newId("h"),
      title: $("#hTitle", sheet).value,
      details: $("#hDetails", sheet).value,
      warrantyUntil: $("#hWarranty", sheet).value,
      files: attach.files(),
    }, h.homeId || currentHomeId());
    if (!next) return;
    putHome(next);
    attach.commit();
    closeSheet(sheet);
  });
  setTimeout(() => $(preset ? "#hDetails" : "#hTitle", sheet)?.focus(), 30);
}

/* ---------------- homes ---------------- */
export function openHomesSheet() {
  const sheet = openSheet("");
  const draw = () => {
    const homes = [...state.homes.values()];
    const count = (id) => [...state.tasks.values()].filter((t) => t.homeId === id).length;
    $(".sheet-body", sheet).innerHTML = `<div class="sheet-form">
      <h3>Your homes</h3>
      <p class="help">Each home has its own tasks, history and Home info.</p>
      <div class="option-list">${homes
        .map(
          (h) => `<div class="home-option" aria-current="${h.id === currentHomeId()}">
            <button type="button" class="option" data-switch="${esc(h.id)}"><span class="option-main"><b>${esc(h.name)}</b><small>${plural(count(h.id), "task")}</small></span>${h.id === currentHomeId() ? icon.check : ""}</button>
            <button type="button" class="icon-btn small" data-rename="${esc(h.id)}" aria-label="Rename ${esc(h.name)}">${icon.edit}</button>
          </div>`
        )
        .join("")}</div>
      <form class="inline-add" id="addHomeForm">
        <input id="newHome" maxlength="40" placeholder="Add a home, e.g. Lake cabin" aria-label="New home name">
        <button class="btn primary" type="submit">Add</button>
      </form>
      <div class="actions"><div class="right"><button type="button" class="btn" data-close>Done</button></div></div>
    </div>`;
    $("#addHomeForm", sheet).addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("#newHome", sheet).value.trim();
      if (!name) return;
      addHome(name);
      closeSheet(sheet);
      toast(`Added “${name}”. You're now looking at it.`);
    });
  };
  sheet.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.switch) {
      switchHome(b.dataset.switch);
      closeSheet(sheet);
    }
    if (b.dataset.rename) openRenameHome(b.dataset.rename, draw);
  });
  draw();
}

function openRenameHome(id, after) {
  const h = state.homes.get(id);
  const sheet = openSheet(`<form class="sheet-form" id="renameForm">
      <h3>Edit home</h3>
      <div class="field"><label for="homeName">Name</label><input id="homeName" required maxlength="40" value="${esc(h.name)}"></div>
      <div class="actions">
        ${state.homes.size > 1 ? `<button type="button" class="btn danger" id="delHome">Delete home</button>` : ""}
        <div class="right"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div>
      </div>
      ${state.homes.size > 1 ? `<p class="help">Deleting a home also deletes its tasks, history and Home info.</p>` : ""}
    </form>`);
  $("#renameForm", sheet).addEventListener("submit", (e) => {
    e.preventDefault();
    renameHome(id, $("#homeName", sheet).value);
    closeSheet(sheet);
    after();
  });
  const del = $("#delHome", sheet);
  if (del)
    armButton(del, "Tap again to delete everything in it", () => {
      removeHomeAndContents(id);
      closeSheet(sheet);
      after();
      toast(`Deleted “${h.name}”.`);
    });
}

/* ---------------- backup ---------------- */
export async function openBackupSheet() {
  const all = snapshot();
  const files = referencedFiles(all.tasks, all.home);
  const sheet = openSheet(`<div class="sheet-form">
      <h3>Back up your log</h3>
      <p class="help">One file with ${plural(all.tasks.length, "task")}, ${plural(all.home.length, "Home info item")} and ${plural(files.size, "photo or document", "photos and documents")}. Save it somewhere other than this phone, like iCloud Drive, Google Drive or your email.</p>
      <button class="btn primary big" id="saveBackup" disabled>Preparing…</button>
      <div class="actions"><div class="right"><button type="button" class="btn" data-close>Close</button></div></div>
    </div>`);
  const btn = $("#saveBackup", sheet);
  let file;
  try {
    const text = toBackup({ ...all, files: await exportFiles(files) });
    file = new File([text], `house-upkeep-backup-${todayISO()}.json`, { type: "application/json" });
    btn.disabled = false;
    btn.textContent = "Save backup";
  } catch {
    btn.textContent = "Couldn't prepare the backup";
    return;
  }
  btn.addEventListener("click", async () => {
    const result = await saveFile(file, { title: "House Upkeep Log backup" });
    if (result === "cancelled") return;
    setLocal({ lastBackupAt: Date.now() });
    closeSheet(sheet);
    toast(result === "shared" ? "Backup saved." : "Backup downloaded. Keep a copy somewhere other than this device.");
  });
}

async function restoreFrom(file) {
  const data = fromBackup(await file.text());
  await importFiles(data.files);
  const cur = snapshot();
  const merged = normalizeData({
    homes: [...cur.homes, ...data.homes.filter((h) => !state.homes.has(h.id))],
    tasks: [...cur.tasks.filter((t) => !data.tasks.some((x) => x.id === t.id)), ...data.tasks],
    home: [...cur.home.filter((h) => !data.home.some((x) => x.id === h.id)), ...data.home],
    prefs: cur.prefs,
    local: cur.local,
    deleted: cur.deleted,
  });
  const stamp = Date.now();
  merged.tasks = merged.tasks.map((t) => (data.tasks.some((x) => x.id === t.id) ? { ...t, updatedAt: stamp } : t));
  merged.home = merged.home.map((h) => (data.home.some((x) => x.id === h.id) ? { ...h, updatedAt: stamp } : h));
  for (const t of [...data.tasks, ...data.home, ...data.homes]) delete merged.deleted[t.id];
  replaceAll(merged);
  return data;
}

/* ---------------- Settings ---------------- */
function formatBytes(n) {
  if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}
const ago = (ms) => {
  if (!ms) return "never";
  const days = Math.floor((Date.now() - ms) / 86400000);
  return days < 1 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
};

/** Extra sections other modules add to Settings (sync and notifications). */
const extraSections = [];
export const addSettingsSection = (fn) => extraSections.push(fn);

export function openSettings() {
  const tasks = homeTasks();
  const p = state.prefs;
  const sheet = openSheet(`<div class="sheet-form">
      <h3>Settings</h3>

      <div id="extraSettings"></div>

      <h4>${esc(currentHome().name)}</h4>
      <section class="setting">
        <div><b>Homes</b><small>${plural(state.homes.size, "home")}. Add a rental, cabin or a parent's place.</small></div>
        <button class="btn" id="homesBtn">Manage</button>
      </section>
      <section class="setting">
        <div><b>Calendar reminders</b><small>Adds this home's tasks to your calendar as repeating events with a 9 am alert. Re-add after big changes.</small></div>
        <button class="btn" id="calAll" ${tasks.length ? "" : "disabled"}>Add all</button>
      </section>
      <section class="setting">
        <div><b>Export jobs to a spreadsheet</b><small>Every logged job with dates and costs, as a CSV file</small></div>
        <button class="btn" id="csvBtn">Export</button>
      </section>

      <h4>Preferences</h4>
      <section class="setting">
        <div><label for="soonDays"><b>“Coming up” starts</b></label><small>How early a task moves into Coming up</small></div>
        <select id="soonDays" class="short-select">${[3, 7, 14, 21, 30].map((d) => `<option value="${d}" ${d === p.soonDays ? "selected" : ""}>${d} days before</option>`).join("")}</select>
      </section>
      <section class="setting">
        <div><label for="currency"><b>Currency symbol</b></label><small>Used for job costs</small></div>
        <input id="currency" class="short" maxlength="4" value="${esc(p.currency)}">
      </section>

      <h4>Your data</h4>
      <section class="setting">
        <div><b>Back up</b><small>Last backup: ${ago(state.local.lastBackupAt)}</small></div>
        <button class="btn" id="backupBtn">Back up</button>
      </section>
      <section class="setting">
        <div><b>Restore from backup</b><small>Adds what's in the file and updates items you already have</small></div>
        <label class="btn" for="importFile">Choose file</label>
        <input type="file" id="importFile" accept="application/json,.json" hidden>
      </section>
      <section class="setting">
        <div><b>Storage on this device</b><small id="storageLine">Checking…</small></div>
        <button class="btn" id="persistBtn" hidden>Protect</button>
      </section>

      <div class="actions"><div class="right"><button type="button" class="btn" data-close>Done</button></div></div>
    </div>`);

  const extra = $("#extraSettings", sheet);
  extraSections.forEach((fn) => fn(extra, sheet));
  if (!extra.children.length) extra.remove();

  $("#homesBtn", sheet).addEventListener("click", () => (closeSheet(sheet), openHomesSheet()));
  $("#calAll", sheet).addEventListener("click", () => exportCalendar(tasks, currentHome().name));
  $("#csvBtn", sheet).addEventListener("click", () => {
    const csv = jobsToCSV([...state.tasks.values()], [...state.homes.values()]);
    saveFile(new File([csv], `house-upkeep-jobs-${todayISO()}.csv`, { type: "text/csv" }), { title: "House Upkeep jobs" });
  });
  $("#soonDays", sheet).addEventListener("change", (e) => setPrefs({ soonDays: Number(e.target.value) }));
  $("#currency", sheet).addEventListener("change", (e) => setPrefs({ currency: e.target.value.trim() || "$" }));
  $("#backupBtn", sheet).addEventListener("click", () => (closeSheet(sheet), openBackupSheet()));

  $("#importFile", sheet).addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await restoreFrom(file);
      closeSheet(sheet);
      toast(`Restored ${plural(data.tasks.length, "task")} and ${plural(data.home.length, "Home info item")}.`);
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
}
