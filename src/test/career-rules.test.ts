import { beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error plain JS game module served from /public
import * as CE from "../../public/ufm/career-ext.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type P = any;

function makeGame() {
  const leagues = [
    { id: "TR1", n: 18 },
    { id: "TR2", n: 20 },
    { id: "TR3A", n: 19 },
    { id: "TR3B", n: 16 },
    { id: "ENG1", n: 20 },
    { id: "ESP1", n: 20 },
    { id: "ITA1", n: 20 },
    { id: "GER1", n: 18 },
    { id: "FRA1", n: 18 },
  ];
  let id = 1;
  const clubs: P[] = [];
  const gl = leagues.map((l) => {
    const clubIds: number[] = [];
    for (let i = 0; i < l.n; i++) {
      clubs.push({ id, name: `C${id}`, leagueId: l.id, rep: 40 + ((id * 7) % 50), balance: 1e7 });
      clubIds.push(id++);
    }
    return { id: l.id, clubIds };
  });
  return { season: 2026, week: 1, phase: "season", clubId: 1, clubs, leagues: gl, cups: [], players: {}, inbox: [] } as P;
}

let seed = 1;
beforeEach(() => {
  seed = 1;
  CE.init({
    ovr: (p: P) => p.ovr,
    value: (p: P) => p.mv,
    getClub: (g: P, cid: number) => g.clubs.find((c: P) => c.id === cid),
    clubPlayers: (g: P, cid: number) => Object.values(g.players).filter((p: any) => p.clubId === cid),
    roundMoney: (v: number) => Math.round(v),
    rand: () => ((seed = (seed * 16807) % 2147483647) / 2147483647),
    shuffle: <T,>(a: T[]) => a,
    inbox: () => {},
  });
});

function player(over: P): P {
  return { id: 7, clubId: 2, age: 26, ovr: 78, pot: 80, mv: 20e6, contractEnd: 2029, careerGoals: 20, careerApps: 120, form: [6.8], listed: false, ...over };
}

describe("transfer fee vs market value", () => {
  it("asks more than market value for a regular player", () => {
    const g = makeGame();
    const p = player({});
    g.players[p.id] = p;
    expect(CE.askingPrice(g, p, 1)).toBeGreaterThan(p.mv);
  });

  it("asks a bigger premium for a more famous player with the same market value", () => {
    const g = makeGame();
    g.clubs[1].rep = 60;
    const unknown = player({ id: 7, ovr: 66, careerGoals: 0, careerApps: 5, form: [6.2] });
    const star = player({ id: 7, ovr: 88, careerGoals: 150, careerApps: 400, form: [7.6] });
    expect(CE.fame(g, star)).toBeGreaterThan(CE.fame(g, unknown));
    g.players = { 7: unknown };
    const a = CE.askingPrice(g, unknown, 1);
    g.players = { 7: star };
    const b = CE.askingPrice(g, star, 1);
    expect(b).toBeGreaterThan(a);
  });
});

describe("world star pricing", () => {
  it("asks at least twice the market value for a world star", () => {
    const g = makeGame();
    g.clubs[1].rep = 92;
    const star = player({ ovr: 91, age: 27, careerGoals: 200, careerApps: 400, form: [7.8] });
    g.players = { 7: star };
    expect(CE.fame(g, star)).toBeGreaterThanOrEqual(0.8);
    expect(CE.askingPrice(g, star, 1)).toBeGreaterThanOrEqual(2 * star.mv);
  });
});

describe("veteran pricing", () => {
  it("asks a smaller premium for a 34-year-old than a 27-year-old of the same value", () => {
    const g = makeGame();
    const young = player({ age: 27 });
    g.players = { 7: young };
    const a = CE.askingPrice(g, young, 1);
    const old = player({ age: 34 });
    g.players = { 7: old };
    const b = CE.askingPrice(g, old, 1);
    expect(b).toBeLessThan(a);
  });
});

describe("domestic cups", () => {
  it("creates the six national cups", () => {
    const g = makeGame();
    CE.createCups(g);
    const names = g.cups.filter((c: P) => c.domestic).map((c: P) => c.name.tr);
    expect(names).toEqual(["Ziraat Türkiye Kupası", "FA Cup", "Copa del Rey", "Coppa Italia", "DFB-Pokal", "Coupe de France"]);
  });

  it("Türkiye Kupası includes clubs from all Turkish divisions", () => {
    const g = makeGame();
    CE.createCups(g);
    const trc = g.cups.find((c: P) => c.id === "TRC");
    expect(trc.clubIds.length).toBe(18 + 20 + 19 + 16);
  });
});

describe("no transfer budget limit", () => {
  it("lets the user bid even with zero transfer budget and an empty balance", () => {
    const g = makeGame();
    const me = g.clubs[0];
    me.transferBudget = 0;
    me.balance = 0;
    const p = player({});
    g.players[p.id] = p;
    for (let i = 0; i < 25; i++) g.players[100 + i] = player({ id: 100 + i, clubId: 2 });
    CE.init({
      ...depsForBudget(),
      windowOpen: () => true,
      money: (v: number) => String(v),
    });
    const err = CE.checkOffer(g, p.id, { fee: 30e6, inst: 1 });
    expect(String(err ?? "")).not.toMatch(/bütçe|budget/i);
  });
});

describe("cards", () => {
  it("usually gives a yellow to an unbooked player instead of a second yellow", () => {
    const lineup = [{ pid: 1, role: "CB" }, { pid: 2, role: "CB" }, { pid: 3, role: "CM" }];
    const ms = { yellow: { 1: 1, 2: 1 } } as P;
    let r = 1;
    CE.init({
      ...depsForBudget(),
      weighted: <T,>(items: T[]) => items[0],
      chance: () => true,
      rand: () => (r = (r * 16807) % 2147483647) / 2147483647,
    });
    expect(CE.cardPick(ms, { lineup }, {}).pid).toBe(3);
  });
});

function depsForBudget() {
  return {
    ovr: (p: P) => p.ovr,
    value: (p: P) => p.mv,
    getClub: (g: P, cid: number) => g.clubs.find((c: P) => c.id === cid),
    clubPlayers: (g: P, cid: number) => Object.values(g.players).filter((p: any) => p.clubId === cid),
    roundMoney: (v: number) => Math.round(v),
    rand: () => 0.5,
    shuffle: <T,>(a: T[]) => a,
    inbox: () => {},
  };
}

describe("financial fair play points deduction", () => {
  function setup(balance: number) {
    const g = makeGame();
    g.clubs[0].balance = balance;
    const mail: string[] = [];
    CE.init({ ...depsForBudget(), money: (v: number) => String(v), inbox: (_g: P, _k: string, t: P) => mail.push(t.tr) });
    return { g, mail };
  }

  it("deducts points next season when the balance is negative at season end", () => {
    const { g, mail } = setup(-5e6);
    CE.ffpSeasonEnd(g);
    expect(CE.penaltyFor(g, 1, 2027)).toBe(3);
    expect(mail.some((m) => /puan/.test(m))).toBe(true);
  });

  it("gives no deduction when the balance is positive at season end", () => {
    const { g } = setup(1e6);
    CE.ffpSeasonEnd(g);
    expect(CE.penaltyFor(g, 1, 2027)).toBe(0);
  });

  it("scales the deduction with the debt and adds 3 for a repeat breach", () => {
    expect(CE.ffpPoints(5e6)).toBe(3);
    expect(CE.ffpPoints(20e6)).toBe(6);
    expect(CE.ffpPoints(50e6)).toBe(9);
    expect(CE.ffpPoints(200e6)).toBe(12);
    expect(CE.ffpPoints(20e6, 1)).toBe(9);
  });

  it("subtracts the deduction from the club's league points", () => {
    const { g } = setup(-50e6);
    CE.ffpSeasonEnd(g);
    g.season = 2027;
    const rows = new Map([[1, { clubId: 1, pts: 10 }], [2, { clubId: 2, pts: 10 }]]);
    CE.applyPenalties(g, rows);
    expect(rows.get(1)!.pts).toBe(1);
    expect(rows.get(2)!.pts).toBe(10);
  });
});
