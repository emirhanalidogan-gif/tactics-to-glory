/*
 * "Plus" extensions (hand-written):
 *  - Line-up board: a standalone İlk 11 screen (pitch, bench, reserves, roles, tactics) that also
 *    works during a live match (positions swap, substitutions) and opens from inside the match.
 *  - Youth academy (Altyapı): prospects live in game.px.academy until promoted to the first team.
 *  - Rejected bids upset the player (morale drop, inbox message, a few sulky weeks).
 *  - Lower potentials for old saves (one-off rescale).
 *  - Kaiser-style transfer market cards, club-colour theme and the 2D stadium bowl (stadiumPlan).
 *
 * State: game.px = { v, academy: { list, nextId, season }, shortlist: [] }; player field p.pxUpset.
 */
import { createUI as __kxCreateUI } from "./kaiser-ext.js?v=2";
import { peekExt as __peekExt } from "./club-ext.js?v=2";

let D = null;
const T = (tr, en) => ({ tr, en });
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function init(deps) {
  D = deps;
  if (typeof document !== "undefined" && !document.getElementById("px-css")) {
    const link = document.createElement("link");
    link.id = "px-css";
    link.rel = "stylesheet";
    link.href = new URL("./plus-ext.css?v=1", import.meta.url).href;
    document.head.appendChild(link);
  }
  return deps;
}

export function ensure(g) {
  g.px ??= {};
  g.px.academy ??= { list: [], nextId: 1, season: null };
  g.px.shortlist ??= [];
  return g.px;
}

/* ============================================================ potentials */

/** Shrinks the gap between current ability and potential (old saves had far too high potentials). */
export function rescalePotential(p, ovr, k = 0.6) {
  if (p.pot == null || p.pot <= ovr) return p.pot;
  return Math.max(ovr, Math.round(ovr + (p.pot - ovr) * k));
}

export function migrate(g) {
  const px = ensure(g);
  if ((px.v ?? 0) < 2) {
    for (const p of Object.values(g.players ?? {})) p.pot = rescalePotential(p, D.ovr(p));
    px.v = 2;
  }
  if (g.clubId != null && px.academy.season == null) academyIntake(g, true);
}

/* ============================================================ rejected bids */

/** Morale lost when the user turns down a bid. kind: "reject" | "walk" (counter-offer too high) | "ignored". */
export function upsetAmount(g, p, buyer, fee, kind = "reject") {
  const mine = g.clubId == null ? null : D.getClub(g, g.clubId);
  const repGap = buyer && mine ? (buyer.rep ?? 50) - (mine.rep ?? 50) : 0;
  const val = D.value(p, g.season) || 1;
  let drop = 8;
  if (repGap > 0) drop += repGap * 0.7; // a bigger club wanted him
  if (fee > val * 1.2) drop += 3; // a big offer, a big wage rise for him
  if (p.age >= 26 && p.age <= 31) drop += 2; // the move of his career
  if (p.listed) drop += 4; // he was told he could go
  const mul = kind === "walk" ? 0.6 : kind === "ignored" ? 0.8 : 1;
  return Math.round(clamp(drop * mul, 4, 28));
}

export function bidRejected(g, offer, kind = "reject") {
  const p = offer && g.players[offer.playerId];
  if (!p || p.clubId !== g.clubId) return 0;
  const buyer = D.getClub(g, offer.fromClub);
  const drop = upsetAmount(g, p, buyer, offer.fee, kind);
  p.morale = clamp(Math.round((p.morale ?? 60) - drop), 0, 100);
  p.pxUpset = { club: buyer?.id ?? null, weeks: drop >= 14 ? 6 : 3, drop };
  const name = D.fullName(p);
  const cn = buyer?.name ?? "?";
  D.inbox(
    g,
    "player",
    T(`${name} çok üzgün`, `${name} is upset`),
    drop >= 14
      ? T(`${name}, ${cn} teklifinin reddedilmesine çok kırıldı. Morali sert düştü (−${drop}) ve antrenmanda isteksiz.`, `${name} is gutted that the ${cn} bid was turned down. His morale crashed (−${drop}).`)
      : T(`${name}, ${cn} teklifinin reddedilmesinden hoşnut değil. Morali düştü (−${drop}).`, `${name} is unhappy the ${cn} bid was rejected. Morale −${drop}.`),
  );
  return drop;
}

/** Offers the user never answered count as rejections. Call before the bundle drops old offers. */
export function offersExpiring(g) {
  const now = g.season * 100 + g.week;
  for (const o of g.offers ?? []) if (now - (o.season * 100 + o.week) > 2 && !o.pxDone) {
    o.pxDone = true;
    bidRejected(g, o, "ignored");
  }
}

export function weekly(g) {
  ensure(g);
  for (const p of Object.values(g.players)) {
    if (!p.pxUpset) continue;
    if (p.clubId !== g.clubId) { delete p.pxUpset; continue; }
    p.morale = clamp((p.morale ?? 60) - 1, 0, 100);
    if (--p.pxUpset.weeks <= 0) delete p.pxUpset;
  }
  academyWeekly(g);
}

/* ============================================================ youth academy */

const POS = ["GK", "CB", "CB", "LB", "RB", "DM", "CM", "CM", "AM", "LW", "RW", "ST", "ST"];
export const academyLevel = (g) => {
  if (g.clubId == null) return 0;
  let lvl = g.clubExt?.[g.clubId]?.fac?.academy;
  if (lvl == null) try { lvl = __peekExt(g, g.clubId).fac.academy; } catch { lvl = 3; }
  return clamp(lvl ?? 3, 0, 10);
};

/** Potential headroom of a new prospect: lower than before, better academies add a little. */
export function youthPotential(ovr, level, r = Math.random()) {
  return clamp(Math.round(ovr + 6 + r * 14 + level * 1.2), ovr, 90);
}

export function academyIntake(g, first = false) {
  const px = ensure(g);
  if (g.clubId == null || !D.makePlayer) return [];
  const club = D.getClub(g, g.clubId);
  const lg = g.leagues.find((l) => l.id === club.leagueId);
  const lvl = academyLevel(g);
  const n = (first ? 5 : 3) + Math.floor(lvl / 3);
  const base = (lg?.level ?? 60) - 22 + lvl;
  const nat = lg?.nat ?? { Türkiye: "TR", England: "ENG", Spain: "ES", Germany: "DE", Italy: "IT", France: "FR" }[lg?.country?.en] ?? "ENG";
  const made = [];
  for (let i = 0; i < n; i++) {
    const p = D.makePlayer(-(px.academy.nextId++), D.pick(POS), clamp(Math.round(base + D.rand() * 8 - 4), 35, 64), D.randInt(15, 17), D.chance(0.8) ? nat : D.pick(["BR", "AR", "FR", "NG", "GH", "SN", "PT", "ES", "DE", "NL"]), null, g.season, 0.2);
    p.pot = youthPotential(D.ovr(p), lvl);
    p.clubId = null;
    p.pxAcademy = true;
    p.pxJoined = g.season;
    made.push(p);
  }
  px.academy.list.push(...made);
  px.academy.season = g.season;
  if (!first && made.length)
    D.inbox(g, "youth", T("Altyapıya yeni yetenekler", "New academy intake"), T(`Altyapıya ${made.length} genç oyuncu katıldı. Altyapı ekranından inceleyin.`, `${made.length} youngsters joined the academy. Check the Academy screen.`));
  return made;
}

function grow(p) {
  const keys = Object.keys(p.attrs ?? {});
  for (let i = 0; i < 3 && keys.length; i++) {
    const k = D.pick(keys);
    p.attrs[k] = clamp(p.attrs[k] + 1, 15, 99);
  }
}

function academyWeekly(g) {
  const px = ensure(g);
  const lvl = academyLevel(g);
  for (const p of px.academy.list) {
    if (D.ovr(p) < p.pot && D.chance(0.12 + lvl * 0.02)) grow(p);
    p.fitness = 100;
  }
}

/** New season: prospects age, the oldest must be promoted or leave, then a new intake arrives. */
export function seasonStart(g) {
  const px = ensure(g);
  if (g.clubId == null) return;
  const gone = [];
  px.academy.list = px.academy.list.filter((p) => {
    p.age += 1;
    if (p.age > 18) { gone.push(D.fullName(p)); return false; }
    return true;
  });
  if (gone.length)
    D.inbox(g, "youth", T("Altyapıdan ayrılanlar", "Academy leavers"), T(`A takıma alınmadığı için ayrılanlar: ${gone.join(", ")}.`, `Left because they were not promoted: ${gone.join(", ")}.`));
  if (px.academy.season !== g.season) academyIntake(g);
}

export function promote(g, tempId) {
  const px = ensure(g);
  const i = px.academy.list.findIndex((p) => p.id === tempId);
  if (i < 0 || g.clubId == null) return null;
  const [p] = px.academy.list.splice(i, 1);
  p.id = g.nextPid++;
  p.clubId = g.clubId;
  p.contractEnd = g.season + 3;
  p.joined = g.season;
  p.pxYouth = true;
  delete p.pxAcademy;
  g.players[p.id] = p;
  D.inbox(g, "youth", T(`${D.fullName(p)} A takımda`, `${D.fullName(p)} promoted`), T(`${D.fullName(p)} (${p.age}) altyapıdan A takıma yükseldi.`, `${D.fullName(p)} (${p.age}) was promoted to the first team.`));
  return p;
}

export function release(g, tempId) {
  const px = ensure(g);
  px.academy.list = px.academy.list.filter((p) => p.id !== tempId);
}

/* ============================================================ club colours */

function hexRgb(hex) {
  let h = String(hex || "#888888").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isNaN(n) ? [136, 136, 136] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const lum = (hex) => {
  const [r, g, b] = hexRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const inkOn = (hex) => (lum(hex) > 0.45 ? "#0a0a0a" : "#ffffff");

/** Club colours as CSS variables on <html>: the home screen and accents use them. */
export function applyClubTheme(club) {
  if (typeof document === "undefined") return;
  const s = document.documentElement.style;
  if (!club) {
    for (const k of ["--club-1", "--club-2", "--club-ink", "--club-ink-2"]) s.removeProperty(k);
    delete document.documentElement.dataset.ufmClub;
    return;
  }
  let [a, b] = [club.colors?.[0] ?? "#0a0a0a", club.colors?.[1] ?? "#ffffff"];
  // a near-white first colour reads badly as an accent: lead with the second
  if (lum(a) > 0.8 && lum(b) < 0.8) [a, b] = [b, a];
  s.setProperty("--club-1", a);
  s.setProperty("--club-2", b);
  s.setProperty("--club-ink", inkOn(a));
  s.setProperty("--club-ink-2", inkOn(b));
  document.documentElement.dataset.ufmClub = String(club.id);
}

/* ============================================================ stadium bowl */

export const PLAN = { PL: 105, PW: 68, SX: 30, ST: 36, SB: 12 };
const planCache = new Map();
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Top-down plan of the home club's stadium around a 105x68 pitch (metres), drawn once on a canvas:
 * advertising boards, track, dugouts, raked stands with a pixel crowd in club colours (home end tifo,
 * away section), concourses, aisles, roof and floodlights. The 2D pitch tilts it with CSS perspective.
 * Returns a data URL; plan box = [-SX, PL+SX] x [-ST, PW+SB].
 */
export function stadiumPlan(club, away, opts = {}) {
  if (typeof document === "undefined" || !club) return null;
  const { PL, PW, SX, ST, SB } = PLAN;
  const ppm = opts.ppm ?? 9;
  const key = `${club.id}:${club.capacity}:${club.colors}:${away?.colors ?? ""}:${ppm}`;
  if (planCache.has(key)) return planCache.get(key);
  const W = Math.round((PL + 2 * SX) * ppm);
  const H = Math.round((PW + ST + SB) * ppm);
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d");
  if (!c) return null;
  const X = (x) => (x + SX) * ppm;
  const Y = (y) => (y + ST) * ppm;
  const R = seeded((club.id || 1) * 9973 + (club.capacity | 0));
  const c1 = hexRgb(club.colors?.[0]);
  const c2 = hexRgb(club.colors?.[1] ?? "#ffffff");
  const a1 = hexRgb(away?.colors?.[0] ?? "#2b59c3");
  const a2 = hexRgb(away?.colors?.[1] ?? "#ffffff");
  const cap = club.capacity || 20000;
  const tiers = cap < 15000 ? 1 : cap < 40000 ? 2 : 3;
  const inner = 8.5; // stands start this far from the touchline
  const depth = { top: cap < 15000 ? 16 : 24 + tiers * 2, side: cap < 15000 ? 12 : 17 + tiers * 2, bottom: SB - 1 };
  // distance outside the pitch rectangle and the allowed stand depth in that direction
  const where = (x, y) => {
    const dx = Math.max(-x, 0, x - PL);
    const dy = Math.max(-y, 0, y - PW);
    const d = Math.hypot(dx, dy);
    const vert = y < 0 ? depth.top : depth.bottom;
    const t = dx + dy > 0 ? dy / (dx + dy) : 0;
    return { d, lim: inner + depth.side * (1 - t) + vert * t, dx, dy };
  };
  const rgb = (col, f) => `rgb(${clamp(col[0] * f, 0, 255) | 0},${clamp(col[1] * f, 0, 255) | 0},${clamp(col[2] * f, 0, 255) | 0})`;

  // run-off grass
  c.fillStyle = "#1a6a31";
  c.fillRect(X(-6), Y(-6), (PL + 12) * ppm, (PW + 12) * ppm);
  // advertising boards (a ring 5–5.8 m out)
  const boards = [
    [c1, c2],
    [[245, 245, 245], [20, 20, 24]],
    [c2, c1],
    [[18, 18, 22], [250, 250, 250]],
  ];
  const board = (x, y, w, hgt, i) => {
    const [bg, fg] = boards[i % boards.length];
    c.fillStyle = rgb(bg, 1);
    c.fillRect(X(x), Y(y), w * ppm, hgt * ppm);
    c.fillStyle = rgb(fg, 1);
    const tw = w * 0.5;
    c.fillRect(X(x + (w - tw) / 2), Y(y + hgt * 0.35), tw * ppm, hgt * 0.3 * ppm);
  };
  for (let i = 0, x = -4; x < PL + 4; i++, x += 9) board(x, -5.8, 8.6, 0.8, i);
  for (let i = 1, x = -4; x < PL + 4; i++, x += 9) if (Math.abs(x + 4.3 - PL / 2) > 14) board(x, PW + 5, 8.6, 0.8, i);
  for (let i = 0, y = -4; y < PW + 4; i++, y += 9) {
    board(-5.8, y, 0.8, 8.6, i + 1);
    board(PL + 5, y, 0.8, 8.6, i + 2);
  }
  // track / concrete apron
  c.fillStyle = "#2a2d33";
  const apron = (x0, y0, x1, y1) => c.fillRect(X(x0), Y(y0), (x1 - x0) * ppm, (y1 - y0) * ppm);
  apron(-inner, -inner, PL + inner, -5.8);
  apron(-inner, PW + 5.8, PL + inner, PW + inner);
  apron(-inner, -5.8, -5.8, PW + 5.8);
  apron(PL + 5.8, -5.8, PL + inner, PW + 5.8);
  // dugouts on the near side
  for (const s of [-1, 1]) {
    const x0 = PL / 2 + s * 11 - 4;
    c.fillStyle = "#121318";
    c.fillRect(X(x0), Y(PW + 5.6), 8 * ppm, 2.6 * ppm);
    c.fillStyle = s < 0 ? rgb(c1, 0.9) : rgb(a1, 0.9);
    c.fillRect(X(x0 + 0.4), Y(PW + 5.9), 7.2 * ppm, 0.5 * ppm);
  }
  // crowd
  const cell = 0.62;
  const gap = 0.14;
  for (let y = -ST; y < PW + SB; y += cell) {
    for (let x = -SX; x < PL + SX; x += cell) {
      const { d, lim, dx, dy } = where(x + cell / 2, y + cell / 2);
      if (d < inner || d > lim) continue;
      const depthHere = lim - inner;
      const k = (d - inner) / depthHere; // 0 front row .. 1 back row
      const tierLen = 1 / tiers;
      const tierPos = (k % tierLen) / tierLen;
      // concourse between tiers
      if (tiers > 1 && k > tierLen * 0.98 && tierPos < 0.07 && k < 0.99) {
        c.fillStyle = "#15171d";
        c.fillRect(X(x), Y(y), cell * ppm + 1, cell * ppm + 1);
        continue;
      }
      // aisles (stairs) every ~13 m along each stand
      const along = dy > dx ? x : y;
      if (dx === 0 || dy === 0 ? (along + 400) % 13 < 0.75 : false) {
        c.fillStyle = "#3a3d45";
        c.fillRect(X(x), Y(y), cell * ppm + 1, cell * ppm + 1);
        continue;
      }
      // seat colour: home end tifo (left), away block (right, near the far corner), mixed elsewhere
      let col;
      const homeEnd = x < -inner + 0.5 && dy === 0;
      const awayEnd = x > PL + inner - 0.5 && y < PW * 0.45 && y > -3;
      const q = R();
      if (homeEnd) col = Math.floor((y + 200) / 3.1) % 2 ? c1 : c2;
      else if (awayEnd) col = q < 0.6 ? a1 : q < 0.85 ? a2 : [40, 42, 50];
      else col = q < 0.42 ? c1 : q < 0.64 ? c2 : q < 0.8 ? [214, 214, 218] : q < 0.92 ? [60, 62, 72] : [150, 120, 95];
      const shade = (0.8 + R() * 0.32) * (1.05 - k * 0.35) * (tiers > 1 ? 1 - tierPos * 0.12 : 1);
      // empty seats in small grounds
      if (cap < 25000 && R() < 0.12) col = [70, 74, 84];
      c.fillStyle = rgb(col, shade);
      c.fillRect(X(x + gap / 2), Y(y + gap / 2), (cell - gap) * ppm, (cell - gap) * ppm);
    }
  }
  // roof ring: dark band at the back of the stands with a lit inner edge
  c.save();
  for (let y = -ST; y < PW + SB; y += 0.5) {
    for (let x = -SX; x < PL + SX; x += 0.5) {
      const { d, lim } = where(x + 0.25, y + 0.25);
      if (d > lim && d < lim + 2.6) {
        c.fillStyle = d < lim + 0.4 ? "#e8e8ec" : "#1c1e25";
        c.fillRect(X(x), Y(y), 0.5 * ppm + 1, 0.5 * ppm + 1);
      }
    }
  }
  c.restore();
  // floodlight glows at the four corners + along the far roof
  const glow = (x, y, r) => {
    const g = c.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), r * ppm);
    g.addColorStop(0, "rgba(255,255,245,0.95)");
    g.addColorStop(0.3, "rgba(255,255,235,0.35)");
    g.addColorStop(1, "rgba(255,255,235,0)");
    c.fillStyle = g;
    c.fillRect(X(x - r), Y(y - r), 2 * r * ppm, 2 * r * ppm);
  };
  const cornerOut = (sx, sy) => {
    const lim = inner + (depth.side + (sy < 0 ? depth.top : depth.bottom)) / 2;
    const o = lim / Math.SQRT2 + 1.2;
    return [sx < 0 ? -o : PL + o, sy < 0 ? -o : PW + o];
  };
  for (const [sx, sy] of [[-1, -1], [1, -1]]) glow(...cornerOut(sx, sy), 7);
  for (let i = 1; i < 8; i++) glow((PL * i) / 8, -(inner + depth.top + 1.2), 3.2);
  // light pool on the grass
  const pool = c.createRadialGradient(X(PL / 2), Y(PW / 2), 10, X(PL / 2), Y(PW / 2), PL * 0.75 * ppm);
  pool.addColorStop(0, "rgba(255,255,240,0.08)");
  pool.addColorStop(1, "rgba(0,0,0,0.18)");
  c.fillStyle = pool;
  c.fillRect(X(-inner), Y(-inner), (PL + 2 * inner) * ppm, (PW + 2 * inner) * ppm);
  let url = cv.toDataURL("image/webp", 0.86);
  if (!url.startsWith("data:image/webp")) url = cv.toDataURL("image/png");
  planCache.set(key, url);
  return url;
}

/* ============================================================ UI */

const LINE = { GK: "gk", CB: "def", LB: "def", RB: "def", DM: "mid", CM: "mid", AM: "mid", LW: "att", RW: "att", ST: "att" };
export const lineOf = (pos) => LINE[pos] ?? "mid";
export const tierOf = (r) => (r >= 85 ? "s" : r >= 78 ? "a" : r >= 70 ? "b" : r >= 60 ? "c" : "d");

export function createUI() {
  const { React, useGame, useI18n, Button, toast, ClubBadge, posName, formations, EmptyState } = D.ui;
  const h = React.createElement;
  const { useState, useEffect, useMemo } = React;
  const cx = (...a) => a.filter(Boolean).join(" ");
  let kxT;
  const MatchTactics = (p) => h((kxT ??= __kxCreateUI().MatchTactics), p);

  const Pos = ({ pos }) => {
    const { tt } = useI18n();
    return h("span", { className: `px-pos px-pos--${lineOf(pos)}` }, tt(posName[pos] ?? posName.CM));
  };
  const Ovr = ({ v, big }) => h("span", { className: cx("px-ovr", `px-ovr--${tierOf(v)}`, big && "px-ovr--big") }, Math.round(v));
  const Fit = ({ v }) => h("span", { className: cx("px-fit", v < 70 ? "is-low" : v < 85 ? "is-mid" : "") }, h("i", { style: { width: `${clamp(v, 0, 100)}%` } }));
  const Flag = ({ nat }) => {
    const code = { ENG: "gb-eng", SCO: "gb-sct", WAL: "gb-wls", NIR: "gb-nir" }[nat] ?? String(nat || "").toLowerCase();
    return code ? h("img", { className: "px-flag", src: `https://flagcdn.com/w40/${code}.png`, alt: "", width: 18, height: 12, loading: "lazy" }) : null;
  };

  /* ---------------- shared pitch ---------------- */
  function Pitch({ slots, children, compact }) {
    return h(
      "div",
      { className: cx("px-pitch", compact && "px-pitch--compact") },
      h("div", { className: "px-pitch-lines", "aria-hidden": "true" }, h("i", { className: "px-pl-half" }), h("i", { className: "px-pl-circle" }), h("i", { className: "px-pl-box px-pl-box--top" }), h("i", { className: "px-pl-box px-pl-box--bot" }), h("i", { className: "px-pl-six px-pl-six--top" }), h("i", { className: "px-pl-six px-pl-six--bot" })),
      children,
    );
  }
  function Token({ x, y, p, role, value, club, sel, warn, onClick, label, sub, badge }) {
    const { L, tt } = useI18n();
    return h(
      "button",
      {
        type: "button",
        className: cx("px-tok", sel && "is-sel", !p && "is-empty", warn && "is-warn", p && (p.injury > 0 || p.banned > 0) && "is-out"),
        style: { left: `${x}%`, top: `${y}%` },
        onClick,
        "aria-pressed": !!sel,
        "aria-label": `${tt(posName[role])}: ${p ? D.shortName(p) : L("boş", "empty")}`,
      },
      h("span", { className: "px-tok-disc", style: club ? { background: club.colors?.[0], color: inkOn(club.colors?.[0] ?? "#000"), borderColor: club.colors?.[1] } : undefined }, p ? Math.round(value) : "+"),
      badge && h("span", { className: "px-tok-badge" }, badge),
      h("span", { className: "px-tok-name" }, p ? label ?? D.shortName(p) : tt(posName[role])),
      h("span", { className: "px-tok-sub" }, sub ?? tt(posName[role])),
    );
  }
  const Row = ({ p, ratingRole, sel, onClick, extra, disabled, mood = true }) =>
    h(
      "button",
      { type: "button", className: cx("px-row", sel && "is-sel", (p.injury > 0 || p.banned > 0) && "is-out"), onClick, disabled },
      h(Pos, { pos: p.pos }),
      h("span", { className: "px-row-name" }, D.shortName(p), mood && p.pxUpset ? " 😞" : "", p.injury > 0 ? " ✚" : ""),
      extra,
      h(Ovr, { v: D.roleRating(p, ratingRole || p.pos) }),
      h(Fit, { v: p.fitness ?? 100 }),
    );

  /* ---------------- club line-up (pre-match / any time) ---------------- */
  function ClubLineup({ compact = false }) {
    const { game: g, act } = useGame();
    const { L, tt } = useI18n();
    const [sel, setSel] = useState(null);
    const club = D.getClub(g, g.clubId);
    const tac = club.tactic;
    const slots = formations[tac.formation] || [];
    const squad = D.clubPlayers(g, club.id);
    const reserves = squad.filter((p) => !tac.xi.includes(p.id) && !tac.bench.includes(p.id)).sort((a, b) => D.ovr(b) - D.ovr(a));
    const selRole = sel?.kind === "xi" ? slots[sel.idx]?.role : null;
    function tap(kind, idx, pid) {
      if (!sel) return setSel({ kind, idx, pid });
      if (sel.kind === kind && (kind === "xi" ? sel.idx === idx : sel.pid === pid)) return setSel(null);
      const A = sel;
      const B = { kind, idx, pid };
      setSel(null);
      act((gg) => swapIn(D.getClub(gg, gg.clubId).tactic, A, B));
    }
    const isSel = (k, i, pid) => sel && sel.kind === k && (k === "xi" ? sel.idx === i : sel.pid === pid);
    const xiRating = Math.round(slots.reduce((s, sl, i) => s + (g.players[tac.xi[i]] ? D.roleRating(g.players[tac.xi[i]], sl.role) : 0), 0) / Math.max(1, slots.length));
    return h(
      "div",
      { className: cx("px-lineup", compact && "px-lineup--compact") },
      h(
        "div",
        { className: "px-lineup-pitch" },
        h(
          "div",
          { className: "px-lineup-head" },
          h("span", { className: "px-kicker" }, L("Diziliş", "Formation")),
          h("b", { className: "px-big" }, tac.formation),
          h("span", { className: "px-kicker" }, L("İlk 11 gücü", "XI rating")),
          h(Ovr, { v: xiRating }),
        ),
        h(
          Pitch,
          null,
          slots.map((s, i) => {
            const p = g.players[tac.xi[i]];
            return h(Token, {
              key: i,
              x: s.x,
              y: s.y,
              p,
              role: s.role,
              club,
              value: p ? D.roleRating(p, s.role) : 0,
              sel: isSel("xi", i),
              warn: p && p.pos !== s.role,
              badge: p && (p.id === tac.captain ? "C" : p.pxUpset ? "😞" : null),
              sub: p ? `${tt(posName[s.role])}${p.fitness < 80 ? ` · %${Math.round(p.fitness)}` : ""}` : undefined,
              onClick: () => tap("xi", i, p?.id ?? null),
            });
          }),
        ),
        h("p", { className: "px-hint" }, sel ? L("Şimdi yer değiştireceği oyuncuya dokunun (sahada, yedeklerde ya da kadro dışında).", "Now tap the player to swap with (pitch, bench or reserves).") : L("Bir oyuncuya, sonra yerine geçecek oyuncuya dokunun. Turuncu çerçeve: oyuncu doğal mevkisinde değil.", "Tap a player, then the one to swap him with. Orange ring: out of position.")),
      ),
      h(
        "div",
        { className: "px-lineup-side" },
        h(
          "div",
          { className: "px-card" },
          h("div", { className: "px-card-head" }, h("h3", null, L("Yedek kulübesi", "Bench"), ` ${tac.bench.length}/9`), selRole && h("span", { className: "px-kicker" }, L(`${tt(posName[selRole])} için puan`, `rating as ${tt(posName[selRole])}`))),
          h("div", { className: "px-list" }, tac.bench.map((id, i) => (g.players[id] ? h(Row, { key: id, p: g.players[id], ratingRole: selRole, sel: isSel("bench", i, id), onClick: () => tap("bench", i, id) }) : null))),
        ),
        reserves.length > 0 &&
          h(
            "div",
            { className: "px-card" },
            h("div", { className: "px-card-head" }, h("h3", null, L("Kadro dışı", "Reserves"), ` ${reserves.length}`)),
            h("div", { className: "px-list px-list--scroll" }, reserves.map((p) => h(Row, { key: p.id, p, ratingRole: selRole, sel: isSel("res", 0, p.id), onClick: () => tap("res", 0, p.id) }))),
          ),
      ),
    );
  }

  /** Swaps two line-up places (xi slot / bench / reserves) on a club tactic. */
  function swapIn(t, A, B) {
    const get = (s) => (s.kind === "xi" ? t.xi[s.idx] : s.pid);
    const set = (s, v) => {
      if (s.kind === "xi") t.xi[s.idx] = v ?? null;
      else if (s.kind === "bench") {
        const i = t.bench.indexOf(s.pid);
        if (i < 0) return;
        if (v == null) t.bench.splice(i, 1);
        else t.bench[i] = v;
      }
    };
    if (A.kind === "res" && B.kind === "res") return;
    if (A.kind === "res" || B.kind === "res") {
      const Rs = A.kind === "res" ? A : B;
      const O = A.kind === "res" ? B : A;
      const out = get(O);
      set(O, Rs.pid);
      if (O.kind === "xi" && out != null && t.bench.length < 9 && !t.bench.includes(out)) t.bench.push(out);
      return;
    }
    const a = get(A);
    const b = get(B);
    set(A, b);
    set(B, a);
  }

  /* ---------------- live line-up (during a match) ---------------- */
  function LiveLineup({ ms, u }) {
    const { game: g, bump } = useGame();
    const { L, tt } = useI18n();
    const [sel, setSel] = useState(null); // pid on the pitch
    const side = ms.sides[u];
    const club = D.getClub(g, side.clubId);
    const form = side.formation || club.tactic.formation;
    const slots = formations[form] || formations[club.tactic.formation] || [];
    const fit = (pid) => ms.fit?.[pid] ?? g.players[pid]?.fitness ?? 100;
    const fin = ms.finished;
    const subsLeft = 5 - side.subsUsed;
    // place every lineup entry on a formation slot with the same role (left to right as listed)
    const used = new Set();
    const placed = side.lineup.map((l) => {
      let i = slots.findIndex((s, k) => !used.has(k) && s.role === l.role);
      if (i < 0) i = slots.findIndex((s, k) => !used.has(k) && lineOf(s.role) === lineOf(l.role));
      if (i < 0) i = slots.findIndex((_, k) => !used.has(k));
      used.add(i);
      return { l, s: slots[i] ?? { x: 50, y: 50, role: l.role } };
    });
    function swap(a, b) {
      const A = side.lineup.find((l) => l.pid === a);
      const B = side.lineup.find((l) => l.pid === b);
      if (!A || !B) return;
      [A.role, B.role] = [B.role, A.role];
      ms.events.push({ min: ms.minute, side: u, kind: "info", text: T(`Taktik: ${D.shortName(g.players[a])} ve ${D.shortName(g.players[b])} yer değiştirdi.`, `Tactics: ${D.shortName(g.players[a])} and ${D.shortName(g.players[b])} swap positions.`) });
      bump();
    }
    function sub(outPid, inPid) {
      if (D.substitute(g, ms, u, outPid, inPid)) {
        bump();
        toast(L("Oyuncu değişikliği yapıldı", "Substitution made"));
      } else toast.error(L("Değişiklik yapılamadı (hak veya duraklama kalmadı).", "Substitution not possible (no subs or windows left)."));
    }
    function tapPitch(pid) {
      if (fin) return;
      if (sel == null) return setSel(pid);
      if (sel === pid) return setSel(null);
      swap(sel, pid);
      setSel(null);
    }
    const selRole = side.lineup.find((l) => l.pid === sel)?.role;
    return h(
      "div",
      { className: "px-lineup px-lineup--live" },
      h(
        "div",
        { className: "px-lineup-pitch" },
        h(
          "div",
          { className: "px-lineup-head" },
          h("span", { className: "px-kicker" }, L("Diziliş", "Formation")),
          h("b", { className: "px-big" }, form),
          h("span", { className: "px-kicker" }, L("Değişiklik", "Subs")),
          h("b", { className: "px-big" }, `${side.subsUsed}/5`),
          h("span", { className: "px-kicker" }, `${D.minuteLabel ? D.minuteLabel(ms.minute) : ms.minute}'`),
        ),
        h(
          Pitch,
          null,
          placed.map(({ l, s }) => {
            const p = g.players[l.pid];
            return h(Token, {
              key: l.pid,
              x: s.x,
              y: s.y,
              p,
              role: l.role,
              club,
              value: p ? D.roleRating(p, l.role) : 0,
              label: p ? D.shortName(p) : "?",
              sub: `${tt(posName[l.role])} · %${Math.round(fit(l.pid))}`,
              sel: sel === l.pid,
              warn: p && p.pos !== l.role,
              onClick: () => tapPitch(l.pid),
            });
          }),
        ),
        h("p", { className: "px-hint" }, fin ? L("Maç bitti.", "Full time.") : sel == null ? L("Sahadan bir oyuncuya dokunun: sonra başka bir oyuncuya dokunursanız yer değiştirirler, yedekten birine dokunursanız oyuncu değişikliği olur.", "Tap a player on the pitch, then another to swap positions, or a substitute to bring him on.") : L("Yer değiştirmek için sahadan, oyuna almak için yedeklerden bir oyuncu seçin.", "Pick a team-mate to swap, or a substitute to bring on.")),
      ),
      h(
        "div",
        { className: "px-lineup-side" },
        h(
          "div",
          { className: "px-card" },
          h("div", { className: "px-card-head" }, h("h3", null, L("Yedekler", "Substitutes")), h("span", { className: "px-kicker" }, L(`${subsLeft} hak kaldı`, `${subsLeft} left`))),
          h(
            "div",
            { className: "px-list" },
            side.bench.map((id) => {
              const p = g.players[id];
              if (!p) return null;
              return h(Row, { key: id, p: { ...p, fitness: fit(id) }, ratingRole: selRole, disabled: fin || sel == null || subsLeft <= 0 || p.injury > 0, onClick: () => { sub(sel, id); setSel(null); } });
            }),
          ),
          side.out.length > 0 && h("p", { className: "px-hint" }, L("Oyundan çıkanlar: ", "Off: "), side.out.map((id) => (g.players[id] ? D.shortName(g.players[id]) : "?")).join(", ")),
        ),
        h("div", { className: "px-card" }, h(MatchTactics, { ms, u, bump })),
      ),
    );
  }

  /** "İlk 11" button inside the live match: pauses and opens the live line-up. */
  function LiveXIButton({ ms, u, onOpen }) {
    const { L } = useI18n();
    const [open, setOpen] = useState(false);
    useEffect(() => {
      if (!open) return;
      const k = (e) => e.key === "Escape" && setOpen(false);
      window.addEventListener("keydown", k);
      return () => window.removeEventListener("keydown", k);
    }, [open]);
    return h(
      React.Fragment,
      null,
      h(Button, { variant: "outline", onClick: () => { onOpen?.(); setOpen(true); } }, "👕 ", L("İlk 11", "Line-up")),
      open &&
        h(
          "div",
          { className: "px-modal", role: "dialog", "aria-modal": "true", "aria-label": L("İlk 11", "Line-up"), onClick: (e) => e.target === e.currentTarget && setOpen(false) },
          h(
            "div",
            { className: "px-modal-box" },
            h("div", { className: "px-modal-head" }, h("h2", null, L("İlk 11 · Canlı", "Line-up · Live")), h(Button, { size: "sm", onClick: () => setOpen(false) }, L("Maça dön", "Back to match"))),
            h(LiveLineup, { ms, u }),
          ),
        ),
    );
  }

  /* ---------------- İlk 11 screen ---------------- */
  function LineupScreen() {
    const { game: g, act, live, setScreen } = useGame();
    const { L } = useI18n();
    if (g.clubId == null) return h(EmptyState, null, L("Bir kulübünüz yok.", "You have no club."));
    const club = D.getClub(g, g.clubId);
    const liveMine = live && !live.finished && live.sides.some((s) => s.clubId === g.clubId);
    const tac = club.tactic;
    const xiPlayers = tac.xi.map((id) => g.players[id]).filter(Boolean);
    const setT = (k, v) => act((gg) => void (D.getClub(gg, gg.clubId).tactic[k] = v));
    const seg = (label, key, opts) =>
      h(
        "div",
        { className: "px-seg-g" },
        h("p", { className: "px-kicker" }, label),
        h("div", { className: "px-seg" }, opts.map(([v, tr, en]) => h("button", { key: v, type: "button", className: cx(tac[key] === v && "is-on"), "aria-pressed": tac[key] === v, onClick: () => setT(key, v) }, L(tr, en)))),
      );
    return h(
      "div",
      { className: "px-screen" },
      h(
        "header",
        { className: "px-hero" },
        h("div", null, h("p", { className: "px-kicker" }, club.name), h("h1", { className: "px-title" }, L("İlk 11", "Line-up"))),
        !liveMine && h("div", { className: "px-hero-act" }, h(Button, { variant: "outline", onClick: () => { act((gg) => D.autoPick(gg, D.getClub(gg, gg.clubId))); toast.success(L("En iyi 11 otomatik seçildi", "Best XI auto-selected")); } }, "✨ ", L("Otomatik Diz", "Auto Pick"))),
      ),
      liveMine
        ? h(
            React.Fragment,
            null,
            h("div", { className: "px-banner" }, h("span", null, "🔴 ", L("Canlı maç sürüyor: değişiklikler sahaya hemen yansır.", "Live match in progress: changes apply on the pitch.")), h(Button, { size: "sm", onClick: () => setScreen("match") }, L("Maça dön", "Back to match"))),
            h(LiveLineup, { ms: live, u: live.sides[0].clubId === g.clubId ? 0 : 1 }),
          )
        : h(
            React.Fragment,
            null,
            h(
              "div",
              { className: "px-card px-formations" },
              h("p", { className: "px-kicker" }, L("Diziliş seç", "Pick a formation")),
              h("div", { className: "px-seg px-seg--wrap" }, Object.keys(formations).map((f) => h("button", { key: f, type: "button", className: cx(tac.formation === f && "is-on"), onClick: () => setT("formation", f) }, f))),
            ),
            h(ClubLineup, null),
            h(
              "div",
              { className: "px-grid-2" },
              h(
                "div",
                { className: "px-card" },
                h("div", { className: "px-card-head" }, h("h3", null, L("Takım görevleri", "Team roles"))),
                h(
                  "label",
                  { className: "px-field" },
                  h("span", { className: "px-kicker" }, L("Kaptan", "Captain")),
                  h("select", { value: tac.captain ?? "", onChange: (e) => setT("captain", Number(e.target.value)) }, xiPlayers.map((p) => h("option", { key: p.id, value: p.id }, D.shortName(p)))),
                ),
                h(
                  "label",
                  { className: "px-field" },
                  h("span", { className: "px-kicker" }, L("Penaltıcı", "Penalty taker")),
                  h("select", { value: tac.penalty ?? "", onChange: (e) => setT("penalty", Number(e.target.value)) }, [...xiPlayers].sort((a, b) => (b.attrs?.sho ?? 0) - (a.attrs?.sho ?? 0)).map((p) => h("option", { key: p.id, value: p.id }, `${D.shortName(p)} (${p.attrs?.sho ?? "?"})`))),
                ),
              ),
              h(
                "div",
                { className: "px-card" },
                h("div", { className: "px-card-head" }, h("h3", null, L("Oyun planı", "Game plan"))),
                seg(L("Oyun anlayışı", "Mentality"), "mentality", [["defensive", "Çok Defansif", "Defensive"], ["cautious", "Temkinli", "Cautious"], ["balanced", "Dengeli", "Balanced"], ["attacking", "Hücum", "Attacking"], ["allout", "Tam Hücum", "All-out"]]),
                seg(L("Pres", "Pressing"), "pressing", [["low", "Düşük", "Low"], ["mid", "Orta", "Medium"], ["high", "Yüksek", "High"]]),
                seg(L("Tempo", "Tempo"), "tempo", [["slow", "Yavaş", "Slow"], ["normal", "Normal", "Normal"], ["fast", "Hızlı", "Fast"]]),
                seg(L("Genişlik", "Width"), "width", [["narrow", "Dar", "Narrow"], ["normal", "Normal", "Normal"], ["wide", "Geniş", "Wide"]]),
              ),
            ),
          ),
    );
  }

  /* ---------------- academy ---------------- */
  function AcademyScreen() {
    const { game: g, act } = useGame();
    const { L, tt } = useI18n();
    const px = g.px?.academy;
    useEffect(() => {
      if (g.clubId != null && (!g.px || g.px.academy?.season == null)) act((gg) => { ensure(gg); academyIntake(gg, true); });
    }, [g.clubId]);
    if (g.clubId == null) return h(EmptyState, null, L("Bir kulübünüz yok.", "You have no club."));
    const club = D.getClub(g, g.clubId);
    const lvl = academyLevel(g);
    const list = [...(px?.list ?? [])].sort((a, b) => b.pot - a.pot);
    const grads = D.clubPlayers(g, club.id).filter((p) => p.pxYouth);
    const stars = (p) => {
      const n = clamp(Math.round((p.pot - 55) / 7), 1, 5);
      return "★".repeat(n) + "☆".repeat(5 - n);
    };
    return h(
      "div",
      { className: "px-screen" },
      h(
        "header",
        { className: "px-hero px-hero--club" },
        h("div", null, h("p", { className: "px-kicker" }, club.name), h("h1", { className: "px-title" }, L("Altyapı", "Academy")), h("p", { className: "px-sub" }, L("Genç yetenekler burada gelişir. Hazır olduklarında A takıma alın; 18 yaşını geçen ve alınmayan oyuncular ayrılır.", "Youngsters develop here. Promote them when ready; those past 18 who are not promoted leave."))),
        h(
          "div",
          { className: "px-stats" },
          h("div", null, h("span", { className: "px-kicker" }, L("Akademi seviyesi", "Academy level")), h("b", { className: "px-big" }, `${lvl}/10`)),
          h("div", null, h("span", { className: "px-kicker" }, L("Oyuncu", "Prospects")), h("b", { className: "px-big" }, list.length)),
          h("div", null, h("span", { className: "px-kicker" }, L("Mezun", "Graduates")), h("b", { className: "px-big" }, grads.length)),
        ),
      ),
      list.length === 0
        ? h(EmptyState, null, L("Şu an altyapıda oyuncu yok. Yeni sezonda yeni gençler gelecek.", "No prospects right now. A new intake arrives next season."))
        : h(
            "div",
            { className: "px-cards" },
            list.map((p) =>
              h(
                "article",
                { key: p.id, className: "px-pcard" },
                h("div", { className: "px-pcard-top", style: { background: `linear-gradient(135deg, ${club.colors?.[0]} 0 60%, ${club.colors?.[1]} 60%)` } }, h(Pos, { pos: p.pos }), h("span", { className: "px-pcard-age" }, L(`${p.age} yaş`, `Age ${p.age}`))),
                h("div", { className: "px-pcard-body" }, h("p", { className: "px-pcard-name" }, h(Flag, { nat: p.nat }), " ", D.fullName(p)), h("div", { className: "px-pcard-nums" }, h("div", null, h("span", { className: "px-kicker" }, L("Güç", "Now")), h(Ovr, { v: D.ovr(p), big: true })), h("div", null, h("span", { className: "px-kicker" }, L("Potansiyel", "Potential")), h("span", { className: "px-stars", title: `${p.pot}` }, stars(p))))),
                h(
                  "div",
                  { className: "px-pcard-act" },
                  h(Button, { size: "sm", onClick: () => { act((gg) => promote(gg, p.id)); toast.success(L(`${D.shortName(p)} A takıma alındı`, `${D.shortName(p)} promoted`)); } }, L("A Takıma Al", "Promote")),
                  h(Button, { size: "sm", variant: "ghost", onClick: () => act((gg) => release(gg, p.id)) }, L("Bırak", "Release")),
                ),
              ),
            ),
          ),
      grads.length > 0 &&
        h(
          "div",
          { className: "px-card" },
          h("div", { className: "px-card-head" }, h("h3", null, L("A takımdaki altyapı mezunları", "Academy graduates in the squad"))),
          h("div", { className: "px-list" }, grads.map((p) => h(Row, { key: p.id, p, extra: h("span", { className: "px-kicker" }, L(`${p.age} yaş`, `age ${p.age}`)) }))),
        ),
    );
  }

  /* ---------------- transfer market (Kaiser-style cards) ---------------- */
  const GROUPS = [
    ["all", "Tümü", "All", null],
    ["gk", "Kaleci", "GK", ["GK"]],
    ["def", "Defans", "Defence", ["CB", "LB", "RB"]],
    ["mid", "Orta saha", "Midfield", ["DM", "CM", "AM"]],
    ["att", "Hücum", "Attack", ["LW", "RW", "ST"]],
  ];
  function TransferMarket({ onSelect }) {
    const { game: g, act } = useGame();
    const { L } = useI18n();
    const [grp, setGrp] = useState("all");
    const [age, setAge] = useState(40);
    const [money, setMoney] = useState("budget");
    const [sort, setSort] = useState("ovr");
    const [q, setQ] = useState("");
    const [only, setOnly] = useState("all");
    const [n, setN] = useState(24);
    const club = g.clubId == null ? null : D.getClub(g, g.clubId);
    const sl = new Set(g.px?.shortlist ?? []);
    const need = club && D.need ? D.need(g, club) : null;
    const list = useMemo(() => {
      const pos = GROUPS.find((x) => x[0] === grp)?.[3];
      const cap = money === "budget" ? (club?.transferBudget ?? Infinity) : money === "any" ? Infinity : Number(money);
      const s = q.trim().toLocaleLowerCase("tr");
      const out = Object.values(g.players)
        .filter((p) => p.clubId !== g.clubId && !p.pxAcademy)
        .filter((p) => !pos || pos.includes(p.pos))
        .filter((p) => p.age <= age)
        .filter((p) => only === "all" || (only === "free" ? p.clubId == null : only === "listed" ? p.listed : sl.has(p.id)))
        .filter((p) => D.value(p, g.season) <= cap)
        .filter((p) => !s || D.fullName(p).toLocaleLowerCase("tr").includes(s));
      const key = sort === "ovr" ? (p) => D.ovr(p) : sort === "pot" ? (p) => p.pot ?? 0 : sort === "value" ? (p) => -D.value(p, g.season) : (p) => -p.age;
      return out.sort((a, b) => key(b) - key(a));
    }, [g, grp, age, money, sort, q, only, g.px?.shortlist?.length]);
    const toggle = (pid) => act((gg) => { const px = ensure(gg); px.shortlist = px.shortlist.includes(pid) ? px.shortlist.filter((x) => x !== pid) : [...px.shortlist, pid]; });
    const chip = (cur, set, v, label) => h("button", { key: v, type: "button", className: cx(cur === v && "is-on"), onClick: () => { set(v); setN(24); } }, label);
    return h(
      "div",
      { className: "px-market" },
      club &&
        h(
          "div",
          { className: "px-stats px-stats--bar" },
          h("div", null, h("span", { className: "px-kicker" }, L("Transfer bütçesi", "Transfer budget")), h("b", { className: "px-big" }, D.money(club.transferBudget))),
          h("div", null, h("span", { className: "px-kicker" }, L("Pencere", "Window")), h("b", { className: "px-big" }, D.windowOpen(g) ? L("Açık", "Open") : L("Kapalı", "Closed"))),
          need && h("div", null, h("span", { className: "px-kicker" }, L("Kadro ihtiyacı", "Squad need")), h(Pos, { pos: need })),
          h("div", null, h("span", { className: "px-kicker" }, L("Takip listesi", "Shortlist")), h("b", { className: "px-big" }, sl.size)),
        ),
      h(
        "div",
        { className: "px-card px-filters" },
        h("input", { className: "px-input", placeholder: L("Oyuncu ara…", "Search players…"), value: q, onChange: (e) => setQ(e.target.value) }),
        h("div", { className: "px-seg px-seg--wrap" }, GROUPS.map(([v, tr, en]) => chip(grp, setGrp, v, L(tr, en)))),
        h("div", { className: "px-seg px-seg--wrap" }, chip(only, setOnly, "all", L("Herkes", "Everyone")), chip(only, setOnly, "listed", L("Satılık", "Listed")), chip(only, setOnly, "free", L("Serbest", "Free agents")), chip(only, setOnly, "short", L("★ Takip", "★ Shortlist"))),
        h(
          "div",
          { className: "px-filter-row" },
          h("label", { className: "px-field" }, h("span", { className: "px-kicker" }, L("Yaş en fazla", "Max age")), h("select", { value: age, onChange: (e) => setAge(Number(e.target.value)) }, [19, 21, 23, 25, 28, 31, 40].map((a) => h("option", { key: a, value: a }, a === 40 ? L("Hepsi", "Any") : a)))),
          h("label", { className: "px-field" }, h("span", { className: "px-kicker" }, L("Değer en fazla", "Max value")), h("select", { value: money, onChange: (e) => setMoney(e.target.value) }, [["budget", L("Bütçem", "My budget")], ["1000000", "€1M"], ["5000000", "€5M"], ["15000000", "€15M"], ["40000000", "€40M"], ["any", L("Sınırsız", "Any")]].map(([v, l]) => h("option", { key: v, value: v }, l)))),
          h("label", { className: "px-field" }, h("span", { className: "px-kicker" }, L("Sırala", "Sort")), h("select", { value: sort, onChange: (e) => setSort(e.target.value) }, [["ovr", L("Güç", "Rating")], ["pot", L("Potansiyel", "Potential")], ["value", L("Ucuzdan pahalıya", "Cheapest")], ["age", L("En genç", "Youngest")]].map(([v, l]) => h("option", { key: v, value: v }, l)))),
        ),
      ),
      h("p", { className: "px-hint" }, L(`${list.length} oyuncu bulundu`, `${list.length} players found`)),
      h(
        "div",
        { className: "px-cards" },
        list.slice(0, n).map((p) => {
          const pc = p.clubId == null ? null : D.getClub(g, p.clubId);
          const val = D.value(p, g.season);
          const young = p.age <= 23 && (p.pot ?? 0) - D.ovr(p) >= 4;
          return h(
            "article",
            { key: p.id, className: "px-pcard" },
            h(
              "div",
              { className: "px-pcard-top", style: pc ? { background: `linear-gradient(135deg, ${pc.colors?.[0]} 0 60%, ${pc.colors?.[1]} 60%)` } : undefined },
              h(Pos, { pos: p.pos }),
              pc ? h(ClubBadge, { club: pc, size: "sm" }) : h("span", { className: "px-tag" }, L("Serbest", "Free")),
              h("button", { type: "button", className: cx("px-star", sl.has(p.id) && "is-on"), onClick: () => toggle(p.id), "aria-label": L("Takip listesi", "Shortlist") }, sl.has(p.id) ? "★" : "☆"),
            ),
            h(
              "div",
              { className: "px-pcard-body" },
              h("p", { className: "px-pcard-name" }, h(Flag, { nat: p.nat }), " ", D.fullName(p)),
              h("p", { className: "px-sub" }, `${pc?.name ?? L("Kulüpsüz", "Without club")} · ${L(`${p.age} yaş`, `age ${p.age}`)}`),
              h(
                "div",
                { className: "px-pcard-nums" },
                h("div", null, h("span", { className: "px-kicker" }, L("Güç", "Rating")), h(Ovr, { v: D.ovr(p), big: true })),
                h("div", null, h("span", { className: "px-kicker" }, L("Değer", "Value")), h("b", null, D.money(val))),
              ),
              h("div", { className: "px-tags" }, p.listed && h("span", { className: "px-tag px-tag--hot" }, L("Satılık", "Listed")), young && h("span", { className: "px-tag px-tag--up" }, L("Gelişime açık", "Rising")), p.contractEnd != null && p.contractEnd <= g.season + 1 && h("span", { className: "px-tag" }, L("Sözleşmesi bitiyor", "Expiring"))),
            ),
            h("div", { className: "px-pcard-act" }, h(Button, { size: "sm", onClick: () => onSelect(p.id) }, L("İncele / Teklif", "View / Bid"))),
          );
        }),
      ),
      n < list.length && h("div", { className: "px-more" }, h(Button, { variant: "outline", onClick: () => setN(n + 24) }, L("Daha fazla göster", "Show more"))),
    );
  }

  /** Keeps the club-colour variables in sync with the managed club. */
  function ClubTheme() {
    const { game: g } = useGame();
    const club = g.clubId == null ? null : D.getClub(g, g.clubId);
    useEffect(() => {
      applyClubTheme(club);
    }, [club?.id, club?.colors?.join(",")]);
    useEffect(() => () => applyClubTheme(null), []);
    return null;
  }

  return { LineupScreen, ClubLineup, LiveLineup, LiveXIButton, AcademyScreen, TransferMarket, ClubTheme };
}

export const PX = { init, ensure, migrate, weekly, seasonStart, bidRejected, offersExpiring, upsetAmount, rescalePotential, youthPotential, academyIntake, promote, release, stadiumPlan, applyClubTheme, createUI, PLAN };
