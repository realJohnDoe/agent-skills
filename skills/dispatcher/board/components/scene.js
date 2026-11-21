// The banner's live scene: an SVG that draws banner.jpg itself, in the image's own 2400x800
// coordinates, cropped by preserveAspectRatio "xMidYMax slice" (object-fit: cover;
// object-position: center bottom). The image is inside the SVG, not an <img> underneath it,
// so the two can never be cropped differently: in Firefox's installed app (no URL bar) the
// <img> and an SVG laid over it got different boxes, and the scene drifted off the picture.
// The painted stations light up with the board's stages, each in its module's colour and with a
// count plate like the module's readout, and the city in the background moves.
// Everything that moves is an SVG animation of an attribute (a bar's width, a ship's
// position), never a CSS transform: mobile Chrome places CSS transforms on scaled SVG in page
// pixels, which shifted them off the screens on phones. CSS animates opacity only.
/** @import { Board } from "../../scripts/board.ts" */

// The board.css tokens, for SVG attributes.
const C = { bad: "#ff5d76", warn: "#ffd34d", ok: "#6fd38a", holo: "#5ee7f2", muted: "#9a93c8", lamp: "#ffc36b", blue: "#7fb2ff" };
// Each stage's colour, as its module's --c in board.css, so a station reads as its module.
export const STAGE = { stuck: C.bad, waiting: C.warn, pr: C.ok, queue: C.blue, behind: C.muted };
// A PR row's CI, coloured as the check in the card's badge (board.css .check.*).
export const CHECK = { green: C.ok, pending: C.lamp, red: C.bad };
const MONO = `"JetBrains Mono", ui-monospace, monospace`;

const DEFS = `<defs>
<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="soft" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="18"/></filter>
</defs>`;

/** @param {string} attr @param {string} values @param {number} dur @param {number} [begin] @param {string} [extra] */
const anim = (attr, values, dur, begin = 0, extra = "") =>
  `<animate attributeName="${attr}" values="${values}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"${extra}/>`;

// ---------- the painted stations ----------
// The three holo panels: [x, y, width, height].
const PR_A = [1307, 486, 135, 89]; // beside the third robot
const PR_B = [1600, 467, 130, 122]; // the one the third robot is tapping
const HEALTH = [718, 463, 114, 77]; // beside the first robot
const POTS = [[1317, 640], [1385, 645], [1600, 650], [1645, 652], [775, 672], [1280, 628]];
// The robots' visible eyes: [x, y, lid rx, lid ry, blink phase in s]. A robot's eyes share a phase.
const EYES = [
  [560, 530, 12, 13, 0], [590, 528, 12, 13, 0], // the first robot, in the left bed
  [988, 493, 12, 13, 2.3], [1014, 493, 12, 13, 2.3], // the second, at the crate
  [1562, 500, 12, 13, 4.6], // the third, side on at the screen: one eye shows
  [1982, 484, 7, 8, 1.2], [1997, 486, 7, 8, 1.2], // the small fourth, by the bonsai
];
// A leaf reaches from 16 above its origin to 6 below it, times its scale: mind its tip near a pane top.
const LEAF = "M0 6 v-14 m0 4 q-9 -2 -10 -10 q9 1 10 10 m0 -2 q9 -2 10 -10 q-9 1 -10 10";

/** @param {number} x @param {number} y @param {number} s @param {string} col @param {string} [cls] */
const leaf = (x, y, s, col, cls = "") =>
  `<path class="${cls}" d="${LEAF}" transform="translate(${x} ${y}) scale(${s})" stroke="${col}" stroke-width="2.5" vector-effect="non-scaling-stroke" fill="none" stroke-linecap="round"/>`;
/** A clean pane over a painted panel, hiding its painted icons. @param {number[]} r */
const pane = ([x, y, w, h]) =>
  `<rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" rx="5" fill="#0d2a3c" opacity=".9" stroke="${C.holo}" stroke-opacity=".6" stroke-width="2"/>`;
// The margin, in the image's units, between a screen's content and its pane's edge.
const PAD = 12;
/** Three status lights along a panel's foot. @param {number[]} r @param {string} col */
const lights = ([x, y, w, h], col) =>
  [-1, 0, 1].map((d) => `<circle cx="${x + w / 2 + d * 16}" cy="${y + h - 3 - PAD - 4.5}" r="4.5" fill="${col}" opacity=".8"/>`).join("");

/**
 * A growth monitor: a row per PR in progress (a leaf, a growth bar, a light), coloured by its
 * CI; a running one's bar grows, a red one's is short and pulses. With none, an idle leaf and a
 * soil-moisture wave.
 * @param {number[]} r @param {string[]} checks @param {boolean} motion
 */
const monitor = ([x, y, w, h], checks, motion) => {
  if (!checks.length)
    return `<g class="ui idle">${leaf(x + w / 2, y + h / 2 - 8, 1.4, C.holo)}<path class="wave" d="M${x + w / 2 - 48} ${y + h - 3 - PAD - 6} q 12 -9 24 0 t 24 0 t 24 0 t 24 0" stroke="${C.holo}" stroke-width="3" fill="none"/></g>`;
  // Rows close up to keep three clear of a short pane's top and foot.
  const step = Math.min(26, (h - 48) / Math.max(1, checks.length - 1));
  const rows = checks.map((check, i) => {
    const col = CHECK[/** @type {keyof typeof CHECK} */ (check)] ?? CHECK.pending;
    const cy = y + h / 2 + 2 + step * (i - (checks.length - 1) / 2);
    // The leaf spans x+3+PAD to x+19+PAD, the light ends at x+w-3-PAD: PAD in from the pane.
    const lx = x + 11 + PAD, ox = x + w - 3 - PAD - 5;
    const bx = lx + 14, bw = ox - 13 - bx;
    const bar =
      check === "red"
        ? `<rect class="fail" x="${bx}" y="${cy - 3}" width="${bw * 0.4}" height="6" rx="3" fill="${col}"/>`
        : check === "green" || !motion
          ? `<rect x="${bx}" y="${cy - 3}" width="${bw}" height="6" rx="3" fill="${col}"/>`
          : `<rect x="${bx}" y="${cy - 3}" width="${bw * 0.12}" height="6" rx="3" fill="${col}">${anim("width", `${bw * 0.12};${bw};${bw}`, 7, -i * 2.1, ' keyTimes="0;.85;1"')}</rect>`;
    return `<g class="row ${check}">${leaf(lx, cy + 3, Math.min(0.8, step / 32), col)}<rect x="${bx}" y="${cy - 3}" width="${bw}" height="6" rx="3" fill="${C.holo}" opacity=".25"/>${bar}<circle class="${check === "red" ? "fail" : ""}" cx="${ox}" cy="${cy}" r="5" fill="${col}"/></g>`;
  });
  return `<g class="ui">${rows.join("")}</g>`;
};

/**
 * A count plate, like a module's readout: the stage's count in its colour on dark glass,
 * 52x32 in the image's units (about 18px tall at desktop width).
 * @param {number} x left @param {number} y top @param {number} n @param {string} col
 */
const plate = (x, y, n, col) =>
  `<g class="plate"><rect x="${x}" y="${y}" width="52" height="32" rx="4" fill="#0c1424" fill-opacity=".9" stroke="${col}" stroke-opacity=".8" stroke-width="2"/><text x="${x + 26}" y="${y + 23}" text-anchor="middle" font-family='${MONO}' font-weight="600" font-size="23" fill="${col}">${String(n).padStart(2, "0")}</text></g>`;
/** A plate on a station's top-right corner, sticking out past its edge like a tab. @param {number[]} r @param {number} n @param {string} col */
const cornerPlate = ([x, y, w], n, col) => plate(x + w - 42, y - 18, n, col);

// The second robot's head, and the speech bubble over it: [x, y, width, height].
const HEAD = [1022, 452];
const BUBBLE = [HEAD[0] + 4, HEAD[1] - 74, 46, 42];
/** A see-through speech bubble with a "!", its body and tail one outline. */
const bubble = () => {
  const [hx, hy] = HEAD, [x, y, w, h] = BUBBLE, r = 12;
  const d = `M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + 30} L${hx} ${hy} L${x + 14} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;
  return `<g class="bubble"><path d="${d}" fill="#0c1424" fill-opacity=".55" stroke="${STAGE.waiting}" stroke-width="2.5" stroke-linejoin="round"/><text x="${x + w / 2}" y="${y + 31}" text-anchor="middle" font-family='${MONO}' font-weight="700" font-size="28" fill="${STAGE.waiting}" filter="url(#glow)">!</text></g>`;
};

/** A scan line sweeping down a panel. @param {number[]} r @param {number} begin */
const scan = ([x, y, w, h], begin) =>
  `<rect x="${x}" y="${y}" width="${w}" height="6" fill="#fff" opacity="0">${anim("y", `${y};${y + h - 6}`, 2.6, begin)}${anim("opacity", ".2;0", 2.6, begin)}</rect>`;

// ---------- the city ----------
const SHIP = `<path d="M-60 0 H-16" stroke="${C.holo}" stroke-opacity=".35" stroke-width="2"/><circle cx="-15" cy="0" r="4" fill="${C.lamp}" filter="url(#glow)"/><path d="M-15 -1 q4 -6 15 -5 l11 5 l-11 4 q-11 1 -15 -4z" fill="#e8e6ff"/><circle cx="3" cy="-2" r="2.2" fill="${C.holo}"/>`;
// Desktop crops the sky above y ≈ 220, so the ships fly low, around the ring.
// [x0, y0, x1, y1, seconds, begin, scale]; a negative scale flies right to left.
// In the order they join as the workshop gets busier.
const LANES = [
  [-150, 250, 2550, 242, 40, 0, 0.8],
  [2550, 272, -150, 262, 55, -20, -1],
  [1650, 330, 2550, 228, 30, -8, 0.7],
  [-150, 232, 2550, 228, 75, -45, 0.55],
  [2550, 240, -150, 236, 65, -30, -0.6],
  [-150, 290, 2550, 284, 48, -12, 0.9],
];
// In the order they light up; the tallest spire, last, only shows on phones (full height).
const BEACONS = [[1017, 228], [1600, 218], [1265, 262], [1762, 272], [1448, 85]];

/**
 * How busy the workshop is, from 0 (nothing open) to 1 (ten or more PRs and queued cards):
 * it sets the city's traffic.
 * @param {Board} board
 */
export const busyness = (board) => Math.min(1, (board.stages.prInProgress.length + board.stages.queue.length) / 10);

/**
 * The city: one ship and one beacon when the workshop is quiet, up to six ships and five
 * beacons when it is busy, and the ring's light runs faster. Ships and the ring only move.
 * @param {number} busy @param {boolean} motion
 */
const city = (busy, motion) =>
  [
    ...BEACONS.slice(0, 1 + Math.round(busy * 4)).map(
      ([x, y], i) => `<circle class="beacon" cx="${x}" cy="${y}" r="4" fill="#ff8a9b" filter="url(#glow)" style="animation-delay:${-i * 0.7}s"/>`,
    ),
    ...(motion
      ? [
          `<path class="ring" d="M700 345 A640 43 0 0 0 1980 335" stroke="#d8fbff" stroke-width="5" fill="none" filter="url(#glow)" style="animation-duration:${(14 - 6 * busy).toFixed(1)}s"/>`,
          ...LANES.slice(0, 1 + Math.round(busy * 5)).map(
            ([x0, y0, x1, y1, t, begin, s]) =>
              `<g class="ship"><animateTransform attributeName="transform" type="translate" values="${x0} ${y0};${x1} ${y1}" dur="${t}s" begin="${begin}s" repeatCount="indefinite"/><g transform="scale(${s} ${Math.abs(s)})">${SHIP}</g></g>`,
          ),
        ]
      : []),
  ].join("");

/**
 * The banner's scene for a board. Each lit station is in its stage's colour (`STAGE`) and
 * carries a plate with the stage's count, as the module below does.
 * - PR in progress: the two right panels glow green, brighter with more PRs, and show a growth
 *   row per PR (up to 6), split between them and coloured by CI as the cards' badges are.
 * - Stuck: the left panel turns red with a warning; otherwise it shows a healthy leaf.
 * - Waiting for human: the second robot asks with a "!" bubble, and the floor lantern and its
 *   lamp post glow, brighter with more cards.
 * - Queue: a blue sprout lights up over a pot per queued card (up to 6).
 * - Behind another issue: a padlock over the green tool box per blocked issue (up to 3).
 * - The city's traffic follows how busy the workshop is (`busyness`).
 * - Paused: the scene dims and stands still, the robots' eyes shut, and the ships are gone.
 * @param {Board} board
 * @param {boolean} [motion] false for reduced motion: nothing moves, no ships
 */
export const scene = (board, motion = true) => {
  const s = board.stages;
  const paused = board.state === "paused";
  const move = motion && !paused;
  const checks = s.prInProgress.slice(0, 6).map((c) => c.check ?? "pending");
  const behind = s.behind ?? [];
  const g = [`<image href="banner.jpg" width="2400" height="800"/>`, city(busyness(board), move), pane(PR_A), pane(PR_B), pane(HEALTH)];

  if (checks.length) {
    const level = Math.min(1, 0.25 + checks.length * 0.15) * 0.3;
    const glass = (/** @type {number[]} */ [x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${STAGE.pr}" opacity="${level}" filter="url(#glow)"/>`;
    g.push(`<g class="pr">${glass(PR_A)}${glass(PR_B)}${move ? scan(PR_A, 0) + scan(PR_B, -1.3) : ""}</g>`);
  }
  g.push(monitor(PR_A, checks.filter((_, i) => i % 2 === 0), move), monitor(PR_B, checks.filter((_, i) => i % 2 === 1), move));
  if (s.prInProgress.length) g.push(cornerPlate(PR_B, s.prInProgress.length, STAGE.pr));

  if (s.stuck.length)
    g.push(`<g class="warning"><rect x="712" y="457" width="126" height="89" rx="8" fill="${C.bad}" opacity=".45" filter="url(#glow)"/>
<path d="M775 479 L794 509 L756 509 Z" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="4" stroke-linejoin="round"/><rect x="773" y="488" width="4" height="10" fill="#fff" fill-opacity=".8"/><circle cx="775" cy="503.5" r="2.5" fill="#fff" fill-opacity=".8"/>${lights(HEALTH, C.bad)}</g>${cornerPlate(HEALTH, s.stuck.length, STAGE.stuck)}`);
  else g.push(`<g class="ui">${leaf(775, 501, 1.4, C.ok, "healthy")}${lights(HEALTH, C.ok)}</g>`);

  if (s.waiting.length) {
    // brighter and wider with each waiting card, up to 6
    const k = Math.min(s.waiting.length, 6) / 6;
    const o = (0.2 + 0.3 * k).toFixed(2);
    g.push(`<g class="wait"><circle cx="1257" cy="625" r="${Math.round(45 + 48 * k)}" fill="${STAGE.waiting}" opacity="${o}" filter="url(#soft)"/><circle cx="1227" cy="425" r="${Math.round(30 + 15 * k)}" fill="${STAGE.waiting}" opacity="${o}" filter="url(#soft)"/></g>`);
    // The bubble asks; its count sits beside it, apart from the "!".
    g.push(bubble(), plate(BUBBLE[0] + BUBBLE[2] + 8, BUBBLE[1] + 5, s.waiting.length, STAGE.waiting));
  }

  POTS.slice(0, s.queue.length).forEach(([x, y], i) =>
    g.push(`<g class="sprout" style="animation-delay:${i * 0.4}s"><circle cx="${x}" cy="${y}" r="16" fill="${STAGE.queue}" opacity=".55" filter="url(#soft)"/><path d="M${x} ${y + 6}${LEAF.slice(4)}" stroke="#dce8ff" stroke-opacity=".8" stroke-width="2.5" fill="none" filter="url(#glow)"/></g>`),
  );
  // The queue's count sits on the deck under the first pot, clear of the PR screens above it.
  if (s.queue.length) g.push(plate(POTS[0][0] - 26, POTS[0][1] + 26, s.queue.length, STAGE.queue));

  behind.slice(0, 3).forEach((_, i) => {
    const x = 1440 + i * 22, y = 660;
    g.push(`<g class="lock" opacity=".75"><rect x="${x - 8}" y="${y}" width="16" height="13" rx="2" fill="${STAGE.behind}"/><path d="M${x - 5} ${y} v-5 a5 5 0 0 1 10 0 v5" stroke="${STAGE.behind}" stroke-width="3" fill="none"/></g>`);
  });
  if (behind.length) g.push(plate(1440 + Math.min(behind.length, 3) * 22, 634, behind.length, STAGE.behind));

  // Eyelids: a blink now and then, shut when paused.
  EYES.forEach(([x, y, rx, ry, phase]) =>
    g.push(
      paused
        ? `<ellipse class="lid" cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#0b0b18"/>`
        : move
          ? `<ellipse class="lid" cx="${x}" cy="${y}" rx="${rx}" ry="0" fill="#0b0b18">${anim("ry", `0;0;${ry};0`, 7, -phase, ' keyTimes="0;.95;.97;1"')}</ellipse>`
          : "",
    ),
  );
  if (paused) g.push(`<rect class="night" width="2400" height="800" fill="#07051a" opacity=".3"/>`);

  return `<svg class="scene${paused ? " paused" : ""}" viewBox="0 0 2400 800" preserveAspectRatio="xMidYMax slice" aria-hidden="true">${DEFS}${g.join("\n")}</svg>`;
};
