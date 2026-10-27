// Swipe gestures on task rows: right to mark done, left to snooze a week.
// Works with touch, pen and mouse (pointer events). Buttons on the row keep working for taps,
// and everything a swipe does is also reachable without one.

const LOCK_PX = 10; // movement before we decide whether this is a swipe or a scroll
const COMMIT = 0.32; // fraction of the row width that commits the action
const MAX_COMMIT_PX = 120;

/**
 * @param root      element containing .swipe rows (delegated, so re-rendering is fine)
 * @param actions   { right(id, row) , left(id, row), canLeft(id), canRight(id), onFirstSwipe() }
 */
export function enableSwipe(root, actions) {
  let g = null; // current gesture
  let suppressClickUntil = 0;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  root.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || g) return;
    const li = e.target.closest(".swipe");
    if (!li || li.classList.contains("leaving")) return;
    const row = li.querySelector(".row");
    g = { li, row, id: li.dataset.id, x: e.clientX, y: e.clientY, dx: 0, pointer: e.pointerId, locked: null, armed: null, width: li.offsetWidth };
  });

  root.addEventListener("pointermove", (e) => {
    if (!g || e.pointerId !== g.pointer) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.locked) {
      if (Math.abs(dy) > LOCK_PX && Math.abs(dy) > Math.abs(dx)) return (g = null); // it's a scroll
      if (Math.abs(dx) < LOCK_PX || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      g.locked = true;
      g.li.setPointerCapture?.(e.pointerId);
      g.li.classList.add("swiping");
    }
    e.preventDefault();
    const dir = dx > 0 ? "right" : "left";
    const allowed = dir === "right" ? actions.canRight(g.id) : actions.canLeft(g.id);
    // Rubber-band when the direction isn't available, and past the commit point.
    const limit = Math.min(g.width * COMMIT, MAX_COMMIT_PX);
    let shown = allowed ? dx : dx * 0.18;
    if (allowed && Math.abs(dx) > limit) shown = Math.sign(dx) * (limit + (Math.abs(dx) - limit) * 0.45);
    g.dx = dx;
    g.row.style.transform = `translateX(${shown}px)`;
    g.li.style.setProperty("--reveal", `${Math.abs(shown)}px`);
    g.li.dataset.dir = dir;
    const armed = allowed && Math.abs(dx) >= limit ? dir : null;
    if (armed !== g.armed) {
      g.armed = armed;
      g.li.classList.toggle("armed", Boolean(armed));
      if (armed) navigator.vibrate?.(8);
    }
  });

  const end = (e) => {
    if (!g || e.pointerId !== g.pointer) return;
    const { li, row, id, armed, locked } = g;
    g = null;
    if (!locked) return;
    suppressClickUntil = Date.now() + 400; // the pointerup would otherwise "click" whatever is under it
    li.classList.remove("swiping", "armed");
    if (!armed || e.type === "pointercancel") return snapBack(li, row);
    actions.onFirstSwipe?.();
    if (armed === "right" && actions.rightLeaves?.(id) === false) {
      snapBack(li, row);
      return actions.right(id, li);
    }
    // Slide the row out, then act (the list re-renders and the row moves to its new group).
    li.classList.add("leaving", `leaving-${armed}`);
    if (reduceMotion.matches) return actions[armed](id, li);
    const anim = row.animate([{ transform: row.style.transform }, { transform: `translateX(${armed === "right" ? "" : "-"}105%)` }], {
      duration: 180,
      easing: "cubic-bezier(.3,.7,.4,1)",
      fill: "forwards",
    });
    anim.onfinish = () => actions[armed](id, li);
  };
  root.addEventListener("pointerup", end);
  root.addEventListener("pointercancel", end);

  // Swallow the click that follows a swipe.
  root.addEventListener(
    "click",
    (e) => {
      if (Date.now() < suppressClickUntil) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true
  );

  function snapBack(li, row) {
    const from = row.style.transform;
    row.style.transform = "";
    li.style.removeProperty("--reveal");
    delete li.dataset.dir;
    if (!from || reduceMotion.matches) return;
    row.animate([{ transform: from }, { transform: "translateX(0)" }], { duration: 220, easing: "cubic-bezier(.2,1.4,.4,1)" });
  }
}

/** A one-time nudge that shows the first row can be swiped. */
export function hintSwipe(li) {
  if (!li || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const row = li.querySelector(".row");
  li.dataset.dir = "right";
  li.style.setProperty("--reveal", "72px");
  li.classList.add("hinting");
  const a = row.animate(
    [
      { transform: "translateX(0)" },
      { transform: "translateX(72px)", offset: 0.35 },
      { transform: "translateX(72px)", offset: 0.55 },
      { transform: "translateX(0)" },
    ],
    { duration: 1400, easing: "ease-in-out", delay: 500 }
  );
  // Keep the revealed strip in step with the row while it moves.
  let raf = requestAnimationFrame(function track() {
    const m = new DOMMatrixReadOnly(getComputedStyle(row).transform);
    li.style.setProperty("--reveal", `${Math.max(0, m.m41)}px`);
    raf = requestAnimationFrame(track);
  });
  a.onfinish = a.oncancel = () => {
    cancelAnimationFrame(raf);
    li.classList.remove("hinting");
    li.style.removeProperty("--reveal");
    delete li.dataset.dir;
  };
}

/** A short confetti burst from an element. Skipped when the user prefers less motion. */
export function celebrate(fromEl, { big = false } = {}) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // From the element if it's on screen, otherwise from the upper middle of the screen.
  const r = fromEl?.getBoundingClientRect();
  const onScreen = r && r.bottom > 0 && r.top < innerHeight;
  const x = onScreen ? r.left + Math.min(r.width, 60) / 2 : innerWidth / 2;
  const y = onScreen ? r.top + r.height / 2 : innerHeight * 0.35;
  const colors = ["var(--ok)", "var(--accent)", "var(--soon)", "#7C5CE0", "#0E9FB5"];
  const n = big ? 56 : 20;
  const layer = document.createElement("div");
  layer.className = "confetti";
  layer.setAttribute("aria-hidden", "true");
  document.body.append(layer);
  for (let i = 0; i < n; i++) {
    const p = document.createElement("span");
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.background = colors[i % colors.length];
    if (i % 3 === 0) p.style.borderRadius = "50%";
    layer.append(p);
    const angle = big ? Math.random() * Math.PI * 2 : -Math.PI * 0.9 + Math.random() * Math.PI * 0.8;
    const dist = (big ? 140 : 70) + Math.random() * (big ? 160 : 70);
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    p.animate(
      [
        { transform: "translate(-50%, -50%) scale(1) rotate(0deg)", opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.9) rotate(${Math.random() * 360}deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy + 90}px)) scale(.6) rotate(${Math.random() * 720}deg)`, opacity: 0 },
      ],
      { duration: (big ? 1300 : 850) + Math.random() * 300, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" }
    );
  }
  setTimeout(() => layer.remove(), big ? 1800 : 1300);
}
