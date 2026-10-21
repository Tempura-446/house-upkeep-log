// Small DOM helpers shared by every screen.

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const plural = (n, word, many = word + "s") => `${n} ${n === 1 ? word : many}`;

export function money(n, symbol = "$") {
  const s = Number(n).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return symbol + s;
}

/* ---------- bottom sheets (stackable: a sheet can open another on top) ---------- */
const stack = [];

export function openSheet(html, onMount, { onClose } = {}) {
  const host = $("#sheetHost");
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  host.append(scrim);
  const entry = { scrim, onClose };
  stack.push(entry);
  scrim.addEventListener("click", (e) => {
    if (e.target === scrim) closeSheet();
    if (e.target.closest("[data-close]")) closeSheet();
  });
  const sheet = $(".sheet", scrim);
  const title = $("h3", sheet);
  if (title) {
    title.id ||= "sheet-title-" + stack.length;
    sheet.setAttribute("aria-labelledby", title.id);
  }
  onMount?.(sheet);
  return sheet;
}

/** Close the top sheet, or a specific one when given its sheet element. */
export function closeSheet(sheetEl) {
  const i = sheetEl ? stack.findIndex((s) => s.scrim.contains(sheetEl)) : stack.length - 1;
  if (i < 0) return;
  const [entry] = stack.splice(i, 1);
  entry.scrim.remove();
  entry.onClose?.();
}

export const closeAllSheets = () => {
  while (stack.length) closeSheet();
};
export const sheetOpen = () => stack.length > 0;

/** Replace the top sheet's contents (used when a sheet re-renders itself). */
export function topSheet() {
  return stack.length ? $(".sheet", stack.at(-1).scrim) : null;
}

/* ---------- inline confirm: first tap arms the button, second tap acts ---------- */
export function armButton(btn, armedLabel, action) {
  btn.addEventListener("click", () => {
    if (!btn.classList.contains("armed")) {
      btn.classList.add("armed");
      btn.dataset.label = btn.textContent;
      btn.textContent = armedLabel;
      setTimeout(() => {
        if (btn.isConnected && btn.classList.contains("armed")) {
          btn.classList.remove("armed");
          btn.textContent = btn.dataset.label;
        }
      }, 4000);
      return;
    }
    action();
  });
}

/* ---------- toast with up to two actions ---------- */
let toastTimer = null;
export function toast(msg, actions = []) {
  clearTimeout(toastTimer);
  const host = $("#toastHost");
  host.innerHTML = `<div class="toast" role="status"><span>${esc(msg)}</span>${actions
    .map((a, i) => `<button data-toast="${i}">${esc(a.label)}</button>`)
    .join("")}</div>`;
  actions.forEach((a, i) =>
    $(`[data-toast="${i}"]`, host).addEventListener("click", () => {
      host.innerHTML = "";
      a.run();
    })
  );
  toastTimer = setTimeout(() => (host.innerHTML = ""), actions.length ? 7000 : 4500);
}

/** Offer a generated file to the user. */
export function download(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
