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
    prInProgress: [
      ...cards(n.red, { kind: "pr", check: "red" }),
      ...cards(n.pr - n.red, { kind: "pr" }).map((c, i) => ({ ...c, check: /** @type {const} */ (i % 2 ? "green" : "pending") })),
    ],
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
  checks: b.stages.prInProgress.map((c) => c.check ?? "pending"),
  behind: (b.stages.behind ?? []).length,
  closed: b.stages.closed.length,
  paused: b.state === "paused",
});
/** @typedef {ReturnType<typeof counts>} Counts */

// ---------- shared SVG bits ----------
const DEFS = `<defs>
<filter id="pb-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="pb-soft" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="18"/></filter>
</defs>`;
// The robots' visible eyes [x, y, robot, rx, ry], for a blink now and then (and "asleep" when paused).
const EYES = [[560, 530, 1, 12, 13], [590, 528, 1, 12, 13], [988, 493, 2, 12, 13], [1014, 493, 2, 12, 13], [1562, 500, 3, 12, 13]];
/** @param {boolean} paused */
const eyes = (paused) =>
  EYES.map(([x, y, r, rx, ry]) => `<ellipse class="pb-lid ${paused ? "shut" : `r${r}`}" cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#0b0b18" style="transform-origin:${x}px ${y - ry}px"/>`).join("");
/** Darkens the scene and stops it; every variant adds it when paused. @param {Counts} n */
const pausedLayer = (n) => (n.paused ? `<rect class="pb-night" x="0" y="0" width="2400" height="800" fill="#07051a" opacity=".3"/>` : "");

// ---------- the city: ambient, the same on every board ----------
// Small ships cross the sky on four lanes, beacons blink on the spires, and a light runs
// along the front of the city's ring. Hidden when paused or with reduced motion.
const SHIP = `<path d="M-60 0 H-16" stroke="${"#5ee7f2"}" stroke-opacity=".35" stroke-width="2"/>
<circle cx="-15" cy="0" r="4" fill="#ffc36b" filter="url(#pb-glow)"/>
<path d="M-15 -1 q4 -6 15 -5 l11 5 l-11 4 q-11 1 -15 -4z" fill="#e8e6ff"/><circle cx="3" cy="-2" r="2.2" fill="#5ee7f2"/>`;
// [y0, y1, seconds, delay, scale, right-to-left]
// Desktop crops the sky above y ≈ 220, so the lanes fly low, around the ring.
const LANES = [[250, 242, 40, 0, 0.8, false], [272, 262, 55, -20, 1, true], [232, 228, 75, -45, 0.55, false], [330, 228, 30, -8, 0.7, false]];
// The tallest spire for phones (which show the full height), the rest low enough for desktop.
const BEACONS = [[1448, 85], [1017, 228], [1265, 262], [1600, 218], [1762, 272]];
const city = () =>
  `<g class="pb-city">
<path class="pb-ring" d="M700 345 A640 43 0 0 0 1980 335" stroke="#d8fbff" stroke-width="5" fill="none" filter="url(#pb-glow)"/>
${BEACONS.map(([x, y], i) => `<circle class="pb-beacon" cx="${x}" cy="${y}" r="4" fill="#ff8a9b" filter="url(#pb-glow)" style="animation-delay:${-i * 0.7}s"/>`).join("")}
${LANES.map(([y0, y1, t, d, sc, rtl]) => {
  const [x0, x1] = rtl ? [2550, -150] : [-150, 2550];
  // the fourth lane leaves from the ring and climbs away to the right
  const from = y0 === 330 ? 1650 : x0;
  return `<g class="pb-ship" style="--x0:${from}px;--y0:${y0}px;--x1:${x1}px;--y1:${y1}px;animation-duration:${t}s;animation-delay:${d}s"><g transform="scale(${rtl ? -sc : sc} ${sc})">${SHIP}</g></g>`;
}).join("")}
</g>`;

// The three painted holo panels: [x, y, width, height].
const S1 = [1307, 486, 135, 89]; // beside the third robot
const S2 = [1600, 477, 130, 110]; // the one the third robot is tapping
const S3 = [718, 463, 114, 77]; // beside the first robot

// ---------- A: glow stations ----------
// PR in progress = the two right panels flicker cyan, brighter with more PRs, and show a
//   growth row per PR (leaf, bar, light in its CI colour); with none, a moisture wave.
// Stuck = the left panel turns red with a warning; otherwise it shows a healthy leaf.
// Waiting = the floor lantern pulses amber. Queue = a sprout light over a pot per queued card
// (up to 6). Behind = small padlocks over the green tool box. Closed has no station.
const POTS = [[1317, 640], [1385, 645], [1600, 650], [1645, 652], [775, 672], [1280, 628]];
/** @param {number[]} r @param {string} fill @param {string} [cls] */
const glass = ([x, y, w, h], fill, cls = "") => `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" filter="url(#pb-glow)"/>`;
/** A clean pane over a painted panel, so the new content replaces its icons. @param {number[]} r */
const pane = ([x, y, w, h]) =>
  `<rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" rx="5" fill="#0d2a3c" opacity=".9"/><rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" rx="5" fill="none" stroke="#5ee7f2" stroke-opacity=".6" stroke-width="2"/>`;

// Screen content: plant-care graphics, no numbers or text.
const LEAF = "M0 6 v-14 m0 4 q-9 -2 -10 -10 q9 1 10 10 m0 -2 q9 -2 10 -10 q-9 1 -10 10";
/** @param {number} x @param {number} y @param {number} s @param {string} col @param {string} [cls] */
const leaf = (x, y, s, col, cls = "") =>
  `<path class="${cls}" d="${LEAF}" transform="translate(${x} ${y}) scale(${s})" stroke="${col}" stroke-width="2.5" vector-effect="non-scaling-stroke" fill="none" stroke-linecap="round"/>`;
/** Three status lights along a screen's foot. @param {number[]} r @param {string} col */
const lights = ([x, y, w, h], col) =>
  [-1, 0, 1].map((d) => `<circle cx="${x + w / 2 + d * 16}" cy="${y + h - 12}" r="4.5" fill="${col}" opacity=".8"/>`).join("");
const CHECK = { green: COL.pr, pending: COL.holo, red: COL.stuck };
/** A growth monitor: one row per PR (a leaf, a growth bar, a status light), or idle with a
 * faint leaf and a soil-moisture wave. @param {number[]} r @param {string[]} checks */
const monitor = ([x, y, w, h], checks) => {
  if (!checks.length)
    return `<g class="pb-screen-ui idle">${leaf(x + w / 2, y + h / 2 - 6, 1.8, COL.holo)}<path class="pb-wave" d="M${x + 14} ${y + h - 16} q 12 -9 24 0 t 24 0 t 24 0 t 24 0" stroke="${COL.holo}" stroke-width="3" fill="none"/></g>`;
  const rh = 26;
  const rows = checks.map((c, i) => {
    const col = CHECK[/** @type {keyof typeof CHECK} */ (c)] ?? COL.holo;
    const cy = y + h / 2 + rh * (i - (checks.length - 1) / 2);
    const bx = x + 30, bw = w - 58;
    const fill = c === "green" ? "" : c === "red" ? "pb-fail" : "pb-grow";
    const part = c === "red" ? 0.4 : 1;
    return `${leaf(x + 15, cy + 3, 0.8, col)}
<rect x="${bx}" y="${cy - 3}" width="${bw}" height="6" rx="3" fill="${COL.holo}" opacity=".25"/>
<rect class="${fill}" x="${bx}" y="${cy - 3}" width="${bw * part}" height="6" rx="3" fill="${col}" style="animation-delay:${-i * 2.1}s"/>
<circle class="${c === "red" ? "pb-fail" : ""}" cx="${x + w - 14}" cy="${cy}" r="5" fill="${col}"/>`;
  });
  return `<g class="pb-screen-ui">${rows.join("")}</g>`;
};

/** @param {Counts} n */
const variantA = (n) => {
  const g = [pane(S1), pane(S2), pane(S3)];
  // PR in progress
  if (n.pr) {
    const lvl = Math.min(1, 0.25 + n.pr * 0.15);
    g.push(`<g class="pb-pr" style="--lvl:${lvl}">${glass(S1, COL.holo)}${glass(S2, COL.holo)}
<rect class="pb-scan" x="${S1[0]}" y="${S1[1]}" width="${S1[2]}" height="6" fill="#fff"/>
<rect class="pb-scan d2" x="${S2[0]}" y="${S2[1]}" width="${S2[2]}" height="6" fill="#fff"/></g>`);
  }
  const shown = n.checks.slice(0, 6);
  g.push(monitor(S1, shown.filter((_, i) => i % 2 === 0)), monitor(S2, shown.filter((_, i) => i % 2 === 1)));
  // Stuck
  if (n.stuck)
    g.push(`<g class="pb-stuck"><rect x="712" y="457" width="126" height="89" rx="8" fill="${COL.stuck}" opacity=".45" filter="url(#pb-glow)"/>
<path d="M775 470 L800 512 L750 512 Z" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="5" stroke-linejoin="round"/><rect x="772.5" y="483" width="5" height="16" fill="#fff" fill-opacity=".8"/><circle cx="775" cy="506" r="3" fill="#fff" fill-opacity=".8"/>
${lights(S3, COL.stuck)}</g>`);
  else g.push(`<g class="pb-screen-ui">${leaf(775, 494, 2, COL.pr, "pb-healthy")}${lights(S3, COL.pr)}</g>`);
  // Waiting for human
  if (n.waiting)
    g.push(`<g class="pb-wait"><circle cx="1257" cy="625" r="${45 + Math.min(n.waiting, 6) * 8}" fill="${COL.waiting}" opacity=".4" filter="url(#pb-soft)"/><circle cx="1227" cy="425" r="45" fill="${COL.waiting}" opacity=".4" filter="url(#pb-soft)"/></g>`);
  // Queue
  POTS.slice(0, Math.min(n.queue, POTS.length)).forEach(([x, y], i) =>
    g.push(`<g class="pb-sprout" style="animation-delay:${i * 0.4}s"><circle cx="${x}" cy="${y}" r="16" fill="${COL.pr}" opacity=".5" filter="url(#pb-soft)"/><path d="M${x} ${y + 6} v-14 m0 4 q-9 -2 -10 -10 q9 1 10 10 m0 -2 q9 -2 10 -10 q-9 1 -10 10" stroke="#d8ffd9" stroke-opacity=".7" stroke-width="2.5" fill="none" filter="url(#pb-glow)"/></g>`),
  );
  // Behind another issue
  for (let i = 0; i < Math.min(n.behind, 3); i++) {
    const x = 1440 + i * 22, y = 660;
    g.push(`<g class="pb-lock" opacity=".55"><rect x="${x - 8}" y="${y}" width="16" height="13" rx="2" fill="${COL.behind}"/><path d="M${x - 5} ${y} v-5 a5 5 0 0 1 10 0 v5" stroke="${COL.behind}" stroke-width="3" fill="none"/></g>`);
  }
  return g.join("\n");
};

// ---------- B: holo readouts ----------
// Each holo panel is redrawn, a little larger, as a readout: the left panel shows Stuck and
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
    `<svg class="pb-svg v${v}${n.paused ? " paused" : ""}" viewBox="0 0 2400 800" preserveAspectRatio="xMidYMax slice" aria-hidden="true">${DEFS}${city()}${body}${eyes(n.paused)}${pausedLayer(n)}</svg>`,
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
