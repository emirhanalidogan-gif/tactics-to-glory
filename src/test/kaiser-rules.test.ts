import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS game modules served from /public
import * as KX from "../../public/ufm/kaiser-ext.js";
// @ts-expect-error plain JS game modules served from /public
import * as IX from "../../public/ufm/kx-intl.js";
// @ts-expect-error plain JS game modules served from /public
import * as CE from "../../public/ufm/career-ext.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type P = any;

let seed = 7;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

KX.init({
  rand,
  ovr: (p: P) => p.ovr,
  getClub: (g: P, id: number) => g.clubs.find((c: P) => c.id === id),
  clubPlayers: (g: P, id: number) => Object.values(g.players).filter((p: P) => p.clubId === id),
  shortName: (p: P) => p.last,
  inbox: () => {},
});

describe("big clubs are favourites", () => {
  it("gives a 90-rated club a clearly bigger strength factor than an average one", () => {
    expect(KX.bigMul(72)).toBeCloseTo(1, 5);
    expect(KX.bigMul(90)).toBeGreaterThanOrEqual(1.15);
    expect(KX.bigMul(60)).toBeLessThan(0.9);
  });
});

describe("extra leagues", () => {
  const xo = (id: string, name: P, country: P, nat: string, level: number, tvPool: number, ticket: number, wageFactor: number, clubs: P[]) => ({ id, name, country, nat, tier: 1, level, tvPool, ticket, wageFactor, promote: 0, relegate: 0, clubs });
  it("adds the eight new leagues and moves real European clubs into them", () => {
    const So: P[] = [{ id: "ENG1", clubs: [] }, { id: "EUR", hidden: true, clubs: [{ name: "Benfica" }, { name: "Celtic" }, { name: "Olympiacos" }] }];
    KX.extendLeagues(So, xo);
    const ids = So.map((l) => l.id);
    for (const id of ["POR1", "NED1", "BEL1", "SCO1", "BRA1", "ARG1", "KSA1", "USA1"]) expect(ids).toContain(id);
    const por = So.find((l) => l.id === "POR1");
    expect(por.clubs.some((c: P) => c.name === "Benfica")).toBe(true);
    expect(por.clubs.length).toBe(15); // Benfica moved + 14 new (the test EUR pool has no Porto/Sporting/Braga)
    expect(So.find((l) => l.id === "EUR").clubs.map((c: P) => c.name)).toEqual(["Olympiacos"]);
    expect(So.find((l) => l.id === "BRA1").clubs.length).toBe(20);
  });
  it("keeps non-European leagues out of UEFA competitions", () => {
    expect(KX.uefa("BRA1")).toBe(false);
    expect(KX.uefa("USA1")).toBe(false);
    expect(KX.uefa("POR1")).toBe(true);
    expect(KX.uefa("TR1")).toBe(true);
  });
  it("gives every new league a domestic cup", () => {
    const ids = CE.DCUPS.flatMap((c: P) => c.leagues);
    for (const id of ["POR1", "NED1", "BEL1", "SCO1", "BRA1", "ARG1", "KSA1", "USA1"]) expect(ids).toContain(id);
  });
});

function makeGame() {
  const players: Record<number, P> = {};
  let id = 1;
  const nats = ["ES", "FR", "ENG", "BR", "AR", "DE", "PT", "NL", "TR", "NZ", "US", "MX", "JP", "MA"];
  for (const nat of nats)
    for (let i = 0; i < 18; i++) {
      players[id] = { id, nat, pos: i === 0 ? "GK" : i < 7 ? "CB" : i < 12 ? "CM" : "ST", ovr: 60 + (IX.baseRating(nat) - 60) * 0.9, clubId: 1, last: `P${id}` };
      id++;
    }
  const clubs = [{ id: 1, name: "Club", rep: 70, leagueId: "TR1", stadium: "Arena", capacity: 30000, city: "X", colors: ["#f00", "#fff"] }];
  return { season: 2026, week: 0, phase: "preseason", clubId: 1, manager: { nat: "TR", rep: 50 }, clubs, leagues: [{ id: "TR1", fixtures: [] }], cups: [], players, board: { confidence: 60 } } as P;
}

describe("national tournaments", () => {
  it("rotates World Cup, EURO and Nations League", () => {
    expect(IX.kindForYear(2026)).toBe("WC");
    expect(IX.kindForYear(2027)).toBe("NL");
    expect(IX.kindForYear(2028)).toBe("EURO");
    expect(IX.kindForYear(2030)).toBe("WC");
  });
  it("plays a 48-team World Cup to a single champion", () => {
    const g = makeGame();
    const t = IX.createTournament(g, "WC", 2026, { ovr: (p: P) => p.ovr, rand });
    expect(t.teams.length).toBe(48);
    expect(t.groups.length).toBe(12);
    IX.playAll(g, t, { rand });
    expect(t.done).toBe(true);
    expect(t.fixtures.filter((f: P) => f.stage === "r32").length).toBe(16);
    expect(t.fixtures.filter((f: P) => f.stage === "f").length).toBe(1);
    expect(t.teams).toContain(t.champion);
  });
  it("plays a 24-team EURO and a 16-team Nations League", () => {
    const g = makeGame();
    const e = IX.createTournament(g, "EURO", 2028, { ovr: (p: P) => p.ovr, rand });
    expect(e.teams.length).toBe(24);
    IX.playAll(g, e, { rand });
    expect(e.done).toBe(true);
    const n = IX.createTournament(g, "NL", 2027, { ovr: (p: P) => p.ovr, rand });
    expect(n.teams.length).toBe(16);
    IX.playAll(g, n, { rand });
    expect(n.fixtures.filter((f: P) => f.stage === "sf").length).toBe(2);
  });
  it("makes a much stronger nation win most of the time", () => {
    const g = makeGame();
    const t: P = { info: { ES: { rating: 87, squad: [] }, NZ: { rating: 68, squad: [] } }, hosts: [], scorers: {}, userNat: null };
    let wins = 0;
    for (let i = 0; i < 400; i++) {
      const f: P = { stage: "g1", home: "ES", away: "NZ" };
      IX.playFixture(g, t, f, { rand, approach: "balanced" });
      if (f.hg > f.ag) wins++;
    }
    expect(wins / 400).toBeGreaterThan(0.7);
  });
});

describe("pre-match press conference", () => {
  it("adds at least six extra questions with three answers each", () => {
    const g = makeGame();
    g.clubs.push({ id: 2, name: "Rival", rep: 75, leagueId: "TR1", stadium: "Dome", capacity: 40000, city: "Y", colors: ["#00f", "#fff"] });
    g.players[9999] = { id: 9999, nat: "TR", pos: "ST", ovr: 80, clubId: 2, last: "Star", age: 27 };
    const qs = KX.pressExtra(g, 1, 2, "Süper Lig", 3, ["A", "B", "C"]);
    expect(qs.length).toBeGreaterThanOrEqual(6);
    for (const q of qs) expect(q.answers.length).toBe(3);
  });
});

describe("in-match formation change", () => {
  const V = (role: string) => ({ role });
  const formations = {
    "4-4-2": ["GK", "LB", "CB", "CB", "RB", "LW", "CM", "CM", "RW", "ST", "ST"].map(V),
    "3-5-2": ["GK", "CB", "CB", "CB", "LW", "CM", "DM", "CM", "RW", "ST", "ST"].map(V),
  };
  const score = (p: P, role: string) => (p.pos === role ? 90 : 50);
  it("keeps the keeper in goal and moves the others into the new shape", () => {
    const roles = formations["4-4-2"].map((s) => s.role);
    const players: P = {};
    const lineup = roles.map((role, i) => {
      players[i] = { pos: role === "LB" ? "CB" : role };
      return { pid: i, role };
    });
    const side: P = { lineup };
    expect(KX.reshape({ players }, side, "3-5-2", formations, score)).toBe(true);
    expect(side.formation).toBe("3-5-2");
    expect(side.lineup.find((l: P) => l.pid === 0).role).toBe("GK");
    const got = side.lineup.map((l: P) => l.role).sort();
    expect(got).toEqual(formations["3-5-2"].map((s) => s.role).sort());
    expect(side.lineup.filter((l: P) => l.role === "CB").length).toBe(3);
  });
  it("refuses an unknown formation", () => {
    const side: P = { lineup: [{ pid: 1, role: "GK" }] };
    expect(KX.reshape({ players: {} }, side, "9-9-9", formations, score)).toBe(false);
  });
});

describe("theme", () => {
  it("defaults to the white theme", () => {
    localStorage.removeItem("ufm-theme");
    expect(KX.readTheme()).toBe("light");
    KX.applyTheme("dark");
    expect(KX.readTheme()).toBe("dark");
    expect(document.documentElement.getAttribute("data-ufm-theme")).toBe("dark");
    KX.applyTheme("light");
    expect(document.documentElement.hasAttribute("data-ufm-theme")).toBe(false);
  });
});

describe("in-match formation change picks the best overall fit", () => {
  it("puts a versatile player in defence instead of leaving a pure striker at centre-back", () => {
    const formations = { "1-1-1": [{ role: "GK" }, { role: "CB" }, { role: "ST" }] };
    const players: P = { 1: { s: { ST: 90, CB: 85 } }, 2: { s: { ST: 89, CB: 10 } }, 3: { s: {} } };
    const side: P = { lineup: [{ pid: 3, role: "GK" }, { pid: 1, role: "AM" }, { pid: 2, role: "AM" }] };
    KX.reshape({ players }, side, "1-1-1", formations, (p: P, r: string) => p.s[r] ?? 0);
    const roleOf = (pid: number) => side.lineup.find((l: P) => l.pid === pid).role;
    expect(roleOf(1)).toBe("CB");
    expect(roleOf(2)).toBe("ST");
    expect(roleOf(3)).toBe("GK");
  });
});
