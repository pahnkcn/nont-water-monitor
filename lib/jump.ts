// A reading the river could not have reached is something crossing the gauge (a person, a pole,
// a boat, rain on the dome), not water. Hold it back until the next round says the same.

/** A level read on one calibration; levels from different calibrations do not compare. */
export type LevelAt = { t: number; level: number; calibration: number };

/**
 * "accept": within reach of the last accepted level. "confirm": out of reach, but the round
 * before saw the same, so the water really moved. "hold": out of reach and unconfirmed.
 */
export type JumpVerdict = "accept" | "confirm" | "hold";

/** Rounds held back here or read with low confidence that keep their picture for /admin. */
export const MAX_SUSPECTS = 24;

const HOUR = 60 * 60 * 1000;
/** Faster than the tide at the pier has been seen to move (about 25 cm an hour at most). */
const MAX_RATE_M_PER_HOUR = 0.4;
/** The reader's own wobble between rounds, more on the shaded foot of the gauge. */
const SLACK_M = 0.1;

/** Could the water have gone from `a` to `b`? */
function within(a: LevelAt, b: LevelAt) {
  const hours = Math.abs(b.t - a.t) / HOUR;
  return Math.abs(b.level - a.level) <= SLACK_M + MAX_RATE_M_PER_HOUR * hours + 1e-9;
}

export function judgeJump(cur: LevelAt, last: LevelAt | null, held: LevelAt | null): JumpVerdict {
  if (!last || last.calibration !== cur.calibration || within(last, cur)) return "accept";
  if (held && held.calibration === cur.calibration && within(held, cur)) return "confirm";
  return "hold";
}
