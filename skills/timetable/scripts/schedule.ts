// The workshop's one schedule table and the due-check over it. Pure: the CLI is
// timetable.ts, and timetable.test.ts pins both. See ../SKILL.md.
export type Day = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
export type Tick = "am" | "pm";
export type Model = "haiku" | "sonnet" | "opus";
// `everyWeeks` (default 1) runs an entry only in every n-th week, counted in whole
// weeks from EPOCH, so the gap is always exactly n weeks, across year ends too.
export type Entry = { skill: string; days: readonly Day[]; everyWeeks?: number; tick: Tick; model: Model; prompt: string };

const DAYS: readonly Day[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// The UTC hour each tick fires at: the `Timetable` routine's cron is `0 5,17 * * *` (UTC).
// A run up to an hour late still counts as that tick.
export const TICKS: Record<Tick, number> = { am: 5, pm: 17 };

// A Monday (UTC) that is week 0 for `everyWeeks`. Moving it shifts which weeks run.
export const EPOCH = "2026-11-16";

export const TABLE: readonly Entry[] = [
  { skill: "dispatcher", days: DAYS, tick: "am", model: "sonnet", prompt: "Run the `joes-workshop:dispatcher` skill." },
  {
    skill: "surveys",
    days: ["mon", "wed", "fri"],
    tick: "pm",
    model: "opus",
    prompt: "Run the `joes-workshop:surveys` skill's **Starting the next survey** over every attached repo.",
  },
  {
    skill: "dependency-maintenance",
    days: ["mon"],
    everyWeeks: 2,
    tick: "am",
    model: "opus",
    prompt: "Run the `joes-workshop:dependency-maintenance` skill over all attached repos.",
  },
];

// The tick a UTC hour belongs to. An hour that maps to none throws: every entry
// would silently stop running.
export const tickOf = (hour: number): Tick => {
  const tick = (Object.keys(TICKS) as Tick[]).find((t) => hour - TICKS[t] >= 0 && hour - TICKS[t] <= 1);
  if (!tick)
    throw new Error(
      `UTC hour ${hour} maps to no tick (${Object.entries(TICKS).map(([t, h]) => `${t} = ${h}:00`).join(", ")}): fix the routine's cron or TICKS`,
    );
  return tick;
};

// What runs at `now`. While the workshop is paused only the dispatcher runs, since
// it carries out the drain and the resume itself; everything else waits.
const WEEK_MS = 7 * 24 * 3600 * 1000;
// Whole weeks from EPOCH's Monday to the Monday-started week holding `now` (negative before it).
export const weekOf = (now: Date) => Math.floor((now.getTime() - Date.parse(`${EPOCH}T00:00Z`)) / WEEK_MS);

export const due = (now: Date, paused: boolean) => {
  const tick = tickOf(now.getUTCHours());
  const day = DAYS[now.getUTCDay()];
  const week = weekOf(now);
  const scheduled = TABLE.filter(
    (e) => e.tick === tick && e.days.includes(day) && week % (e.everyWeeks ?? 1) === 0,
  );
  return {
    day,
    tick,
    run: scheduled.filter((e) => !paused || e.skill === "dispatcher"),
    held: scheduled.filter((e) => paused && e.skill !== "dispatcher").map((e) => e.skill),
  };
};
