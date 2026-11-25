/*
 * National-team tournaments: FIFA World Cup (48 teams), UEFA Euro (24) and the
 * UEFA Nations League finals (16 -> final four). Pure game logic, no React.
 *
 * Nations are built from the players in the save (p.nat) blended with a base
 * rating so real football powers stay strong even with few players in the game.
 * Matches use a Poisson model where the stronger nation is clearly favoured.
 * The manager may coach one participating nation and pick an approach per match.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const CONF = {
  UEFA: "ES FR ENG PT DE NL IT BE HR TR DK CH NO AT UA SE PL CZ SCO RS HU GR WAL IE SK SI RO AL GE IS FI BA MK ME NIR BG IL XK KZ AZ AM LU EE LV LT MD CY FO AD BY".split(" "),
  CONMEBOL: "AR BR UY CO EC PY CL PE VE BO".split(" "),
  CAF: "MA SN EG NG CI DZ TN CM GH ML ZA CD BF CV GN GA AO ZM GM GW BJ TG MZ MG SL LR MR KM BI TZ UG RW NE TD CF SD ET ZW KE CG GQ LY".split(" "),
  AFC: "JP KR IR AU SA QA UZ IQ JO CN SY PS LB PH ID".split(" "),
  CONCACAF: "US MX CA PA CR JM HN HT CW SR DO CU NI GP MQ GF".split(" "),
  OFC: ["NZ"],
};
const CONF_OF = {};
for (const [c, list] of Object.entries(CONF)) for (const n of list) CONF_OF[n] = c;
export const confOf = (nat) => CONF_OF[nat] ?? null;

const BASE = {
  ES: 87, FR: 87, ENG: 86, PT: 85, DE: 84, NL: 84, IT: 82, BE: 81, HR: 80, TR: 79, NO: 79, DK: 78, CH: 78, AT: 78,
  UA: 75, SE: 76, PL: 75, CZ: 75, SCO: 74, RS: 75, HU: 74, GR: 74, WAL: 72, IE: 71, SK: 72, SI: 71, RO: 72, AL: 70,
  GE: 72, IS: 68, FI: 68, BA: 69, MK: 66, ME: 66, NIR: 67, BG: 65, IL: 66, XK: 66, KZ: 63, AZ: 62, AM: 62, LU: 61,
  EE: 58, LV: 58, LT: 58, MD: 57, CY: 60, FO: 55, AD: 50, BY: 60,
  AR: 87, BR: 86, UY: 82, CO: 81, EC: 79, PY: 76, CL: 74, PE: 73, VE: 73, BO: 66,
  MA: 82, SN: 80, EG: 77, NG: 77, CI: 77, DZ: 77, TN: 75, CM: 75, GH: 75, ML: 75, ZA: 72, CD: 74, BF: 72, CV: 72,
  GN: 70, GA: 70, AO: 69, ZM: 68,
  JP: 80, KR: 77, IR: 77, AU: 76, SA: 72, QA: 71, UZ: 73, IQ: 71, JO: 72, CN: 66,
  US: 78, MX: 78, CA: 77, PA: 72, CR: 71, JM: 70, HN: 68, HT: 66, CW: 66, SR: 64,
  NZ: 68,
};
export const baseRating = (nat) => BASE[nat] ?? 60;

export const KINDS = {
  WC: { tr: "FIFA Dünya Kupası", en: "FIFA World Cup", short: "WC", teams: 48, groups: 12 },
  EURO: { tr: "UEFA Avrupa Şampiyonası", en: "UEFA European Championship", short: "EURO", teams: 24, groups: 6 },
  NL: { tr: "UEFA Uluslar Ligi", en: "UEFA Nations League", short: "UNL", teams: 16, groups: 4 },
};
export const STAGES = {
  g1: { tr: "Grup · 1. maç", en: "Group · MD1" },
  g2: { tr: "Grup · 2. maç", en: "Group · MD2" },
  g3: { tr: "Grup · 3. maç", en: "Group · MD3" },
  r32: { tr: "Son 32", en: "Round of 32" },
  r16: { tr: "Son 16", en: "Round of 16" },
  qf: { tr: "Çeyrek final", en: "Quarter-final" },
  sf: { tr: "Yarı final", en: "Semi-final" },
  f: { tr: "Final", en: "Final" },
};
const KO_FLOW = { WC: ["r32", "r16", "qf", "sf", "f"], EURO: ["r16", "qf", "sf", "f"], NL: ["sf", "f"] };
export const APPROACH = {
  attack: { tr: "Hücum", en: "Attack", f: 1.22, a: 1.18 },
  balanced: { tr: "Dengeli", en: "Balanced", f: 1, a: 1 },
  counter: { tr: "Kontra", en: "Counter", f: 0.95, a: 0.82 },
  defend: { tr: "Savunma", en: "Park the bus", f: 0.72, a: 0.66 },
};

/** Tournament held in the summer of `year` (season year-1/year ends just before it). */
export function kindForYear(year) {
  if (year % 4 === 2) return "WC";
  if (year % 4 === 0) return "EURO";
  return "NL";
}
export const hostOf = (kind, year) =>
  ({ "WC:2026": ["US", "MX", "CA"], "WC:2030": ["ES", "PT", "MA"], "WC:2034": ["SA"], "EURO:2028": ["ENG", "IE", "WAL", "SCO"], "EURO:2032": ["IT", "TR"] })[`${kind}:${year}`] ?? [];

const POS_ATT = { GK: 0.02, CB: 0.25, LB: 0.3, RB: 0.3, DM: 0.45, CM: 0.9, AM: 1.8, LW: 2, RW: 2, ST: 3.4 };

/** nat -> {nat, rating, squad:[pid]} built from the save's players. */
export function nations(g, ovr) {
  const pools = new Map();
  for (const p of Object.values(g.players)) {
    if (!p.nat || p.retired) continue;
    let a = pools.get(p.nat);
    if (!a) pools.set(p.nat, (a = []));
    a.push(p);
  }
  const out = new Map();
  const nats = new Set([...Object.keys(BASE), ...pools.keys()]);
  for (const nat of nats) {
    if (nat === "RU" || !confOf(nat)) continue;
    const pool = (pools.get(nat) ?? []).map((p) => ({ p, o: ovr(p) })).sort((a, b) => b.o - a.o);
    const gks = pool.filter((x) => x.p.pos === "GK");
    const outf = pool.filter((x) => x.p.pos !== "GK");
    const squad = [...gks.slice(0, 3), ...outf.slice(0, 23 - Math.min(3, gks.length))];
    const xi = [...gks.slice(0, 1), ...outf.slice(0, 10)];
    const base = baseRating(nat);
    let rating = base;
    if (xi.length >= 11) {
      const avg = xi.reduce((s, x) => s + x.o, 0) / xi.length;
      rating = 0.5 * avg + 0.5 * base;
    } else if (xi.length) {
      const avg = xi.reduce((s, x) => s + x.o, 0) / xi.length;
      const w = (xi.length / 11) * 0.35;
      rating = w * avg + (1 - w) * base;
    }
    out.set(nat, { nat, rating: Math.round(rating * 10) / 10, squad: squad.map((x) => x.p.id), ovrs: squad.map((x) => x.o) });
  }
  return out;
}

function pickParticipants(kind, year, nmap) {
  const by = (conf) => [...nmap.values()].filter((n) => confOf(n.nat) === conf).sort((a, b) => b.rating - a.rating);
  const hosts = hostOf(kind, year).filter((n) => nmap.has(n));
  const take = (list, k, chosen) => {
    for (const n of list) {
      if (k <= 0) break;
      if (!chosen.has(n.nat)) {
        chosen.add(n.nat);
        k--;
      }
    }
  };
  const chosen = new Set(hosts);
  if (kind === "WC") {
    if (year === 2026) {
      const real = "US MX CA PA HT CW JP IR UZ KR JO AU QA SA MA TN EG DZ GH CV ZA SN CI AR BR EC UY CO PY NZ ENG FR HR NO PT NL DE ES BE AT CH SCO IT TR DK CZ CD IQ".split(" ");
      for (const n of real) if (nmap.has(n)) chosen.add(n);
    }
    const quota = { UEFA: 16, CONMEBOL: 6, CAF: 9, AFC: 8, CONCACAF: 6, OFC: 1 };
    for (const [c, q] of Object.entries(quota)) {
      const have = [...chosen].filter((n) => confOf(n) === c).length;
      take(by(c), q - have, chosen);
    }
    const rest = [...nmap.values()].sort((a, b) => b.rating - a.rating);
    take(rest, 48 - chosen.size, chosen);
    return [...chosen].slice(0, 48);
  }
  const n = kind === "EURO" ? 24 : 16;
  take(by("UEFA"), n - chosen.size, chosen);
  return [...chosen].slice(0, n);
}

function shuffleWith(a, rand) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Create a tournament (not yet played). */
export function createTournament(g, kind, year, { ovr, rand }) {
  const nmap = nations(g, ovr);
  const K = KINDS[kind];
  const teams = pickParticipants(kind, year, nmap);
  const sorted = [...teams].sort((a, b) => nmap.get(b).rating - nmap.get(a).rating);
  const G = K.groups;
  const per = teams.length / G;
  const pots = Array.from({ length: per }, (_, i) => shuffleWith(sorted.slice(i * G, (i + 1) * G), rand));
  const groups = Array.from({ length: G }, (_, i) => ({ name: String.fromCharCode(65 + i), teams: pots.map((pot) => pot[i]).filter(Boolean) }));
  const fixtures = [];
  let id = 1;
  for (const gr of groups) {
    const [a, b, c, d] = gr.teams;
    const md = [[[a, b], [c, d]], [[a, c], [d, b]], [[d, a], [b, c]]];
    md.forEach((pairs, i) => pairs.forEach(([h, w]) => h && w && fixtures.push({ id: id++, stage: `g${i + 1}`, group: gr.name, home: h, away: w, played: false, hg: 0, ag: 0, goals: [] })));
  }
  const info = {};
  for (const nat of teams) {
    const n = nmap.get(nat);
    info[nat] = { rating: n.rating, squad: n.squad, ovrs: n.ovrs };
  }
  return {
    kind, year, name: { tr: `${K.tr} ${year}`, en: `${K.en} ${year}` }, short: `${K.short} ${year}`,
    hosts: hostOf(kind, year), teams, info, groups, fixtures, nextId: id,
    stage: "g1", flow: ["g1", "g2", "g3", ...KO_FLOW[kind]], done: false, champion: null, runnerUp: null,
    scorers: {}, userNat: null, approach: "balanced", log: [],
  };
}

function poisson(lambda, rand) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L && k < 12);
  return k - 1;
}

function scorerOf(t, nat, g, rand) {
  const inf = t.info[nat];
  const squad = (inf?.squad ?? []).map((pid, i) => ({ p: g.players[pid], o: inf.ovrs?.[i] ?? 70 })).filter((x) => x.p);
  if (!squad.length) return null;
  const w = squad.map(({ p, o }) => (POS_ATT[p.pos] ?? 0.5) * Math.max(0.2, (o / 70) ** 3));
  let r = rand() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < squad.length; i++) {
    r -= w[i];
    if (r <= 0) return squad[i].p.id;
  }
  return squad[squad.length - 1].p.id;
}

/** Expected goals for `a` vs `b` (strong favourites score much more). */
export function lambdaFor(ra, rb, homeBoost = 0) {
  return clamp(1.15 * Math.exp((ra - rb + homeBoost) * 0.075), 0.15, 3.8);
}

export function playFixture(g, t, f, { rand, approach }) {
  const ra = t.info[f.home].rating;
  const rb = t.info[f.away].rating;
  const hb = (t.hosts.includes(f.home) ? 2 : 0) - (t.hosts.includes(f.away) ? 2 : 0);
  let lh = lambdaFor(ra, rb, hb);
  let la = lambdaFor(rb, ra, -hb);
  const ap = APPROACH[approach] ?? null;
  if (ap && t.userNat === f.home) {
    lh *= ap.f;
    la *= ap.a;
  } else if (ap && t.userNat === f.away) {
    la *= ap.f;
    lh *= ap.a;
  }
  f.hg = poisson(lh, rand);
  f.ag = poisson(la, rand);
  const ko = !f.stage.startsWith("g");
  if (ko && f.hg === f.ag) {
    const eh = poisson(lh / 4, rand);
    const ea = poisson(la / 4, rand);
    f.hg += eh;
    f.ag += ea;
    f.aet = true;
    if (f.hg === f.ag) {
      const pHome = clamp(0.5 + (ra - rb) * 0.01, 0.35, 0.65);
      f.pens = rand() < pHome ? "home" : "away";
    }
  }
  f.goals = [];
  for (let i = 0; i < f.hg; i++) f.goals.push({ side: 0, pid: scorerOf(t, f.home, g, rand), min: 1 + Math.floor(rand() * (f.aet ? 120 : 90)) });
  for (let i = 0; i < f.ag; i++) f.goals.push({ side: 1, pid: scorerOf(t, f.away, g, rand), min: 1 + Math.floor(rand() * (f.aet ? 120 : 90)) });
  f.goals.sort((a, b) => a.min - b.min);
  for (const gl of f.goals) if (gl.pid != null) t.scorers[gl.pid] = (t.scorers[gl.pid] ?? 0) + 1;
  f.played = true;
  return f;
}

export const winnerOf = (f) => (f.hg > f.ag || f.pens === "home" ? f.home : f.away);
export const loserOf = (f) => (winnerOf(f) === f.home ? f.away : f.home);

export function groupTable(t, name) {
  const gr = t.groups.find((x) => x.name === name);
  const rows = new Map(gr.teams.map((n) => [n, { nat: n, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }]));
  for (const f of t.fixtures) {
    if (f.group !== name || !f.played) continue;
    const h = rows.get(f.home);
    const a = rows.get(f.away);
    h.p++, a.p++, (h.gf += f.hg), (h.ga += f.ag), (a.gf += f.ag), (a.ga += f.hg);
    if (f.hg > f.ag) h.w++, a.l++, (h.pts += 3);
    else if (f.hg < f.ag) a.w++, h.l++, (a.pts += 3);
    else h.d++, a.d++, h.pts++, a.pts++;
  }
  return [...rows.values()].sort((x, y) => y.pts - x.pts || y.gf - y.ga - (x.gf - x.ga) || y.gf - x.gf || t.info[y.nat].rating - t.info[x.nat].rating);
}

/** Standard bracket order so the top seeds can only meet late: [1,n,(n/2+1)...]. */
function seedOrder(n) {
  let order = [1, 2];
  while (order.length < n) {
    const m = order.length * 2 + 1;
    order = order.flatMap((s) => [s, m - s]);
  }
  return order;
}

function koEntrants(t) {
  const tables = t.groups.map((gr) => groupTable(t, gr.name));
  const rankKey = (r) => r.pts * 1e4 + (r.gf - r.ga) * 100 + r.gf;
  const firsts = tables.map((x) => x[0]).sort((a, b) => rankKey(b) - rankKey(a));
  const seconds = tables.map((x) => x[1]).sort((a, b) => rankKey(b) - rankKey(a));
  if (t.kind === "NL") return firsts.map((r) => r.nat);
  const nThird = t.kind === "WC" ? 8 : 4;
  const thirds = tables.map((x) => x[2]).filter(Boolean).sort((a, b) => rankKey(b) - rankKey(a)).slice(0, nThird);
  return [...firsts, ...seconds, ...thirds].map((r) => r.nat);
}

function buildKo(t, stage, entrants) {
  const n = entrants.length;
  const order = seedOrder(n);
  for (let i = 0; i < n; i += 2) {
    const a = entrants[order[i] - 1];
    const b = entrants[order[i + 1] - 1];
    t.fixtures.push({ id: t.nextId++, stage, home: a, away: b, played: false, hg: 0, ag: 0, goals: [] });
  }
}

/** After the current stage is fully played, create the next one. */
function advance(t) {
  const i = t.flow.indexOf(t.stage);
  const cur = t.fixtures.filter((f) => f.stage === t.stage);
  if (cur.some((f) => !f.played)) return false;
  if (t.stage === "f") {
    const f = cur[0];
    t.champion = winnerOf(f);
    t.runnerUp = loserOf(f);
    t.done = true;
    return true;
  }
  const next = t.flow[i + 1];
  if (t.stage === "g3") {
    const ent = koEntrants(t);
    // reseed the entrants by group finish; seedOrder keeps the best apart
    buildKo(t, next, ent);
  } else {
    const winners = cur.map(winnerOf);
    for (let k = 0; k < winners.length; k += 2)
      t.fixtures.push({ id: t.nextId++, stage: next, home: winners[k], away: winners[k + 1], played: false, hg: 0, ag: 0, goals: [] });
  }
  t.stage = next;
  return true;
}

/** Play every fixture of the current stage (user's fixture with the chosen approach). */
export function playStage(g, t, deps) {
  if (t.done) return t;
  for (const f of t.fixtures) if (f.stage === t.stage && !f.played) playFixture(g, t, f, { rand: deps.rand, approach: t.approach });
  advance(t);
  return t;
}
export function playAll(g, t, deps) {
  let guard = 0;
  while (!t.done && guard++ < 20) playStage(g, t, deps);
  return t;
}

export const userAlive = (t) =>
  !!t.userNat && !t.done && (t.stage.startsWith("g") || t.fixtures.some((f) => f.stage === t.stage && (f.home === t.userNat || f.away === t.userNat)));

/** Furthest stage reached by a nation (for rewards / history). */
export function reached(t, nat) {
  if (t.champion === nat) return "champion";
  if (t.runnerUp === nat) return "f";
  const ko = t.fixtures.filter((f) => !f.stage.startsWith("g") && (f.home === nat || f.away === nat));
  if (!ko.length) return "group";
  return ko[ko.length - 1].stage;
}

export function topScorers(t, n = 10) {
  return Object.entries(t.scorers)
    .map(([pid, goals]) => ({ pid: +pid, goals }))
    .sort((a, b) => b.goals - a.goals)
    .slice(0, n);
}

/** Can the manager take this nation's job? Own nation always, others by reputation. */
export function canCoach(g, t, nat) {
  if (!t.teams.includes(nat)) return false;
  if (g.manager?.nat === nat) return true;
  const rep = g.manager?.rep ?? 45;
  return t.info[nat].rating <= 58 + rep * 0.36;
}
