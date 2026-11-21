// PROTOTYPE, throwaway: lives on its own branch, never on main.
// Question: what should an animated banner that reflects the board's stages look like,
// on desktop and on a 375px phone crop?
// Three variants of the banner on the real board page, switchable with ?variant=A|B|C,
// fed by ?scenario=live|quiet|busy|stuck|paused (fake boards; live = board.json).
//   A  Glow stations   the painting's own props light up per stage (panels, lantern, pots, crate)
//   B  Holo readouts   the robots' holo screens show each stage's count
//   C  Conveyor        one light per card riding a track along the deck's front edge
// Every overlay is an SVG in the image's own 2400x800 coordinates, cropped exactly like the
// <img> (preserveAspectRatio "xMidYMax slice" = object-fit cover, object-position center bottom).
/** @import { Board, Card } from "../scripts/board.ts" */

const VARIANTS = /** @type {const} */ ({ A: "Glow stations", B: "Holo readouts", C: "Conveyor" });
const SCENARIOS = ["live", "quiet", "busy", "stuck", "paused"];
const COL = { stuck: "#ff5d76", waiting: "#ffd34d", closed: "#b99cff", pr: "#6fd38a", queue: "#7fb2ff", behind: "#9a93c8", holo: "#5ee7f2" };

// ---------- fake boards ----------
/** @param {number} n @param {Partial<Card>} [extra] @returns {Card[]} */
const cards = (n, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({ repo: "realJohnDoe/agent-skills", kind: "issue", number: 200 + i, title: `Fake card ${i + 1}`, url: "#", reason: "prototype data", ...extra }));
/** @param {{stuck:number,waiting:number,queue:number,pr:number,red:number,behind:number,closed:number}} n @param {boolean} [paused] @returns {Board} */
const fake = (n, paused = false) => ({
  generated: new Date().toISOString(),
  lastRun: new Date(Date.now() - 3 * 3600e3).toISOString(),
  repos: ["realJohnDoe/agent-skills"],
  state: paused ? "paused" : "normal",
  ...(paused && { paused: { since: new Date().toISOString(), snapshot: "#" } }),
  stages: {
    stuck: cards(n.stuck),
    waiting: cards(n.waiting, { sub: "review" }),
    queue: cards(n.queue, { tier: "sonnet" }),
    prInProgress: [...cards(n.red, { kind: "pr", check: "red" }), ...cards(n.pr - n.red, { kind: "pr", check: "pending" })],
    closed: cards(n.closed),
    behind: cards(n.behind),
  },
});
const BUSY = { stuck: 0, waiting: 3, queue: 6, pr: 4, red: 1, behind: 2, closed: 5 };
const FAKE = {
  quiet: () => fake({ stuck: 0, waiting: 0, queue: 0, pr: 0, red: 0, behind: 0, closed: 5 }),
  busy: () => fake(BUSY),
  stuck: () => fake({ stuck: 2, waiting: 5, queue: 3, pr: 2, red: 1, behind: 1, closed: 5 }),
  paused: () => fake(BUSY, true),
};

let liveOk = true; // false once board.json is missing: then "live" leaves the scenario list

/** The board for the current scenario; with no board.json, live becomes busy. */
export const loadBoard = async () => {
  const s = param("scenario", "live");
  if (s !== "live" && s in FAKE) return FAKE[/** @type {keyof typeof FAKE} */ (s)]();
  try {
    const res = await fetch("board.json", { cache: "no-store" });
    if (!res.ok) throw new Error();
    return /** @type {Board} */ (await res.json());
  } catch {
    liveOk = false;
    state.scenario = "busy";
    return FAKE.busy();
  }
};

/** @param {Board} b */
const counts = (b) => ({
  stuck: b.stages.stuck.length,
  waiting: b.stages.waiting.length,
  queue: b.stages.queue.length,
  pr: b.stages.prInProgress.length,
  red: b.stages.prInProgress.filter((c) => c.check === "red").length,
  behind: (b.stages.behind ?? []).length,
  closed: b.stages.closed.length,
  paused: b.state === "paused",
});
/** @typedef {ReturnType<typeof counts>} Counts */

// ---------- shared SVG bits ----------
const DEFS = `<defs>
<filter id="pb-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="pb-soft" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="18"/></filter>
<linearGradient id="pb-sweep" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#ffe9a8" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<clipPath id="pb-crate"><rect x="962" y="565" width="150" height="32"/></clipPath>
</defs>`;
// The robots' visible eyes, for a blink now and then (and "asleep" when paused).
const EYES = [[560, 530, 1], [590, 528, 1], [988, 493, 2], [1014, 493, 2], [1562, 500, 3]];
/** @param {boolean} paused */
const eyes = (paused) =>
  EYES.map(([x, y, r]) => `<ellipse class="pb-lid ${paused ? "shut" : `r${r}`}" cx="${x}" cy="${y}" rx="12" ry="13" fill="#0b0b18" style="transform-origin:${x}px ${y - 13}px"/>`).join("");
/** Darkens the scene and stops it; every variant adds it when paused. @param {Counts} n */
const pausedLayer = (n) => (n.paused ? `<rect class="pb-night" x="0" y="0" width="2400" height="800" fill="#07051a" opacity=".5"/>` : "");

// ---------- A: glow stations ----------
// Stuck = left holo panel turns red and flashes a warning. PR in progress = the two right
// panels flicker cyan, brighter with more PRs; a red PR adds a red light. Waiting = the floor
// lantern pulses amber. Queue = a green sprout light over a pot per queued card (up to 6).
// Behind = small padlocks over the green tool box. Closed = a gold shimmer on the carried crate.
const POTS = [[1317, 640], [1385, 645], [1600, 650], [1645, 652], [775, 672], [1280, 628]];
/** @param {Counts} n */
const variantA = (n) => {
  const g = [];
  // Stuck
  if (n.stuck)
    g.push(`<g class="pb-stuck"><rect x="712" y="457" width="126" height="89" rx="8" fill="${COL.stuck}" opacity=".8" filter="url(#pb-glow)"/>
<path d="M775 474 L800 518 L750 518 Z" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"/><rect x="772.5" y="487" width="5" height="17" fill="#fff"/><circle cx="775" cy="511" r="3" fill="#fff"/></g>`);
  // PR in progress
  if (n.pr) {
    const lvl = Math.min(1, 0.25 + n.pr * 0.15);
    g.push(`<g class="pb-pr" style="--lvl:${lvl}">
<rect x="1307" y="486" width="135" height="89" rx="6" fill="${COL.holo}" filter="url(#pb-glow)"/>
<rect x="1600" y="477" width="130" height="110" rx="6" fill="${COL.holo}" filter="url(#pb-glow)"/>
<rect class="pb-scan" x="1307" y="486" width="135" height="6" fill="#fff"/>
<rect class="pb-scan d2" x="1600" y="477" width="130" height="6" fill="#fff"/></g>`);
    if (n.red) g.push(`<circle class="pb-alarm" cx="1712" cy="566" r="14" fill="${COL.stuck}" filter="url(#pb-glow)"/>`);
  }
  // Waiting for human
  if (n.waiting)
    g.push(`<g class="pb-wait"><circle cx="1257" cy="625" r="${45 + Math.min(n.waiting, 6) * 8}" fill="${COL.waiting}" opacity=".8" filter="url(#pb-soft)"/><circle cx="1227" cy="425" r="45" fill="${COL.waiting}" opacity=".8" filter="url(#pb-soft)"/></g>`);
  // Queue
  POTS.slice(0, Math.min(n.queue, POTS.length)).forEach(([x, y], i) =>
    g.push(`<g class="pb-sprout" style="animation-delay:${i * 0.4}s"><circle cx="${x}" cy="${y}" r="16" fill="${COL.pr}" filter="url(#pb-soft)"/><path d="M${x} ${y + 6} v-14 m0 4 q-9 -2 -10 -10 q9 1 10 10 m0 -2 q9 -2 10 -10 q-9 1 -10 10" stroke="#d8ffd9" stroke-width="2.5" fill="none" filter="url(#pb-glow)"/></g>`),
  );
  // Behind another issue
  for (let i = 0; i < Math.min(n.behind, 3); i++) {
    const x = 1440 + i * 22, y = 660;
    g.push(`<g class="pb-lock" opacity=".85"><rect x="${x - 8}" y="${y}" width="16" height="13" rx="2" fill="${COL.behind}"/><path d="M${x - 5} ${y} v-5 a5 5 0 0 1 10 0 v5" stroke="${COL.behind}" stroke-width="3" fill="none"/></g>`);
  }
  // Closed
  if (n.closed)
    g.push(`<g clip-path="url(#pb-crate)"><rect class="pb-shimmer" x="900" y="560" width="70" height="45" fill="url(#pb-sweep)"/></g>`);
  return g.join("\n");
};

// ---------- B: holo readouts ----------
// Each holo screen is redrawn, a little larger, as a readout: the left panel shows Stuck and
// Waiting, the middle one Queue and Behind, the right one PR in progress and Closed.
/** @param {number} x @param {number} y @param {number} w @param {number} h @param {string} label @param {number} v @param {string} col @param {number} i */
const cell = (x, y, w, h, label, v, col, i) => `<g class="pb-cell${v ? "" : " zero"}" style="--c:${col}; animation-delay:${i * 0.15}s">
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="#081626" fill-opacity=".9" stroke="${col}" stroke-width="2"/>
<text x="${x + w / 2}" y="${y + h * 0.62}" text-anchor="middle" class="pb-num" fill="${col}" font-size="${h * 0.62}">${v}</text>
<text x="${x + w / 2}" y="${y + h - 6}" text-anchor="middle" class="pb-lbl" fill="${col}" font-size="12">${label}</text></g>`;
/** @param {number} x @param {number} y @param {number} w @param {number} h @param {string} cells @param {boolean} alarm @param {number} i */
const screen = (x, y, w, h, cells, alarm, i) => `<g class="pb-screen" style="animation-delay:${i * 0.7}s">
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#0c2a3a" fill-opacity=".55" stroke="${alarm ? COL.stuck : COL.holo}" stroke-width="3" filter="url(#pb-glow)"/>
${cells}
<rect class="pb-scan" x="${x}" y="${y}" width="${w}" height="5" fill="#fff"/></g>`;
/** @param {Counts} n */
const variantB = (n) =>
  [
    screen(706, 446, 140, 104, cell(714, 454, 60, 88, "STUCK", n.stuck, COL.stuck, 0) + cell(778, 454, 60, 88, "WAIT", n.waiting, COL.waiting, 1), n.stuck > 0, 0),
    screen(1296, 470, 160, 112, cell(1304, 478, 70, 96, "QUEUE", n.queue, COL.queue, 2) + cell(1378, 478, 70, 96, "BEHIND", n.behind, COL.behind, 3), false, 1),
    screen(1592, 462, 150, 130, cell(1600, 470, 64, 114, "PR", n.pr, COL.pr, 4) + cell(1670, 470, 64, 114, "CLOSED", n.closed, COL.closed, 5), n.red > 0, 2),
  ].join("\n");

// ---------- C: conveyor ----------
// A light track along the deck's front edge, split into the stages in the order work flows.
// One light per card: Behind sits dim, Queue drifts toward PR, PRs shuttle while worked on,
// Stuck flash behind a red barrier, Waiting pulses amber, Closed slides off the end and fades.
const TRACK_Y = 738;
const SEGS = /** @type {const} */ ([
  ["behind", "BEHIND", 560, 700],
  ["queue", "QUEUE", 700, 1010],
  ["pr", "PR", 1010, 1400],
  ["stuck", "STUCK", 1400, 1480],
  ["waiting", "WAITING", 1480, 1660],
  ["closed", "CLOSED", 1660, 1840],
]);
/** @param {Counts} n */
const variantC = (n) => {
  const g = [`<line x1="560" y1="${TRACK_Y}" x2="1840" y2="${TRACK_Y}" stroke="${COL.holo}" stroke-opacity=".35" stroke-width="4"/>`];
  for (const [key, label, x0, x1] of SEGS) {
    const v = /** @type {number} */ (n[key]);
    const col = COL[key];
    g.push(`<line x1="${x0 + 4}" y1="${TRACK_Y}" x2="${x1 - 4}" y2="${TRACK_Y}" stroke="${col}" stroke-opacity="${v ? 0.7 : 0.18}" stroke-width="6" stroke-linecap="round"/>`);
    g.push(`<text class="pb-lbl" x="${(x0 + x1) / 2}" y="${TRACK_Y + 34}" text-anchor="middle" fill="${col}" fill-opacity="${v ? 0.9 : 0.4}" font-size="20">${label} ${v}</text>`);
    if (key === "stuck" && v) g.push(`<rect class="pb-barrier" x="${x1 - 10}" y="${TRACK_Y - 26}" width="8" height="52" fill="${COL.stuck}"/>`);
    const shown = Math.min(v, 8);
    const step = (x1 - x0) / (shown + 1);
    for (let i = 0; i < shown; i++) {
      const x = x0 + step * (i + 1);
      const red = key === "pr" && i < n.red;
      g.push(`<circle class="pb-dot d-${key}" cx="${x}" cy="${TRACK_Y}" r="11" fill="${red ? COL.stuck : col}" filter="url(#pb-glow)" style="animation-delay:${-i * 0.6}s"/>`);
    }
  }
  return g.join("\n");
};

// ---------- mounting ----------
// The choice lives in the page: seeded from ?variant=&scenario= or a #B-stuck hash (an artifact
// passes only a plain hash), and written back to both where the frame allows it.
const q = new URLSearchParams(location.search);
const [hv, hs] = location.hash.slice(1).split("-");
/** @type {Record<string, string | undefined>} */
const state = { variant: q.get("variant") ?? (hv || undefined), scenario: q.get("scenario") ?? (hs || undefined) };
/** @param {string} k @param {string} d */
const param = (k, d) => state[k] ?? d;

/** Puts the chosen variant's overlay over the banner image. @param {Board} board */
export const mountBanner = (board) => {
  const header = /** @type {HTMLElement} */ (document.querySelector(".banner"));
  const img = /** @type {HTMLImageElement} */ (header.querySelector("img"));
  let art = header.querySelector(".pb-art");
  if (!art) {
    art = document.createElement("div");
    art.className = "pb-art";
    header.append(art);
    art.append(img);
  }
  const v = /** @type {keyof typeof VARIANTS} */ (param("variant", "A"));
  const n = counts(board);
  const body = { A: variantA, B: variantB, C: variantC }[v]?.(n) ?? variantA(n);
  art.querySelector("svg")?.remove();
  art.insertAdjacentHTML(
    "beforeend",
    `<svg class="pb-svg v${v}${n.paused ? " paused" : ""}" viewBox="0 0 2400 800" preserveAspectRatio="xMidYMax slice" aria-hidden="true">${DEFS}${body}${eyes(n.paused)}${pausedLayer(n)}</svg>`,
  );
};

/** The floating prototype bar: variant arrows (or ← →) and the scenario buttons. @param {() => void} rerender */
export const mountSwitcher = (rerender) => {
  const bar = document.createElement("div");
  bar.className = "pb-bar";
  document.body.append(bar);
  const keys = /** @type {(keyof typeof VARIANTS)[]} */ (Object.keys(VARIANTS));
  /** @param {string} k @param {string} v */
  const set = (k, v) => {
    state[k] = v;
    try {
      history.replaceState(null, "", `#${param("variant", "A")}-${param("scenario", "live")}`);
    } catch {} // a locked-down frame may refuse it; the page state still holds
    draw();
    rerender();
  };
  /** @param {number} d */
  const cycle = (d) => {
    const i = keys.indexOf(/** @type {keyof typeof VARIANTS} */ (param("variant", "A")));
    set("variant", keys[(i + d + keys.length) % keys.length]);
  };
  const draw = () => {
    const v = /** @type {keyof typeof VARIANTS} */ (param("variant", "A"));
    const s = param("scenario", "live");
    bar.innerHTML = `<button data-d="-1" aria-label="Previous variant">◀</button><span class="pb-v">${v} · ${VARIANTS[v] ?? "?"}</span><button data-d="1" aria-label="Next variant">▶</button>
<span class="pb-sep"></span>${SCENARIOS.filter((x) => liveOk || x !== "live").map((x) => `<button data-s="${x}" class="${x === s ? "on" : ""}">${x}</button>`).join("")}`;
  };
  bar.addEventListener("click", (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest("button");
    if (!b) return;
    if (b.dataset.d) cycle(Number(b.dataset.d));
    if (b.dataset.s) set("scenario", b.dataset.s);
  });
  addEventListener("keydown", (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (t.closest("input, textarea, [contenteditable]")) return;
    if (e.key === "ArrowLeft") cycle(-1);
    if (e.key === "ArrowRight") cycle(1);
  });
  draw();
};
