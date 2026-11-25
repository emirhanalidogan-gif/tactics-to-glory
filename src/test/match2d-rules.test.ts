import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS game module served from /public
import { __m2dTest as M } from "../../public/ufm/match2d.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type P = any;

const ROLES = ["GK", "LB", "CB", "CB", "RB", "LW", "CM", "CM", "RW", "ST", "ST"];
const POS = [50, 14, 38, 62, 86, 14, 38, 62, 86, 38, 62].map((x, i) => ({ x, y: [92, 72, 76, 76, 72, 46, 50, 50, 46, 20, 20][i] }));
const formations = { "4-4-2": ROLES.map((role, i) => ({ role, ...POS[i] })) };

function setup() {
  const game: P = { players: {} };
  const sides = [0, 1].map((si) => ({
    clubId: si,
    lineup: ROLES.map((role, i) => {
      const pid = si * 100 + i;
      game.players[pid] = { last: `P${pid}` };
      return { pid, role };
    }),
  }));
  const S = M.newSim();
  M.syncPlayers(S, game, { sides }, () => ({ tactic: { formation: "4-4-2" } }), formations, true);
  S.mode = "ambient";
  return { S, game };
}

const goalLineDist = (pt: P, side: number) => (side === 0 ? M.PL - pt.x : pt.x);

describe("2D penalties", () => {
  it("the taker is standing at the ball when the penalty is struck", () => {
    for (let key = 1; key <= 25; key++) {
      const { S, game } = setup();
      // the taker is a centre-back deep in his own half
      const taker = S.players.get(2);
      taker.x = 10;
      taker.y = 5;
      const ev = { kind: key % 3 ? "goal" : "save", side: 0, pid: 2, min: 50, text: { tr: "GOL! P2 penaltıyı gole çevirdi!", en: "penalty" } };
      S.hl = M.buildHighlight(S, ev, key, game, (p: P) => p.last);
      let struck = false;
      for (let i = 0; i < 30 * 15 && !struck; i++) {
        M.tick(S, 1 / 30, { running: true, share: 0.5, rnd: Math.random });
        if (S.ball.mode === "shot") {
          struck = true;
          const from = S.ball.from;
          const p = S.players.get(2);
          expect(Math.hypot(p.x - from.x, p.y - from.y)).toBeLessThan(1.5);
          expect(goalLineDist(from, 0)).toBeCloseTo(11, 0);
        }
      }
      expect(struck).toBe(true);
    }
  });
});

describe("2D goals", () => {
  it("ordinary goals are scored from close range (12 m or less)", () => {
    for (let key = 1; key <= 200; key++) {
      const { S, game } = setup();
      const ev = { kind: "goal", side: 0, pid: 9, min: 30, text: { tr: "GOL! P9 yakın mesafeden topu ağlara gönderdi!", en: "" } };
      const H = M.buildHighlight(S, ev, key, game, (p: P) => p.last);
      const last = H.steps.filter((s: P) => s.type === "pass").pop();
      expect(goalLineDist(last.at, 0)).toBeLessThanOrEqual(12.01);
    }
  });
  it("only goals the engine calls long-range are struck from outside the box", () => {
    const { S, game } = setup();
    const ev = { kind: "goal", side: 0, pid: 9, min: 30, text: { tr: "GOL! P9 ceza sahası dışından olağanüstü bir şut çaktı!", en: "" } };
    const H = M.buildHighlight(S, ev, 3, game, (p: P) => p.last);
    const last = H.steps.filter((s: P) => s.type === "pass").pop();
    expect(goalLineDist(last.at, 0)).toBeGreaterThan(20);
  });
});
