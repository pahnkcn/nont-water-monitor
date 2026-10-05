import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLDS as TH,
  INITIAL_ALERT_STATE,
  classify,
  stepAlert,
  wantsEvent,
  type AlertEvent,
  type AlertState,
  type ReadingInput,
} from "@/lib/alerts";

function run(levels: Array<number | [number, "high" | "low"]>, start: AlertState = INITIAL_ALERT_STATE) {
  let state = start;
  const events: AlertEvent[] = [];
  levels.forEach((l, i) => {
    const [level, confidence] = Array.isArray(l) ? l : [l, "high" as const];
    const reading: ReadingInput = { t: i * 600_000, level, confidence };
    const out = stepAlert(state, reading, TH);
    state = out.state;
    events.push(...out.events);
  });
  return { state, events };
}

describe("classify", () => {
  it("maps levels to states", () => {
    expect(classify(1.5, TH, "normal")).toBe("normal");
    expect(classify(2.2, TH, "normal")).toBe("watch");
    expect(classify(2.5, TH, "normal")).toBe("danger");
  });

  it("holds a state until the water is clearly below", () => {
    expect(classify(2.47, TH, "danger")).toBe("danger");
    expect(classify(2.44, TH, "danger")).toBe("watch");
    expect(classify(2.17, TH, "watch")).toBe("watch");
    expect(classify(2.14, TH, "watch")).toBe("normal");
  });
});

describe("stepAlert", () => {
  it("escalates immediately on one confident reading", () => {
    const { state, events } = run([1.8, 2.25]);
    expect(state.status).toBe("watch");
    expect(events).toEqual([expect.objectContaining({ kind: "escalate", from: "normal", to: "watch" })]);
  });

  it("jumps straight to danger", () => {
    const { events } = run([1.8, 2.6]);
    expect(events).toEqual([expect.objectContaining({ kind: "escalate", from: "normal", to: "danger" })]);
  });

  it("needs two low-confidence readings to escalate", () => {
    expect(run([1.8, [2.6, "low"]]).events).toHaveLength(0);
    expect(run([1.8, [2.6, "low"], [2.6, "low"]]).events).toEqual([
      expect.objectContaining({ kind: "escalate", to: "danger" }),
    ]);
  });

  it("does not flap on a single dip", () => {
    const { state, events } = run([2.6, 2.4, 2.6]);
    expect(state.status).toBe("danger");
    expect(events.filter((e) => e.kind === "clear")).toHaveLength(0);
  });

  it("clears after two confident readings below", () => {
    const { state, events } = run([2.6, 2.0, 2.0]);
    expect(state.status).toBe("normal");
    expect(events.at(-1)).toEqual(expect.objectContaining({ kind: "clear", from: "danger", to: "normal" }));
  });

  it("never clears on low-confidence readings", () => {
    const { state } = run([2.6, [1.0, "low"], [1.0, "low"], [1.0, "low"]]);
    expect(state.status).toBe("danger");
  });

  it("repeats a danger alert each 10 cm further up", () => {
    const { events } = run([2.55, 2.6, 2.65, 2.7, 2.81]);
    const rising = events.filter((e) => e.kind === "rising");
    expect(rising).toHaveLength(2);
    expect(rising[0]).toEqual(expect.objectContaining({ level: 2.65, previous: 2.55 }));
    expect(rising[1]).toEqual(expect.objectContaining({ level: 2.81, previous: 2.65 }));
  });
});

describe("wantsEvent", () => {
  const up = (to: "watch" | "danger"): AlertEvent => ({ kind: "escalate", from: "normal", to, level: 2.3, t: 0 });
  const down = (from: "watch" | "danger"): AlertEvent => ({ kind: "clear", from, to: "normal", level: 2, t: 0 });

  it("danger-only subscribers skip watch alerts and watch all-clears", () => {
    expect(wantsEvent("danger", up("watch"))).toBe(false);
    expect(wantsEvent("danger", up("danger"))).toBe(true);
    expect(wantsEvent("danger", down("watch"))).toBe(false);
    expect(wantsEvent("danger", down("danger"))).toBe(true);
  });

  it("watch subscribers get everything", () => {
    expect(wantsEvent("watch", up("watch"))).toBe(true);
    expect(wantsEvent("watch", down("watch"))).toBe(true);
  });

  it("off gets nothing", () => {
    expect(wantsEvent("off", up("danger"))).toBe(false);
  });
});
