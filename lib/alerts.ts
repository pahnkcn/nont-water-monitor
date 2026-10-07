export type Status = "normal" | "watch" | "danger";

export type Thresholds = {
  /** เฝ้าระวัง, metres on the gauge. */
  watch: number;
  /** อันตราย, metres on the gauge. */
  danger: number;
  /** How far below a threshold the water must fall before the state steps down. */
  hysteresis: number;
  /** While in danger, alert again each time the level climbs this much further. */
  repeatStep: number;
};

export const DEFAULT_THRESHOLDS: Thresholds = {
  watch: 2.2,
  danger: 2.5,
  hysteresis: 0.05,
  repeatStep: 0.1,
};

/**
 * The highest a bound (the water hidden somewhere under it) is worth keeping at: under the
 * watch level, where "more than … cm to go" is still true.
 */
export function boundCeiling(th: Pick<Thresholds, "watch" | "danger">) {
  return Math.min(th.watch, th.danger);
}

export type AlertState = {
  status: Status;
  since: number;
  /** Level at the most recent escalation or repeat alert. */
  lastAlertLevel: number | null;
  /** A change seen but not yet confirmed. */
  pending: { status: Status; count: number } | null;
};

export const INITIAL_ALERT_STATE: AlertState = {
  status: "normal",
  since: 0,
  lastAlertLevel: null,
  pending: null,
};

export type ReadingInput = {
  t: number;
  level: number;
  confidence: "high" | "low";
  /** The level is only the most the water can be (it is hidden lower down). */
  bound?: boolean;
};

export type AlertEvent =
  | { kind: "escalate"; from: Status; to: Status; level: number; t: number }
  | { kind: "rising"; level: number; previous: number; t: number }
  | { kind: "clear"; from: Status; to: Status; level: number; t: number };

const RANK: Record<Status, number> = { normal: 0, watch: 1, danger: 2 };

export function rank(s: Status) {
  return RANK[s];
}

/** Status for a level, holding the current state until the water is clearly below its threshold. */
export function classify(level: number, th: Thresholds, current: Status): Status {
  if (level >= th.danger) return "danger";
  if (current === "danger" && level >= th.danger - th.hysteresis) return "danger";
  if (level >= th.watch) return "watch";
  if (current !== "normal" && level >= th.watch - th.hysteresis) return "watch";
  return "normal";
}

/** The state a level puts the site in when it is taken there without an alert. */
export function stateAtLevel(level: number | null, th: Thresholds, now: number): AlertState {
  const status = level === null ? "normal" : classify(level, th, "normal");
  return { status, since: now, lastAlertLevel: status === "normal" ? null : level, pending: null };
}

/**
 * Advance the alert state by one reading.
 * Going up: one confident reading is enough; a low-confidence one needs a second in a row.
 * Going down: two confident readings in a row. Low-confidence readings never clear an alert.
 * A bound can take the state down (the water is at most that high) but never up.
 */
export function stepAlert(
  state: AlertState,
  reading: ReadingInput,
  th: Thresholds,
): { state: AlertState; events: AlertEvent[] } {
  const target = classify(reading.level, th, state.status);
  const { t, level } = reading;

  if (target === state.status) {
    const events: AlertEvent[] = [];
    let lastAlertLevel = state.lastAlertLevel;
    if (
      state.status === "danger" &&
      reading.confidence === "high" &&
      !reading.bound &&
      lastAlertLevel !== null &&
      level >= lastAlertLevel + th.repeatStep - 1e-9
    ) {
      events.push({ kind: "rising", level, previous: lastAlertLevel, t });
      lastAlertLevel = level;
    }
    return { state: { ...state, pending: null, lastAlertLevel }, events };
  }

  const up = rank(target) > rank(state.status);
  if (up && reading.bound) return { state, events: [] };
  if (!up && reading.confidence === "low") return { state, events: [] };

  const needed = up ? (reading.confidence === "high" ? 1 : 2) : 2;
  const sameDirection =
    state.pending !== null && rank(state.pending.status) > rank(state.status) === up;
  const count = sameDirection ? (state.pending as { count: number }).count + 1 : 1;

  if (count < needed) {
    return { state: { ...state, pending: { status: target, count } }, events: [] };
  }

  const event: AlertEvent = up
    ? { kind: "escalate", from: state.status, to: target, level, t }
    : { kind: "clear", from: state.status, to: target, level, t };
  return {
    state: {
      status: target,
      since: t,
      lastAlertLevel: target === "normal" ? null : level,
      pending: null,
    },
    events: [event],
  };
}
