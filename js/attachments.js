// Photos and PDFs attached to jobs (receipts, before/after) and to Home info items (manuals, warranties).
import { FILE_LABELS } from "./store.js";
import { addFile, deleteFile, fileURL, getFile, setFileLabel } from "./files.js";
import { $, $$, esc, openSheet, toast } from "./ui.js";
import { icon } from "./icons.js";

export function thumbsHTML(fileIds, { removable = false } = {}) {
  return fileIds
    .map(
      (f) => `<span class="thumb" data-file="${esc(f)}"><button type="button" class="thumb-open" data-open-file="${esc(f)}" aria-label="Open attachment"></button><span class="thumb-label"></span>${
        removable ? `<button type="button" class="thumb-x" data-remove-file="${esc(f)}" aria-label="Remove attachment">×</button>` : ""
      }</span>`
    )
    .join("");
}

/** Fill thumbnail placeholders with images (or a PDF tile) and their labels once the files load. */
export async function hydrateThumbs(root) {
  for (const el of $$(".thumb[data-file]:not([data-ready])", root)) {
    el.dataset.ready = "1";
    const id = el.dataset.file;
    const rec = await getFile(id).catch(() => null);
    const btn = $(".thumb-open", el);
    if (!rec) {
      btn.innerHTML = `<span class="missing">Not on this device</span>`;
      continue;
    }
    $(".thumb-label", el).textContent = FILE_LABELS[rec.label] || "";
    if (rec.type === "application/pdf") btn.innerHTML = `<span class="pdf">PDF</span>`;
    else btn.innerHTML = `<img alt="${esc(FILE_LABELS[rec.label] || "Attachment")} photo" src="${await fileURL(id)}">`;
  }
}

/** Show an attachment. With onLabel, the viewer also lets you change its label. */
export async function openFile(id, { labels, onLabel } = {}) {
  const rec = await getFile(id).catch(() => null);
  if (!rec) return toast("That attachment isn't on this device. If you use sync, it will download when you're online.");
  const url = await fileURL(id);
  const labelPicker =
    labels && onLabel
      ? `<div class="segmented" role="group" aria-label="Label">${labels
          .map((l) => `<button type="button" data-label="${l}" aria-pressed="${rec.label === l}">${FILE_LABELS[l]}</button>`)
          .join("")}</div>`
      : "";
  const sheet = openSheet(
    `<div class="sheet-form">
      <h3>${esc(FILE_LABELS[rec.label] || "Attachment")}</h3>
      ${labelPicker}
      ${rec.type === "application/pdf" ? `<p class="help">${esc(rec.name)}</p>` : `<img class="viewer" alt="${esc(FILE_LABELS[rec.label] || "Attachment")} photo" src="${url}">`}
      <div class="actions"><div class="right"><button type="button" class="btn" data-close>Close</button>${
        rec.type === "application/pdf" ? `<a class="btn primary" href="${url}" target="_blank" rel="noopener">Open PDF</a>` : ""
      }</div></div>
    </div>`
  );
  $$("[data-label]", sheet).forEach((b) =>
    b.addEventListener("click", async () => {
      await setFileLabel(id, b.dataset.label);
      $$("[data-label]", sheet).forEach((x) => x.setAttribute("aria-pressed", x === b));
      $("h3", sheet).textContent = FILE_LABELS[b.dataset.label];
      onLabel(b.dataset.label);
    })
  );
}

/**
 * An editable attachment area inside a form.
 * Returns { files(), commit(), discard() }: call commit() when the form saves and discard() when it's cancelled,
 * so files added and then abandoned don't linger.
 */
export function attachmentField(container, initial, { labels = ["receipt", "before", "after"], title = "Photos & receipts" } = {}) {
  let files = [...initial];
  const added = [];
  let addAs = labels[0];
  container.innerHTML = `
    <span class="label">${title}</span>
    <div class="thumbs"></div>
    ${labels.length > 1 ? `<div class="segmented small" role="group" aria-label="Add as">${labels.map((l) => `<button type="button" data-add-as="${l}" aria-pressed="${l === addAs}">${FILE_LABELS[l]}</button>`).join("")}</div>` : ""}
    <label class="add-receipt">${icon.camera}<span>Add ${labels.length > 1 ? "photo or PDF" : FILE_LABELS[labels[0]].toLowerCase()}</span><input type="file" accept="image/*,application/pdf" multiple hidden></label>
    <span class="help file-status" aria-live="polite"></span>`;
  const thumbs = $(".thumbs", container);
  const status = $(".file-status", container);
  const draw = () => {
    thumbs.innerHTML = thumbsHTML(files, { removable: true });
    hydrateThumbs(thumbs);
  };
  draw();

  container.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.addAs) {
      addAs = b.dataset.addAs;
      $$("[data-add-as]", container).forEach((x) => x.setAttribute("aria-pressed", x === b));
    } else if (b.dataset.removeFile) {
      files = files.filter((f) => f !== b.dataset.removeFile);
      draw();
    } else if (b.dataset.openFile) {
      const id = b.dataset.openFile;
      openFile(id, { labels, onLabel: () => { const el = $(`.thumb[data-file="${CSS.escape(id)}"]`, thumbs); if (el) { delete el.dataset.ready; hydrateThumbs(thumbs); } } });
    }
  });

  $("input[type=file]", container).addEventListener("change", async (e) => {
    const picked = [...e.target.files];
    e.target.value = "";
    for (const file of picked) {
      status.textContent = `Saving ${file.name || "file"}…`;
      try {
        const id = await addFile(file, addAs);
        added.push(id);
        files.push(id);
        draw();
        status.textContent = "";
      } catch (err) {
        status.textContent = err.message;
      }
    }
  });

  let done = false;
  return {
    files: () => [...files],
    commit: () => (done = true),
    discard: () => {
      if (!done) added.forEach((f) => deleteFile(f));
    },
  };
}

