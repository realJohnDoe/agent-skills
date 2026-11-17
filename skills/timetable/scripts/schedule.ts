// The workshop's one schedule table and the due-check over it. Pure: the CLI is
// timetable.ts, and timetable.test.ts pins both. See ../SKILL.md.
export type Day = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
export type Tick = "am" | "pm";
export type Model = "haiku" | "sonnet" | "opus";
export type Entry = { skill: string; days: readonly Day[]; tick: Tick; model: Model; prompt: string };

const DAYS: readonly Day[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// The UTC hour each tick fires at: the `Timetable` routine's cron is `0 5,17 * * *` (UTC).
// A run up to an hour late still counts as that tick.
export const TICKS: Record<Tick, number> = { am: 5, pm: 17 };

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
export const due = (now: Date, paused: boolean) => {
  const tick = tickOf(now.getUTCHours());
  const day = DAYS[now.getUTCDay()];
  const scheduled = TABLE.filter((e) => e.tick === tick && e.days.includes(day));
  return {
    day,
    tick,
    run: scheduled.filter((e) => !paused || e.skill === "dispatcher"),
    held: scheduled.filter((e) => paused && e.skill !== "dispatcher").map((e) => e.skill),
  };
};
