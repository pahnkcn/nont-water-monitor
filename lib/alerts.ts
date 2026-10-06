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
 * Personal alert points, in cm against the site thresholds. Negative alerts before the water
 * gets there (a low house), positive only once it is that far over (a raised one).
 */
export const OFFSET_CHOICES = [-50, -30, -20, -10, 0, 10, 20, 30] as const;

/** Both thresholds moved by the subscriber's offset. */
export function personalThresholds(th: Thresholds, offsetCm: number): Thresholds {
  const move = (v: number) => Math.round(v * 100 + offsetCm) / 100;
  return { ...th, watch: move(th.watch), danger: move(th.danger) };
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

export type ReadingInput = { t: number; level: number; confidence: "high" | "low" };

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

/** State for someone who has just picked an alert point: where the water already is, without an alert. */
export function initialPersonalState(level: number | null, th: Thresholds, now: number): AlertState {
  const status = level === null ? "normal" : classify(level, th, "normal");
  return { status, since: now, lastAlertLevel: status === "normal" ? null : level, pending: null };
}

/**
 * Advance the alert state by one reading.
 * Going up: one confident reading is enough; a low-confidence one needs a second in a row.
 * Going down: two confident readings in a row. Low-confidence readings never clear an alert.
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
      lastAlertLevel !== null &&
      level >= lastAlertLevel + th.repeatStep - 1e-9
    ) {
      events.push({ kind: "rising", level, previous: lastAlertLevel, t });
      lastAlertLevel = level;
    }
    return { state: { ...state, pending: null, lastAlertLevel }, events };
  }

  const up = rank(target) > rank(state.status);
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

export type AlertPreference = "watch" | "danger" | "off";

/** Whether a subscriber who asked for alerts from `pref` upward should hear about this event. */
export function wantsEvent(pref: AlertPreference, event: AlertEvent): boolean {
  if (pref === "off") return false;
  const min = rank(pref);
  switch (event.kind) {
    case "escalate":
      return rank(event.to) >= min;
    case "rising":
      return rank("danger") >= min;
    case "clear":
      // Only people who were told about the level being left.
      return rank(event.from) >= min;
  }
}
