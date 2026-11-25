/*
 * Kaiser-style extensions (hand-written, framework-agnostic apart from injected React).
 *
 *  - Extra leagues + their domestic cups (kx-leagues.js), UEFA eligibility.
 *  - National tournaments: World Cup, Euro, Nations League (kx-intl.js) played in
 *    the summer/preseason; the manager may coach a nation.
 *  - Match engine hooks: big-club factor (favourites win more), match plan cards
 *    (buff / debuff trade-offs), form momentum.
 *  - Extra pre-match press questions.
 *  - Achievements and season awards (Ballon d'Or, Golden Boy, Golden Boot...).
 *  - Procedural stadium renderer: every club gets its own bowl in its colours,
 *    sized by capacity, used as the app backdrop and behind the 2D pitch.
 *
 * State lives in game.kx = { intl:{current, history}, ach:{id:season}, awards:[], plan }.
 */
import * as LX from "./kx-leagues.js?v=1";
import * as IX from "./kx-intl.js?v=1";

let D = null;
const T = (tr, en) => ({ tr, en });
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rnd = () => (D?.rand ? D.rand() : Math.random());

export const { extendLeagues, uefa, UEFA_SLOTS, EXTRA } = LX;
export const INTL = IX;

export function init(deps) {
  D = deps;
  if (typeof document !== "undefined" && !document.getElementById("kx-css")) {
    const link = document.createElement("link");
    link.id = "kx-css";
    link.rel = "stylesheet";
    link.href = new URL("./kaiser-ext.css?v=2", import.meta.url).href;
    document.head.appendChild(link);
  }
  applyTheme(readTheme());
}

/* ================================================================ theme (white default, black optional) */
const THEME_KEY = "ufm-theme";
export function readTheme() {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}
export function applyTheme(t) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (t === "dark") el.setAttribute("data-ufm-theme", "dark");
  else el.removeAttribute("data-ufm-theme");
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* private mode */
  }
}

/* ================================================================ in-match formation change */
/** Minimum-cost assignment for a square matrix; returns column index per row. */
function hungarian(a) {
  const n = a.length;
  const INF = 1e18;
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0);
  const way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(INF);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) (minv[j] = cur), (way[j] = j0);
        if (minv[j] < delta) (delta = minv[j]), (j1 = j);
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) (u[p[j]] += delta), (v[j] -= delta);
        else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const res = new Array(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j]) res[p[j] - 1] = j - 1;
  return res;
}
/**
 * Re-assigns the roles of the players on the pitch to a new formation:
 * the keeper stays in goal, everyone else goes to the free slot they fit best.
 */
export function reshape(g, side, formation, formations = D?.formations, roleScore = D?.roleScore) {
  const slots = formations?.[formation];
  if (!slots || !side?.lineup?.length) return false;
  const usedSlot = new Set();
  const role = new Map();
  const gk = side.lineup.find((l) => l.role === "GK");
  const gkSlot = slots.findIndex((s) => s.role === "GK");
  if (gk && gkSlot >= 0) {
    role.set(gk.pid, "GK");
    usedSlot.add(gkSlot);
  }
  // best overall fit (Hungarian assignment), small bonus for keeping a player's current role
  const ps = side.lineup.filter((l) => !role.has(l.pid));
  const free = slots.map((s, i) => i).filter((i) => slots[i].role !== "GK" && !usedSlot.has(i));
  const n = Math.max(ps.length, free.length);
  const cost = [];
  for (let r = 0; r < n; r++) {
    cost.push([]);
    for (let c = 0; c < n; c++) {
      const l = ps[r];
      const si = free[c];
      if (!l || si == null) cost[r].push(0);
      else {
        const pl = g.players[l.pid];
        const sc = (roleScore && pl ? roleScore(pl, slots[si].role) : 0) + (l.role === slots[si].role ? 2 : 0);
        cost[r].push(-sc);
      }
    }
  }
  const match = hungarian(cost);
  match.forEach((c, r) => {
    if (ps[r] && free[c] != null) role.set(ps[r].pid, slots[free[c]].role);
  });
  for (const l of side.lineup) if (role.has(l.pid)) l.role = role.get(l.pid);
  side.formation = formation;
  return true;
}

export function ensure(g) {
  g.kx ??= {};
  const k = g.kx;
  k.intl ??= { current: null, history: [] };
  k.ach ??= {};
  k.awards ??= [];
  k.plan ??= "standard";
  return k;
}

const ixDeps = () => ({ ovr: D.ovr, rand: rnd });

/* ================================================================ lifecycle */

/** New career: the 2026 World Cup is played during the first preseason. */
export function newGame(g) {
  const k = ensure(g);
  if (!k.intl.current && g.season === 2026) k.intl.current = IX.createTournament(g, "WC", 2026, ixDeps());
}

/** Old saves: no cards any more, add extension state. */
export function migrate(g) {
  ensure(g);
  for (const p of Object.values(g.players ?? {})) {
    if (p.banned > 0) p.banned = 0;
    if (p.yellowAcc) p.yellowAcc = 0;
  }
}

/** Season end (before the year rolls over): awards, then draw the summer tournament. */
export function seasonEnd(g) {
  const k = ensure(g);
  try {
    seasonAwards(g);
  } catch (e) {
    console.error(e);
  }
  if (k.intl.current && !k.intl.current.done) finishIntl(g, true);
  const year = g.season + 1;
  const kind = IX.kindForYear(year);
  const t = IX.createTournament(g, kind, year, ixDeps());
  k.intl.current = t;
  const mine = myClubCallups(g, t);
  D.inbox(
    g,
    "board",
    T(`${t.name.tr}: kura çekildi`, `${t.name.en}: the draw is made`),
    T(
      `${t.teams.length} milli takım yaz döneminde kupa için mücadele edecek. Turnuvayı "Milli Turnuvalar" ekranından takip edebilir, isterseniz bir milli takımı çalıştırabilirsiniz.${mine.length ? ` Kadromuzdan ${mine.length} oyuncu davet aldı.` : ""}`,
      `${t.teams.length} nations will compete this summer. Follow it on the "International" screen — you can even coach a nation.${mine.length ? ` ${mine.length} of our players were called up.` : ""}`,
    ),
  );
}

/** Weekly tick: an unfinished tournament is completed once the season starts; achievements. */
export function weekly(g) {
  const k = ensure(g);
  if (k.intl.current && !k.intl.current.done && g.phase === "season") finishIntl(g, true);
  try {
    checkAchievements(g);
  } catch (e) {
    console.error(e);
  }
}

function myClubCallups(g, t) {
  if (g.clubId == null) return [];
  const out = [];
  for (const nat of t.teams) for (const pid of t.info[nat].squad) if (g.players[pid]?.clubId === g.clubId) out.push(pid);
  return out;
}

export function intlPlayStage(g) {
  const t = ensure(g).intl.current;
  if (!t || t.done) return;
  IX.playStage(g, t, ixDeps());
  if (t.done) finishIntl(g, false);
}
export function intlPlayAll(g) {
  const t = ensure(g).intl.current;
  if (!t || t.done) return;
  IX.playAll(g, t, ixDeps());
  finishIntl(g, false);
}
export function intlCoach(g, nat) {
  const t = ensure(g).intl.current;
  if (!t || t.done || !t.stage.startsWith("g") || t.fixtures.some((f) => f.played)) return false;
  if (nat == null) {
    t.userNat = null;
    return true;
  }
  if (!IX.canCoach(g, t, nat)) return false;
  t.userNat = nat;
  return true;
}
export function intlApproach(g, a) {
  const t = ensure(g).intl.current;
  if (t && IX.APPROACH[a]) t.approach = a;
}

const NAT_NAME = (g, nat, en) => D.natName?.(nat, en) ?? nat;

function finishIntl(g, auto) {
  const k = ensure(g);
  const t = k.intl.current;
  if (!t) return;
  if (!t.done) IX.playAll(g, t, ixDeps());
  if (t.recorded) return;
  t.recorded = true;
  const top = IX.topScorers(t, 1)[0];
  // Golden Ball: best performer among the semi-finalists' players
  const semis = new Set(t.fixtures.filter((f) => f.stage === "sf").flatMap((f) => [f.home, f.away]));
  let ball = null;
  let best = -1;
  for (const nat of semis) {
    const inf = t.info[nat];
    inf.squad.forEach((pid, i) => {
      const s = (inf.ovrs?.[i] ?? 70) + (t.scorers[pid] ?? 0) * 2.2 + (nat === t.champion ? 3 : 0);
      if (s > best) (best = s), (ball = pid);
    });
  }
  const userRes = t.userNat ? IX.reached(t, t.userNat) : null;
  k.intl.history.unshift({
    kind: t.kind,
    year: t.year,
    name: t.name,
    champion: t.champion,
    runnerUp: t.runnerUp,
    boot: top ? { pid: top.pid, goals: top.goals, name: nameOf(g, top.pid) } : null,
    ball: ball != null ? { pid: ball, name: nameOf(g, ball) } : null,
    userNat: t.userNat,
    userRes,
  });
  k.intl.history.length > 30 && (k.intl.history.length = 30);
  // rewards
  if (t.userNat) {
    const gain = { champion: 9, f: 5, sf: 3, qf: 1, r16: 0, r32: -1, group: -2 }[userRes] ?? 0;
    g.manager.rep = clamp((g.manager.rep ?? 45) + gain, 10, 99);
    if (userRes === "champion") {
      g.manager.trophies = (g.manager.trophies ?? 0) + 1;
      k.ach.intl_champ ??= g.season;
    }
  }
  for (const nat of t.teams) {
    const res = IX.reached(t, nat);
    const boost = res === "champion" ? 8 : res === "f" ? 4 : res === "sf" ? 2 : res === "group" ? -2 : 0;
    for (const pid of t.info[nat].squad) {
      const p = g.players[pid];
      if (!p) continue;
      p.kxCaps = (p.kxCaps ?? 0) + t.fixtures.filter((f) => f.played && (f.home === nat || f.away === nat)).length;
      p.kxIntlGoals = (p.kxIntlGoals ?? 0) + (t.scorers[pid] ?? 0);
      if (res === "champion") p.kxIntlTitles = (p.kxIntlTitles ?? 0) + 1;
      if (p.clubId === g.clubId) p.morale = clamp((p.morale ?? 60) + boost, 5, 100);
    }
  }
  const mine = myClubCallups(g, t);
  const myGoals = mine.reduce((s, pid) => s + (t.scorers[pid] ?? 0), 0);
  D.inbox(
    g,
    "board",
    T(`${t.name.tr}: ${NAT_NAME(g, t.champion)} şampiyon!`, `${t.name.en}: ${NAT_NAME(g, t.champion, 1)} are champions!`),
    T(
      `Finalde ${NAT_NAME(g, t.champion)}, ${NAT_NAME(g, t.runnerUp)} karşısında kupayı kaldırdı.${top ? ` Gol kralı: ${nameOf(g, top.pid)} (${top.goals}).` : ""}${t.userNat ? ` Çalıştırdığınız ${NAT_NAME(g, t.userNat)}: ${resLabel(userRes).tr}.` : ""}${mine.length ? ` Oyuncularımız turnuvada ${myGoals} gol attı.` : ""}${auto ? " (Turnuva otomatik tamamlandı.)" : ""}`,
      `${NAT_NAME(g, t.champion, 1)} beat ${NAT_NAME(g, t.runnerUp, 1)} in the final.${top ? ` Golden Boot: ${nameOf(g, top.pid)} (${top.goals}).` : ""}${t.userNat ? ` Your ${NAT_NAME(g, t.userNat, 1)}: ${resLabel(userRes).en}.` : ""}${mine.length ? ` Our players scored ${myGoals}.` : ""}${auto ? " (Tournament auto-completed.)" : ""}`,
    ),
  );
}

export const resLabel = (r) =>
  ({
    champion: T("Şampiyon", "Champions"),
    f: T("Finalist", "Runners-up"),
    sf: T("Yarı final", "Semi-final"),
    qf: T("Çeyrek final", "Quarter-final"),
    r16: T("Son 16", "Round of 16"),
    r32: T("Son 32", "Round of 32"),
    group: T("Grupta elendi", "Group stage"),
  })[r] ?? T("—", "—");

function nameOf(g, pid) {
  const p = g.players[pid];
  return p ? D.shortName(p) : "—";
}

/* ================================================================ match engine */

/** Big-club factor on team strength: prestigious clubs are clear favourites. */
export function bigMul(rep) {
  return clamp(1 + ((rep ?? 70) - 72) * 0.0095, 0.88, 1.2);
}

export const PLANS = {
  standard: { tr: "Standart", en: "Standard", dtr: "Dengeli, bonus yok.", den: "Balanced, no modifiers.", m: {} },
  wings: { tr: "Kanat Bombardımanı", en: "Wing Overload", dtr: "Hücum +8% · Savunma −4%", den: "Attack +8% · Defence −4%", m: { att: 1.08, def: 0.96 } },
  gegen: { tr: "Gegenpress", en: "Gegenpress", dtr: "Orta saha +8% · Hücum +3% · Savunma −4%", den: "Midfield +8% · Attack +3% · Defence −4%", m: { mid: 1.08, att: 1.03, def: 0.96 } },
  tiki: { tr: "Tiki-Taka", en: "Tiki-Taka", dtr: "Orta saha +10% · Hücum −2%", den: "Midfield +10% · Attack −2%", m: { mid: 1.1, att: 0.98 } },
  counter: { tr: "Kontra Atak", en: "Counter Attack", dtr: "Güçlü rakibe karşı Hücum +12% · Orta saha −6%", den: "vs stronger sides Attack +12% · Midfield −6%", m: { mid: 0.94 }, counter: 1.12 },
  bus: { tr: "Otobüsü Çek", en: "Park the Bus", dtr: "Savunma +14% · Kaleci +5% · Hücum −16%", den: "Defence +14% · GK +5% · Attack −16%", m: { def: 1.14, gk: 1.05, att: 0.84 } },
  allin: { tr: "Ya Hep Ya Hiç", en: "All or Nothing", dtr: "Hücum +16% · Savunma −12%", den: "Attack +16% · Defence −12%", m: { att: 1.16, def: 0.88 } },
};

function momentumOf(g, clubId) {
  const club = D.getClub(g, clubId);
  const lg = g.leagues.find((l) => l.id === club?.leagueId);
  if (!lg) return 1;
  const fx = lg.fixtures.filter((f) => f.played && (f.home === clubId || f.away === clubId)).sort((a, b) => b.week - a.week);
  let w = 0;
  let l = 0;
  for (const f of fx) {
    const gf = f.home === clubId ? f.hg : f.ag;
    const ga = f.home === clubId ? f.ag : f.hg;
    if (gf > ga && l === 0) w++;
    else if (gf < ga && w === 0) l++;
    else break;
    if (w + l >= 5) break;
  }
  return 1 + Math.min(4, w) * 0.008 - Math.min(4, l) * 0.006;
}
export function streak(g, clubId) {
  const all = [...g.leagues, ...(g.cups ?? [])].flatMap((c) => c.fixtures ?? []).filter((f) => f.played && (f.home === clubId || f.away === clubId));
  all.sort((a, b) => b.week - a.week || b.id - a.id);
  const res = all.slice(0, 5).map((f) => {
    const gf = f.home === clubId ? f.hg : f.ag;
    const ga = f.home === clubId ? f.ag : f.hg;
    return gf > ga ? "W" : gf < ga ? "L" : "D";
  });
  return res;
}

/** Applied to a side's strength every minute (after the big-club factor). */
export function planMul(g, ms, side, f) {
  const idx = ms.sides[0] === side ? 0 : 1;
  if (!ms.kxMom) ms.kxMom = ms.sides.map((s) => momentumOf(g, s.clubId));
  const m = ms.kxMom[idx] ?? 1;
  f.att *= m;
  f.mid *= m;
  f.def *= m;
  if (g.clubId == null || side.clubId !== g.clubId) return f;
  const P = PLANS[g.kx?.plan] ?? PLANS.standard;
  for (const [k, v] of Object.entries(P.m)) f[k] *= v;
  if (P.counter) {
    const opp = ms.sides[1 - idx];
    const me = D.getClub(g, side.clubId);
    const them = D.getClub(g, opp.clubId);
    if ((them?.rep ?? 0) > (me?.rep ?? 0) + 2) f.att *= P.counter;
  }
  return f;
}

/** Press answers may carry a plan ("we will press high"). */
export function onAnswer(g, a) {
  if (a?.plan && PLANS[a.plan]) ensure(g).plan = a.plan;
}

/* ================================================================ press conference */

const pickBy = (arr, seed) => arr[Math.abs(seed) % arr.length];

/** Extra pre-match questions (same shape as the bundle's). */
export function pressExtra(g, homeId, awayId, compName, fid, journalists) {
  if (g.clubId == null) return [];
  const me = D.getClub(g, g.clubId);
  const oppId = homeId === g.clubId ? awayId : homeId;
  const opp = D.getClub(g, oppId);
  const myP = D.clubPlayers(g, me.id).filter((p) => !p.injury).sort((a, b) => D.ovr(b) - D.ovr(a));
  const opP = D.clubPlayers(g, opp.id).sort((a, b) => D.ovr(b) - D.ovr(a));
  const star = myP[0];
  const theirStar = opP[0];
  const young = myP.filter((p) => p.age <= 20).sort((a, b) => (b.pot ?? 0) - (a.pot ?? 0))[0];
  const j = (i) => journalists[(fid + i + 4) % journalists.length];
  const home = homeId === g.clubId;
  const stad = D.getClub(g, homeId).stadium;
  const derby = me.city && me.city === opp.city;
  const Q = [];
  Q.push({
    journalist: j(0),
    q: T("Bu maçta hangi oyun planıyla sahaya çıkacaksınız?", "Which game plan will you go with?"),
    answers: [
      { text: T("Önde baskı yapıp rakibi boğacağız.", "We'll press high and suffocate them."), morale: 1, board: 0, rep: 1, plan: "gegen", reply: T("Plan: Gegenpress. Oyuncular hazır!", "Plan: Gegenpress. The players are fired up!") },
      { text: T("Topa sahip olup oyunu biz kuracağız.", "We'll keep the ball and dictate."), morale: 1, board: 1, rep: 0, plan: "tiki", reply: T("Plan: Tiki-Taka. Kontrol bizde.", "Plan: Tiki-Taka. We take control.") },
      { text: T("Bekleyip hızlı kontralarla vuracağız.", "We'll sit deep and hit them on the break."), morale: 0, board: 1, rep: 0, plan: "counter", reply: T("Plan: Kontra Atak.", "Plan: Counter Attack.") },
    ],
  });
  if (star)
    Q.push({
      journalist: j(1),
      q: T(`${D.shortName(star)} takımın yıldızı. Bu maçta ondan ne bekliyorsunuz?`, `${D.shortName(star)} is your star man. What do you expect from him?`),
      answers: [
        { text: T("O bizim liderimiz, fark yaratacak.", "He's our leader, he'll make the difference."), morale: 2, board: 0, rep: 0, reply: T(`${D.shortName(star)} övgünüzden motive oldu.`, `${D.shortName(star)} is buzzing after your praise.`) },
        { text: T("Takım bireylerden büyüktür.", "The team is bigger than any individual."), morale: 1, board: 1, rep: 1, reply: T("Takım ruhu vurgunuz beğenildi.", "Your team-first message went down well.") },
        { text: T("Daha fazlasını yapabilir, ondan çok şey bekliyorum.", "He can do more; I expect a lot."), morale: -1, board: 1, rep: 0, reply: T("Yıldız oyuncunuz biraz alındı.", "Your star looked a little stung.") },
      ],
    });
  if (theirStar)
    Q.push({
      journalist: j(2),
      q: T(`Rakibin en tehlikeli ismi ${D.shortName(theirStar)}. Onu nasıl durduracaksınız?`, `${D.shortName(theirStar)} is their danger man. How do you stop him?`),
      answers: [
        { text: T("Ona özel bir plan hazırladık.", "We have a special plan for him."), morale: 1, board: 1, rep: 1, reply: T("Taktik hazırlığınız dikkat çekti.", "Your preparation impressed.") },
        { text: T("Bizim oyuncularımız ondan daha iyi.", "Our players are better than him."), morale: 3, board: -1, rep: -1, reply: T("Cesur açıklamanız rakip kampta tepki çekti!", "Bold words — the opposition noticed!") },
        { text: T("Büyük oyuncu, ona saygı duyuyoruz.", "Great player, we respect him."), morale: 0, board: 0, rep: 2, reply: T("Centilmence bir yanıt.", "A gracious answer.") },
      ],
    });
  Q.push(
    derby
      ? {
          journalist: j(3),
          q: T(`${me.city} derbisi! Bu maç sizin için ne ifade ediyor?`, `The ${me.city} derby! What does it mean to you?`),
          answers: [
            { text: T("Şehrin hâkimi belli olacak.", "This decides who owns the city."), morale: 3, board: 0, rep: 1, reply: T("Taraftarlar coştu!", "The fans are ecstatic!") },
            { text: T("Sadece üç puanlık bir maç.", "It's just three points."), morale: -1, board: 1, rep: 0, reply: T("Taraftarlar biraz hayal kırıklığına uğradı.", "Some fans wanted more passion.") },
            { text: T("Sahada konuşacağız.", "We'll do the talking on the pitch."), morale: 2, board: 1, rep: 1, reply: T("Kararlı duruşunuz takdir topladı.", "Your focus was appreciated.") },
          ],
        }
      : {
          journalist: j(3),
          q: home
            ? T(`${stad} tamamen dolacak. Taraftarlara mesajınız?`, `${stad} will be packed. A message for the fans?`)
            : T(`${stad} deplasmanı zorlu. Taraftar baskısından çekiniyor musunuz?`, `${stad} is a tough away ground. Worried about the crowd?`),
          answers: [
            { text: home ? T("Bizi ateşlesinler, 12. adamımız onlar!", "Make some noise — they're our 12th man!") : T("Baskı bizi daha da güçlendirir.", "Pressure only makes us stronger."), morale: 2, board: 0, rep: 1, reply: T("Atmosfer şimdiden ısındı.", "The atmosphere is building already.") },
            { text: T("Sabırlı olsunlar, süreç devam ediyor.", "Be patient, it's a process."), morale: 0, board: 2, rep: 0, reply: T("Yönetim sağduyulu tavrınızı beğendi.", "The board liked your calm approach.") },
            { text: T("Önemli olan sadece saha içi.", "Only what happens on the pitch matters."), morale: 1, board: 0, rep: 0, reply: T("Kısa ve net.", "Short and sharp.") },
          ],
        },
  );
  Q.push({
    journalist: j(4),
    q: T("Maçın hakemi hakkında ne düşünüyorsunuz?", "What do you think of the referee appointment?"),
    answers: [
      { text: T("Hakemler hakkında konuşmam.", "I don't talk about referees."), morale: 0, board: 1, rep: 1, reply: T("Profesyonel bir yanıt.", "A professional answer.") },
      { text: T("Adil bir yönetim bekliyoruz.", "We expect a fair game."), morale: 0, board: 0, rep: 1, reply: T("Dengeli bir açıklama.", "A balanced comment.") },
      { text: T("Son maçlardaki kararlar hâlâ aklımızda.", "Recent decisions are still on our minds."), morale: 2, board: -2, rep: -1, reply: T("Federasyon açıklamanızı not aldı…", "The federation took note…") },
    ],
  });
  Q.push(
    young
      ? {
          journalist: j(5),
          q: T(`Genç yetenek ${D.shortName(young)} için forma şansı gelecek mi?`, `Will young ${D.shortName(young)} get a chance?`),
          answers: [
            { text: T("Geleceğimiz o, süre alacak.", "He's our future; he'll get minutes."), morale: 2, board: 1, rep: 1, reply: T("Akademi camiası mutlu.", "The academy is delighted.") },
            { text: T("Acele etmeyeceğiz.", "We won't rush him."), morale: 0, board: 1, rep: 0, reply: T("Temkinli yaklaşım.", "A cautious approach.") },
            { text: T("Önce kendini antrenmanda kanıtlamalı.", "He must prove himself in training first."), morale: -1, board: 0, rep: 0, reply: T("Genç oyuncu mesajı aldı.", "Message received.") },
          ],
        }
      : {
          journalist: j(5),
          q: T("Transfer söylentileri hakkında ne söylersiniz?", "Any comment on the transfer rumours?"),
          answers: [
            { text: T("Söylentilere yorum yapmam.", "I don't comment on rumours."), morale: 0, board: 1, rep: 0, reply: T("Kapılar kapalı.", "Doors firmly shut.") },
            { text: T("Her zaman en iyileri isteriz.", "We always want the best."), morale: -1, board: 0, rep: 2, reply: T("Spekülasyon alevlendi!", "Speculation is running wild!") },
            { text: T("Kadromdan çok memnunum.", "I'm very happy with my squad."), morale: 2, board: 0, rep: 0, reply: T("Oyuncular güveninizi hissetti.", "The players felt your trust.") },
          ],
        },
  );
  Q.push(
    (g.board?.confidence ?? 60) < 45
      ? {
          journalist: j(6),
          q: T("Yönetimin size olan güveni sarsılıyor mu?", "Is the board losing faith in you?"),
          answers: [
            { text: T("Sonuçlar gelecek, inanıyorum.", "Results will come, I believe."), morale: 1, board: 2, rep: 0, reply: T("Kararlılığınız not edildi.", "Your resolve was noted.") },
            { text: T("Bu soruya cevap vermeyeceğim.", "I won't answer that."), morale: 0, board: -1, rep: -1, reply: T("Basın tatmin olmadı.", "The press were not satisfied.") },
            { text: T("Bu maçı kazanıp konuyu kapatacağız.", "We'll win this and end the debate."), morale: 3, board: 1, rep: 1, reply: T("Büyük söz verdiniz!", "A big promise!") },
          ],
        }
      : {
          journalist: j(6),
          q: T(`${compName} hedefiniz nedir?`, `What's your goal in the ${compName}?`),
          answers: [
            { text: T("Şampiyonluk, başka hedefimiz yok.", "The title, nothing less."), morale: 2, board: 1, rep: 2, reply: T("İddialı! Gözler üzerinizde.", "Ambitious! All eyes on you.") },
            { text: T("Maç maç bakıyoruz.", "One game at a time."), morale: 1, board: 1, rep: 0, reply: T("Ayakları yere basan bir açıklama.", "Feet firmly on the ground.") },
            { text: T("Önce Avrupa'yı garantilemek.", "Securing Europe comes first."), morale: 1, board: 2, rep: 0, reply: T("Yönetim gerçekçi hedefinizi beğendi.", "The board liked the realistic target.") },
          ],
        },
  );
  return Q;
}

/* ================================================================ achievements */

export const ACH = [
  ["first_win", "🥇", T("İlk Galibiyet", "First Win"), T("İlk maçını kazan.", "Win your first match.")],
  ["wins_50", "⚡", T("50 Galibiyet", "50 Wins"), T("Kariyerinde 50 maç kazan.", "Win 50 career matches.")],
  ["wins_100", "🔥", T("100 Galibiyet", "Century"), T("Kariyerinde 100 maç kazan.", "Win 100 career matches.")],
  ["wins_250", "👑", T("Efsane Menajer", "Legend"), T("Kariyerinde 250 maç kazan.", "Win 250 career matches.")],
  ["streak5", "📈", T("Seri Katil", "On Fire"), T("Üst üste 5 maç kazan.", "Win 5 in a row.")],
  ["big_win", "💥", T("Gol Yağmuru", "Goal Fest"), T("Bir maçı 5+ farkla kazan.", "Win by 5+ goals.")],
  ["giant", "🗡️", T("Dev Avcısı", "Giant Killer"), T("Çok daha büyük bir kulübü yen.", "Beat a much bigger club.")],
  ["trophy1", "🏆", T("İlk Kupa", "First Silverware"), T("İlk kupanı kazan.", "Win your first trophy.")],
  ["trophy5", "🏛️", T("Hanedan", "Dynasty"), T("5 kupa kazan.", "Win 5 trophies.")],
  ["star", "⭐", T("Yıldız Avcısı", "Star Hunter"), T("Kadrona 85+ güçte bir oyuncu kat.", "Have an 85+ rated player.")],
  ["wonder", "💎", T("Altın Çocuk", "Wonderkid"), T("21 yaş altı 75+ güçte oyuncun olsun.", "Have a U21 player rated 75+.")],
  ["rich", "💰", T("Kasa Dolu", "Deep Pockets"), T("Kulüp kasası €100M'yi aşsın.", "Club balance over €100M.")],
  ["seasons5", "📅", T("Sadık", "Loyal"), T("5 sezon tamamla.", "Complete 5 seasons.")],
  ["europe", "🌍", T("Avrupa Gecesi", "European Nights"), T("Şampiyonlar Ligi'nde mücadele et.", "Play in the Champions League.")],
  ["intl_champ", "🌐", T("Dünyanın Zirvesi", "On Top of the World"), T("Milli takımla turnuva kazan.", "Win a tournament as a national coach.")],
];

function lastResults(g, clubId) {
  return [...g.leagues, ...(g.cups ?? [])].flatMap((c) => c.fixtures ?? []).filter((f) => f.played && (f.home === clubId || f.away === clubId));
}

export function checkAchievements(g) {
  const k = ensure(g);
  const m = g.manager ?? {};
  const unlock = (id) => {
    if (k.ach[id] != null) return;
    k.ach[id] = g.season;
    const a = ACH.find((x) => x[0] === id);
    if (a) D.inbox(g, "board", T(`Başarım açıldı: ${a[2].tr} ${a[1]}`, `Achievement unlocked: ${a[2].en} ${a[1]}`), a[3]);
  };
  if ((m.wins ?? 0) >= 1) unlock("first_win");
  if ((m.wins ?? 0) >= 50) unlock("wins_50");
  if ((m.wins ?? 0) >= 100) unlock("wins_100");
  if ((m.wins ?? 0) >= 250) unlock("wins_250");
  if ((m.trophies ?? 0) >= 1) unlock("trophy1");
  if ((m.trophies ?? 0) >= 5) unlock("trophy5");
  if ((m.history?.length ?? 0) >= 5) unlock("seasons5");
  if (g.clubId == null) return;
  const club = D.getClub(g, g.clubId);
  if ((club?.balance ?? 0) >= 1e8) unlock("rich");
  const sq = D.clubPlayers(g, g.clubId);
  if (sq.some((p) => D.ovr(p) >= 85)) unlock("star");
  if (sq.some((p) => p.age <= 21 && D.ovr(p) >= 75)) unlock("wonder");
  if ((g.cups ?? []).some((c) => c.id === "UCL" && c.clubIds?.includes(g.clubId))) unlock("europe");
  const st = streak(g, g.clubId);
  if (st.length >= 5 && st.every((r) => r === "W")) unlock("streak5");
  for (const f of lastResults(g, g.clubId)) {
    const gf = f.home === g.clubId ? f.hg : f.ag;
    const ga = f.home === g.clubId ? f.ag : f.hg;
    if (gf - ga >= 5) unlock("big_win");
    const opp = D.getClub(g, f.home === g.clubId ? f.away : f.home);
    if (gf > ga && opp && club && opp.rep >= club.rep + 10) unlock("giant");
  }
}

/* ================================================================ season awards */

export function seasonAwards(g) {
  const k = ensure(g);
  if (k.awards.some((a) => a.season === g.season)) return;
  const top = new Set(g.leagues.filter((l) => l.tier === 1 && !l.hidden).map((l) => l.id));
  const lgOf = new Map(g.clubs.map((c) => [c.id, c.leagueId]));
  const lvl = new Map(g.leagues.map((l) => [l.id, l.level ?? 60]));
  const cand = Object.values(g.players).filter((p) => p.clubId != null && top.has(lgOf.get(p.clubId)) && (p.stats?.apps ?? 0) >= 12);
  const score = (p) => {
    const s = p.stats;
    const avg = s.ratingSum / Math.max(1, s.apps);
    const lv = lvl.get(lgOf.get(p.clubId)) ?? 60;
    return avg * 8 + s.goals * 0.55 + s.assists * 0.35 + D.ovr(p) * 0.45 + (lv - 66) * 0.6 + (s.motm ?? 0) * 0.4;
  };
  const best = (list) => list.reduce((a, b) => (a == null || score(b) > score(a) ? b : a), null);
  const ballon = best(cand);
  const boy = best(cand.filter((p) => p.age <= 21));
  const keeper = best(cand.filter((p) => p.pos === "GK"));
  const boot = cand.reduce((a, b) => (a == null || b.stats.goals > a.stats.goals ? b : a), null);
  const pack = (p, extra) => (p ? { pid: p.id, name: D.shortName(p), clubId: p.clubId, ...extra } : null);
  const rec = {
    season: g.season,
    ballon: pack(ballon),
    boy: pack(boy),
    keeper: pack(keeper),
    boot: pack(boot, { goals: boot?.stats.goals ?? 0 }),
  };
  k.awards.unshift(rec);
  k.awards.length > 40 && (k.awards.length = 40);
  for (const key of ["ballon", "boy", "keeper", "boot"]) {
    const a = rec[key];
    const p = a && g.players[a.pid];
    if (!p) continue;
    p.kxAwards = [...(p.kxAwards ?? []), `${key}:${g.season}`];
    if (p.clubId === g.clubId) p.morale = clamp((p.morale ?? 60) + 10, 5, 100);
  }
  const cl = (a) => (a ? D.getClub(g, a.clubId)?.name ?? "" : "");
  D.inbox(
    g,
    "board",
    T(`Sezon ödülleri ${g.season}/${String((g.season + 1) % 100).padStart(2, "0")}`, `Season awards ${g.season}/${String((g.season + 1) % 100).padStart(2, "0")}`),
    T(
      `Altın Top: ${rec.ballon?.name ?? "—"} (${cl(rec.ballon)}) · Golden Boy: ${rec.boy?.name ?? "—"} (${cl(rec.boy)}) · Yılın Kalecisi: ${rec.keeper?.name ?? "—"} · Altın Ayakkabı: ${rec.boot?.name ?? "—"} (${rec.boot?.goals ?? 0} gol)`,
      `Ballon d'Or: ${rec.ballon?.name ?? "—"} (${cl(rec.ballon)}) · Golden Boy: ${rec.boy?.name ?? "—"} (${cl(rec.boy)}) · Best Keeper: ${rec.keeper?.name ?? "—"} · Golden Shoe: ${rec.boot?.name ?? "—"} (${rec.boot?.goals ?? 0} goals)`,
    ),
  );
}

/* ================================================================ stadium renderer */

function hexRgb(hex) {
  let h = String(hex || "#888").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isNaN(n) ? [136, 136, 136] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function seeded(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const stadCache = new Map();

/**
 * Draws a club's stadium bowl (night match, crowd in club colours) and returns a JPEG data URL.
 * opts.pitch=false leaves the centre as plain grass for the 2D pitch to sit on.
 */
export function stadiumImage(club, opts = {}) {
  if (typeof document === "undefined" || !club) return null;
  const W = opts.w ?? 1600;
  const H = opts.h ?? 900;
  const withPitch = opts.pitch !== false;
  const key = `${club.id}:${club.capacity}:${club.colors?.join(",")}:${W}x${H}:${withPitch}`;
  if (stadCache.has(key)) return stadCache.get(key);
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d");
  if (!c) return null;
  const R = seeded((club.id || 1) * 7919 + (club.capacity | 0));
  const [c1, c2] = [hexRgb(club.colors?.[0]), hexRgb(club.colors?.[1] ?? "#ffffff")];
  // night sky
  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#05060a");
  sky.addColorStop(0.45, "#0d1020");
  sky.addColorStop(1, "#07080c");
  c.fillStyle = sky;
  c.fillRect(0, 0, W, H);
  const glow = c.createRadialGradient(W / 2, H * 0.18, 10, W / 2, H * 0.18, W * 0.6);
  glow.addColorStop(0, `rgba(${c1[0]},${c1[1]},${c1[2]},0.22)`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = glow;
  c.fillRect(0, 0, W, H);

  const cap = club.capacity || 20000;
  const tiers = cap < 15000 ? 1 : cap < 35000 ? 2 : 3;
  const cx = W / 2;
  const cy = H * 0.56;
  const rxIn = W * 0.3;
  const ryIn = H * 0.235;
  const tierRows = 16;
  const rowGap = W * 0.0052;
  const rows = tiers * tierRows + (tiers - 1) * 2;
  const rxOut = rxIn + rows * rowGap;
  const ryOut = ryIn + rows * rowGap * 0.62;
  // structure / roof shadow
  c.fillStyle = "#0b0c12";
  c.beginPath();
  c.ellipse(cx, cy + rows * 1.2, rxOut + W * 0.03, ryOut + H * 0.05, 0, 0, Math.PI * 2);
  c.fill();
  // crowd rows
  let row = 0;
  for (let t = 0; t < tiers; t++) {
    for (let r = 0; r < tierRows; r++, row++) {
      const k = row / rows;
      const rx = rxIn + row * rowGap;
      const ry = ryIn + row * rowGap * 0.62;
      const yOff = row * 1.2;
      const circ = 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2);
      const n = Math.floor(circ / 4.2);
      const shade = 0.55 + 0.45 * (1 - k * 0.6);
      for (let i = 0; i < n; i++) {
        const th = (i / n) * Math.PI * 2;
        const x = cx + Math.cos(th) * rx;
        const y = cy + yOff + Math.sin(th) * ry;
        const near = (Math.sin(th) + 1) / 2;
        const s = 2.1 + near * 1.9;
        // left end (behind a goal) is the home end: striped tifo
        const deg = ((th * 180) / Math.PI + 360) % 360;
        let col;
        if (deg > 150 && deg < 210) col = row % 4 < 2 ? c1 : c2;
        else {
          const q = R();
          col = q < 0.46 ? c1 : q < 0.7 ? c2 : q < 0.84 ? [210, 210, 214] : [28, 30, 38];
        }
        const f = shade * (0.75 + R() * 0.35) * (0.7 + near * 0.35);
        c.fillStyle = `rgb(${(col[0] * f) | 0},${(col[1] * f) | 0},${(col[2] * f) | 0})`;
        c.fillRect(x - s / 2, y - s / 2, s, s * 0.8);
      }
    }
    if (t < tiers - 1) {
      // concourse band between tiers
      const rx = rxIn + (row + 0.5) * rowGap;
      const ry = ryIn + (row + 0.5) * rowGap * 0.62;
      c.strokeStyle = "#090a0f";
      c.lineWidth = rowGap * 2;
      c.beginPath();
      c.ellipse(cx, cy + row * 1.2, rx + rowGap * 0.5, ry + rowGap * 0.3, 0, 0, Math.PI * 2);
      c.stroke();
      c.strokeStyle = `rgba(${c1[0]},${c1[1]},${c1[2]},0.55)`;
      c.lineWidth = 2;
      c.beginPath();
      c.ellipse(cx, cy + row * 1.2, rx - rowGap * 0.3, ry - rowGap * 0.2, 0, 0, Math.PI * 2);
      c.stroke();
      row += 2;
    }
  }
  // roof rim with floodlights
  c.strokeStyle = "#15161f";
  c.lineWidth = W * 0.022;
  c.beginPath();
  c.ellipse(cx, cy + rows * 1.2, rxOut + W * 0.012, ryOut + H * 0.014, 0, 0, Math.PI * 2);
  c.stroke();
  c.strokeStyle = "rgba(255,255,255,0.18)";
  c.lineWidth = 2;
  c.beginPath();
  c.ellipse(cx, cy + rows * 1.2, rxOut + W * 0.022, ryOut + H * 0.022, 0, Math.PI, Math.PI * 2);
  c.stroke();
  for (let i = 0; i < 22; i++) {
    const th = Math.PI + (i / 21) * Math.PI;
    const x = cx + Math.cos(th) * (rxOut + W * 0.018);
    const y = cy + rows * 1.2 + Math.sin(th) * (ryOut + H * 0.02);
    const lg = c.createRadialGradient(x, y, 0, x, y, 26);
    lg.addColorStop(0, "rgba(255,255,240,0.95)");
    lg.addColorStop(0.25, "rgba(255,255,230,0.35)");
    lg.addColorStop(1, "rgba(255,255,230,0)");
    c.fillStyle = lg;
    c.fillRect(x - 26, y - 26, 52, 52);
  }
  // pitch surround
  c.fillStyle = "#123d22";
  c.beginPath();
  c.ellipse(cx, cy, rxIn - 2, ryIn - 2, 0, 0, Math.PI * 2);
  c.fill();
  if (withPitch) {
    const fy = cy - ryIn * 0.66;
    const ny = cy + ryIn * 0.72;
    const fw = rxIn * 0.66;
    const nw = rxIn * 0.86;
    const strips = 14;
    for (let i = 0; i < strips; i++) {
      const a = i / strips;
      const b = (i + 1) / strips;
      c.fillStyle = i % 2 ? "#1f7a3a" : "#238540";
      c.beginPath();
      c.moveTo(cx - fw + 2 * fw * a, fy);
      c.lineTo(cx - fw + 2 * fw * b, fy);
      c.lineTo(cx - nw + 2 * nw * b, ny);
      c.lineTo(cx - nw + 2 * nw * a, ny);
      c.closePath();
      c.fill();
    }
    c.strokeStyle = "rgba(255,255,255,0.75)";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(cx - fw, fy);
    c.lineTo(cx + fw, fy);
    c.lineTo(cx + nw, ny);
    c.lineTo(cx - nw, ny);
    c.closePath();
    c.moveTo(cx, fy);
    c.lineTo(cx, ny);
    c.stroke();
    c.beginPath();
    c.ellipse(cx, (fy + ny) / 2, rxIn * 0.12, ryIn * 0.17, 0, 0, Math.PI * 2);
    c.stroke();
  }
  // light pool + vignette
  const pool = c.createRadialGradient(cx, cy, 10, cx, cy, rxIn * 1.1);
  pool.addColorStop(0, "rgba(255,255,240,0.10)");
  pool.addColorStop(1, "rgba(255,255,240,0)");
  c.fillStyle = pool;
  c.fillRect(0, 0, W, H);
  const vig = c.createRadialGradient(cx, cy, W * 0.25, cx, cy, W * 0.75);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.6)");
  c.fillStyle = vig;
  c.fillRect(0, 0, W, H);
  const url = cv.toDataURL("image/jpeg", 0.82);
  stadCache.set(key, url);
  return url;
}

/* ================================================================ UI */

export function createUI() {
  const { React, useGame, useI18n, Button, ClubBadge, EmptyState, Tabs, TabsList, TabsTrigger, TabsContent, toast } = D.ui;
  const h = React.createElement;
  const { useState, useEffect, useMemo } = React;
  const cx = (...a) => a.filter(Boolean).join(" ");

  /** Fixed backdrop: the managed club's stadium. */
  function Backdrop() {
    const { game: g } = useGame();
    const club = g.clubId == null ? null : D.getClub(g, g.clubId);
    const [url, setUrl] = useState(null);
    useEffect(() => {
      if (!club) return setUrl(null);
      const id = setTimeout(() => setUrl(stadiumImage(club)), 30);
      return () => clearTimeout(id);
    }, [club?.id, club?.capacity]);
    if (!url) return null;
    return h("div", { className: "kx-backdrop", "aria-hidden": "true", style: { backgroundImage: `url(${url})` } });
  }

  const FLAG_CODE = { ENG: "gb-eng", SCO: "gb-sct", WAL: "gb-wls", NIR: "gb-nir" };
  /** New-career screen: swap the welcome photo for the picked club's stadium. */
  function ClubBackdrop({ club }) {
    useEffect(() => {
      const el = document.querySelector(".pitch-stripes");
      if (!el || !club) return;
      const prev = el.style.backgroundImage;
      const url = stadiumImage(club);
      if (url) {
        el.style.setProperty("background-image", `url(${url})`, "important");
        el.style.setProperty("background-position", "center 40%", "important");
      }
      return () => {
        el.style.removeProperty("background-image");
        el.style.removeProperty("background-position");
        if (prev) el.style.backgroundImage = prev;
      };
    }, [club?.id]);
    if (!club) return null;
    return h("p", { className: "kx-pick-stad" }, h("span", { className: "kx-kicker" }, "🏟"), " ", club.stadium, h("span", { className: "kx-mono" }, ` · ${(club.capacity ?? 0).toLocaleString("tr-TR")}`));
  }

  const Flag = ({ nat, name }) => {
    const { L } = useI18n();
    const code = FLAG_CODE[nat] ?? String(nat).toLowerCase();
    return h(
      "span",
      { className: "kx-flag" },
      h("img", { src: `https://flagcdn.com/w40/${code}.png`, alt: "", width: 20, height: 14, loading: "lazy", decoding: "async" }),
      name ? h("span", null, L(D.natName?.(nat, 0) ?? nat, D.natName?.(nat, 1) ?? nat)) : h("span", null, nat),
    );
  };

  function HomeBanner() {
    const { game: g, setScreen } = useGame();
    const { L, tt } = useI18n();
    const k = g.kx;
    const club = g.clubId == null ? null : D.getClub(g, g.clubId);
    const t = k?.intl?.current;
    const st = club ? streak(g, club.id) : [];
    const plan = PLANS[k?.plan] ?? PLANS.standard;
    const achN = Object.keys(k?.ach ?? {}).length;
    return h(
      "section",
      { className: "kx-hero" },
      club &&
        h(
          "div",
          { className: "kx-hero-stad" },
          h("p", { className: "kx-kicker" }, L("Ev sahası", "Home ground")),
          h("p", { className: "kx-hero-name" }, club.stadium),
          h("p", { className: "kx-mono" }, `${(club.capacity ?? 0).toLocaleString("tr-TR")} ${L("koltuk", "seats")} · ${club.city ?? ""}`),
        ),
      h(
        "div",
        { className: "kx-hero-row" },
        h(
          "button",
          { type: "button", className: "kx-chip", onClick: () => setScreen("kaiser") },
          h("span", { className: "kx-kicker" }, L("Form", "Form")),
          h("span", { className: "kx-form" }, st.length ? st.map((r, i) => h("i", { key: i, className: `is-${r}` }, r === "W" ? L("G", "W") : r === "L" ? L("M", "L") : L("B", "D"))) : "—"),
        ),
        h(
          "button",
          { type: "button", className: "kx-chip", onClick: () => setScreen("match") },
          h("span", { className: "kx-kicker" }, L("Maç planı", "Match plan")),
          h("b", null, L(plan.tr, plan.en)),
        ),
        h(
          "button",
          { type: "button", className: "kx-chip", onClick: () => setScreen("kaiser") },
          h("span", { className: "kx-kicker" }, L("Başarımlar", "Achievements")),
          h("b", null, `${achN}/${ACH.length}`),
        ),
        t &&
          h(
            "button",
            { type: "button", className: cx("kx-chip", !t.done && "is-live"), onClick: () => setScreen("intl") },
            h("span", { className: "kx-kicker" }, t.done ? L("Şampiyon", "Champions") : L("Milli turnuva", "International")),
            h("b", null, t.done ? `${tt(t.name)} · ${L(D.natName?.(t.champion, 0) ?? t.champion, D.natName?.(t.champion, 1) ?? t.champion)}` : tt(t.name)),
          ),
      ),
    );
  }

  /** Pre-match: Kaiser-style plan cards. */
  function PlanPicker() {
    const { game: g, act } = useGame();
    const { L } = useI18n();
    const cur = g.kx?.plan ?? "standard";
    return h(
      "section",
      { className: "kx-card" },
      h("p", { className: "kx-kicker" }, L("Taktik kartı", "Tactic card")),
      h("h2", { className: "kx-h" }, L("Maç Planı", "Match Plan")),
      h("p", { className: "kx-sub" }, L("Her kartın bir artısı ve bir eksisi var. Seçtiğin plan değiştirene kadar geçerli.", "Every card has an upside and a downside. Your plan stays until you change it.")),
      h(
        "div",
        { className: "kx-plans" },
        Object.entries(PLANS).map(([key, p]) =>
          h(
            "button",
            {
              key,
              type: "button",
              className: cx("kx-plan", cur === key && "is-on"),
              "aria-pressed": cur === key,
              onClick: () => act((gg) => void (ensure(gg).plan = key)),
            },
            h("b", null, L(p.tr, p.en)),
            h("span", null, L(p.dtr, p.den)),
          ),
        ),
      ),
    );
  }

  /* ---------- international ---------- */
  function IntlScreen() {
    const { game: g, act } = useGame();
    const { L, tt } = useI18n();
    const k = g.kx ?? { intl: { current: null, history: [] } };
    const t = k.intl.current;
    const [tab, setTab] = useState("groups");
    const [pick, setPick] = useState(g.manager?.nat ?? "");
    if (!t)
      return h(
        "div",
        { className: "grid gap-6" },
        h("h1", { className: "font-display text-3xl font-bold uppercase" }, L("Milli Turnuvalar", "International")),
        h(EmptyState, null, L("Bir sonraki turnuvanın kurası sezon sonunda çekilir (Dünya Kupası, EURO ve Uluslar Ligi dönüşümlü).", "The next draw happens at season end (World Cup, EURO and Nations League rotate).")),
        h(History, { k }),
      );
    const started = t.fixtures.some((f) => f.played);
    const coachable = t.teams.filter((n) => IX.canCoach(g, t, n)).sort((a, b) => t.info[b].rating - t.info[a].rating);
    const myNext = t.userNat && !t.done ? t.fixtures.find((f) => f.stage === t.stage && !f.played && (f.home === t.userNat || f.away === t.userNat)) : null;
    const res = t.userNat ? IX.reached(t, t.userNat) : null;
    const scorers = IX.topScorers(t, 10);
    const stages = t.flow.filter((s) => t.fixtures.some((f) => f.stage === s)).reverse();
    return h(
      "div",
      { className: "grid gap-6" },
      h(
        "div",
        { className: "kx-intl-head" },
        h("p", { className: "kx-kicker" }, `${KIND_KICKER(t.kind, L)} · ${t.teams.length} ${L("takım", "teams")}${t.hosts.length ? ` · ${L("Ev sahibi", "Hosts")}: ${t.hosts.join(", ")}` : ""}`),
        h("h1", { className: "font-display text-4xl font-bold uppercase" }, tt(t.name)),
        t.done
          ? h("p", { className: "ce-winner kx-row" }, "🏆 ", L("Şampiyon", "Champions"), ": ", h(Flag, { nat: t.champion, name: true }), " · ", L("Finalist", "Runners-up"), ": ", h(Flag, { nat: t.runnerUp, name: true }))
          : h("p", { className: "kx-sub" }, L("Aşama", "Stage"), ": ", tt(IX.STAGES[t.stage])),
      ),
      !t.done &&
        h(
          "section",
          { className: "kx-card" },
          h("p", { className: "kx-kicker" }, L("Milli takım teknik direktörlüğü", "National team job")),
          t.userNat
            ? h(
                React.Fragment,
                null,
                h("h2", { className: "kx-h kx-row" }, h(Flag, { nat: t.userNat, name: true }), L(" teknik direktörüsünüz", " — you are the head coach")),
                h("p", { className: "kx-sub" }, L(`Güç ${t.info[t.userNat].rating} · Durum: `, `Rating ${t.info[t.userNat].rating} · Status: `), IX.userAlive(t) ? L("Turnuvada", "Still in") : L(resLabel(res).tr, resLabel(res).en)),
                myNext &&
                  h(
                    "p",
                    { className: "kx-next" },
                    L("Sıradaki maç", "Next match"),
                    ": ",
                    h(Flag, { nat: myNext.home, name: true }), " – ", h(Flag, { nat: myNext.away, name: true }),
                    ` · ${tt(IX.STAGES[myNext.stage])}`,
                  ),
                h(
                  "div",
                  { className: "kx-plans is-4" },
                  Object.entries(IX.APPROACH).map(([key, a]) =>
                    h(
                      "button",
                      { key, type: "button", className: cx("kx-plan", t.approach === key && "is-on"), onClick: () => act((gg) => intlApproach(gg, key)) },
                      h("b", null, L(a.tr, a.en)),
                      h("span", null, key === "attack" ? L("Daha çok gol, daha açık savunma", "More goals both ways") : key === "counter" ? L("Az gol yeme, fırsat kolla", "Concede less, strike on the break") : key === "defend" ? L("Kilit savunma, az gol", "Lock it down") : L("Dengeli", "Even")),
                    ),
                  ),
                ),
              )
            : h(
                React.Fragment,
                null,
                h("h2", { className: "kx-h" }, L("Bir milli takımı çalıştır", "Coach a national team")),
                h("p", { className: "kx-sub" }, L("Kendi ülken her zaman açık; diğerleri itibarına göre. Turnuva başlamadan seçmelisin.", "Your own nation is always open; others depend on your reputation. Pick before kick-off.")),
                !started &&
                  h(
                    "div",
                    { className: "kx-row" },
                    h(
                      "select",
                      { className: "ce-select kx-select", value: pick, onChange: (e) => setPick(e.target.value), "aria-label": L("Milli takım", "Nation") },
                      h("option", { value: "" }, L("Ülke seç…", "Choose a nation…")),
                      coachable.map((n) => h("option", { key: n, value: n }, `${L(D.natName?.(n, 0) ?? n, D.natName?.(n, 1) ?? n)} · ${t.info[n].rating}`)),
                    ),
                    h(Button, { disabled: !pick || !coachable.includes(pick), onClick: () => act((gg) => intlCoach(gg, pick)) }, L("Görevi kabul et", "Take the job")),
                  ),
              ),
          h(
            "div",
            { className: "kx-row" },
            h(Button, { onClick: () => act((gg) => intlPlayStage(gg)) }, myNext ? L("Maçı oyna", "Play match") : L("Sıradaki turu oyna", "Play next round")),
            h(Button, { variant: "outline", onClick: () => act((gg) => intlPlayAll(gg)) }, L("Turnuvayı tamamla", "Sim to the end")),
          ),
        ),
      h(
        Tabs,
        { value: tab, onValueChange: setTab },
        h(TabsList, { className: "ce-tabs" }, h(TabsTrigger, { value: "groups" }, L("Gruplar", "Groups")), h(TabsTrigger, { value: "ko" }, L("Eleme", "Knockouts")), h(TabsTrigger, { value: "scorers" }, L("Gol Krallığı", "Top Scorers")), h(TabsTrigger, { value: "hist" }, L("Geçmiş", "History"))),
        h(
          TabsContent,
          { value: "groups", className: "mt-4" },
          h(
            "div",
            { className: "kx-groups" },
            t.groups.map((gr) =>
              h(
                "section",
                { key: gr.name, className: "kx-card kx-group" },
                h("p", { className: "kx-kicker" }, L(`Grup ${gr.name}`, `Group ${gr.name}`)),
                h(
                  "table",
                  { className: "kx-table" },
                  h("thead", null, h("tr", null, h("th", null, ""), h("th", null, L("O", "P")), h("th", null, L("A", "GD")), h("th", null, L("P", "Pts")))),
                  h(
                    "tbody",
                    null,
                    IX.groupTable(t, gr.name).map((r, i) =>
                      h(
                        "tr",
                        { key: r.nat, className: cx(i < 2 && "is-q", r.nat === t.userNat && "is-me") },
                        h("td", null, h(Flag, { nat: r.nat, name: true }), h("span", { className: "kx-dim" }, ` ${t.info[r.nat].rating}`)),
                        h("td", null, r.p),
                        h("td", null, r.gf - r.ga),
                        h("td", null, h("b", null, r.pts)),
                      ),
                    ),
                  ),
                ),
                h(
                  "ul",
                  { className: "kx-fx" },
                  t.fixtures
                    .filter((f) => f.group === gr.name)
                    .map((f) => h("li", { key: f.id, className: cx((f.home === t.userNat || f.away === t.userNat) && "is-me") }, h(Flag, { nat: f.home }), h("b", null, f.played ? `${f.hg}–${f.ag}` : "vs"), h(Flag, { nat: f.away }))),
                ),
              ),
            ),
          ),
        ),
        h(
          TabsContent,
          { value: "ko", className: "mt-4" },
          stages.filter((s) => !s.startsWith("g")).length
            ? stages
                .filter((s) => !s.startsWith("g"))
                .map((s) =>
                  h(
                    "section",
                    { key: s, className: "kx-card" },
                    h("p", { className: "kx-kicker" }, tt(IX.STAGES[s])),
                    h(
                      "ul",
                      { className: "kx-fx is-ko" },
                      t.fixtures
                        .filter((f) => f.stage === s)
                        .map((f) =>
                          h(
                            "li",
                            { key: f.id, className: cx((f.home === t.userNat || f.away === t.userNat) && "is-me") },
                            h("span", { className: cx(f.played && IX.winnerOf(f) === f.home && "is-win") }, h(Flag, { nat: f.home, name: true })),
                            h("b", null, f.played ? `${f.hg}–${f.ag}${f.pens ? L(" (pen.)", " (pens)") : f.aet ? L(" (uz.)", " (aet)") : ""}` : "vs"),
                            h("span", { className: cx(f.played && IX.winnerOf(f) === f.away && "is-win") }, h(Flag, { nat: f.away, name: true })),
                          ),
                        ),
                    ),
                  ),
                )
            : h(EmptyState, null, L("Eleme turları grup aşaması bitince belli olur.", "Knockouts are drawn after the group stage.")),
        ),
        h(
          TabsContent,
          { value: "scorers", className: "mt-4" },
          scorers.length
            ? h(
                "section",
                { className: "kx-card" },
                h(
                  "ol",
                  { className: "kx-scorers" },
                  scorers.map((s, i) => {
                    const p = g.players[s.pid];
                    return h("li", { key: s.pid }, h("span", { className: "kx-mono" }, i + 1), h("span", null, p ? D.shortName(p) : "—", " ", h("span", { className: "kx-dim" }, p?.nat ?? "")), h("b", null, s.goals));
                  }),
                ),
              )
            : h(EmptyState, null, L("Henüz gol yok.", "No goals yet.")),
        ),
        h(TabsContent, { value: "hist", className: "mt-4" }, h(History, { k })),
      ),
    );
  }
  const KIND_KICKER = (kind, L) => (kind === "WC" ? L("FIFA", "FIFA") : "UEFA");

  function History({ k }) {
    const { L, tt } = useI18n();
    const hs = k.intl?.history ?? [];
    if (!hs.length) return h(EmptyState, null, L("Henüz tamamlanan turnuva yok.", "No completed tournaments yet."));
    return h(
      "section",
      { className: "kx-card" },
      h("p", { className: "kx-kicker" }, L("Şampiyonlar", "Roll of honour")),
      h(
        "ul",
        { className: "kx-hist" },
        hs.map((x, i) =>
          h(
            "li",
            { key: i },
            h("span", { className: "kx-mono" }, x.year),
            h("span", null, tt(x.name).replace(/ \d{4}$/, "")),
            h("b", { className: "kx-row" }, "🏆 ", h(Flag, { nat: x.champion, name: true })),
            h("span", { className: "kx-dim" }, x.boot ? `${L("Gol kralı", "Boot")}: ${x.boot.name} (${x.boot.goals})` : ""),
            x.userNat ? h("span", { className: "kx-pill" }, `${x.userNat}: ${tt(resLabel(x.userRes))}`) : null,
          ),
        ),
      ),
    );
  }

  /* ---------- achievements & awards ---------- */
  function AwardsScreen() {
    const { game: g } = useGame();
    const { L, tt } = useI18n();
    const k = g.kx ?? { ach: {}, awards: [] };
    const got = Object.keys(k.ach ?? {}).length;
    const club = (id) => (id == null ? "" : D.getClub(g, id)?.short ?? "");
    return h(
      "div",
      { className: "grid gap-6" },
      h("div", null, h("p", { className: "kx-kicker" }, L("Kariyer", "Career")), h("h1", { className: "font-display text-4xl font-bold uppercase" }, L("Başarımlar & Ödüller", "Achievements & Awards"))),
      h(
        "section",
        { className: "kx-card" },
        h("div", { className: "kx-row kx-between" }, h("h2", { className: "kx-h" }, L("Başarımlar", "Achievements")), h("span", { className: "kx-pill" }, `${got}/${ACH.length}`)),
        h("div", { className: "kx-meter" }, h("i", { style: { width: `${(got / ACH.length) * 100}%` } })),
        h(
          "div",
          { className: "kx-ach" },
          ACH.map(([id, icon, name, desc]) =>
            h(
              "div",
              { key: id, className: cx("kx-ach-i", k.ach?.[id] != null && "is-on") },
              h("span", { className: "kx-ach-ic", "aria-hidden": "true" }, icon),
              h("b", null, tt(name)),
              h("span", null, tt(desc)),
              k.ach?.[id] != null && h("em", null, L(`Sezon ${k.ach[id]}`, `Season ${k.ach[id]}`)),
            ),
          ),
        ),
      ),
      h(
        "section",
        { className: "kx-card" },
        h("h2", { className: "kx-h" }, L("Sezon Ödülleri", "Season Awards")),
        k.awards?.length
          ? h(
              "div",
              { className: "kx-awards" },
              k.awards.map((a) =>
                h(
                  "div",
                  { key: a.season, className: "kx-award" },
                  h("p", { className: "kx-kicker" }, `${a.season}/${String((a.season + 1) % 100).padStart(2, "0")}`),
                  h("p", null, h("span", { className: "kx-dim" }, L("Altın Top", "Ballon d'Or")), h("b", null, a.ballon ? `${a.ballon.name} · ${club(a.ballon.clubId)}` : "—")),
                  h("p", null, h("span", { className: "kx-dim" }, "Golden Boy"), h("b", null, a.boy ? `${a.boy.name} · ${club(a.boy.clubId)}` : "—")),
                  h("p", null, h("span", { className: "kx-dim" }, L("Yılın Kalecisi", "Best Keeper")), h("b", null, a.keeper ? `${a.keeper.name} · ${club(a.keeper.clubId)}` : "—")),
                  h("p", null, h("span", { className: "kx-dim" }, L("Altın Ayakkabı", "Golden Shoe")), h("b", null, a.boot ? `${a.boot.name} (${a.boot.goals})` : "—")),
                ),
              ),
            )
          : h("p", { className: "kx-sub" }, L("Ödüller her sezon sonunda verilir: Altın Top, Golden Boy, Yılın Kalecisi ve Altın Ayakkabı.", "Awards are handed out at the end of every season: Ballon d'Or, Golden Boy, Best Keeper and Golden Shoe.")),
      ),
    );
  }

  /** Header button: white (default) / black theme. */
  function ThemeToggle() {
    const { L } = useI18n();
    const [t, setT] = useState("light");
    useEffect(() => setT(readTheme()), []);
    const next = t === "dark" ? "light" : "dark";
    return h(
      "button",
      {
        type: "button",
        className: "kx-theme",
        "aria-label": next === "dark" ? L("Siyah temaya geç", "Switch to black theme") : L("Beyaz temaya geç", "Switch to white theme"),
        title: next === "dark" ? L("Siyah tema", "Black theme") : L("Beyaz tema", "White theme"),
        onClick: () => {
          applyTheme(next);
          setT(next);
        },
      },
      h("span", { "aria-hidden": "true" }, t === "dark" ? "☀" : "☾"),
    );
  }

  const MENT = [
    ["defensive", "Defans", "Defend"],
    ["cautious", "Temkinli", "Cautious"],
    ["balanced", "Dengeli", "Balanced"],
    ["attacking", "Hücum", "Attack"],
    ["allout", "Tam Hücum", "All-out"],
  ];
  const PRESS = [
    ["low", "Düşük", "Low"],
    ["mid", "Orta", "Medium"],
    ["high", "Yüksek", "High"],
  ];
  const TEMPO = [
    ["slow", "Yavaş", "Slow"],
    ["normal", "Normal", "Normal"],
    ["fast", "Hızlı", "Fast"],
  ];
  const WIDTH = [
    ["narrow", "Dar", "Narrow"],
    ["normal", "Normal", "Normal"],
    ["wide", "Geniş", "Wide"],
  ];

  /** Touchline: every tactical setting can be changed during the match. */
  function MatchTactics({ ms, u, bump }) {
    const { game: g } = useGame();
    const { L } = useI18n();
    const side = ms.sides[u];
    if (!side) return null;
    const club = D.getClub(g, side.clubId);
    const off = !!ms.finished;
    const form = side.formation || club?.tactic?.formation;
    const plan = g.kx?.plan ?? "standard";
    const P = PLANS[plan] ?? PLANS.standard;
    const set = (key, v) => {
      side[key] = v;
      bump();
    };
    const group = (label, cur, opts, onPick) =>
      h(
        "div",
        { className: "kx-tg" },
        h("p", { className: "kx-tg-l" }, label),
        h(
          "div",
          { className: "kx-tg-o" },
          opts.map(([v, tr, en]) =>
            h(
              "button",
              {
                key: v,
                type: "button",
                disabled: off,
                className: cx("kx-tb", (cur ?? "normal") === v && "is-on"),
                "aria-pressed": (cur ?? "normal") === v,
                onClick: () => onPick(v),
              },
              L(tr, en),
            ),
          ),
        ),
      );
    const forms = Object.keys(D.formations ?? {});
    return h(
      "div",
      { className: "kx-tactics" },
      forms.length > 0 &&
        group(
          L("Diziliş", "Formation"),
          form,
          forms.map((f) => [f, f, f]),
          (f) => {
            if (reshape(g, side, f)) bump();
          },
        ),
      group(L("Oyun anlayışı", "Mentality"), side.mentality, MENT, (v) => set("mentality", v)),
      group(L("Pres", "Pressing"), side.pressing ?? "mid", PRESS, (v) => set("pressing", v)),
      group(L("Tempo", "Tempo"), side.tempo, TEMPO, (v) => set("tempo", v)),
      group(L("Genişlik", "Width"), side.width, WIDTH, (v) => set("width", v)),
      side.clubId === g.clubId &&
        h(
          "div",
          { className: "kx-tg" },
          h("p", { className: "kx-tg-l" }, L("Maç planı", "Match plan")),
          h(
            "div",
            { className: "kx-tg-o" },
            Object.entries(PLANS).map(([key, p]) =>
              h(
                "button",
                {
                  key,
                  type: "button",
                  disabled: off,
                  className: cx("kx-tb", plan === key && "is-on"),
                  "aria-pressed": plan === key,
                  onClick: () => {
                    ensure(g).plan = key;
                    bump();
                  },
                },
                L(p.tr, p.en),
              ),
            ),
          ),
          h("p", { className: "kx-tg-d" }, L(P.dtr, P.den)),
        ),
    );
  }

  return { Backdrop, ClubBackdrop, HomeBanner, PlanPicker, IntlScreen, AwardsScreen, ThemeToggle, MatchTactics };
}

export const KX = {
  init, ensure, newGame, migrate, seasonEnd, weekly, bigMul, planMul, onAnswer, pressExtra, stadiumImage, createUI,
  extendLeagues, uefa, UEFA_SLOTS, PLANS, ACH, streak, checkAchievements, seasonAwards,
  intlPlayStage, intlPlayAll, intlCoach, intlApproach, INTL: IX, reshape, readTheme, applyTheme,
};
