/*
 * Career extensions (hand-written, framework-agnostic apart from injected React).
 *
 *  - Transfer pricing: asking prices sit above market value, scaled by a player's
 *    fame ("tanınırlık"), contract length, squad role and the clubs involved.
 *  - Detailed negotiation: multi-round club talks (fee, instalments, appearance
 *    bonus, sell-on clause, player swap, patience) followed by personal terms
 *    (squad role, wage, length, signing bonus, agent fee).
 *  - Loans: loan players in / out (wage share, loan fee, half/full season, option
 *    to buy), AI clubs requesting the user's youngsters, loan returns.
 *  - AI transfer market: clubs actively buy, sell and loan during windows.
 *  - Domestic cups: Ziraat Türkiye Kupası, FA Cup, Copa del Rey, Coppa Italia,
 *    DFB-Pokal and Coupe de France as single-leg knockouts stored in game.cups
 *    with `domestic: true`.
 *  - Realism: player development by age / playing time, in-match fatigue,
 *    weekly and midweek recovery, fatigue-weighted injuries, scoring tempo.
 *  - UI: negotiation, loan screens, domestic cup screen, pre-match XI editor and
 *    the live match touchline panel.
 *
 * Extension state lives in game.ce; player-level fields: p.loan, p.ceSellOn,
 * p.ceAddon, p.ceLast, p.dvA.
 */
import { createUI as __kxCreateUI } from "./kaiser-ext.js?v=2";
let __kxT;
const kxTactics = () => (__kxT ??= __kxCreateUI().MatchTactics);

let D = null;
const T = (tr, en) => ({ tr, en });
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function hash01(a, b = 0) {
  let h = (Math.imul(a | 0, 2654435761) ^ Math.imul((b | 0) + 1, 40503)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), h | 1);
  h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
  return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
}

export function init(deps) {
  D = deps;
  if (typeof document !== "undefined" && !document.getElementById("ce-css")) {
    const link = document.createElement("link");
    link.id = "ce-css";
    link.rel = "stylesheet";
    link.href = new URL("./career-ext.css?v=2", import.meta.url).href;
    document.head.appendChild(link);
  }
}

export function ensure(g) {
  g.ce ??= {};
  const c = g.ce;
  c.neg ??= {};
  c.loanOffers ??= [];
  c.nextLoanOfferId ??= 1;
  c.payments ??= [];
  c.nextFid ??= 800000;
  return c;
}

const isUser = (g, clubId) => g.clubId != null && clubId === g.clubId;
const seasonKey = (g) => g.season * 100 + g.week;
export const windowKey = (g) => `${g.season}:${g.phase === "preseason" || g.week <= 4 ? "S" : "W"}`;

/* ============================================================ indexes */

function squadIndex(g) {
  const m = new Map();
  for (const p of Object.values(g.players)) {
    if (p.clubId == null) continue;
    let a = m.get(p.clubId);
    if (!a) m.set(p.clubId, (a = []));
    a.push(p);
  }
  return m;
}
function idxMove(idx, p, from, to) {
  if (from != null) {
    const a = idx.get(from);
    if (a) {
      const i = a.indexOf(p);
      if (i >= 0) a.splice(i, 1);
    }
  }
  if (to != null) {
    let a = idx.get(to);
    if (!a) idx.set(to, (a = []));
    a.push(p);
  }
}
function strengthOf(list) {
  const r = list.map(D.ovr).sort((a, b) => b - a).slice(0, 14);
  return r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0;
}

/* ======================================================== fame & price */

/** Recognition 0..1: ability, club stature, experience, form and hype. */
export function fame(g, p) {
  const o = D.ovr(p);
  const club = p.clubId == null ? null : D.getClub(g, p.clubId);
  const rep = club ? club.rep : 40;
  const ovrF = clamp((o - 58) / 30, 0, 1);
  const repF = clamp((rep - 40) / 55, 0, 1);
  const ageF = p.age <= 19 ? 0.15 : p.age <= 22 ? 0.45 : p.age <= 31 ? 1 : 0.7;
  const careerF = clamp((p.careerGoals * 1.6 + p.careerApps * 0.35) / 160, 0, 1);
  const form = p.form?.length ? p.form.reduce((a, b) => a + b, 0) / p.form.length : 6.6;
  const formF = clamp((form - 6.4) / 1.2, 0, 1);
  const hype = p.age <= 21 && p.pot - o >= 10 ? 0.12 : 0;
  return clamp(0.52 * ovrF + 0.22 * repF + 0.1 * ageF + 0.08 * careerF + 0.08 * formF + hype, 0, 1);
}
export function fameLabel(f) {
  return f >= 0.8
    ? T("Dünya yıldızı", "World star")
    : f >= 0.62
      ? T("Çok tanınıyor", "Famous")
      : f >= 0.42
        ? T("Tanınıyor", "Well known")
        : f >= 0.25
          ? T("Az tanınıyor", "Little known")
          : T("Tanınmıyor", "Unknown");
}

function squadRank(g, p, idx) {
  const list = (idx ? idx.get(p.clubId) : D.clubPlayers(g, p.clubId)) || [];
  const sorted = [...list].sort((a, b) => D.ovr(b) - D.ovr(a));
  return sorted.indexOf(p);
}

/** What the selling club asks for (always above market value unless the deal is distressed). */
export function askingPrice(g, p, buyerId, idx) {
  if (p.clubId == null) return 0;
  const mv = D.value(p, g.season);
  const seller = D.getClub(g, p.clubId);
  const buyer = buyerId == null ? null : D.getClub(g, buyerId);
  const f = fame(g, p);
  // Premium grows steeply for world stars (fame >= 0.62): ~1.2x for unknowns,
  // ~1.6x for famous players, 2-2.4x for the very biggest names.
  let m = 1.12 + f * 0.5 + Math.max(0, f - 0.62) * 1.98;
  const rank = squadRank(g, p, idx);
  if (rank >= 0 && rank < 11) m *= 1.08;
  else if (rank >= 18) m *= 0.92;
  if (p.age <= 23 && p.pot - D.ovr(p) >= 6) m *= 1.06;
  if (p.age >= 30) m *= Math.max(0.62, 1 - (p.age - 29) * 0.06);
  const yrs = p.contractEnd - g.season;
  m *= yrs <= 0 ? 0.62 : yrs === 1 ? 0.86 : yrs >= 4 ? 1.06 : 1;
  if (p.listed) m *= 0.84;
  if (buyer && seller && buyer.leagueId === seller.leagueId) m *= 1.06;
  if (buyer && seller && seller.rep > buyer.rep + 10) m *= 1.04;
  if (seller && seller.balance < 0) m *= 0.9;
  m *= 0.96 + hash01(p.id, g.season) * 0.08;
  return D.roundMoney(Math.max(1e4, mv * m));
}

/** AI bid for one of the user's players (Tc). */
export function aiBidFee(g, p, buyer, listed) {
  const a = askingPrice(g, p, buyer.id);
  const r = D.rand();
  return D.roundMoney(a * (listed ? 0.74 + r * 0.2 : 0.82 + r * 0.24));
}

function notForSale(g, p, buyerId) {
  if (p.listed || p.clubId == null) return false;
  const seller = D.getClub(g, p.clubId);
  const buyer = buyerId == null ? null : D.getClub(g, buyerId);
  const rank = squadRank(g, p);
  return rank >= 0 && rank < 8 && fame(g, p) >= 0.45 && seller.rep >= (buyer?.rep ?? 0) - 3;
}

/* ===================================================== negotiation */

export function negState(g, pid) {
  const c = ensure(g);
  const p = g.players[pid];
  if (!p || p.clubId == null) return null;
  const key = windowKey(g);
  let s = c.neg[pid];
  if (!s || s.key !== key || s.club !== p.clubId) {
    const seller = D.getClub(g, p.clubId);
    const nfs = notForSale(g, p, g.clubId);
    const ask = askingPrice(g, p, g.clubId) * (nfs ? 1.3 : 1);
    const r = hash01(pid, g.season * 7 + (key.endsWith("W") ? 1 : 0));
    const poor = seller.balance < 3e6;
    const min = ask * (poor ? 0.88 : 0.93) * (0.97 + r * 0.05);
    const patience = clamp(Math.round(4.2 - (seller.rep - 60) / 18 + r * 1.4), 2, 5);
    s = c.neg[pid] = {
      key,
      club: p.clubId,
      ask: D.roundMoney(ask),
      min: D.roundMoney(Math.min(ask, min)),
      patience,
      max: patience,
      round: 0,
      best: 0,
      hist: [],
      agreed: null,
      broken: false,
      nfs,
      termsTries: 0,
    };
  }
  return s;
}

const INST = { 1: 1, 2: 0.96, 3: 0.92 };
export function swapValue(g, sp, sellerId) {
  if (!sp) return 0;
  const list = D.clubPlayers(g, sellerId);
  const bestAtPos = list.filter((x) => x.pos === sp.pos).map(D.ovr).sort((a, b) => b - a)[0] ?? 0;
  const strength = strengthOf(list);
  let k = D.ovr(sp) >= bestAtPos - 1 ? 0.88 : D.ovr(sp) >= strength - 5 ? 0.66 : 0.42;
  if (sp.age >= 30) k *= 0.72;
  return D.value(sp, g.season) * k;
}
export function offerValue(g, p, o) {
  const mv = D.value(p, g.season);
  let v = (o.fee || 0) * (INST[o.inst] ?? 1) + (o.addon || 0) * 0.45 + ((o.sellOn || 0) / 100) * mv * 0.35;
  if (o.swap != null) v += swapValue(g, g.players[o.swap], p.clubId);
  return v;
}
export const upfrontOf = (o) => Math.round((o.fee || 0) / (o.inst || 1));

export function checkOffer(g, pid, o) {
  const p = g.players[pid];
  const me = D.getClub(g, g.clubId);
  if (!D.windowOpen(g)) return T("Transfer dönemi kapalı.", "The transfer window is closed.");
  if (p.loan) return T("Oyuncu kiralık, şu an transfer edilemez.", "The player is on loan and cannot be signed now.");
  if (!(o.fee > 0) && o.swap == null) return T("Geçerli bir bonservis girin.", "Enter a valid fee.");
  const seller = D.getClub(g, p.clubId);
  const sellerSize = D.clubPlayers(g, seller.id).length;
  if (sellerSize <= 18 && o.swap == null)
    return T(`${seller.name} kadrosu çok dar, oyuncuyu satmayacak.`, `${seller.name} have too few players to sell.`);
  if (o.swap != null) {
    const sp = g.players[o.swap];
    if (!sp || sp.clubId !== g.clubId || sp.loan) return T("Takas oyuncusu geçersiz.", "Invalid swap player.");
    if (sellerSize >= 32) return T(`${seller.name} kadrosu dolu, takas kabul etmez.`, `${seller.name} have no room for a swap.`);
  }
  return null;
}

/** One round of club-to-club talks. Mutates negotiation state. */
export function submitOffer(g, pid, o) {
  const s = negState(g, pid);
  const p = g.players[pid];
  if (!s) return { kind: "error", msg: T("Oyuncu bulunamadı.", "Player not found.") };
  if (s.broken)
    return { kind: "broken", msg: T("Kulüp görüşmeleri bu dönem için kesti.", "The club has ended talks for this window.") };
  const err = checkOffer(g, pid, o);
  if (err) return { kind: "error", msg: err };
  s.round++;
  const val = offerValue(g, p, o);
  const seller = D.getClub(g, p.clubId);
  let kind;
  if (val >= s.min) {
    s.agreed = { ...o };
    kind = "accept";
  } else {
    const ratio = val / s.min;
    if (s.best && val < s.best * 0.98) s.patience--;
    if (ratio < 0.6) {
      s.patience -= 2;
      kind = "insult";
    } else if (ratio < 0.84) {
      s.patience -= 1;
      kind = "low";
    } else {
      if (ratio < 0.95) s.patience -= 1;
      const next = Math.max(s.min, s.ask - (s.ask - val) * clamp(0.16 + 0.07 * s.round, 0.16, 0.5));
      s.ask = D.roundMoney(next);
      kind = "counter";
    }
    s.best = Math.max(s.best, val);
    if (s.patience <= 0) {
      s.broken = true;
      kind = "broken";
    }
  }
  const msg = {
    accept: T(
      `${seller.name} teklifinizi kabul etti! Şimdi oyuncuyla kişisel şartları konuşun.`,
      `${seller.name} accepted your offer! Now agree personal terms with the player.`,
    ),
    counter: T(
      `${seller.name} teklifi reddetti ama masada kalıyor: ${D.money(s.ask)} istiyorlar.`,
      `${seller.name} rejected the bid but are still talking: they want ${D.money(s.ask)}.`,
    ),
    low: T(
      `${seller.name} teklifi düşük buldu. Beklentileri hâlâ ${D.money(s.ask)} civarında.`,
      `${seller.name} found the bid too low. They still expect around ${D.money(s.ask)}.`,
    ),
    insult: T(
      `${seller.name} teklifi hakaret olarak algıladı! Sabırları hızla azalıyor.`,
      `${seller.name} took the bid as an insult! Their patience is running out.`,
    ),
    broken: T(
      `${seller.name} görüşmeleri kesti. Bu transfer döneminde yeni teklif kabul etmeyecekler.`,
      `${seller.name} walked away. They will not talk again this window.`,
    ),
  }[kind];
  s.hist.push({ round: s.round, fee: o.fee || 0, inst: o.inst || 1, addon: o.addon || 0, sellOn: o.sellOn || 0, swap: o.swap ?? null, val, kind, ask: s.ask });
  return { kind, msg, ask: s.ask };
}

export const ROLES = [
  { id: "star", tr: "Yıldız oyuncu", en: "Star player", k: 0.94 },
  { id: "starter", tr: "İlk 11 oyuncusu", en: "First-team regular", k: 1 },
  { id: "rotation", tr: "Rotasyon oyuncusu", en: "Rotation player", k: 1.12 },
  { id: "backup", tr: "Yedek", en: "Backup", k: 1.26 },
  { id: "prospect", tr: "Gelecek vaat eden", en: "Prospect", k: 1.04 },
];

/** Player-side check: refusal reason or demands for a squad role. */
export function playerDemand(g, pid, roleId, fee) {
  const p = g.players[pid];
  const me = D.getClub(g, g.clubId);
  const refuse = D.personalCheck(g, pid, 1e12, false);
  if (!refuse.ok && refuse.demand == null) return { refuse: refuse.reason };
  const role = ROLES.find((r) => r.id === roleId) ?? ROLES[1];
  const o = D.ovr(p);
  const str = D.strength(g, me.id);
  if (roleId === "prospect" && p.age > 22)
    return { refuse: T(`${D.fullName(p)} artık genç bir oyuncu değil, bu rolü kabul etmez.`, `${D.fullName(p)} is no prospect any more.`) };
  if (roleId === "backup" && o >= str + 2)
    return { refuse: T(`${D.fullName(p)} yedek kalmak için gelmez.`, `${D.fullName(p)} won't come to sit on the bench.`) };
  if (roleId === "star" && o < str + 3)
    return { refuse: T(`Kadronuzda yıldız rolü için yeterince öne çıkmıyor; bu sözü inandırıcı bulmadı.`, `He doesn't stand out enough to believe a star-role promise.`) };
  const f = fame(g, p);
  const base = D.wageDemand(g, p, me) * (1 + f * 0.22) * role.k;
  const wage = Math.round(base / 100) * 100;
  const agent = D.roundMoney(fee > 0 ? Math.max(25e3, fee * (0.03 + f * 0.05)) : Math.max(1e4, wage * 52 * 0.2));
  return { wage, agent, fame: f };
}
export function termsAccepted(dem, t, p) {
  const years = t.years || 3;
  let need = dem.wage;
  if (p.age >= 31 && years < 2) need *= 1.12;
  if (p.age <= 23 && years >= 4) need *= 0.97;
  const eff = (t.wage || 0) + ((t.bonus || 0) / (52 * years)) * 0.9;
  return { ok: eff >= need * 0.97, need: Math.round(need / 100) * 100, eff };
}

/** Finalise an agreed transfer with personal terms. */
export function completeTransfer(g, pid, t) {
  const s = negState(g, pid);
  const p = g.players[pid];
  if (!s?.agreed) return { ok: false, msg: T("Önce kulüple anlaşın.", "Agree a fee with the club first.") };
  const me = D.getClub(g, g.clubId);
  const seller = D.getClub(g, p.clubId);
  const o = s.agreed;
  const dem = playerDemand(g, pid, t.role, o.fee);
  if (dem.refuse) return { ok: false, msg: dem.refuse };
  const acc = termsAccepted(dem, t, p);
  if (!acc.ok) {
    s.termsTries++;
    if (s.termsTries >= 3) {
      s.broken = true;
      s.agreed = null;
      return {
        ok: false,
        walked: true,
        msg: T(`${D.fullName(p)} şartlarda anlaşamadığınız için görüşmeleri bitirdi.`, `${D.fullName(p)} ended talks after failing to agree terms.`),
      };
    }
    return {
      ok: false,
      need: acc.need,
      msg: T(
        `${D.fullName(p)} şartları yetersiz buldu. Haftalık en az ${D.money(acc.need)} (veya daha yüksek imza parası) istiyor. Kalan hak: ${3 - s.termsTries}.`,
        `${D.fullName(p)} wants at least ${D.money(acc.need)}/week (or a bigger signing bonus). Attempts left: ${3 - s.termsTries}.`,
      ),
    };
  }
  if (!D.squadRoom(g, g.clubId)) return { ok: false, msg: T("Kadronuz dolu (en fazla 32 oyuncu).", "Your squad is full (max 32).") };
  const upfront = upfrontOf(o);
  const extra = (t.bonus || 0) + dem.agent;
  if (o.swap != null) {
    const sp = g.players[o.swap];
    if (sp && sp.clubId === g.clubId) {
      D.move(g, sp, seller.id, 0, D.wageDemand(g, sp, seller), D.randInt(2, 4));
      g.transfers[0].note = "swap";
    }
  }
  D.move(g, p, me.id, upfront, t.wage, t.years);
  g.transfers[0].fee = o.fee;
  me.balance -= extra;
  me.transferBudget = Math.max(0, me.transferBudget - extra);
  g.finance.purchases += extra;
  const c = ensure(g);
  for (let k = 1; k < (o.inst || 1); k++)
    c.payments.push({ from: me.id, to: seller.id, amount: Math.round(o.fee / o.inst), season: g.season + k, pid: p.id, name: D.fullName(p) });
  if (o.addon > 0) p.ceAddon = { club: seller.id, payer: me.id, amount: o.addon, need: 25, base: p.careerApps };
  if (o.sellOn > 0) p.ceSellOn = { club: seller.id, pct: o.sellOn };
  p.ceRole = t.role;
  p.morale = clamp(p.morale + (t.role === "star" ? 12 : t.role === "backup" ? -4 : 6), 5, 100);
  delete c.neg[pid];
  const parts = [];
  if ((o.inst || 1) > 1) parts.push(T(`${o.inst} taksit`, `${o.inst} instalments`));
  if (o.addon > 0) parts.push(T(`${D.money(o.addon)} bonus`, `${D.money(o.addon)} add-on`));
  if (o.sellOn > 0) parts.push(T(`%${o.sellOn} sonraki satıştan pay`, `${o.sellOn}% sell-on`));
  const ex = parts.length ? ` (${parts.map((x) => x.tr).join(", ")})` : "";
  const exEn = parts.length ? ` (${parts.map((x) => x.en).join(", ")})` : "";
  D.inbox(
    g,
    "transfer",
    T(`${D.fullName(p)} transfer edildi`, `${D.fullName(p)} signed`),
    T(
      `${D.fullName(p)} ${D.money(o.fee)} bonservisle${ex} ${seller.name} kulübünden aramıza katıldı. Haftalık maaş ${D.money(t.wage)}, ${t.years} yıl.`,
      `${D.fullName(p)} joined from ${seller.name} for ${D.money(o.fee)}${exEn}. Wage ${D.money(t.wage)}/wk, ${t.years} years.`,
    ),
  );
  return { ok: true, msg: T("Transfer tamamlandı!", "Transfer complete!") };
}

/** Called at the end of every hc() move: sell-on clauses, add-ons, loans. */
export function afterMove(g, p, from, to, fee) {
  if (p.ceSellOn && from && fee > 0 && from.id !== p.ceSellOn.club) {
    const cut = Math.round((fee * p.ceSellOn.pct) / 100);
    const rc = D.getClub(g, p.ceSellOn.club);
    if (rc && cut > 0) {
      from.balance -= cut;
      rc.balance += cut;
      if (isUser(g, from.id)) {
        g.finance.sales -= cut;
        D.inbox(g, "transfer", T("Sonraki satıştan pay ödendi", "Sell-on fee paid"), T(`${D.fullName(p)} satışından ${rc.name} kulübüne ${D.money(cut)} ödendi.`, `${D.money(cut)} paid to ${rc.name} from the ${D.fullName(p)} sale.`));
      }
      if (isUser(g, rc.id)) {
        g.finance.sales += cut;
        D.inbox(g, "transfer", T("Sonraki satıştan pay geldi!", "Sell-on income!"), T(`${D.fullName(p)} transferinden %${p.ceSellOn.pct} pay olarak ${D.money(cut)} kasamıza girdi.`, `We received ${D.money(cut)} (${p.ceSellOn.pct}%) from the ${D.fullName(p)} transfer.`));
      }
    }
  }
  if (from && to && from.id !== to.id) {
    delete p.ceSellOn;
    delete p.ceAddon;
    delete p.ceRole;
  }
  delete p.loan;
  p.loanListed = false;
}

/* ============================================================== loans */

function rankAtPos(list, p) {
  return list.filter((x) => x !== p && x.pos === p.pos && D.ovr(x) > D.ovr(p)).length;
}

/** Can the user borrow this player? Returns parent club demands. */
export function loanInQuote(g, pid) {
  const p = g.players[pid];
  if (!p || p.clubId == null || g.clubId == null || p.clubId === g.clubId) return { ok: false, reason: T("Bu oyuncu kiralanamaz.", "This player can't be loaned.") };
  if (!D.windowOpen(g)) return { ok: false, reason: T("Transfer dönemi kapalı.", "The window is closed.") };
  if (p.loan) return { ok: false, reason: T("Oyuncu zaten kiralık.", "Already on loan.") };
  const parent = D.getClub(g, p.clubId);
  const me = D.getClub(g, g.clubId);
  const list = D.clubPlayers(g, parent.id);
  if (list.length <= 19) return { ok: false, reason: T(`${parent.name} kadrosu dar, oyuncu kiralamıyor.`, `${parent.name} have too few players to loan.`) };
  const rank = squadRank(g, p);
  if ((rank < 11 && p.age > 21) || (rank < 14 && p.age > 25))
    return { ok: false, reason: T(`${parent.name} bu oyuncuyu as kadro için düşünüyor, kiralık vermez.`, `${parent.name} see him as a first-team player.`) };
  const mine = D.clubPlayers(g, me.id);
  if (rankAtPos(mine, p) >= 2)
    return { ok: false, reason: T(`${D.fullName(p)} sizde forma şansı bulamayacağını düşünüyor.`, `${D.fullName(p)} doesn't expect to play for you.`) };
  if (!D.squadRoom(g, me.id)) return { ok: false, reason: T("Kadronuz dolu.", "Your squad is full.") };
  let minShare = 0.5 + (p.age >= 25 ? 0.25 : 0) + (parent.balance < 0 ? 0.25 : 0) + (me.rep >= parent.rep ? 0.1 : 0);
  minShare = clamp(Math.ceil(minShare * 4) / 4, 0.5, 1);
  const mv = D.value(p, g.season);
  const young = p.age <= 22 && p.pot - D.ovr(p) >= 5;
  const fee = D.roundMoney(mv * (young ? 0.02 : 0.06));
  const optionFee = D.roundMoney(askingPrice(g, p, me.id) * 1.05);
  return { ok: true, minShare, fee, optionFee, parent };
}
export function loanInNeed(q, offer) {
  const dur = offer.half ? 0.6 : 1;
  return D.roundMoney(Math.max(0, q.fee * dur * (offer.option ? 1.3 : 1) * (1 - (offer.share - q.minShare) * 1.2)));
}
export function requestLoanIn(g, pid, offer) {
  const q = loanInQuote(g, pid);
  if (!q.ok) return { ok: false, msg: q.reason };
  const me = D.getClub(g, g.clubId);
  const need = loanInNeed(q, offer);
  if (offer.share < q.minShare)
    return { ok: false, msg: T(`${q.parent.name} maaşın en az %${Math.round(q.minShare * 100)}'ini ödemenizi istiyor.`, `${q.parent.name} want you to pay at least ${Math.round(q.minShare * 100)}% of his wage.`) };
  if ((offer.fee || 0) < need * 0.97)
    return { ok: false, msg: T(`${q.parent.name} kiralık bedeli olarak ${D.money(need)} istiyor.`, `${q.parent.name} want a loan fee of ${D.money(need)}.`), need };
  const p = g.players[pid];
  doLoan(g, p, me.id, { share: offer.share, fee: offer.fee || 0, option: offer.option ? q.optionFee : null, half: offer.half });
  D.inbox(
    g,
    "transfer",
    T(`${D.fullName(p)} kiralandı`, `${D.fullName(p)} loaned in`),
    T(
      `${D.fullName(p)} ${q.parent.name} kulübünden ${offer.half ? "devre arasına kadar" : "sezon sonuna kadar"} kiralık olarak aramızda. Maaşının %${Math.round(offer.share * 100)}'ini ödeyeceğiz.${offer.option ? ` Satın alma opsiyonu: ${D.money(q.optionFee)}.` : ""}`,
      `${D.fullName(p)} joins on loan from ${q.parent.name} until ${offer.half ? "mid-season" : "the end of the season"}. We pay ${Math.round(offer.share * 100)}% of his wage.${offer.option ? ` Option to buy: ${D.money(q.optionFee)}.` : ""}`,
    ),
  );
  return { ok: true, msg: T("Kiralık anlaşması tamam!", "Loan agreed!") };
}

function untilFor(g, half) {
  if (half && g.phase !== "preseason" && g.week < 19) return { season: g.season, week: 19 };
  if (half && g.phase === "preseason") return { season: g.season, week: 19 };
  return { season: g.season, week: 39 };
}

export function doLoan(g, p, toId, o) {
  const from = D.getClub(g, p.clubId);
  const to = D.getClub(g, toId);
  from.tactic.xi = from.tactic.xi.map((x) => (x === p.id ? null : x));
  from.tactic.bench = from.tactic.bench.filter((x) => x !== p.id);
  const fee = o.fee || 0;
  if (fee) {
    to.balance -= fee;
    to.transferBudget = Math.max(0, to.transferBudget - fee);
    from.balance += fee;
    from.transferBudget += Math.round(fee * 0.5);
    if (isUser(g, to.id)) g.finance.purchases += fee;
    if (isUser(g, from.id)) g.finance.sales += fee;
  }
  p.loan = { from: from.id, to: to.id, share: o.share ?? 1, fee, option: o.option ?? null, until: untilFor(g, o.half), since: seasonKey(g) };
  p.clubId = to.id;
  p.listed = false;
  p.loanListed = false;
  p.morale = clamp(p.morale + 5, 5, 100);
  g.transfers.unshift({ season: g.season, week: g.week, playerId: p.id, playerName: D.fullName(p), from: from.name, to: to.name, fee, loan: true });
  g.transfers.length > 600 && (g.transfers.length = 600);
  g.offers = g.offers.filter((x) => x.playerId !== p.id);
  ensure(g).loanOffers = ensure(g).loanOffers.filter((x) => x.pid !== p.id);
}

export function endLoan(g, p, silent) {
  const l = p.loan;
  if (!l) return;
  const to = D.getClub(g, l.to);
  const from = D.getClub(g, l.from);
  if (to) {
    to.tactic.xi = to.tactic.xi.map((x) => (x === p.id ? null : x));
    to.tactic.bench = to.tactic.bench.filter((x) => x !== p.id);
  }
  p.clubId = l.from;
  delete p.loan;
  if (!silent && (isUser(g, l.from) || isUser(g, l.to)))
    D.inbox(
      g,
      "player",
      T(`${D.fullName(p)} kiralıktan döndü`, `${D.fullName(p)} returns from loan`),
      T(
        `${D.fullName(p)}, ${to?.name ?? "—"} kulübündeki kiralık süresini tamamlayıp ${from?.name ?? "—"} kulübüne döndü.`,
        `${D.fullName(p)} completed his loan at ${to?.name ?? "—"} and returned to ${from?.name ?? "—"}.`,
      ),
    );
}

export function exerciseOption(g, pid) {
  const p = g.players[pid];
  const l = p?.loan;
  if (!l || !isUser(g, l.to) || !l.option) return { ok: false, msg: T("Satın alma opsiyonu yok.", "No option to buy.") };
  const me = D.getClub(g, g.clubId);
  const fee = l.option;
  p.clubId = l.from;
  delete p.loan;
  D.move(g, p, me.id, fee, p.wage, Math.max(2, Math.min(5, p.contractEnd - g.season + 1)));
  D.inbox(g, "transfer", T(`${D.fullName(p)} bonservisi alındı`, `${D.fullName(p)} signed permanently`), T(`Satın alma opsiyonu kullanıldı: ${D.money(fee)}.`, `Option to buy exercised: ${D.money(fee)}.`));
  return { ok: true, msg: T("Opsiyon kullanıldı, oyuncu artık bizim!", "Option exercised, he is ours now!") };
}

/** Interested clubs for one of the user's players (deterministic per week). */
export function loanOutOffers(g, pid) {
  const p = g.players[pid];
  if (!p || !isUser(g, p.clubId) || p.loan) return [];
  const me = D.getClub(g, g.clubId);
  const idx = squadIndex(g);
  const o = D.ovr(p);
  const out = [];
  for (const c of g.clubs) {
    if (c.id === me.id) continue;
    const list = idx.get(c.id) || [];
    if (list.length >= 28 || list.length < 16) continue;
    if (c.rep > me.rep + 12) continue;
    const ahead = rankAtPos(list, p);
    if (ahead >= 2) continue;
    const str = strengthOf(list);
    if (o < str - 7) continue;
    const r = hash01(pid * 31 + c.id, seasonKey(g));
    if (r < 0.45) continue;
    const role = ahead === 0 ? "starter" : "rotation";
    const share = clamp(Math.round((0.5 + c.balance / 8e7 + (role === "starter" ? 0.2 : 0) + r * 0.2) * 4) / 4, 0.5, 1);
    const young = p.age <= 22;
    const fee = young ? 0 : D.roundMoney(D.value(p, g.season) * (0.02 + r * 0.04));
    const option = c.rep < me.rep && p.age >= 23 && r > 0.85 ? D.roundMoney(askingPrice(g, p, c.id)) : null;
    out.push({ club: c.id, role, share, fee, option, score: (role === "starter" ? 100 : 0) + c.rep + r * 10 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}
export function acceptLoanOut(g, pid, offer, half) {
  const p = g.players[pid];
  if (!D.windowOpen(g)) return { ok: false, msg: T("Transfer dönemi kapalı.", "The window is closed.") };
  if (!p || !isUser(g, p.clubId) || p.loan) return { ok: false, msg: T("Oyuncu kiralanamaz.", "Player can't be loaned.") };
  if (D.clubPlayers(g, g.clubId).length <= 16) return { ok: false, msg: T("Kadronuz çok dar (en az 16 oyuncu kalmalı).", "Your squad is too thin (keep at least 16).") };
  const c = D.getClub(g, offer.club);
  doLoan(g, p, c.id, { share: offer.share, fee: half ? D.roundMoney(offer.fee * 0.6) : offer.fee, option: offer.option, half });
  p.morale = clamp(p.morale + (offer.role === "starter" ? 8 : 3), 5, 100);
  D.inbox(
    g,
    "transfer",
    T(`${D.fullName(p)} kiralık gitti`, `${D.fullName(p)} loaned out`),
    T(
      `${D.fullName(p)} ${half ? "devre arasına kadar" : "sezon sonuna kadar"} ${c.name} kulübüne kiralandı. Maaşının %${Math.round(offer.share * 100)}'ini ${c.name} ödeyecek.`,
      `${D.fullName(p)} joins ${c.name} on loan until ${half ? "mid-season" : "the end of the season"}. They pay ${Math.round(offer.share * 100)}% of his wage.`,
    ),
  );
  return { ok: true, msg: T("Kiralık anlaşması tamam!", "Loan agreed!") };
}
export function respondLoanOffer(g, id, accept) {
  const c = ensure(g);
  const o = c.loanOffers.find((x) => x.id === id);
  if (!o) return T("Teklif bulunamadı.", "Offer not found.");
  c.loanOffers = c.loanOffers.filter((x) => x.id !== id);
  if (!accept) return T("Kiralık teklifi reddedildi.", "Loan offer rejected.");
  const r = acceptLoanOut(g, o.pid, o, false);
  return r.msg;
}

/** Weekly wage bill including loan wage splits. */
const wbCache = new WeakMap();
export function wageBill(g, clubId) {
  let c = wbCache.get(g);
  const key = seasonKey(g);
  if (!c || c.key !== key) {
    const m = new Map();
    const add = (id, v) => m.set(id, (m.get(id) || 0) + v);
    for (const p of Object.values(g.players)) {
      if (p.clubId == null) continue;
      if (p.loan) {
        add(p.clubId, p.wage * p.loan.share);
        add(p.loan.from, p.wage * (1 - p.loan.share));
      } else add(p.clubId, p.wage);
    }
    c = { key, m };
    wbCache.set(g, c);
  }
  return Math.round(c.m.get(clubId) || 0);
}

/* ========================================================= AI market */

/**
 * AI transfer & loan activity. mode: "week" (inside a window) or "summer" (season rollover).
 */
export function aiMarket(g, mode) {
  if (mode === "week" && !D.windowOpen(g)) return;
  const c = ensure(g);
  const idx = squadIndex(g);
  const all = Object.values(g.players);
  const deadline = g.week === 4 || g.week === 22;
  const clubs = g.clubs.filter((x) => x.id !== g.clubId);
  const tries = mode === "summer" ? 110 : deadline ? 34 : 18;
  let news = 0;
  const userLeague = g.clubId == null ? null : D.getClub(g, g.clubId).leagueId;
  for (let k = 0; k < tries; k++) {
    const buyer = D.pick(clubs);
    const squad = idx.get(buyer.id) || [];
    if (squad.length >= 28) continue;
    const pos = D.need(g, buyer);
    const cur = squad.filter((p) => p.pos === pos).map(D.ovr).sort((a, b) => b - a);
    const best = cur[0] ?? 0;
    const depth = cur.length;
    const want = depth < (pos === "CB" || pos === "CM" || pos === "ST" ? 2 : 1) ? best - 6 : best - 1;
    let pickP = null;
    let pickScore = -1;
    let pickFee = 0;
    for (let n = 0; n < 260; n++) {
      const p = all[Math.floor(D.rand() * all.length)];
      if (p.pos !== pos || p.clubId === buyer.id || p.loan || (g.clubId != null && p.clubId === g.clubId)) continue;
      if (p.age > 31 && p.clubId != null) continue;
      if (!g.players[p.id]) continue;
      const o = D.ovr(p);
      if (o <= want) continue;
      let fee = 0;
      if (p.clubId != null) {
        const seller = D.getClub(g, p.clubId);
        const sList = idx.get(seller.id) || [];
        if (sList.length <= 20) continue;
        const rank = squadRank(g, p, idx);
        if (seller.rep > buyer.rep + 8 && rank < 14) continue;
        if (seller.rep > buyer.rep + 20) continue;
        fee = askingPrice(g, p, buyer.id, idx);
        if (fee > buyer.transferBudget) continue;
      } else if (o < best - 4) continue;
      const s = o + (p.age <= 24 ? 2 : 0) - (p.age >= 30 ? 2 : 0) + D.rand() * 2;
      if (s > pickScore) {
        pickScore = s;
        pickP = p;
        pickFee = fee;
      }
    }
    if (!pickP) continue;
    const from = pickP.clubId;
    const fee = from == null ? 0 : D.roundMoney(pickFee * (0.94 + D.rand() * 0.14));
    const fromName = from == null ? null : D.getClub(g, from).name;
    D.move(g, pickP, buyer.id, fee, D.wageDemand(g, pickP, buyer), D.randInt(2, 5));
    idxMove(idx, pickP, from, buyer.id);
    const notable = fee >= 15e6 || (userLeague && buyer.leagueId === userLeague && fee >= 4e6);
    if (notable && news < (mode === "summer" ? 6 : 3)) {
      news++;
      D.inbox(
        g,
        "general",
        T(`${fee >= 15e6 ? "Dev transfer" : "Transfer"}: ${D.fullName(pickP)}`, `${fee >= 15e6 ? "Big transfer" : "Transfer"}: ${D.fullName(pickP)}`),
        T(`${D.fullName(pickP)}, ${fromName} kulübünden ${buyer.name}'a ${D.money(fee)} bedelle transfer oldu.`, `${D.fullName(pickP)} moved from ${fromName} to ${buyer.name} for ${D.money(fee)}.`),
      );
    }
    const sq = idx.get(buyer.id) || [];
    if (sq.length > 27) {
      const w = [...sq].sort((a, b) => D.ovr(a) - D.ovr(b))[0];
      if (w && !w.loan) {
        buyer.tactic.xi = buyer.tactic.xi.map((x) => (x === w.id ? null : x));
        buyer.tactic.bench = buyer.tactic.bench.filter((x) => x !== w.id);
        idxMove(idx, w, buyer.id, null);
        w.clubId = null;
        w.contractEnd = g.season;
      }
    }
  }
  aiLoans(g, mode, idx, userLeague);
  if (g.clubId != null) aiLoanRequests(g, idx);
  void c;
}

function aiLoans(g, mode, idx, userLeague) {
  const tries = mode === "summer" ? 60 : g.week === 4 || g.week === 22 ? 14 : 7;
  const parents = g.clubs.filter((x) => x.id !== g.clubId && x.rep >= 58);
  let news = 0;
  for (let k = 0; k < tries; k++) {
    const parent = D.pick(parents);
    const list = idx.get(parent.id) || [];
    if (list.length < 23) continue;
    const sorted = [...list].sort((a, b) => D.ovr(b) - D.ovr(a));
    const cands = sorted.slice(15).filter((p) => !p.loan && p.age <= 23 && p.injury === 0);
    if (!cands.length) continue;
    const p = D.pick(cands);
    const o = D.ovr(p);
    let best = null;
    let bs = -1;
    for (let n = 0; n < 40; n++) {
      const b = D.pick(g.clubs);
      if (b.id === parent.id || b.id === g.clubId || b.rep > parent.rep - 4) continue;
      const bl = idx.get(b.id) || [];
      if (bl.length >= 27) continue;
      if (rankAtPos(bl, p) >= 2) continue;
      if (o < strengthOf(bl) - 8) continue;
      const s = b.rep + D.rand() * 8 + (b.leagueId === parent.leagueId ? 4 : 0);
      if (s > bs) (bs = s), (best = b);
    }
    if (!best) continue;
    doLoan(g, p, best.id, { share: clamp(Math.round((0.5 + D.rand() * 0.5) * 4) / 4, 0.5, 1), fee: 0, option: null, half: mode !== "summer" && g.week < 19 && D.rand() < 0.3 });
    idxMove(idx, p, parent.id, best.id);
    if (userLeague && (best.leagueId === userLeague || parent.leagueId === userLeague) && o >= 70 && news < 2) {
      news++;
      D.inbox(g, "general", T(`Kiralık: ${D.fullName(p)}`, `Loan: ${D.fullName(p)}`), T(`${D.fullName(p)}, ${parent.name} kulübünden ${best.name}'a kiralandı.`, `${D.fullName(p)} joined ${best.name} on loan from ${parent.name}.`));
    }
  }
}

function aiLoanRequests(g, idx) {
  if (!D.windowOpen(g)) return;
  const c = ensure(g);
  c.loanOffers = c.loanOffers.filter((o) => seasonKey(g) - o.at <= 2 && g.players[o.pid]?.clubId === g.clubId && !g.players[o.pid]?.loan);
  const mine = idx.get(g.clubId) || [];
  const sorted = [...mine].sort((a, b) => D.ovr(b) - D.ovr(a));
  const me = D.getClub(g, g.clubId);
  for (const p of sorted.slice(15)) {
    if (p.loan || p.age > 23 || c.loanOffers.some((o) => o.pid === p.id)) continue;
    if (!D.chance(p.loanListed ? 0.45 : 0.04)) continue;
    const offers = loanOutOffers(g, p.id);
    const o = offers[0];
    if (!o) continue;
    const club = D.getClub(g, o.club);
    c.loanOffers.push({ id: c.nextLoanOfferId++, pid: p.id, at: seasonKey(g), ...o });
    D.inbox(
      g,
      "transfer",
      T(`Kiralık teklifi: ${D.fullName(p)}`, `Loan offer: ${D.fullName(p)}`),
      T(`${club.name}, ${D.fullName(p)} oyuncusunu kiralamak istiyor (${o.role === "starter" ? "ilk 11 garantisi" : "rotasyon"}). Transferler > Kiralık bölümünden yanıtlayın.`, `${club.name} want ${D.fullName(p)} on loan (${o.role === "starter" ? "first-team football" : "rotation"}). Reply in Transfers > Loans.`),
    );
  }
  void me;
}

/* ======================================================= week & season */

export function weekly(g) {
  const c = ensure(g);
  for (const p of Object.values(g.players)) {
    const l = p.loan;
    if (l && l.until.season === g.season && l.until.week <= 38 && g.week >= l.until.week) endLoan(g, p, false);
    const a = p.ceAddon;
    if (a && p.clubId === a.payer && p.careerApps - a.base >= a.need) {
      const payer = D.getClub(g, a.payer);
      const rc = D.getClub(g, a.club);
      if (payer && rc) {
        payer.balance -= a.amount;
        rc.balance += a.amount;
        if (isUser(g, payer.id)) {
          g.finance.purchases += a.amount;
          D.inbox(g, "transfer", T("Transfer bonusu ödendi", "Add-on paid"), T(`${D.fullName(p)} ${a.need} maça ulaştı; ${rc.name} kulübüne ${D.money(a.amount)} bonus ödendi.`, `${D.fullName(p)} reached ${a.need} games; ${D.money(a.amount)} paid to ${rc.name}.`));
        }
        if (isUser(g, rc.id)) g.finance.sales += a.amount;
      }
      delete p.ceAddon;
    } else if (a && p.clubId !== a.payer) delete p.ceAddon;
  }
  aiMarket(g, "week");
  ffpWarn(g);
  void c;
}

/* ================================================= financial fair play */
// A club whose balance (kasa) is still negative when the season ends starts the next
// season with a points deduction. The deduction scales with the size of the debt and is
// harsher for repeat offenders. The user is warned during the season while in the red.

/** Points deducted for a season-end debt (positive number) and earlier offences. */
export function ffpPoints(debt, offences = 0) {
  if (!(debt > 0)) return 0;
  const base = debt < 10e6 ? 3 : debt < 30e6 ? 6 : debt < 75e6 ? 9 : 12;
  return Math.min(15, base + (offences > 0 ? 3 : 0));
}

/** Points deducted from a club in the given season (0 when none). */
export function penaltyFor(g, clubId, season = g.season) {
  return (g.ce && g.ce.pen && g.ce.pen[season] && g.ce.pen[season][clubId]) || 0;
}

/** Applies points deductions to a league table being built (Map or array of rows). */
export function applyPenalties(g, rows) {
  const list = rows instanceof Map ? [...rows.values()] : rows;
  for (const r of list) {
    const d = penaltyFor(g, r.clubId);
    if (d) {
      r.pts -= d;
      r.ded = d;
    }
  }
  return rows;
}

function ffpWarn(g) {
  if (g.clubId == null) return;
  const me = D.getClub(g, g.clubId);
  if (!me || !(me.balance < 0)) return;
  const c = ensure(g);
  const w = (c.ffpWarn ??= {});
  const k = String(g.season);
  const last = w[k];
  if (last != null && g.week - last < 8) return;
  w[k] = g.week;
  const pts = ffpPoints(-me.balance, c.ffpOffences || 0);
  D.inbox(
    g,
    "board",
    T("Mali uyarı: kasa eksi", "Financial warning: balance negative"),
    T(
      `Kulübün kasası ${D.money(me.balance)}. Sezon sonuna kadar kasa artıya geçmezse Finansal Fair Play kuralları gereği gelecek sezona ${pts} puan silinerek başlayacağız. Oyuncu satarak ya da maaşları düşürerek kasayı düzeltebilirsin.`,
      `The club balance is ${D.money(me.balance)}. If it is still negative at the end of the season, financial fair play rules will deduct ${pts} points from us next season. Sell players or cut wages to fix it.`,
    ),
  );
}

export function ffpSeasonEnd(g) {
  if (g.clubId == null) return;
  const me = D.getClub(g, g.clubId);
  if (!me) return;
  const c = ensure(g);
  if (!(me.balance < 0)) return;
  const pts = ffpPoints(-me.balance, c.ffpOffences || 0);
  const next = g.season + 1;
  c.pen ??= {};
  c.pen[next] ??= {};
  c.pen[next][me.id] = pts;
  c.ffpOffences = (c.ffpOffences || 0) + 1;
  for (const s of Object.keys(c.pen)) if (+s < g.season) delete c.pen[s];
  D.inbox(
    g,
    "board",
    T(`Finansal Fair Play ihlali: -${pts} puan`, `Financial fair play breach: -${pts} points`),
    T(
      `Sezonu ${D.money(me.balance)} borçla kapattık. Federasyon ${next}-${String(next + 1).slice(-2)} sezonunda ${me.name} kulübünden ${pts} puan silme cezası verdi; yeni sezona ${-pts} puanla başlayacağız.${c.ffpOffences > 1 ? " Tekrarlanan ihlal nedeniyle ceza ağırlaştırıldı." : ""}`,
      `We ended the season ${D.money(me.balance)} in debt. The federation deducted ${pts} points from ${me.name} for the ${next}/${String(next + 1).slice(-2)} season; we start on ${-pts} points.${c.ffpOffences > 1 ? " The penalty was increased for a repeat breach." : ""}`,
    ),
  );
}

/** Season end (before players age): returns loans, AI options, potential changes. */
export function seasonEnd(g) {
  ffpSeasonEnd(g);
  for (const p of Object.values(g.players)) {
    const l = p.loan;
    if (l) {
      const to = D.getClub(g, l.to);
      const avg = p.stats.apps ? p.stats.ratingSum / p.stats.apps : 0;
      if (l.option && !isUser(g, l.to) && to && avg >= 6.9 && p.stats.apps >= 15 && to.transferBudget >= l.option && D.chance(0.6)) {
        const fee = l.option;
        p.clubId = l.from;
        delete p.loan;
        D.move(g, p, to.id, fee, D.wageDemand(g, p, to), D.randInt(2, 4));
        if (isUser(g, l.from))
          D.inbox(g, "transfer", T(`${D.fullName(p)} opsiyonla satıldı`, `${D.fullName(p)} bought outright`), T(`${to.name}, ${D.fullName(p)} için satın alma opsiyonunu kullandı. ${D.money(fee)} kasamıza girdi.`, `${to.name} exercised the option to buy ${D.fullName(p)}. We receive ${D.money(fee)}.`));
        continue;
      }
      endLoan(g, p, false);
    }
  }
  for (const p of Object.values(g.players)) yearEnd(g, p);
  // club stature is sticky: reputations drift back towards their historic level
  baseReps(g);
  for (const c of g.clubs) c.rep = clamp(Math.round(c.rep + (c.ceRep0 - c.rep) * 0.3), 1, 99);
  for (const k of Object.keys(ensure(g).neg)) delete g.ce.neg[k];
  g.ce.loanOffers = [];
}

/** After the new season was set up: instalments fall due. */
export function seasonStart(g) {
  const c = ensure(g);
  const due = c.payments.filter((x) => x.season <= g.season);
  c.payments = c.payments.filter((x) => x.season > g.season);
  for (const x of due) {
    const a = D.getClub(g, x.from);
    const b = D.getClub(g, x.to);
    if (!a || !b) continue;
    a.balance -= x.amount;
    a.transferBudget = Math.max(0, a.transferBudget - x.amount);
    b.balance += x.amount;
    if (isUser(g, a.id))
      D.inbox(g, "transfer", T("Transfer taksiti ödendi", "Transfer instalment paid"), T(`${x.name} transferi için ${b.name} kulübüne ${D.money(x.amount)} taksit ödendi.`, `${D.money(x.amount)} instalment paid to ${b.name} for ${x.name}.`));
  }
}

/* ===================================================== development */

const FOCUS = { attack: ["sho", "dri"], defense: ["def", "phy"], physical: ["pac", "phy"], technical: ["pas", "dri"], goalkeeping: ["gk"] };
function growthRate(age) {
  return age <= 17 ? 6 : age === 18 ? 5.4 : age === 19 ? 4.8 : age === 20 ? 4.1 : age === 21 ? 3.4 : age === 22 ? 2.7 : age === 23 ? 2.1 : age === 24 ? 1.5 : age === 25 ? 1 : age === 26 ? 0.6 : age === 27 ? 0.35 : age === 28 ? 0.15 : 0;
}
function declineRate(age, pos) {
  const a = pos === "GK" ? age - 2 : age;
  return a <= 28 ? 0 : a === 29 ? 0.25 : a === 30 ? 0.6 : a === 31 ? 1 : a === 32 ? 1.6 : a === 33 ? 2.3 : a === 34 ? 3 : 4;
}

/** Weekly development (replaces the bundle's Dc). */
export function develop(g, p, isMine) {
  const o = D.ovr(p);
  const w = D.posWeights[p.pos];
  const tot = Object.values(w).reduce((a, b) => a + b, 0);
  const ratio = clamp(p.stats.apps / Math.max(1, (g.week || 1) * 0.9), 0, 1);
  let pf = 0.55 + 0.7 * ratio;
  if (p.age <= 19) pf = Math.max(pf, 0.72);
  const train = isMine ? (g.training.intensity === "high" ? 1.18 : g.training.intensity === "low" ? 0.86 : 1) * D.trainMul(g, p) : 1;
  const indiv = 0.75 + hash01(p.id, 17) * 0.5;
  const gap = Math.max(0, p.pot - o);
  let annual = Math.min(gap, growthRate(p.age) * pf * train * indiv * clamp(0.55 + gap / 14, 0.55, 1.15));
  annual -= declineRate(p.age, p.pos) * (0.85 + hash01(p.id, 29) * 0.3) * (isMine && g.training.intensity === "high" ? 1.05 : 1);
  p.dvA = (p.dvA || 0) + annual / 38;
  const pickUp = () => {
    if (isMine && g.training.focus !== "balanced" && D.chance(0.6)) {
      const f = (FOCUS[g.training.focus] || []).filter((a) => (p.pos === "GK") === (a === "gk") || g.training.focus !== "goalkeeping");
      const ok = f.filter((a) => w[a]);
      if (ok.length) return D.pick(ok);
    }
    const keys = Object.keys(w);
    return D.weighted(keys, keys.map((k) => w[k]));
  };
  let guard = 0;
  while (p.dvA >= 0.12 && guard++ < 6) {
    const a = pickUp();
    if (p.attrs[a] >= 99) break;
    const share = (w[a] || 0.05) / tot;
    p.attrs[a] += 1;
    p.dvA -= share;
  }
  guard = 0;
  while (p.dvA <= -0.12 && guard++ < 6) {
    const keys = Object.keys(w);
    const a = D.weighted(keys, keys.map((k) => w[k] * (k === "pac" || k === "phy" ? 2.6 : k === "gk" ? 0.8 : 1)));
    if (p.attrs[a] <= 15) break;
    p.attrs[a] -= 1;
    p.dvA += (w[a] || 0.05) / tot;
  }
  if (p.dvA > 1.5) p.dvA = 1.5;
  if (p.dvA < -1.5) p.dvA = -1.5;
}

/** Potential re-evaluation once a year, from the finished season's playing time. */
export function yearEnd(g, p) {
  const o = D.ovr(p);
  if (p.age <= 23) {
    const apps = p.stats.apps;
    const avg = apps ? p.stats.ratingSum / apps : 0;
    if (apps >= 22 && avg >= 7) p.pot += D.randInt(1, 3);
    else if (apps >= 14 && avg >= 6.8) p.pot += D.randInt(0, 2);
    else if (apps <= 4 && p.age >= 19) p.pot -= D.randInt(0, 2);
    if (D.chance(0.04)) p.pot += D.randInt(3, 6);
    else if (D.chance(0.03)) p.pot -= D.randInt(2, 4);
  }
  p.pot = clamp(Math.round(p.pot), o, 95);
}

/* ============================================================ fitness */

const FAT = { GK: 0.03, CB: 0.27, LB: 0.37, RB: 0.37, DM: 0.34, CM: 0.37, AM: 0.35, LW: 0.38, RW: 0.38, ST: 0.33 };
/** Per-minute fitness loss for a player on the pitch. */
export function fatigue(g, ms, side, slot, p) {
  let f = FAT[slot.role] ?? 0.33;
  if (slot.role !== "GK") {
    f *= side.pressing === "high" ? 1.22 : side.pressing === "low" ? 0.88 : 1;
    f *= side.tempo === "fast" ? 1.08 : side.tempo === "slow" ? 0.93 : 1;
    f *= side.mentality === "allout" ? 1.07 : side.mentality === "attacking" ? 1.03 : side.mentality === "defensive" ? 0.95 : 1;
    f *= 1.32 - p.attrs.phy / 125;
    if (p.age >= 30) f *= 1 + (p.age - 29) * 0.03;
    if (ms.minute > 60) f *= 1.12;
    if ((ms.fit[p.id] ?? 100) < 55) f *= 0.82;
  }
  return f;
}
export function startFit(g, p) {
  if (p.ceLast === seasonKey(g)) return Math.min(100, p.fitness + 14 * recFactor(p));
  return p.fitness;
}
function recFactor(p) {
  const age = p.age <= 23 ? 1.08 : p.age <= 29 ? 1 : p.age <= 32 ? 0.92 : 0.84;
  return age * (0.85 + p.attrs.phy / 400);
}
/** Weekly recovery (replaces the flat +20). */
export function recover(g, p, mine) {
  const base = mine ? (g.training.intensity === "high" ? 22 : g.training.intensity === "low" ? 34 : 28) : 28;
  return Math.min(100, Math.round((p.fitness + base * recFactor(p)) * 10) / 10);
}
export function injuryMul(ms, side) {
  if (!side.lineup.length) return 1;
  const avg = side.lineup.reduce((a, l) => a + (ms.fit[l.pid] ?? 100), 0) / side.lineup.length;
  return 1 + Math.max(0, 82 - avg) / 30;
}
export function injuryPick(ms, side) {
  return D.weighted(side.lineup, side.lineup.map((l) => (l.role === "GK" ? 0.3 : 1) * (1 + Math.max(0, 78 - (ms.fit[l.pid] ?? 100)) / 9)));
}

/**
 * Picks who gets a yellow card. Players already on a booking play carefully,
 * so most of the time the card goes to someone else (fewer second-yellow reds).
 */
export function cardPick(ms, side, roleW) {
  const lineup = side.lineup;
  if (!lineup.length) return null;
  const w = (l) => (roleW?.[l.role] ?? 1);
  const pick = D.weighted(lineup, lineup.map(w));
  if (!(ms.yellow?.[pick.pid] >= 1) || !D.chance(0.75)) return pick;
  const clean = lineup.filter((l) => !(ms.yellow?.[l.pid] >= 1));
  return clean.length ? D.weighted(clean, clean.map(w)) : pick;
}

/* ========================================================== match pace */

/** Shot-rate multiplier by minute and game state. */
export function paceMul(ms, side, opp) {
  const n = ms.minute;
  let m = n <= 15 ? 0.9 : n <= 45 ? 1 : n <= 75 ? 1.06 : 1.16;
  const diff = side.goals - opp.goals;
  if (diff < 0 && n > 60) m *= 1.08 + Math.min(0.06, -diff * 0.03);
  if (diff > 0 && n > 70) m *= 0.92;
  if (diff >= 3) m *= diff >= 4 ? 0.5 : 0.62;
  else if (diff === 2 && n > 55) m *= 0.85;
  if (diff <= -3) m *= 0.85;
  return m;
}
export function subWindowOk(ms, side) {
  if (ms.minute === 45 || ms.minute === 0) return true;
  if (side.lastSubMin === ms.minute) return true;
  return (side.windows || 0) < 3;
}
export function subWindowUse(ms, side) {
  if (ms.minute === 45 || ms.minute === 0) return;
  if (side.lastSubMin === ms.minute) return;
  side.windows = (side.windows || 0) + 1;
  side.lastSubMin = ms.minute;
}
export const minuteLabel = (m) => (m > 90 ? `90+${m - 90}` : `${m}`);

/* ======================================================= domestic cups */

export const DCUPS = [
  { id: "TRC", name: T("Ziraat Türkiye Kupası", "Turkish Cup"), short: "ZTK", leagues: ["TR1", "TR2", "TR3A", "TR3B"], prize: { round: 3e5, win: 3e6 } },
  { id: "FAC", name: T("FA Cup", "FA Cup"), short: "FA", leagues: ["ENG1"], prize: { round: 1e6, win: 4e6 } },
  { id: "CDR", name: T("Copa del Rey", "Copa del Rey"), short: "CDR", leagues: ["ESP1"], prize: { round: 6e5, win: 3e6 } },
  { id: "CIT", name: T("Coppa Italia", "Coppa Italia"), short: "CI", leagues: ["ITA1"], prize: { round: 8e5, win: 4e6 } },
  { id: "DFB", name: T("DFB-Pokal", "DFB-Pokal"), short: "DFB", leagues: ["GER1"], prize: { round: 1e6, win: 4.5e6 } },
  { id: "CDF", name: T("Coupe de France", "Coupe de France"), short: "CDF", leagues: ["FRA1"], prize: { round: 4e5, win: 2e6 } },
  { id: "TDP", name: T("Taça de Portugal", "Taça de Portugal"), short: "TDP", leagues: ["POR1"], prize: { round: 2e5, win: 1.5e6 } },
  { id: "KNV", name: T("KNVB Beker", "KNVB Cup"), short: "KNVB", leagues: ["NED1"], prize: { round: 2e5, win: 1.5e6 } },
  { id: "BCU", name: T("Belçika Kupası", "Belgian Cup"), short: "BC", leagues: ["BEL1"], prize: { round: 1.5e5, win: 1.2e6 } },
  { id: "SCC", name: T("İskoçya Kupası", "Scottish Cup"), short: "SC", leagues: ["SCO1"], prize: { round: 1e5, win: 1e6 } },
  { id: "CDB", name: T("Copa do Brasil", "Copa do Brasil"), short: "CDB", leagues: ["BRA1"], prize: { round: 4e5, win: 4e6 } },
  { id: "CAR", name: T("Copa Argentina", "Copa Argentina"), short: "CA", leagues: ["ARG1"], prize: { round: 1.5e5, win: 1.2e6 } },
  { id: "KCC", name: T("Kral Kupası", "King's Cup"), short: "KC", leagues: ["KSA1"], prize: { round: 3e5, win: 3e6 } },
  { id: "USO", name: T("US Open Cup", "US Open Cup"), short: "USOC", leagues: ["USA1"], prize: { round: 1.5e5, win: 1.5e6 } },
];
const CUP_POOL = [3, 8, 13, 18, 24, 27, 30, 33, 36];
const CUP_SCHED = { 4: [13, 24, 30, 36], 5: [8, 13, 24, 30, 36], 6: [3, 8, 13, 24, 30, 36], 7: [3, 8, 13, 18, 24, 30, 36] };
export const STAGE_NAMES = {
  dpr: T("Ön eleme", "Preliminary round"),
  d64: T("Son 64 turu", "Round of 64"),
  d32: T("Son 32 turu", "Round of 32"),
  d16: T("Son 16 turu", "Round of 16"),
  dqf: T("Çeyrek final", "Quarter-final"),
  dsf: T("Yarı final", "Semi-final"),
  df: T("Final", "Final"),
};
const stageFor = (n) => (n >= 64 ? "d64" : n >= 32 ? "d32" : n >= 16 ? "d16" : n >= 8 ? "dqf" : n >= 4 ? "dsf" : "df");

function fixture(g, week, a, b, stage) {
  const c = ensure(g);
  const A = D.getClub(g, a);
  const B = D.getClub(g, b);
  const [home, away] = stage === "df" ? (D.rand() < 0.5 ? [a, b] : [b, a]) : A.rep <= B.rep ? [a, b] : [b, a];
  return { id: c.nextFid++, week, home, away, played: false, hg: 0, ag: 0, goals: [], stage };
}

function buildCup(g, def, fromWeek) {
  const ids = def.leagues.flatMap((lid) => g.leagues.find((l) => l.id === lid)?.clubIds ?? []);
  if (ids.length < 4) return null;
  const sorted = [...ids].sort((a, b) => D.getClub(g, b).rep - D.getClub(g, a).rep);
  const N = sorted.length;
  const P = 2 ** Math.floor(Math.log2(N));
  const prelimCount = N === P ? 0 : 2 * (N - P);
  const R = (prelimCount ? 1 : 0) + Math.log2(P);
  let weeks = CUP_SCHED[R] ? [...CUP_SCHED[R]] : CUP_POOL.slice(-R);
  if (fromWeek > 0) {
    weeks = weeks.filter((w) => w > fromWeek);
    if (weeks.length < R) {
      const pool = CUP_POOL.filter((w) => w > fromWeek);
      if (pool.length < R) return null;
      weeks = pool.slice(pool.length - R);
    }
  }
  const byes = prelimCount ? sorted.slice(0, N - prelimCount) : [];
  const first = prelimCount ? sorted.slice(N - prelimCount) : sorted;
  const cup = {
    id: def.id,
    name: def.name,
    short: def.short,
    domestic: true,
    clubIds: [...sorted],
    fixtures: [],
    alive: [...sorted],
    byes,
    weeks,
    round: 0,
    prize: { entry: 0, win: 0, draw: 0, round: 0 },
    dprize: def.prize,
  };
  const pool = D.shuffle([...first]);
  const stage = prelimCount ? "dpr" : stageFor(pool.length);
  for (let i = 0; i + 1 < pool.length; i += 2) cup.fixtures.push(fixture(g, weeks[0], pool[i], pool[i + 1], stage));
  return cup;
}

function baseReps(g) {
  for (const c of g.clubs) c.ceRep0 ??= c.rep;
}

/** Appends the domestic cups to game.cups (called after European cups are drawn). */
export function createCups(g, fromWeek = 0) {
  ensure(g);
  baseReps(g);
  g.cups = (g.cups ?? []).filter((c) => !c.domestic);
  for (const def of DCUPS) {
    const cup = buildCup(g, def, fromWeek);
    if (cup) {
      g.cups.push(cup);
      if (g.clubId != null && cup.clubIds.includes(g.clubId)) {
        const f = cup.fixtures.find((x) => x.home === g.clubId || x.away === g.clubId);
        if (f) {
          const opp = D.getClub(g, f.home === g.clubId ? f.away : f.home);
          D.inbox(g, "match", T(`${def.name.tr}: kura çekildi`, `${def.name.en}: draw made`), T(`${STAGE_NAMES[f.stage].tr} rakibimiz ${opp.name} (Hafta ${f.week}).`, `${STAGE_NAMES[f.stage].en}: we face ${opp.name} (week ${f.week}).`));
        } else
          D.inbox(g, "match", T(`${def.name.tr}`, `${def.name.en}`), T(`Kupaya üst turdan (bay geçerek) başlayacağız. İlk maçımız Hafta ${cup.weeks[1] ?? cup.weeks[0]}.`, `We enter in a later round (bye). First tie in week ${cup.weeks[1] ?? cup.weeks[0]}.`));
      }
    }
  }
}

/** Old saves: add this season's cups if there is still time. */
export function migrate(g) {
  ensure(g);
  if (!(g.cups ?? []).some((c) => c.domestic) && g.phase !== "ended") createCups(g, g.phase === "season" ? g.week : 0);
}

/** Advances domestic cups after a match week (called from the bundle's Yo). */
export function cupsWeek(g, week) {
  for (const cup of g.cups ?? []) {
    if (!cup.domestic) continue;
    const ties = cup.fixtures.filter((f) => f.week === week && f.played);
    if (!ties.length) continue;
    const stage = ties[0].stage;
    const winners = ties.map(D.koWinner);
    const pay = (id, amt) => {
      const club = D.getClub(g, id);
      club.balance += amt;
      if (isUser(g, id)) g.finance.prize += amt;
    };
    for (const w of winners) pay(w, cup.dprize.round);
    const userTie = g.clubId == null ? null : ties.find((f) => f.home === g.clubId || f.away === g.clubId);
    if (stage === "df") {
      cup.winner = winners[0];
      cup.alive = [winners[0]];
      pay(winners[0], cup.dprize.win);
      const wc = D.getClub(g, winners[0]);
      wc.rep = Math.min(99, wc.rep + 2);
      if (userTie)
        D.inbox(
          g,
          "match",
          winners[0] === g.clubId ? T(`🏆 ${cup.name.tr} şampiyonu olduk!`, `🏆 We won the ${cup.name.en}!`) : T(`${cup.name.tr} finalini kaybettik`, `${cup.name.en} final lost`),
          winners[0] === g.clubId ? T(`Kupayı kaldırdık! ${D.money(cup.dprize.win)} ödül kasaya girdi.`, `We lifted the trophy! ${D.money(cup.dprize.win)} prize money.`) : T(`Finalde ${wc.name} kupayı kazandı.`, `${wc.name} won the final.`),
        );
      continue;
    }
    let next = [...winners];
    if (stage === "dpr") next = [...cup.byes, ...winners];
    cup.alive = next;
    cup.round++;
    const wk = cup.weeks[cup.round] ?? week + 3;
    const pool = D.shuffle([...next]);
    const ns = stageFor(pool.length);
    for (let i = 0; i + 1 < pool.length; i += 2) cup.fixtures.push(fixture(g, wk, pool[i], pool[i + 1], ns));
    if (g.clubId != null && cup.clubIds.includes(g.clubId)) {
      if (userTie && D.koWinner(userTie) !== g.clubId)
        D.inbox(g, "match", T(`${cup.name.tr}: elendik`, `${cup.name.en}: knocked out`), T(`${STAGE_NAMES[stage].tr} turunda kupaya veda ettik.`, `We went out in the ${STAGE_NAMES[stage].en.toLowerCase()}.`));
      const f = cup.fixtures.find((x) => x.week === wk && (x.home === g.clubId || x.away === g.clubId));
      if (f) {
        const opp = D.getClub(g, f.home === g.clubId ? f.away : f.home);
        D.inbox(g, "match", T(`${cup.name.tr}: ${STAGE_NAMES[ns].tr} kurası`, `${cup.name.en}: ${STAGE_NAMES[ns].en} draw`), T(`Rakibimiz ${opp.name}. Maç ${wk}. haftada, ${f.home === g.clubId ? "kendi sahamızda" : "deplasmanda"}.`, `We face ${opp.name} in week ${wk}, ${f.home === g.clubId ? "at home" : "away"}.`));
      }
    }
  }
}

/* ================================================================= UI */

export function createUI() {
  const { React, useGame, useI18n, Button, toast, ClubBadge, OvrBadge, PosBadge, FitBar, MoneyField, fmtShort, parseMoney, Tabs, TabsList, TabsTrigger, TabsContent, FixtureRow, EmptyState, posName, formations } = D.ui;
  const h = React.createElement;
  const { useState, useMemo } = React;
  const cx = (...a) => a.filter(Boolean).join(" ");
  const Fit = ({ value }) => {
    const { L } = useI18n();
    const v = Math.round(clamp(value ?? 100, 0, 100));
    return h(
      React.Fragment,
      null,
      h("span", { className: "ce-fit", "aria-hidden": "true" }, h("i", { className: v >= 80 ? "is-good" : v >= 65 ? "is-warn" : "is-bad", style: { width: `${v}%` } })),
      h("span", { className: cx("ce-fit-n", v < 65 && "ce-tone-bad") }, L(`%${v}`, `${v}%`)),
    );
  };

  const Seg = ({ value, onChange, opts, small }) =>
    h(
      "div",
      { className: "ce-seg", role: "group" },
      opts.map(([v, label]) =>
        h("button", { key: String(v), type: "button", className: cx("ce-seg-b", value === v && "is-on", small && "is-sm"), "aria-pressed": value === v, onClick: () => onChange(v) }, label),
      ),
    );
  const KV = ({ k, v, tone }) => h("div", { className: "ce-kv" }, h("span", null, k), h("b", { className: tone ? `ce-tone-${tone}` : undefined }, v));
  const Pat = ({ n, max }) =>
    h("span", { className: "ce-pat", "aria-label": `${n}/${max}` }, Array.from({ length: max }, (_, i) => h("i", { key: i, className: i < n ? "is-on" : "" })));

  /* ---------------- negotiation ---------------- */
  function Negotiation({ pid, onBack, onDone }) {
    const { game: g, act } = useGame();
    const { L, tt } = useI18n();
    const p = g.players[pid];
    const s = negState(g, pid);
    const me = D.getClub(g, g.clubId);
    const seller = p?.clubId == null ? null : D.getClub(g, p.clubId);
    const mv = D.value(p, g.season);
    const f = fame(g, p);
    const [fee, setFee] = useState(() => fmtShort(s?.agreed?.fee ?? Math.round((s?.ask ?? mv) * 0.92)));
    const [inst, setInst] = useState(1);
    const [addonPct, setAddonPct] = useState(0);
    const [sellOn, setSellOn] = useState(0);
    const [swap, setSwap] = useState("");
    const [msg, setMsg] = useState(null);
    const [role, setRoleRaw] = useState(() => (p && p.age <= 21 ? "prospect" : "starter"));
    const demandFor = (r) => {
      if (!s?.agreed) return "";
      const d = playerDemand(g, pid, r, s.agreed.fee);
      return d.refuse ? "" : fmtShort(d.wage);
    };
    const [wage, setWage] = useState(() => demandFor(p && p.age <= 21 ? "prospect" : "starter"));
    const setRole = (r) => {
      setRoleRaw(r);
      const w = demandFor(r);
      if (w) setWage(w);
    };
    const [years, setYears] = useState(p && p.age >= 31 ? 2 : 4);
    const [bonus, setBonus] = useState("0");
    if (!p || !s || !seller) return null;
    const feeN = parseMoney(fee);
    const offer = { fee: Number.isFinite(feeN) ? feeN : 0, inst, addon: Math.round(((Number.isFinite(feeN) ? feeN : 0) * addonPct) / 100), sellOn, swap: swap === "" ? null : Number(swap) };
    const val = offerValue(g, p, offer);
    const mySquad = D.clubPlayers(g, g.clubId).filter((x) => !x.loan).sort((a, b) => D.ovr(b) - D.ovr(a));
    const mood = s.broken ? "bad" : s.patience / s.max > 0.66 ? "good" : s.patience / s.max > 0.34 ? "warn" : "bad";

    function send() {
      setMsg(null);
      const r = act((gg) => submitOffer(gg, pid, offer));
      setMsg({ tone: r.kind === "accept" ? "good" : r.kind === "counter" ? "warn" : "bad", text: tt(r.msg) });
      if (r.kind === "accept") {
        const d = playerDemand(g, pid, role, offer.fee);
        if (!d.refuse) setWage(fmtShort(d.wage));
        toast.success(L("Kulüpler anlaştı!", "Clubs agreed!"));
      } else if (r.kind === "counter") setFee(fmtShort(r.ask));
    }

    if (s.agreed) {
      const a = s.agreed;
      const dem = playerDemand(g, pid, role, a.fee);
      const wN = parseMoney(wage);
      const bN = parseMoney(bonus);
      const t = { role, wage: Number.isFinite(wN) ? wN : 0, years, bonus: Number.isFinite(bN) ? bN : 0 };
      const acc = dem.refuse ? null : termsAccepted(dem, t, p);
      const cost = upfrontOf(a) + (t.bonus || 0) + (dem.agent || 0);
      function sign() {
        const r = act((gg) => completeTransfer(gg, pid, t));
        if (r.ok) {
          toast.success(tt(r.msg));
          onDone?.();
        } else {
          setMsg({ tone: "bad", text: tt(r.msg) });
          if (r.need) setWage(fmtShort(r.need));
          if (r.walked) onBack?.();
        }
      }
      return h(
        "div",
        { className: "ce-box" },
        h("p", { className: "ce-h" }, "✅ ", L("Bonservis anlaşması", "Fee agreed"), " · ", D.money(a.fee), a.inst > 1 ? ` · ${a.inst} ${L("taksit", "instalments")}` : ""),
        h("p", { className: "ce-sub" }, L(`Şimdi ${D.fullName(p)} ile kişisel şartlar. Oyuncuya vereceğiniz rol maaş beklentisini değiştirir.`, `Now personal terms with ${D.fullName(p)}. The squad role you promise changes his demands.`)),
        h("div", { className: "ce-field" }, h("span", { className: "ce-lbl" }, L("Kadro rolü", "Squad role")), h(Seg, { value: role, onChange: setRole, small: true, opts: ROLES.map((r) => [r.id, L(r.tr, r.en)]) })),
        dem.refuse
          ? h("p", { className: "ce-msg ce-tone-bad" }, tt(dem.refuse))
          : h(
              React.Fragment,
              null,
              h(MoneyField, { id: "ce-wage", label: L("Haftalık maaş (€)", "Weekly wage (€)"), value: wage, onChange: setWage, hint: L(`Oyuncunun beklentisi ≈ ${D.money(dem.wage)}/hafta · Şu anki maaşı ${D.money(p.wage)}`, `He expects ≈ ${D.money(dem.wage)}/wk · Current ${D.money(p.wage)}`) }),
              h("div", { className: "ce-field" }, h("span", { className: "ce-lbl" }, L("Sözleşme süresi", "Contract length")), h(Seg, { value: years, onChange: setYears, opts: [1, 2, 3, 4, 5].map((y) => [y, L(`${y} yıl`, `${y}y`)]) })),
              h(MoneyField, { id: "ce-bonus", label: L("İmza parası (€, tek seferlik)", "Signing bonus (€, one-off)"), value: bonus, onChange: setBonus, hint: L("İmza parası, haftalık maaş talebini düşürür.", "A signing bonus lowers the weekly wage he needs.") }),
              h(
                "div",
                { className: "ce-kvs" },
                h(KV, { k: L("Menajer komisyonu", "Agent fee"), v: D.money(dem.agent) }),
                h(KV, { k: L("Şimdi ödenecek toplam", "Due now"), v: D.money(cost), tone: cost > me.balance ? "warn" : undefined }),
                h(KV, { k: L("Kasa (sezon sonu eksi = puan cezası)", "Balance (negative at season end = points deduction)"), v: D.money(me.balance), tone: me.balance - cost < 0 ? "bad" : undefined }),
                acc && h(KV, { k: L("Oyuncunun tepkisi", "Player's reaction"), v: acc.ok ? L("Olumlu 👍", "Positive 👍") : L("Yetersiz", "Not enough"), tone: acc.ok ? "good" : "warn" }),
              ),
            ),
        msg && h("p", { className: `ce-msg ce-tone-${msg.tone}`, role: "alert" }, msg.text),
        h("div", { className: "ce-actions" }, h(Button, { variant: "ghost", onClick: onBack }, L("Geri", "Back")), h(Button, { onClick: sign, disabled: !!dem.refuse }, L("Sözleşmeyi İmzala", "Sign Contract"))),
      );
    }

    return h(
      "div",
      { className: "ce-box" },
      h(
        "div",
        { className: "ce-row" },
        h(ClubBadge, { club: seller, size: "sm" }),
        h("p", { className: "ce-h", style: { flex: 1 } }, L(`${seller.name} ile pazarlık`, `Talks with ${seller.name}`)),
        h("span", { className: `ce-pill ce-tone-${mood}` }, s.broken ? L("Görüşme bitti", "Talks over") : L("Sabır", "Patience"), " ", !s.broken && h(Pat, { n: Math.max(0, s.patience), max: s.max })),
      ),
      s.nfs && !s.broken && h("p", { className: "ce-msg ce-tone-warn" }, L("Kulüp bu oyuncuyu satmak istemiyor. Fikrini ancak çok yüksek bir teklif değiştirebilir.", "The club doesn't want to sell. Only a huge offer may change their mind.")),
      h(
        "div",
        { className: "ce-kvs" },
        h(KV, { k: L("Piyasa değeri", "Market value"), v: D.money(mv) }),
        h(KV, { k: L("Tanınırlık", "Fame"), v: `${tt(fameLabel(f))} · %${Math.round(f * 100)}` }),
        h(KV, { k: s.round ? L("Kulübün son talebi", "Club's latest ask") : L("Kulübün beklentisi", "Club expects"), v: `≈ ${D.money(s.ask)}`, tone: "warn" }),
        h(KV, { k: L("Kasa (sezon sonu eksi = puan cezası)", "Balance (negative at season end = points deduction)"), v: D.money(me.balance), tone: me.balance < 0 ? "bad" : undefined }),
      ),
      s.broken
        ? h("p", { className: "ce-msg ce-tone-bad" }, L("Kulüp bu transfer döneminde görüşmeyi reddediyor.", "The club refuses to talk this window."))
        : h(
            React.Fragment,
            null,
            h(MoneyField, {
              id: "ce-fee",
              label: L("Toplam bonservis (€)", "Total fee (€)"),
              value: fee,
              onChange: setFee,
              presets: [
                { label: L("Piyasa değeri", "Value"), value: mv },
                { label: L("Talep", "Ask"), value: s.ask },
                { label: "-10%", value: Math.round(s.ask * 0.9) },
              ],
            }),
            h("div", { className: "ce-field" }, h("span", { className: "ce-lbl" }, L("Ödeme planı", "Payment plan")), h(Seg, { value: inst, onChange: setInst, opts: [[1, L("Peşin", "Upfront")], [2, L("2 taksit", "2 seasons")], [3, L("3 taksit", "3 seasons")]] }), h("span", { className: "ce-hint" }, L(`Bu sezon ödenecek: ${D.money(upfrontOf(offer))}. Taksit, kulübün gözünde teklifin değerini biraz düşürür.`, `Due this season: ${D.money(upfrontOf(offer))}. Instalments make the bid slightly less attractive.`))),
            h("div", { className: "ce-field" }, h("span", { className: "ce-lbl" }, L("Performans bonusu (25 maç sonrası)", "Add-on (after 25 games)")), h(Seg, { value: addonPct, onChange: setAddonPct, small: true, opts: [[0, L("Yok", "None")], [10, "+10%"], [20, "+20%"], [30, "+30%"]] })),
            h("div", { className: "ce-field" }, h("span", { className: "ce-lbl" }, L("Sonraki satıştan pay", "Sell-on clause")), h(Seg, { value: sellOn, onChange: setSellOn, small: true, opts: [[0, "%0"], [10, "%10"], [20, "%20"], [30, "%30"]] })),
            h(
              "label",
              { className: "ce-field" },
              h("span", { className: "ce-lbl" }, L("Takas oyuncusu (isteğe bağlı)", "Swap player (optional)")),
              h(
                "select",
                { className: "ce-select", value: swap, onChange: (e) => setSwap(e.target.value) },
                h("option", { value: "" }, L("— Takas yok —", "— No swap —")),
                mySquad.map((x) => h("option", { key: x.id, value: String(x.id) }, `${tt(posName[x.pos])} · ${D.shortName(x)} (${D.ovr(x)}) · ${D.money(D.value(x, g.season))}`)),
              ),
              swap !== "" && h("span", { className: "ce-hint" }, L(`Kulüp takas oyuncusunu ≈ ${D.money(swapValue(g, g.players[Number(swap)], seller.id))} değerinde görüyor.`, `The club values the swap at ≈ ${D.money(swapValue(g, g.players[Number(swap)], seller.id))}.`)),
            ),
            h("div", { className: "ce-meter" }, h("span", null, L("Teklifin kulübe göre değeri", "Offer value to the club")), h("b", null, D.money(val)), h("i", { style: { width: `${clamp((val / Math.max(1, s.ask)) * 100, 0, 100)}%` }, className: val >= s.ask * 0.95 ? "is-good" : val >= s.ask * 0.8 ? "is-warn" : "is-bad" })),
          ),
      msg && h("p", { className: `ce-msg ce-tone-${msg.tone}`, role: "alert" }, msg.text),
      s.hist.length > 0 &&
        h(
          "ol",
          { className: "ce-hist" },
          [...s.hist].reverse().map((x) =>
            h(
              "li",
              { key: x.round },
              h("span", null, L(`Tur ${x.round}`, `Round ${x.round}`)),
              h("span", null, D.money(x.fee), x.inst > 1 ? ` (${x.inst}x)` : "", x.addon ? ` +${D.money(x.addon)}` : "", x.sellOn ? ` · %${x.sellOn}` : "", x.swap != null ? ` + ${L("takas", "swap")}` : ""),
              h("b", { className: `ce-tone-${x.kind === "accept" ? "good" : x.kind === "counter" ? "warn" : "bad"}` }, { accept: L("Kabul", "Accepted"), counter: L(`Karşı: ${D.money(x.ask)}`, `Counter: ${D.money(x.ask)}`), low: L("Düşük", "Too low"), insult: L("Hakaret", "Insult"), broken: L("Kesildi", "Ended") }[x.kind]),
            ),
          ),
        ),
      h("div", { className: "ce-actions" }, h(Button, { variant: "ghost", onClick: onBack }, L("Geri", "Back")), !s.broken && h(Button, { onClick: send }, L("Teklifi Gönder", "Submit Offer"))),
    );
  }

  /* ---------------- loan in ---------------- */
  function LoanIn({ pid, onBack, onDone }) {
    const { game: g, act } = useGame();
    const { L, tt } = useI18n();
    const q = loanInQuote(g, pid);
    const [share, setShare] = useState(q.ok ? q.minShare : 1);
    const [half, setHalf] = useState(false);
    const [option, setOption] = useState(false);
    const [fee, setFee] = useState(() => fmtShort(q.ok ? q.fee : 0));
    const [msg, setMsg] = useState(null);
    const p = g.players[pid];
    if (!q.ok) return h("div", { className: "ce-box" }, h("p", { className: "ce-msg ce-tone-bad" }, tt(q.reason)), h("div", { className: "ce-actions" }, h(Button, { variant: "ghost", onClick: onBack }, L("Geri", "Back"))));
    const feeN = parseMoney(fee);
    const offer = { share, half, option, fee: Number.isFinite(feeN) ? feeN : 0 };
    const need = loanInNeed(q, offer);
    const weeks = half ? 19 : 38;
    function send() {
      const r = act((gg) => requestLoanIn(gg, pid, offer));
      if (r.ok) {
        toast.success(tt(r.msg));
        onDone?.();
      } else {
        setMsg(tt(r.msg));
        if (r.need) setFee(fmtShort(r.need));
      }
    }
    return h(
      "div",
      { className: "ce-box" },
      h("div", { className: "ce-row" }, h(ClubBadge, { club: q.parent, size: "sm" }), h("p", { className: "ce-h", style: { flex: 1 } }, L(`${q.parent.name} ile kiralık görüşmesi`, `Loan talks with ${q.parent.name}`))),
      h("div", { className: "ce-field" }, h("span", { className: "ce-lbl" }, L("Süre", "Length")), h(Seg, { value: half, onChange: setHalf, opts: [[false, L("Sezon sonuna kadar", "Until season end")], [true, L("Devre arasına kadar", "Until mid-season")]] })),
      h("div", { className: "ce-field" }, h("span", { className: "ce-lbl" }, L("Maaşın ne kadarını ödeyeceğiz?", "Wage share we pay")), h(Seg, { value: share, onChange: setShare, opts: [[0.5, "%50"], [0.75, "%75"], [1, "%100"]] }), h("span", { className: "ce-hint" }, L(`Haftalık ${D.money(Math.round(p.wage * share))} · ${weeks} haftada ≈ ${D.money(Math.round(p.wage * share * weeks))}. Kulüp en az %${Math.round(q.minShare * 100)} istiyor.`, `${D.money(Math.round(p.wage * share))}/wk · ≈ ${D.money(Math.round(p.wage * share * weeks))} total. Club wants at least ${Math.round(q.minShare * 100)}%.`))),
      h("div", { className: "ce-field" }, h("span", { className: "ce-lbl" }, L("Satın alma opsiyonu", "Option to buy")), h(Seg, { value: option, onChange: setOption, opts: [[false, L("Yok", "No")], [true, `${L("Var", "Yes")} · ${D.money(q.optionFee)}`]] })),
      h(MoneyField, { id: "ce-loanfee", label: L("Kiralık bedeli (€)", "Loan fee (€)"), value: fee, onChange: setFee, hint: L(`Kulübün beklentisi ≈ ${D.money(need)} (maaşa daha çok katkı bedeli düşürür).`, `Club expects ≈ ${D.money(need)} (paying more wages lowers it).`) }),
      msg && h("p", { className: "ce-msg ce-tone-bad", role: "alert" }, msg),
      h("div", { className: "ce-actions" }, h(Button, { variant: "ghost", onClick: onBack }, L("Geri", "Back")), h(Button, { onClick: send }, L("Kiralık Teklifi Gönder", "Send Loan Offer"))),
    );
  }

  /* ---------------- loan out ---------------- */
  function LoanOut({ pid, onBack, onDone }) {
    const { game: g, act } = useGame();
    const { L, tt } = useI18n();
    const [half, setHalf] = useState(false);
    const offers = useMemo(() => loanOutOffers(g, pid), [g, pid, g.week]);
    const p = g.players[pid];
    function take(o) {
      const r = act((gg) => acceptLoanOut(gg, pid, o, half));
      if (r.ok) {
        toast.success(tt(r.msg));
        onDone?.();
      } else toast.error(tt(r.msg));
    }
    return h(
      "div",
      { className: "ce-box" },
      h("p", { className: "ce-h" }, L(`${D.fullName(p)} için kiralık talipleri`, `Loan suitors for ${D.fullName(p)}`)),
      !D.windowOpen(g) && h("p", { className: "ce-msg ce-tone-warn" }, L("Transfer dönemi kapalı.", "The window is closed.")),
      h("div", { className: "ce-field" }, h("span", { className: "ce-lbl" }, L("Süre", "Length")), h(Seg, { value: half, onChange: setHalf, opts: [[false, L("Sezon sonuna kadar", "Until season end")], [true, L("Devre arasına kadar", "Until mid-season")]] })),
      h(
        "label",
        { className: "ce-check" },
        h("input", { type: "checkbox", checked: !!p.loanListed, onChange: () => act((gg) => void (gg.players[pid].loanListed = !gg.players[pid].loanListed)) }),
        L("Kiralık listesine koy (kulüplerden haftalık teklif gelsin)", "Loan-list him (clubs send offers each week)"),
      ),
      offers.length
        ? h(
            "ul",
            { className: "ce-list" },
            offers.map((o) => {
              const c = D.getClub(g, o.club);
              return h(
                "li",
                { key: o.club, className: "ce-li" },
                h(ClubBadge, { club: c, size: "sm" }),
                h("div", { className: "ce-li-main" }, h("b", null, c.name), h("span", null, o.role === "starter" ? L("İlk 11 garantisi", "First-team football") : L("Rotasyon", "Rotation"), ` · ${L("maaş", "wage")} %${Math.round(o.share * 100)}`, o.fee ? ` · ${D.money(half ? Math.round(o.fee * 0.6) : o.fee)}` : "", o.option ? ` · ${L("opsiyon", "option")} ${D.money(o.option)}` : "")),
                h(Button, { size: "sm", onClick: () => take(o), disabled: !D.windowOpen(g) }, L("Anlaş", "Agree")),
              );
            }),
          )
        : h("p", { className: "ce-sub" }, L("Şu an oyuncuyla ilgilenen kulüp yok. Kiralık listesine koyarsanız teklif gelebilir.", "No club is interested right now. Loan-list him to attract offers.")),
      h("div", { className: "ce-actions" }, h(Button, { variant: "ghost", onClick: onBack }, L("Geri", "Back"))),
    );
  }

  /* ---------------- player dialog actions ---------------- */
  function PlayerActions({ pid, onBid, onRenew, onRelease, onClose, setMode }) {
    const { game: g, act } = useGame();
    const { L, tt } = useI18n();
    const p = g.players[pid];
    if (!p) return null;
    const mineClub = g.clubId != null && p.clubId === g.clubId;
    const open = D.windowOpen(g);
    const l = p.loan;
    const btns = [];
    let info = null;
    if (l) {
      const from = D.getClub(g, l.from);
      const to = D.getClub(g, l.to);
      const until = l.until.week <= 38 ? L("devre arası (Hafta 19)", "mid-season (week 19)") : L("sezon sonu", "season end");
      if (isUser(g, l.to)) {
        info = L(`${from.name} kulübünden kiralık · dönüş: ${until} · maaşının %${Math.round(l.share * 100)}'ini ödüyoruz.`, `On loan from ${from.name} · returns: ${until} · we pay ${Math.round(l.share * 100)}% of his wage.`);
        if (l.option) btns.push(h(Button, { key: "opt", onClick: () => { const r = act((gg) => exerciseOption(gg, pid)); r.ok ? toast.success(tt(r.msg)) : toast.error(tt(r.msg)); } }, L(`Opsiyonu Kullan (${D.money(l.option)})`, `Exercise Option (${D.money(l.option)})`)));
      } else if (isUser(g, l.from)) info = L(`Bizim oyuncumuz · ${to.name} kulübünde kiralık · dönüş: ${until}.`, `Our player · on loan at ${to.name} · returns: ${until}.`);
      else info = L(`${from.name} oyuncusu, ${to.name} kulübünde kiralık. Kiralık süresince transfer edilemez.`, `${from.name} player on loan at ${to.name}. Not available during the loan.`);
    } else if (mineClub) {
      btns.push(h(Button, { key: "list", variant: "outline", onClick: () => { act((gg) => void (gg.players[pid].listed = !gg.players[pid].listed)); toast(p.listed ? L("Oyuncu transfer listesine eklendi", "Player transfer-listed") : L("Oyuncu transfer listesinden çıkarıldı", "Player removed from the list")); } }, p.listed ? L("Listeden Çıkar", "Unlist") : L("Satışa Çıkar", "Transfer List")));
      btns.push(h(Button, { key: "lo", variant: "outline", onClick: () => setMode("loanout") }, L("Kiralığa Gönder", "Loan Out")));
      btns.push(h(Button, { key: "renew", variant: "outline", onClick: onRenew }, L("Sözleşme Uzat", "Renew Contract")));
      btns.push(h(Button, { key: "rel", variant: "destructive", onClick: onRelease }, L("Serbest Bırak", "Release")));
    } else if (g.clubId != null) {
      if (p.clubId == null) btns.push(h(Button, { key: "c", onClick: onBid }, L("Sözleşme Teklif Et", "Offer Contract")));
      else {
        btns.push(h(Button, { key: "b", onClick: onBid, disabled: !open }, open ? L("Transfer Teklifi Yap", "Make Transfer Bid") : L("Transfer dönemi kapalı", "Window closed")));
        btns.push(h(Button, { key: "li", variant: "outline", onClick: () => setMode("loanin"), disabled: !open }, L("Kiralık Al", "Loan In")));
      }
    }
    return h(
      React.Fragment,
      null,
      info && h("p", { className: "ce-msg ce-tone-info" }, "🔁 ", info),
      h("div", { className: "ce-actions ce-wrap" }, ...btns, h(Button, { key: "x", variant: "ghost", onClick: onClose }, L("Kapat", "Close"))),
    );
  }

  /* ---------------- transfers > loans tab ---------------- */
  function LoansTab({ onSelect }) {
    const { game: g, act } = useGame();
    const { L, tt } = useI18n();
    const c = ensure(g);
    const mineOut = Object.values(g.players).filter((p) => p.loan && isUser(g, p.loan.from));
    const mineIn = Object.values(g.players).filter((p) => p.loan && isUser(g, p.loan.to));
    const recent = g.transfers.filter((t) => t.loan).slice(0, 25);
    const row = (p, club, extra) =>
      h(
        "li",
        { key: p.id, className: "ce-li" },
        h(ClubBadge, { club, size: "sm" }),
        h("button", { type: "button", className: "ce-li-main ce-link", onClick: () => onSelect(p.id) }, h("b", null, D.fullName(p), " ", h(OvrBadge, { value: D.ovr(p) })), h("span", null, extra)),
      );
    const avg = (p) => (p.stats.apps ? (p.stats.ratingSum / p.stats.apps).toFixed(2) : "—");
    return h(
      "div",
      { className: "ce-stack" },
      h(
        "section",
        { className: "ce-card" },
        h("p", { className: "ce-h" }, L("Gelen kiralık teklifleri", "Incoming loan offers"), c.loanOffers.length ? ` (${c.loanOffers.length})` : ""),
        c.loanOffers.length
          ? h(
              "ul",
              { className: "ce-list" },
              c.loanOffers.map((o) => {
                const p = g.players[o.pid];
                const club = D.getClub(g, o.club);
                if (!p || !club) return null;
                return h(
                  "li",
                  { key: o.id, className: "ce-li" },
                  h(ClubBadge, { club, size: "sm" }),
                  h("div", { className: "ce-li-main" }, h("b", null, `${club.name} → ${D.fullName(p)}`), h("span", null, o.role === "starter" ? L("İlk 11 garantisi", "First-team football") : L("Rotasyon", "Rotation"), ` · ${L("maaş", "wage")} %${Math.round(o.share * 100)}`, o.fee ? ` · ${D.money(o.fee)}` : "")),
                  h("div", { className: "ce-actions" }, h(Button, { size: "sm", variant: "ghost", onClick: () => toast(tt(act((gg) => respondLoanOffer(gg, o.id, false)))) }, L("Reddet", "Reject")), h(Button, { size: "sm", onClick: () => toast.success(tt(act((gg) => respondLoanOffer(gg, o.id, true)))) }, L("Kabul", "Accept"))),
                );
              }),
            )
          : h("p", { className: "ce-sub" }, L("Bekleyen kiralık teklifi yok. Oyuncu ekranından 'Kiralığa Gönder' ile kulüp arayabilirsiniz.", "No loan offers. Use 'Loan Out' on a player to find a club.")),
      ),
      h(
        "section",
        { className: "ce-card" },
        h("p", { className: "ce-h" }, L("Kiraladığımız oyuncular", "Loaned in")),
        mineIn.length ? h("ul", { className: "ce-list" }, mineIn.map((p) => row(p, D.getClub(g, p.loan.from), L(`${D.getClub(g, p.loan.from).name} · maaş %${Math.round(p.loan.share * 100)}${p.loan.option ? ` · opsiyon ${D.money(p.loan.option)}` : ""}`, `${D.getClub(g, p.loan.from).name} · wage ${Math.round(p.loan.share * 100)}%${p.loan.option ? ` · option ${D.money(p.loan.option)}` : ""}`)))) : h("p", { className: "ce-sub" }, L("Yok.", "None.")),
      ),
      h(
        "section",
        { className: "ce-card" },
        h("p", { className: "ce-h" }, L("Kiralıktaki oyuncularımız", "Our players out on loan")),
        mineOut.length ? h("ul", { className: "ce-list" }, mineOut.map((p) => row(p, D.getClub(g, p.clubId), L(`${D.getClub(g, p.clubId).name} · ${p.stats.apps} maç · ${p.stats.goals} gol · ort. ${avg(p)}`, `${D.getClub(g, p.clubId).name} · ${p.stats.apps} apps · ${p.stats.goals} goals · avg ${avg(p)}`)))) : h("p", { className: "ce-sub" }, L("Yok.", "None.")),
      ),
      h(
        "section",
        { className: "ce-card" },
        h("p", { className: "ce-h" }, L("Son kiralık hareketleri", "Recent loan moves")),
        recent.length ? h("ul", { className: "ce-list ce-compact" }, recent.map((t, i) => h("li", { key: i, className: "ce-li" }, h("div", { className: "ce-li-main" }, h("b", null, t.playerName), h("span", null, `${t.from} → ${t.to}`, t.fee ? ` · ${D.money(t.fee)}` : ""))))) : h("p", { className: "ce-sub" }, L("Henüz kiralık hareketi yok.", "No loans yet.")),
      ),
    );
  }

  /* ---------------- domestic cups screen ---------------- */
  function CupsScreen() {
    const { game: g } = useGame();
    const { L, tt } = useI18n();
    const cups = (g.cups ?? []).filter((c) => c.domestic);
    const mine = cups.find((c) => g.clubId != null && c.clubIds.includes(g.clubId));
    const [tab, setTab] = useState(mine?.id ?? cups[0]?.id ?? "TRC");
    if (!cups.length) return h(EmptyState, null, L("Bu sezon ülke kupası yok. Yeni sezonda kuralar çekilir.", "No domestic cups this season yet."));
    return h(
      "div",
      { className: "grid gap-6" },
      h("h1", { className: "font-display text-3xl font-bold tracking-wide uppercase" }, L("Ülke Kupaları", "Domestic Cups")),
      h(
        Tabs,
        { value: tab, onValueChange: setTab },
        h(TabsList, { className: "ce-tabs" }, cups.map((c) => h(TabsTrigger, { key: c.id, value: c.id }, c.short))),
        cups.map((c) => h(TabsContent, { key: c.id, value: c.id, className: "mt-4" }, h(CupView, { cup: c }))),
      ),
    );
  }
  function CupView({ cup }) {
    const { game: g } = useGame();
    const { L, tt } = useI18n();
    const stages = ["df", "dsf", "dqf", "d16", "d32", "d64", "dpr"].filter((s) => cup.fixtures.some((f) => f.stage === s));
    const inCup = g.clubId != null && cup.clubIds.includes(g.clubId);
    const alive = g.clubId != null && cup.alive.includes(g.clubId) && cup.winner == null;
    const status = !inCup ? null : cup.winner === g.clubId ? L("🏆 Şampiyon!", "🏆 Winners!") : alive ? L("Kupada devam ediyoruz", "Still in the cup") : L("Elendik", "Knocked out");
    const myNext = g.clubId == null ? null : cup.fixtures.find((f) => !f.played && (f.home === g.clubId || f.away === g.clubId));
    const bye = alive && !myNext && cup.round === 0 && cup.byes.includes(g.clubId);
    const nextWeek = cup.winner == null ? cup.fixtures.filter((f) => !f.played).map((f) => f.week)[0] ?? null : null;
    return h(
      "div",
      { className: "ce-stack" },
      h(
        "section",
        { className: "ce-card" },
        h("p", { className: "ce-h" }, tt(cup.name)),
        h("p", { className: "ce-sub" }, L(`${cup.clubIds.length} takım · tek maç eleme · beraberlikte penaltılar · ev sahibi küçük kulüp`, `${cup.clubIds.length} clubs · single-leg knockout · penalties after a draw · smaller club hosts`)),
        cup.winner != null && h("p", { className: "ce-winner" }, "🏆 ", L("Şampiyon", "Winners"), ": ", D.getClub(g, cup.winner).name),
        status && h("p", { className: `ce-msg ${alive || cup.winner === g.clubId ? "ce-tone-good" : "ce-tone-bad"}` }, status),
        myNext && h("p", { className: "ce-sub" }, L(`Sıradaki maçımız: Hafta ${myNext.week} · ${D.getClub(g, myNext.home === g.clubId ? myNext.away : myNext.home).name} (${myNext.home === g.clubId ? "iç saha" : "deplasman"})`, `Our next tie: week ${myNext.week} vs ${D.getClub(g, myNext.home === g.clubId ? myNext.away : myNext.home).name} (${myNext.home === g.clubId ? "home" : "away"})`)),
        bye && h("p", { className: "ce-sub" }, L(`Ön elemede bay geçiyoruz. İlk maçımız Hafta ${cup.weeks[1]}.`, `We have a bye in the preliminary round. First tie in week ${cup.weeks[1]}.`)),
        !myNext && !bye && nextWeek && h("p", { className: "ce-sub" }, L(`Sıradaki tur: Hafta ${nextWeek}`, `Next round: week ${nextWeek}`)),
        h("p", { className: "ce-sub" }, L("Ödüller: ", "Prize money: "), `${L("tur başına", "per round")} ${D.money(cup.dprize.round)} · ${L("şampiyon", "winner")} ${D.money(cup.dprize.win)}`),
      ),
      stages.map((s) =>
        h(
          "section",
          { key: s, className: "ce-card" },
          h("p", { className: "ce-lbl" }, tt(STAGE_NAMES[s]), " · ", L("Hafta", "Week"), " ", cup.fixtures.find((f) => f.stage === s)?.week),
          h("ul", { className: "grid gap-1.5" }, cup.fixtures.filter((f) => f.stage === s).map((f) => h(FixtureRow, { key: f.id, f, ko: true }))),
        ),
      ),
    );
  }

  /* ---------------- pre-match XI editor ---------------- */
  function PreMatchXI() {
    const { game: g, act } = useGame();
    const { L, tt } = useI18n();
    const [sel, setSel] = useState(null);
    const club = D.getClub(g, g.clubId);
    const slots = formations[club.tactic.formation] || [];
    const xi = club.tactic.xi;
    const bench = club.tactic.bench;
    const squad = D.clubPlayers(g, club.id);
    const reserves = squad.filter((p) => !xi.includes(p.id) && !bench.includes(p.id)).sort((a, b) => D.ovr(b) - D.ovr(a));
    const avail = (p) => p.injury === 0 && p.banned === 0;
    const tired = xi.map((id) => g.players[id]).filter((p) => p && p.fitness < 72);
    function tap(kind, idx, pid) {
      if (!sel) return setSel({ kind, idx, pid });
      if (sel.kind === kind && sel.idx === idx) return setSel(null);
      act((gg) => {
        const t = D.getClub(gg, gg.clubId).tactic;
        const A = sel;
        const B = { kind, idx, pid };
        const get = (s) => (s.kind === "xi" ? t.xi[s.idx] : s.pid);
        const set = (s, v) => {
          if (s.kind === "xi") t.xi[s.idx] = v;
          else if (s.kind === "bench") {
            const i = t.bench.indexOf(s.pid);
            if (v == null) t.bench.splice(i, 1);
            else t.bench[i] = v;
          }
        };
        const a = get(A);
        const b = get(B);
        if (A.kind === "res" && B.kind === "res") return;
        if (A.kind === "res" || B.kind === "res") {
          const R = A.kind === "res" ? A : B;
          const O = A.kind === "res" ? B : A;
          const out = get(O);
          set(O, R.pid);
          if (O.kind === "xi" && out != null && t.bench.length < 9) t.bench.push(out);
          return;
        }
        set(A, b);
        set(B, a);
      });
      setSel(null);
    }
    const isSel = (k, i, pid) => sel && sel.kind === k && (k === "xi" ? sel.idx === i : sel.pid === pid);
    const rowP = (p, roleLbl, k, i, ratingRole) =>
      h(
        "button",
        { key: `${k}${i}${p?.id ?? "e"}`, type: "button", className: cx("ce-pl", isSel(k, i, p?.id) && "is-sel", p && !avail(p) && "is-out"), onClick: () => tap(k, i, p?.id ?? null) },
        h("span", { className: "ce-pl-role" }, roleLbl),
        h("span", { className: "ce-pl-name" }, p ? D.shortName(p) : L("Boş", "Empty")),
        p && h("span", { className: "ce-pl-ovr" }, Math.round(D.roleRating(p, ratingRole || p.pos))),
        p && h(Fit, { value: p.fitness }),
      );
    return h(
      "section",
      { className: "rounded-xl border bg-card p-4" },
      h("div", { className: "ce-row" }, h("p", { className: "ce-h", style: { flex: 1 } }, L("İlk 11 ve Yedekler", "Starting XI & Bench"), ` (${club.tactic.formation})`), h(Button, { size: "sm", variant: "outline", onClick: () => act((gg) => D.autoPick(gg, D.getClub(gg, gg.clubId))) }, L("Otomatik Diz", "Auto Pick"))),
      h("p", { className: "ce-sub" }, sel ? L("Şimdi yer değiştireceği oyuncuya dokunun.", "Now tap the player to swap with.") : L("Değiştirmek için bir oyuncuya, sonra yerine geçecek oyuncuya dokunun.", "Tap a player, then the one to swap him with.")),
      tired.length > 0 && h("p", { className: "ce-msg ce-tone-warn" }, L(`Yorgun oyuncular: ${tired.map((p) => `${D.shortName(p)} %${Math.round(p.fitness)}`).join(", ")}`, `Tired: ${tired.map((p) => `${D.shortName(p)} ${Math.round(p.fitness)}%`).join(", ")}`)),
      h("div", { className: "ce-xi" }, slots.map((s, i) => rowP(g.players[xi[i]], tt(posName[s.role]), "xi", i, s.role))),
      h("p", { className: "ce-lbl", style: { marginTop: ".75rem" } }, L("Yedek kulübesi", "Bench"), ` (${bench.length}/9)`),
      h("div", { className: "ce-xi" }, bench.map((id, i) => rowP(g.players[id], tt(posName[g.players[id]?.pos] ?? posName.CM), "bench", i))),
      reserves.length > 0 && h("p", { className: "ce-lbl", style: { marginTop: ".75rem" } }, L("Kadro dışı", "Reserves")),
      reserves.length > 0 && h("div", { className: "ce-xi" }, reserves.map((p, i) => rowP(p, tt(posName[p.pos]), "res", i))),
    );
  }

  /* ---------------- live touchline panel ---------------- */
  function MatchPanel({ ms, u }) {
    const { game: g, bump } = useGame();
    const { L, tt } = useI18n();
    const [view, setView] = useState(u);
    const [out, setOut] = useState(null);
    const [inn, setInn] = useState(null);
    const side = ms.sides[view];
    const mine = view === u;
    const fin = ms.finished;
    const subsLeft = 5 - side.subsUsed;
    const winLeft = 3 - (side.windows || 0);
    const canSub = mine && !fin && subsLeft > 0 && (winLeft > 0 || ms.minute === 45 || side.lastSubMin === ms.minute);
    const fit = (pid) => ms.fit[pid] ?? g.players[pid]?.fitness ?? 100;
    const tiredest = side.lineup.filter((l) => l.role !== "GK").sort((a, b) => fit(a.pid) - fit(b.pid))[0];
    const outRole = side.lineup.find((l) => l.pid === out)?.role;
    const suggest = tiredest && fit(tiredest.pid) < 70 ? side.bench.filter((id) => g.players[id] && g.players[id].injury === 0).sort((a, b) => D.roleRating(g.players[b], tiredest.role) - D.roleRating(g.players[a], tiredest.role))[0] : null;
    function doSub(o, i) {
      if (D.substitute(g, ms, u, o, i)) {
        setOut(null);
        setInn(null);
        bump();
        toast(L("Oyuncu değişikliği yapıldı", "Substitution made"));
      } else toast.error(L("Değişiklik yapılamadı (hak veya duraklama kalmadı).", "Substitution not possible (no subs or windows left)."));
    }
    function doSwap(a, b) {
      const A = side.lineup.find((l) => l.pid === a);
      const B = side.lineup.find((l) => l.pid === b);
      if (!A || !B) return;
      [A.role, B.role] = [B.role, A.role];
      ms.events.push({ min: ms.minute, side: u, kind: "info", text: T(`Taktik: ${D.shortName(g.players[a])} ve ${D.shortName(g.players[b])} yer değiştirdi.`, `Tactics: ${D.shortName(g.players[a])} and ${D.shortName(g.players[b])} swap positions.`) });
      setOut(null);
      bump();
    }
    function tapPitch(pid) {
      if (!mine || fin) return;
      if (inn != null && out == null) return canSub ? doSub(pid, inn) : undefined;
      if (out == null) return setOut(pid);
      if (out === pid) return setOut(null);
      if (out != null) {
        doSwap(out, pid);
        return;
      }
    }
    return h(
      "section",
      { className: "ce-panel rounded-xl border bg-card p-4 lg:row-span-2" },
      h(
        "div",
        { className: "ce-row" },
        h("h2", { className: "font-display text-lg font-bold uppercase", style: { flex: 1 } }, L("Teknik Alan", "Touchline")),
        h(Seg, { value: view, onChange: (v) => { setView(v); setOut(null); setInn(null); }, small: true, opts: [[u, L("Biz", "Us")], [1 - u, L("Rakip", "Opponent")]] }),
      ),
      // every tactical setting (formation, mentality, pressing, tempo, width, plan card) — kaiser-ext
      mine && h(kxTactics(), { ms, u, bump }),
      h(
        "p",
        { className: "ce-sub" },
        L(`Değişiklik ${side.subsUsed}/5 · Duraklama ${side.windows || 0}/3 (devre arası sayılmaz)`, `Subs ${side.subsUsed}/5 · Windows ${side.windows || 0}/3 (half-time is free)`),
      ),
      mine && suggest != null && !fin && subsLeft > 0 &&
        h(
          "button",
          { type: "button", className: "ce-suggest", onClick: () => doSub(tiredest.pid, suggest), disabled: !canSub },
          "💡 ",
          L(`Öneri: ${D.shortName(g.players[tiredest.pid])} (%${Math.round(fit(tiredest.pid))}) çıksın, ${D.shortName(g.players[suggest])} girsin`, `Suggestion: ${D.shortName(g.players[tiredest.pid])} (${Math.round(fit(tiredest.pid))}%) off, ${D.shortName(g.players[suggest])} on`),
        ),
      h("p", { className: "ce-lbl" }, L("Sahadakiler (puan · kondisyon)", "On the pitch (rating · fitness)"), mine && !fin ? ` · ${out == null ? L("çıkacak oyuncuyu seçin", "pick a player") : L("yedek seçin ya da yer değiştirmek için sahadan birini seçin", "pick a sub, or another player to swap positions")}` : ""),
      h(
        "div",
        { className: "ce-xi" },
        side.lineup.map((l) => {
          const p = g.players[l.pid];
          const y = ms.yellow?.[l.pid];
          return h(
            "button",
            { key: l.pid, type: "button", className: cx("ce-pl", out === l.pid && "is-sel"), onClick: () => tapPitch(l.pid), disabled: !mine || fin },
            h("span", { className: "ce-pl-role" }, tt(posName[l.role])),
            h("span", { className: "ce-pl-name" }, p ? D.shortName(p) : "?", y ? " 🟨" : ""),
            h("span", { className: "ce-pl-ovr" }, (ms.rating[l.pid] ?? 6.4).toFixed(1)),
            h(Fit, { value: fit(l.pid) }),
          );
        }),
      ),
      h("p", { className: "ce-lbl", style: { marginTop: ".6rem" } }, L("Yedekler (güç · kondisyon)", "Bench (ability · fitness)"), mine && out != null ? ` · ${L("seçilen mevkiye göre", "for the selected role")}` : ""),
      h(
        "div",
        { className: "ce-xi" },
        side.bench.map((id) => {
          const p = g.players[id];
          if (!p) return null;
          return h(
            "button",
            { key: id, type: "button", className: cx("ce-pl", inn === id && "is-sel", p.injury > 0 && "is-out"), disabled: !mine || fin || !canSub || p.injury > 0, onClick: () => (out != null ? doSub(out, id) : setInn(inn === id ? null : id)) },
            h("span", { className: "ce-pl-role" }, tt(posName[p.pos])),
            h("span", { className: "ce-pl-name" }, D.shortName(p)),
            h("span", { className: "ce-pl-ovr" }, Math.round(D.roleRating(p, outRole || p.pos))),
            h(Fit, { value: fit(id) }),
          );
        }),
      ),
      side.out.length > 0 && h("p", { className: "ce-sub", style: { marginTop: ".5rem" } }, L("Oyundan çıkanlar: ", "Off: "), side.out.map((id) => (g.players[id] ? D.shortName(g.players[id]) : "?")).join(", ")),
    );
  }

  return { Negotiation, LoanIn, LoanOut, PlayerActions, LoansTab, CupsScreen, PreMatchXI, MatchPanel };
}

export const CE = {
  init,
  ensure,
  fame,
  fameLabel,
  askingPrice,
  aiBidFee,
  negState,
  submitOffer,
  completeTransfer,
  afterMove,
  loanInQuote,
  requestLoanIn,
  doLoan,
  endLoan,
  exerciseOption,
  loanOutOffers,
  acceptLoanOut,
  respondLoanOffer,
  wageBill,
  aiMarket,
  weekly,
  seasonEnd,
  seasonStart,
  ffpPoints,
  ffpSeasonEnd,
  penaltyFor,
  applyPenalties,
  develop,
  yearEnd,
  fatigue,
  startFit,
  recover,
  injuryMul,
  injuryPick,
  cardPick,
  paceMul,
  subWindowOk,
  subWindowUse,
  minuteLabel,
  createCups,
  migrate,
  cupsWeek,
  STAGE_NAMES,
  DCUPS,
  createUI,
};
