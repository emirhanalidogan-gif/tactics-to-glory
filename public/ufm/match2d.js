/*
 * Live 2D match view.
 *
 * A self-contained, real-time top-down renderer for the live match screen.
 * - Between key moments it runs an "ambient" possession simulation: both teams
 *   keep a compact shape that shifts with the ball, the team in possession
 *   circulates the ball player-to-player and the defending side presses.
 *   Possession share follows the real match engine statistics.
 * - When the match engine produces a key moment (goal, save, miss, penalty)
 *   it plays a scripted, deterministic sequence built from the real players:
 *   build-up passes, the shot by the actual shooter and the correct outcome
 *   (net bulge, keeper dive, post, wide/over, goal kick, kick-off restart).
 *
 * Coordinates are metres on a 105 x 68 pitch. Side 0 (home) attacks to the
 * right (+x), side 1 (away) to the left.
 *
 * The module is framework-agnostic apart from React; the host bundle injects
 * its React instance and a few game helpers through createMatch2D().
 */

const PL = 105;
const PW = 68;
const GOAL_HALF = 3.66;
const CY = PW / 2;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const dirOf = (side) => (side === 0 ? 1 : -1);
const goalXOf = (side) => (side === 0 ? PL : 0); // goal the side attacks
const progress = (side, x) => (side === 0 ? x / PL : 1 - x / PL);
const latN = (side, y) => (side === 0 ? y / PW : 1 - y / PW);
const toWorld = (side, d, l) => ({
  x: side === 0 ? d * PL : PL - d * PL,
  y: side === 0 ? l * PW : PW - l * PW,
});

function mulberry32(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

import { stadiumImage as __stadiumImage } from "./kaiser-ext.js?v=2";
import { stadiumPlan as __stadiumPlan } from "./plus-ext.js?v=1";

/* ------------------------------------------------------------------ kits */

function hexToRgb(hex) {
  let h = String(hex || "#888888").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [136, 136, 136];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function colorDist(a, b) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
}
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const inkFor = (hex) => (luminance(hex) > 0.45 ? "#0b1220" : "#ffffff");

const CLASH = 150;
function pickKits(homeColors = [], awayColors = []) {
  const home = { shirt: homeColors[0] || "#d1d5db", trim: homeColors[1] || "#111827" };
  let away = { shirt: awayColors[0] || "#1f2937", trim: awayColors[1] || "#f9fafb" };
  if (colorDist(home.shirt, away.shirt) < CLASH) {
    if (awayColors[1] && colorDist(home.shirt, awayColors[1]) >= CLASH) {
      away = { shirt: awayColors[1], trim: awayColors[0] };
    } else if (colorDist(home.shirt, "#f8fafc") >= CLASH) {
      away = { shirt: "#f8fafc", trim: awayColors[0] || "#0f172a" };
    } else {
      away = { shirt: "#111827", trim: awayColors[0] || "#f8fafc" };
    }
  }
  // Make sure the trim stands out against the shirt itself
  for (const k of [home, away]) if (colorDist(k.shirt, k.trim) < 90) k.trim = inkFor(k.shirt);
  const gkPool = ["#facc15", "#22d3ee", "#a3e635", "#f472b6", "#fb923c", "#c084fc", "#2dd4bf"];
  const taken = [home.shirt, away.shirt, "#1f7a3a"];
  const pickGk = () => {
    let best = gkPool[0];
    let bestScore = -1;
    for (const c of gkPool) {
      const s = Math.min(...taken.map((t) => colorDist(c, t)));
      if (s > bestScore) (bestScore = s), (best = c);
    }
    taken.push(best);
    return { shirt: best, trim: "#0b1220" };
  };
  const homeGk = pickGk();
  const awayGk = pickGk();
  return [
    { ...home, ink: inkFor(home.shirt), gk: { ...homeGk, ink: inkFor(homeGk.shirt) } },
    { ...away, ink: inkFor(away.shirt), gk: { ...awayGk, ink: inkFor(awayGk.shirt) } },
  ];
}

/* ------------------------------------------------------- formation slots */

// Fallback slot (x: 0-100 left→right, y: 0-100 attack→own goal) per role
const ROLE_DEFAULT = {
  GK: [50, 92],
  CB: [50, 77],
  LB: [12, 67],
  RB: [88, 67],
  DM: [50, 60],
  CM: [50, 47],
  AM: [50, 32],
  LW: [15, 24],
  RW: [85, 24],
  ST: [50, 16],
};
// Classic shirt numbers per role (the game has no squad numbers)
const ROLE_NUMBERS = {
  GK: [1, 12], RB: [2, 22], LB: [3, 13], CB: [4, 5, 15], DM: [6, 16], CM: [8, 14, 18],
  AM: [10, 20], RW: [7, 17], LW: [11, 19], ST: [9, 21, 23],
};
function assignNumbers(slots) {
  const used = new Set();
  const out = {};
  for (const s of slots) {
    let n = (ROLE_NUMBERS[s.role] || []).find((v) => !used.has(v));
    for (let v = 24; n == null; v++) if (!used.has(v)) n = v;
    used.add(n);
    out[s.pid] = n;
  }
  return out;
}

function computeSlots(lineup, formation) {
  const pool = [...(formation || [])];
  const out = [];
  const missing = {};
  for (const l of lineup) {
    const i = pool.findIndex((s) => s.role === l.role);
    if (i >= 0) {
      const s = pool.splice(i, 1)[0];
      out.push({ pid: l.pid, role: l.role, fx: s.x, fy: s.y });
    } else {
      out.push({ pid: l.pid, role: l.role, fx: null, fy: null });
      missing[l.role] = (missing[l.role] || 0) + 1;
    }
  }
  const seen = {};
  for (const o of out) {
    if (o.fx != null) continue;
    const [dx, dy] = ROLE_DEFAULT[o.role] || [50, 50];
    const n = missing[o.role];
    const k = (seen[o.role] = (seen[o.role] || 0) + 1) - 1;
    o.fx = clamp(dx + (k - (n - 1) / 2) * 22, 6, 94);
    o.fy = dy;
  }
  return out.map((o) => ({ ...o, d: (100 - o.fy) / 100, l: o.fx / 100 }));
}

/* ----------------------------------------------------------- simulation */

function newSim() {
  return {
    players: new Map(),
    ball: { x: PL / 2, y: CY, z: 0, mode: "dead", holder: null, from: null, to: null, t: 0, dur: 0, peak: 0, curve: 0, after: null, ease: "out" },
    poss: 0,
    holdLeft: 1,
    mode: "rest",
    kickSide: 0,
    kickWait: 0,
    time: 0,
    trail: [],
    cards: [],
    net: null,
    overlay: null,
    hl: null,
    recv: null,
    lastEvents: 0,
    sig: "",
  };
}

function kickoffPos(p, kickSide) {
  if (p.role === "GK") return toWorld(p.side, 0.025, 0.5);
  let d = (3 + p.slot.d * 47) / PL;
  let l = p.slot.l;
  if (p.side !== kickSide) d = Math.min(d, 0.4);
  return toWorld(p.side, Math.min(d, 0.47), l);
}

function syncPlayers(S, game, ms, getClub, formations, initial) {
  const sig = ms.sides
    .map((s) => s.lineup.map((l) => `${l.pid}:${l.role}`).join(",") + "|" + (s.formation || getClub(game, s.clubId)?.tactic?.formation || ""))
    .join("#");
  if (sig === S.sig) return;
  S.sig = sig;
  const keep = new Set();
  ms.sides.forEach((side, si) => {
    const club = getClub(game, side.clubId);
    const slots = computeSlots(side.lineup, formations[side.formation || club?.tactic?.formation]);
    const numbers = assignNumbers(slots);
    for (const s of slots) {
      keep.add(s.pid);
      let p = S.players.get(s.pid);
      if (!p) {
        p = {
          pid: s.pid,
          side: si,
          role: s.role,
          slot: { d: s.d, l: s.l },
          x: 0,
          y: 0,
          tx: 0,
          ty: 0,
          vx: 0,
          vy: 0,
          speed: 6,
          phase: (s.pid * 1.618) % (Math.PI * 2),
        };
        if (initial) {
          const k = kickoffPos(p, S.kickSide);
          p.x = k.x;
          p.y = k.y;
        } else {
          // substitute: enters from the halfway line touchline
          p.x = PL / 2 + (si === 0 ? -5 : 5);
          p.y = PW + 1.5;
        }
        p.tx = p.x;
        p.ty = p.y;
        S.players.set(s.pid, p);
      } else {
        p.role = s.role;
        p.slot = { d: s.d, l: s.l };
      }
      p.num = numbers[s.pid];
    }
  });
  for (const pid of [...S.players.keys()]) if (!keep.has(pid)) S.players.delete(pid);
  if (S.ball.holder != null && !S.players.has(S.ball.holder)) S.ball.holder = null;
}

const teamOf = (S, side) => [...S.players.values()].filter((p) => p.side === side);
const outfield = (S, side) => teamOf(S, side).filter((p) => p.role !== "GK");
const keeperOf = (S, side) => teamOf(S, side).find((p) => p.role === "GK");

function nearest(list, pt, exclude) {
  let best = null;
  let bd = Infinity;
  for (const p of list) {
    if (exclude && exclude.has(p.pid)) continue;
    const d = dist(p, pt);
    if (d < bd) (bd = d), (best = p);
  }
  return best ? { p: best, d: bd } : null;
}

function shapeTarget(p, S) {
  const b = S.ball;
  const bp = clamp(progress(p.side, b.x), 0, 1);
  const bl = clamp(latN(p.side, b.y), 0, 1);
  const inPoss = S.poss === p.side;
  let d;
  let l;
  if (p.role === "GK") {
    d = inPoss ? 0.03 + 0.13 * bp : 0.012 + 0.07 * bp;
    l = 0.5 + (bl - 0.5) * 0.28;
  } else {
    const t = clamp((p.slot.d - 0.18) / 0.64, 0, 1);
    if (inPoss) {
      const back = clamp(bp - 0.3, 0.1, 0.56);
      const front = clamp(bp + 0.25, 0.42, 0.9);
      d = lerp(back, front, t);
      l = 0.5 + (p.slot.l - 0.5) * 1.1 + (bl - 0.5) * 0.22;
    } else {
      const back = clamp(bp - 0.15, 0.05, 0.42);
      const front = clamp(bp + 0.14, 0.24, 0.62);
      d = lerp(back, front, t);
      l = 0.5 + (p.slot.l - 0.5) * 0.74 + (bl - 0.5) * 0.4;
    }
    d += Math.sin(S.time * 0.55 + p.phase) * 0.012;
    l += Math.cos(S.time * 0.45 + p.phase * 1.3) * 0.016;
  }
  return toWorld(p.side, clamp(d, 0.01, 0.95), clamp(l, 0.04, 0.96));
}

function movePlayer(p, dt) {
  const dx = p.tx - p.x;
  const dy = p.ty - p.y;
  const dd = Math.hypot(dx, dy);
  if (dd < 0.02) {
    p.vx = p.vy = 0;
    return;
  }
  const sp = Math.min(p.speed, dd * 2.2 + 0.25);
  const step = Math.min(dd, sp * dt);
  const nvx = (dx / dd) * (step / dt);
  const nvy = (dy / dd) * (step / dt);
  // light inertia for smoother turns
  p.vx = lerp(p.vx, nvx, Math.min(1, dt * 10));
  p.vy = lerp(p.vy, nvy, Math.min(1, dt * 10));
  p.x += p.vx * dt;
  p.y += p.vy * dt;
}

function startBall(S, to, dur, opts = {}) {
  const b = S.ball;
  b.from = { x: b.x, y: b.y };
  b.to = { x: to.x, y: to.y };
  b.t = 0;
  b.dur = Math.max(0.12, dur);
  b.peak = opts.peak ?? 0;
  b.curve = opts.curve ?? 0;
  b.ease = opts.ease ?? "out";
  b.mode = opts.mode ?? "pass";
  b.after = opts.after ?? null;
  b.recv = opts.recv ?? null; // pass receiver: the ball homes onto his feet
  b.holder = null;
  if (b.mode !== "shot") S.trail = [];
}

function updateBall(S, dt) {
  const b = S.ball;
  if (b.mode === "held") {
    const hp = S.players.get(b.holder);
    if (hp) {
      const sp = Math.hypot(hp.vx, hp.vy);
      const fx = sp > 0.3 ? hp.vx / sp : dirOf(hp.side);
      const fy = sp > 0.3 ? hp.vy / sp : 0;
      b.x = hp.x + fx * 0.85;
      b.y = hp.y + fy * 0.85;
      b.z = 0;
    }
    return;
  }
  if (b.mode === "pass" || b.mode === "shot" || b.mode === "loose") {
    b.t += dt;
    const u = Math.min(1, b.t / b.dur);
    if (b.mode === "pass" && b.recv != null) {
      // Track the receiver so the ball always arrives at his feet (no drifting to empty
      // spots and no snapping onto the player at the end).
      const r = S.players.get(b.recv);
      if (r) {
        const left = Math.max(0, b.dur - b.t);
        const sp = Math.hypot(r.vx, r.vy);
        const fx = sp > 0.3 ? r.vx / sp : dirOf(r.side);
        const fy = sp > 0.3 ? r.vy / sp : 0;
        b.to.x = clamp(r.x + r.vx * left + fx * 0.85, 0.5, PL - 0.5);
        b.to.y = clamp(r.y + r.vy * left + fy * 0.85, 0.5, PW - 0.5);
      }
    }
    const e = b.ease === "lin" ? u : 1 - (1 - u) ** 1.7;
    const nx = -(b.to.y - b.from.y);
    const ny = b.to.x - b.from.x;
    const nl = Math.hypot(nx, ny) || 1;
    const bend = Math.sin(Math.PI * e) * b.curve;
    b.x = lerp(b.from.x, b.to.x, e) + (nx / nl) * bend;
    b.y = lerp(b.from.y, b.to.y, e) + (ny / nl) * bend;
    b.z = b.peak * 4 * e * (1 - e);
    if (b.mode === "shot") {
      S.trail.push({ x: b.x, y: b.y - b.z * 0.45 });
      if (S.trail.length > 22) S.trail.shift();
    }
    if (u >= 1) {
      b.mode = "still";
      b.z = 0;
      const fn = b.after;
      b.after = null;
      fn && fn();
    }
  }
}

function giveBall(S, p, hold) {
  S.ball.mode = "held";
  S.ball.holder = p.pid;
  S.poss = p.side;
  S.holdLeft = hold;
  S.recv = null;
}

function passTo(S, from, target, rnd, opts = {}) {
  const d = dist(from, target);
  const long = d > 27;
  const dur = d / (long ? 21 : 15.5) + 0.12;
  const lead = opts.at || {
    x: clamp(target.x + target.vx * dur * 0.9, 1.5, PL - 1.5),
    y: clamp(target.y + target.vy * dur * 0.9, 1.5, PW - 1.5),
  };
  S.recv = target.pid;
  target.tx = lead.x;
  target.ty = lead.y;
  startBall(S, lead, opts.dur ?? dur, {
    recv: target.pid,
    peak: opts.peak ?? (long ? 1.6 + d * 0.05 : 0.12),
    // straight ground passes; only long balls get a slight bend
    curve: opts.curve ?? (long ? (rnd() - 0.5) * 0.8 : 0),
    after: () => {
      giveBall(S, target, opts.hold ?? 0.4 + rnd() * 1.2);
      opts.after && opts.after();
    },
  });
}

/* --------------------------------------------------------- ambient play */

function ambientDecide(S, dt, rnd, share) {
  const b = S.ball;
  if (b.mode === "still" || b.mode === "dead") {
    // loose ball: nearest player collects it
    const n = nearest([...S.players.values()], b);
    if (n) {
      n.p.tx = b.x;
      n.p.ty = b.y;
      if (n.d < 1.1) giveBall(S, n.p, 0.5 + rnd() * 0.8);
    }
    return;
  }
  if (b.mode !== "held") return;
  const hp = S.players.get(b.holder);
  if (!hp) {
    b.mode = "still";
    return;
  }
  const dir = dirOf(hp.side);
  const bp = progress(hp.side, hp.x);
  S.holdLeft -= dt;
  hp.tx = clamp(hp.x + dir * (bp > 0.8 ? 0.6 : 3.2), 2, PL - 2);
  hp.ty = clamp(hp.y + (CY - hp.y) * 0.04 + Math.sin(S.time * 1.4 + hp.phase) * 0.9, 2, PW - 2);
  hp.speed = 4.4;

  const opp = nearest(teamOf(S, 1 - hp.side), hp);
  // tackles: more likely against the side with less possession
  if (opp && opp.d < 1.5 && rnd() < dt * (0.55 + (share[hp.side] < 0.5 ? 0.6 : 0.15))) {
    giveBall(S, opp.p, 0.6 + rnd() * 0.8);
    return;
  }
  if (S.holdLeft > 0 && !(opp && opp.d < 1.8 && S.holdLeft < 0.6)) return;

  // choose a pass
  const mates = teamOf(S, hp.side).filter((m) => m.pid !== hp.pid && (m.role !== "GK" || (bp < 0.4 && rnd() < 0.2)));
  if (!mates.length) return;
  const oppTeam = teamOf(S, 1 - hp.side);
  let best = null;
  let bestScore = -Infinity;
  for (const m of mates) {
    const gain = (progress(m.side, m.x) - bp) * PL;
    const d = dist(hp, m);
    const press = nearest(oppTeam, m);
    let s = bp > 0.8 ? -Math.abs(gain) * 0.02 - gain * 0.05 : gain * 0.07;
    s -= Math.max(0, d - 30) * 0.16 + Math.max(0, 6 - d) * 0.45;
    if (press && press.d < 3) s -= 1.4;
    s += rnd() * 1.3;
    if (s > bestScore) (bestScore = s), (best = m);
  }
  const d = dist(hp, best);
  const press = nearest(oppTeam, best);
  let lossP = 0.08 * ((1 - share[hp.side]) / 0.5) + (press && press.d < 3 ? 0.1 : 0) + (d > 30 ? 0.07 : 0);
  if (bp > 0.82) lossP += 0.3; // the defence clears in the final third — real chances come from the engine
  if (rnd() < clamp(lossP, 0.04, 0.6)) {
    const mid = { x: lerp(hp.x, best.x, 0.7), y: lerp(hp.y, best.y, 0.7) };
    const it = nearest(oppTeam, mid);
    if (it) {
      passTo(S, hp, it.p, rnd, { at: { x: clamp(lerp(it.p.x, mid.x, 0.5), 1, PL - 1), y: clamp(lerp(it.p.y, mid.y, 0.5), 1, PW - 1) } });
      return;
    }
  }
  passTo(S, hp, best, rnd);
}

/* ------------------------------------------------------- highlight script */

function buildHighlight(S, ev, key, game, shortName) {
  const rnd = mulberry32((key * 2654435761) ^ ((ev.pid ?? 7) * 40503));
  const aSide = ev.side === 1 ? 1 : 0;
  const dSide = 1 - aSide;
  const dir = dirOf(aSide);
  const gx = goalXOf(aSide);
  const txt = (ev.text && (ev.text.tr || "")) + " " + (ev.text && (ev.text.en || ""));
  const isPen = /penalt/i.test(txt);
  const isPost = /direk|post/i.test(txt);
  const isHeader = /kafa|head/i.test(txt);
  const isOver = isHeader || (/over|üst/i.test(txt));
  const outcome = ev.kind === "goal" ? "goal" : ev.kind === "save" ? "save" : isPost ? "post" : isOver ? "over" : "wide";
  const att = outfield(S, aSide);
  let shooter = S.players.get(ev.pid);
  if (!shooter || shooter.side !== aSide) shooter = [...att].sort((a, b) => progress(aSide, b.x) - progress(aSide, a.x))[0];
  const sign = rnd() < 0.5 ? -1 : 1;
  if (!shooter) return null;
  const steps = [];
  const runs = [];

  // A scorer who is far from the box (a centre-back, a deep midfielder) gets his chance
  // from a corner: he has time to go up and the ball is played to him in the box.
  const isLongTxt = /uzaktan|ceza sahası dışından|long-range|from distance/i.test(txt);
  let header = isHeader;
  const cornerAt = !isPen && !isLongTxt && toWorld(aSide, 1 - (6 + rnd() * 4) / PL, 0.5 + (rnd() - 0.5) * 0.24);
  // Corners are rare: only a defender who is still deep in his own half, and only some of the time.
  // Everyone else makes a late run into the box during the build-up instead.
  const deepDefender = ["CB", "LB", "RB", "GK"].includes(shooter.role);
  const isCorner = !isPen && !isLongTxt && deepDefender && dist(shooter, cornerAt) > 48 && rnd() < 0.2;

  if (isPen) {
    steps.push({ type: "penSetup", dur: 1.7 });
    steps.push({ type: "runup", dur: 0.75 });
  } else if (isCorner) {
    header = true;
    const flag = { x: gx - dir * 0.4, y: sign < 0 ? 0.4 : PW - 0.4 };
    // the attacker nearest the corner flag takes it
    const crosser = [...att].filter((p) => p.pid !== shooter.pid).sort((a, b) => dist(a, flag) - dist(b, flag))[0];
    steps.push({ type: "cornerSetup", dur: 1.9, flag, crosser: crosser?.pid, shooterAt: cornerAt });
    if (crosser) steps.push({ type: "await", pid: crosser.pid, at: { x: flag.x - dir * 0.6, y: flag.y + (sign < 0 ? -0.3 : 0.3) }, tol: 1, max: 3 });
    steps.push({ type: "await", pid: shooter.pid, at: cornerAt, tol: 1.5, max: 3.5 });
    steps.push({ type: "pass", pid: shooter.pid, at: cornerAt, peak: 3.4, cross: true });
  } else {
    steps.push({ type: "regain" });
    steps.push({ type: "runs" });
    const pool = att.filter((p) => p.pid !== shooter?.pid);
    const n = isHeader ? 1 : 1 + Math.floor(rnd() * 2);
    const chain = [];
    const pref = { AM: 3, LW: 2.6, RW: 2.6, CM: 2.2, ST: 2, DM: 1.2, LB: 1.1, RB: 1.1, CB: 0.4 };
    if (isHeader) {
      const wide = [...pool].sort((a, b) => Math.abs(b.slot.l - 0.5) * 2 + rnd() * 0.3 - (Math.abs(a.slot.l - 0.5) * 2 + rnd() * 0.3))[0];
      if (wide) chain.push(wide);
    } else {
      const cand = [...pool];
      for (let i = 0; i < n && cand.length; i++) {
        let tot = 0;
        const w = cand.map((p) => (tot += pref[p.role] || 1));
        const r = rnd() * tot;
        const idx = Math.max(0, w.findIndex((v) => v >= r));
        chain.push(cand.splice(idx, 1)[0]);
      }
    }
    chain.forEach((p, i) => {
      let d;
      let l;
      if (isHeader) {
        d = 0.82 + rnd() * 0.06;
        l = p.slot.l < 0.5 ? 0.08 + rnd() * 0.06 : 0.86 + rnd() * 0.06;
      } else {
        d = lerp(0.5, 0.78, (i + 1) / (chain.length + 1)) + rnd() * 0.05;
        l = clamp(lerp(p.slot.l, 0.5, 0.25) + (rnd() - 0.5) * 0.16, 0.08, 0.92);
      }
      const at = toWorld(aSide, d, l);
      runs.push({ pid: p.pid, at });
      steps.push({ type: "await", pid: p.pid, at, tol: 4, max: 3 });
      steps.push({ type: "pass", pid: p.pid, at });
      steps.push({ type: "dribble", pid: p.pid, dur: 0.35 + rnd() * 0.45 });
    });
    // Most goals are close-range finishes; long-range screamers only when the
    // engine says so (rare "ceza sahası dışından" goals).
    const isLong = isLongTxt;
    const shotDist = isHeader
      ? 5 + rnd() * 4
      : isLong
        ? 22 + rnd() * 6
        : outcome === "goal"
          ? 6 + rnd() * 6
          : 8 + rnd() * 9;
    const close = !isLong && outcome === "goal";
    const shotLat = 0.5 + (rnd() - 0.5) * (isHeader ? 0.14 : close ? 0.22 : 0.3);
    const shotAt = toWorld(aSide, 1 - shotDist / PL, shotLat);
    runs.push({ pid: shooter.pid, at: shotAt });
    // the shooter must really be in the box before he gets the ball (no 40 m "close-range" goals)
    steps.push({ type: "await", pid: shooter.pid, at: shotAt, tol: 1.5, max: clamp(dist(shooter, shotAt) / 9 + 1, 4, 9) });
    steps.push({
      type: "pass",
      pid: shooter.pid,
      at: shotAt,
      peak: isHeader ? 3.2 : undefined,
      cross: isHeader,
    });
    if (!isHeader) steps.push({ type: "dribble", pid: shooter.pid, dur: close ? 0.15 + rnd() * 0.15 : 0.25 + rnd() * 0.3 });
  }

  // shot target and keeper movement
  let target;
  let gkTo;
  let peak = 0.35 + rnd() * 0.6;
  if (outcome === "goal") {
    const ty = CY + sign * (1 + rnd() * 2.3);
    target = { x: gx + dir * 1.7, y: ty };
    gkTo = { x: gx - dir * 0.7, y: CY + sign * 0.4 - sign * rnd() * 2.2 };
    if (isPen && rnd() < 0.6) gkTo = { x: gx - dir * 0.6, y: CY - sign * 2.6 };
  } else if (outcome === "save") {
    const ty = CY + sign * (0.5 + rnd() * 2.6);
    target = { x: gx - dir * 0.9, y: ty };
    gkTo = { ...target };
  } else if (outcome === "post") {
    target = { x: gx, y: CY + sign * GOAL_HALF };
    gkTo = { x: gx - dir * 0.6, y: CY + sign * 1.2 };
  } else if (outcome === "over") {
    target = { x: gx + dir * 3.5, y: CY + sign * rnd() * 2.6 };
    peak = 3.6 + rnd();
    gkTo = { x: gx - dir * 0.7, y: CY + sign * 0.8 };
  } else {
    target = { x: gx + dir * 3.5, y: CY + sign * (4.8 + rnd() * 5) };
    gkTo = { x: gx - dir * 0.7, y: CY + sign * 1.5 };
  }
  steps.push({ type: "shot", pid: shooter.pid, target, gkTo, peak: header ? Math.max(peak, 0.8) : peak, header });
  steps.push({ type: "outcome", outcome });

  return {
    key,
    ev,
    rnd,
    aSide,
    dSide,
    dir,
    gx,
    isPen,
    outcome,
    shooter: shooter?.pid,
    shooterName: shooter && game.players[shooter.pid] ? shortName(game.players[shooter.pid]) : "",
    steps,
    runs,
    idx: -1,
    wait: 0,
    waitBall: false,
    done: false,
    finishedAt: null,
    lock: new Set(),
    gkDive: null,
  };
}

function snapshot(S) {
  return {
    players: [...S.players.values()].map((p) => ({ ...p, slot: { ...p.slot } })),
    ball: { ...S.ball, after: null, from: S.ball.from && { ...S.ball.from }, to: S.ball.to && { ...S.ball.to } },
    poss: S.poss,
    holdLeft: S.holdLeft,
  };
}
function restore(S, snap) {
  S.players = new Map(snap.players.map((p) => [p.pid, { ...p, slot: { ...p.slot } }]));
  S.ball = { ...snap.ball, after: null };
  if (S.ball.mode === "pass" || S.ball.mode === "shot" || S.ball.mode === "loose") S.ball.mode = "still";
  S.poss = snap.poss;
  S.holdLeft = snap.holdLeft;
  S.trail = [];
  S.net = null;
  S.overlay = null;
  S.recv = null;
  S.sig = ""; // force a re-sync with the current line-ups
}

/** Nearest defender runs onto a rebound so the ball never sits alone on the pitch. */
function chaseLoose(S, H, spot) {
  const n = nearest(outfield(S, H.dSide), spot);
  if (!n) return;
  n.p.tx = spot.x;
  n.p.ty = spot.y;
  n.p.speed = 7.5;
  H.lock.add(n.p.pid);
}

function runHighlight(S, dt) {
  const H = S.hl;
  if (!H || H.done) return;
  const rnd = H.rnd;
  if (H.wait > 0) H.wait -= dt;
  if (H.wait > 0 || H.waitBall) return;
  // penalties: wait until the taker has actually reached his mark (snap if he is late)
  if (H.arrive) {
    const p = S.players.get(H.arrive.pid);
    if (p && dist(p, H.arrive) > H.arrive.tol && S.time < H.arrive.until) return;
    if (p && dist(p, H.arrive) > H.arrive.tol) {
      // late: put him on his mark (rare; runs start early)
      p.x = H.arrive.x - (H.arrive.keep ? dirOf(p.side) * 0.6 : 0);
      p.y = H.arrive.y;
    }
    if (p) {
      p.tx = H.arrive.x;
      p.ty = H.arrive.y;
    }
    H.arrive = null;
  }
  H.idx++;
  const st = H.steps[H.idx];
  if (!st) {
    H.done = true;
    return;
  }
  const b = S.ball;
  switch (st.type) {
    case "regain": {
      S.poss = H.aSide;
      const holder = b.mode === "held" ? S.players.get(b.holder) : null;
      if (holder && holder.side === H.aSide && holder.role !== "GK") {
        H.wait = 0.15;
        break;
      }
      const cand = outfield(S, H.aSide).filter((p) => p.pid !== H.shooter);
      const n = nearest(cand.length ? cand : outfield(S, H.aSide), b);
      if (!n) break;
      H.waitBall = true;
      passTo(S, b, n.p, rnd, {
        at: { x: lerp(n.p.x, b.x, 0.4), y: lerp(n.p.y, b.y, 0.4) },
        dur: 0.45,
        peak: 0.4,
        hold: 9,
        after: () => (H.waitBall = false),
      });
      break;
    }
    case "runs": {
      // everyone in the move starts his run at once, so the attack arrives together
      for (const r of H.runs || []) {
        const p = S.players.get(r.pid);
        if (!p || b.holder === p.pid) continue;
        p.tx = r.at.x;
        p.ty = r.at.y;
        p.speed = 9.5;
        H.lock.add(p.pid);
      }
      break;
    }
    case "await": {
      const p = S.players.get(st.pid);
      if (p && b.holder !== p.pid) {
        p.tx = st.at.x;
        p.ty = st.at.y;
        p.speed = Math.max(p.speed || 0, 9.5);
        H.lock.add(p.pid);
        H.arrive = { pid: p.pid, x: st.at.x, y: st.at.y, tol: st.tol, until: S.time + st.max, keep: true };
      }
      break;
    }
    case "dribble": {
      const p = S.players.get(st.pid);
      if (p) {
        p.tx = clamp(p.x + H.dir * 3, 1, PL - 1);
        p.ty = p.y + (CY - p.y) * 0.15;
        p.speed = 5.2;
      }
      H.wait = st.dur;
      break;
    }
    case "pass": {
      const from = S.players.get(b.holder);
      const to = S.players.get(st.pid);
      if (!to) break;
      const src = from || b;
      const d = dist(src, st.at);
      const dur = st.cross ? 0.95 + d / 40 : clamp(d / 17 + 0.15, 0.4, 1.4);
      H.lock.add(to.pid);
      to.speed = clamp(dist(to, st.at) / dur + 0.5, 5, 10.5);
      H.waitBall = true;
      passTo(S, src, to, rnd, {
        at: st.at,
        dur,
        peak: st.peak ?? (d > 26 ? 1.8 + d * 0.04 : 0.15),
        curve: st.cross ? -H.dir * 1.2 : 0,
        hold: 9,
        after: () => {
          H.waitBall = false;
          H.lock.delete(to.pid);
        },
      });
      break;
    }
    case "penSetup": {
      const gk = keeperOf(S, H.dSide);
      const spot = { x: H.gx - H.dir * 11, y: CY };
      b.mode = "dead";
      b.holder = null;
      b.x = spot.x;
      b.y = spot.y;
      b.z = 0;
      const others = [...S.players.values()].filter((p) => p.pid !== H.shooter && p !== gk && p.role !== "GK");
      others.sort((a, c) => a.y - c.y);
      others.forEach((p, i) => {
        const t = others.length > 1 ? i / (others.length - 1) : 0.5;
        const y = lerp(14, 54, t);
        const edge = 18 + Math.max(0, 8 - Math.abs(y - CY)) * 0.35 + rnd() * 3.5;
        p.tx = H.gx - H.dir * edge;
        p.ty = y + (rnd() - 0.5) * 2;
        p.speed = 7;
        H.lock.add(p.pid);
      });
      const ownGk = keeperOf(S, H.aSide);
      if (ownGk) H.lock.delete(ownGk.pid);
      if (gk) {
        gk.tx = H.gx - H.dir * 0.4;
        gk.ty = CY;
        gk.speed = 6;
        H.lock.add(gk.pid);
      }
      const sh = S.players.get(H.shooter);
      if (sh) {
        sh.tx = spot.x - H.dir * 3.2;
        sh.ty = CY - 1.6;
        sh.speed = 9;
        H.lock.add(sh.pid);
        H.arrive = { pid: sh.pid, x: sh.tx, y: sh.ty, tol: 0.5, until: S.time + 4 };
      }
      H.wait = st.dur;
      break;
    }
    case "cornerSetup": {
      S.poss = H.aSide;
      b.mode = "dead";
      b.holder = null;
      b.x = st.flag.x;
      b.y = st.flag.y;
      b.z = 0;
      const ownGk = keeperOf(S, H.aSide);
      const gk = keeperOf(S, H.dSide);
      const atk = outfield(S, H.aSide).filter((p) => p.pid !== st.crosser && p.pid !== H.shooter);
      const def = outfield(S, H.dSide);
      // attackers crowd the box (the two deepest stay back), defenders mark them
      atk.sort((a, c) => progress(H.aSide, c.x) - progress(H.aSide, a.x));
      const boxers = atk.slice(0, Math.max(0, atk.length - 2));
      const spots = [];
      boxers.forEach((p, i) => {
        const t = boxers.length > 1 ? i / (boxers.length - 1) : 0.5;
        const spot = { x: H.gx - H.dir * (7 + rnd() * 9), y: lerp(CY - 12, CY + 12, t) + (rnd() - 0.5) * 3 };
        spots.push(spot);
        p.tx = spot.x;
        p.ty = spot.y;
        p.speed = 7.5;
        H.lock.add(p.pid);
      });
      atk.slice(boxers.length).forEach((p) => {
        p.tx = toWorld(H.aSide, 0.55, p.slot.l).x;
        p.ty = clamp(p.y, 12, PW - 12);
        p.speed = 5;
        H.lock.add(p.pid);
      });
      spots.push(st.shooterAt);
      def.forEach((p, i) => {
        const m = spots[i % spots.length];
        p.tx = m.x - H.dir * 0.9;
        p.ty = m.y + (i % 2 ? 0.8 : -0.8);
        p.speed = 7.5;
        H.lock.add(p.pid);
      });
      if (gk) {
        gk.tx = H.gx - H.dir * 0.8;
        gk.ty = CY + (st.flag.y < CY ? -1.2 : 1.2);
        gk.speed = 5;
        H.lock.add(gk.pid);
      }
      if (ownGk) H.lock.delete(ownGk.pid);
      const cr = S.players.get(st.crosser);
      if (cr) {
        cr.tx = st.flag.x - H.dir * 0.6;
        cr.ty = st.flag.y + (st.flag.y < CY ? -0.3 : 0.3);
        cr.speed = 9;
        H.lock.add(cr.pid);
      }
      const sh = S.players.get(H.shooter);
      if (sh) {
        sh.tx = st.shooterAt.x;
        sh.ty = st.shooterAt.y;
        sh.speed = 9.5;
        H.lock.add(sh.pid);
      }
      H.wait = st.dur;
      break;
    }
    case "runup": {
      const sh = S.players.get(H.shooter);
      if (sh) {
        sh.tx = b.x - H.dir * 0.7;
        sh.ty = b.y - 0.3;
        sh.speed = 4.5;
        H.lock.add(sh.pid);
        H.arrive = { pid: sh.pid, x: sh.tx, y: sh.ty, tol: 0.35, until: S.time + 1.6 };
      }
      H.wait = st.dur;
      break;
    }
    case "shot": {
      const sh = S.players.get(st.pid);
      if (sh && b.mode === "held") b.holder = sh.pid;
      if (sh && H.isPen && dist(sh, b) > 1.2) {
        sh.x = b.x - H.dir * 0.7;
        sh.y = b.y - 0.3;
      }
      const gk = keeperOf(S, H.dSide);
      const d = dist(b, st.target);
      const dur = st.header ? 0.42 + d / 60 : clamp(d / 30, 0.32, 0.75);
      S.trail = [{ x: b.x, y: b.y }];
      startBall(S, st.target, dur, { mode: "shot", ease: "lin", peak: st.peak, curve: (H.rnd() - 0.5) * 1.6 });
      if (gk) {
        H.lock.add(gk.pid);
        const late = H.outcome === "goal" ? 0.55 : 0.2;
        H.gkDive = { pid: gk.pid, at: S.time + dur * late, to: st.gkTo, speed: dist(gk, st.gkTo) / Math.max(0.12, dur * (1 - late)) + 1 };
      }
      if (sh) {
        sh.tx = sh.x + H.dir * 1.5;
        sh.ty = sh.y;
        sh.speed = 3;
      }
      H.waitBall = true;
      S.ball.after = () => (H.waitBall = false);
      break;
    }
    case "outcome": {
      const o = st.outcome;
      const gk = keeperOf(S, H.dSide);
      if (o === "goal") {
        b.mode = "dead";
        S.net = { x: H.gx, t: S.time, dir: H.dir };
        S.overlay = { kind: "goal", t: S.time, side: H.aSide, name: H.shooterName, min: H.ev.min };
        // celebration: scorer runs to a corner flag, team-mates follow
        const sh = S.players.get(H.shooter);
        const corner = { x: H.gx - H.dir * 3, y: b.y < CY ? 3 : PW - 3 };
        if (sh) {
          sh.tx = corner.x;
          sh.ty = corner.y;
          sh.speed = 7.5;
          H.lock.add(sh.pid);
        }
        outfield(S, H.aSide)
          .filter((p) => p.pid !== H.shooter)
          .sort((a, c) => dist(a, corner) - dist(c, corner))
          .slice(0, 4)
          .forEach((p, i) => {
            p.tx = corner.x - H.dir * (2 + i * 1.2);
            p.ty = corner.y + (corner.y < CY ? 1 : -1) * (1.5 + i * 0.9);
            p.speed = 7;
            H.lock.add(p.pid);
          });
        H.wait = 2.6;
        H.after = "goal";
      } else if (o === "save") {
        S.overlay = { kind: "save", t: S.time, side: H.dSide, name: H.shooterName, min: H.ev.min };
        if (gk && H.rnd() < 0.5) {
          giveBall(S, gk, 9);
          S.poss = H.dSide;
          H.after = "catch";
        } else {
          const ly = CY + (b.y < CY ? -1 : 1) * (9 + H.rnd() * 9);
          const spot = { x: H.gx - H.dir * (4 + H.rnd() * 7), y: clamp(ly, 2, PW - 2) };
          startBall(S, spot, 0.55, { mode: "loose", peak: 1.2 });
          chaseLoose(S, H, spot);
          S.poss = H.dSide;
          H.after = "loose";
        }
        H.wait = 1.6;
      } else if (o === "post") {
        S.overlay = { kind: "post", t: S.time, side: H.aSide, name: H.shooterName, min: H.ev.min };
        S.net = { x: H.gx, t: S.time, dir: H.dir, post: true };
        const spot = { x: H.gx - H.dir * (7 + H.rnd() * 6), y: CY + Math.sign(b.y - CY) * (2 + H.rnd() * 7) };
        startBall(S, spot, 0.6, { mode: "loose", peak: 0.6 });
        chaseLoose(S, H, spot);
        S.poss = H.dSide;
        H.after = "loose";
        H.wait = 1.6;
      } else {
        S.overlay = { kind: "miss", t: S.time, side: H.aSide, name: H.shooterName, min: H.ev.min };
        b.mode = "dead";
        H.after = "goalkick";
        H.wait = 1.5;
      }
      break;
    }
    default:
      break;
  }
}

function finishHighlight(S) {
  const H = S.hl;
  const after = H?.after;
  S.hl = null;
  S.recv = null;
  for (const p of S.players.values()) p.speed = 6;
  if (after === "goal") {
    S.mode = "kickoff";
    S.kickSide = H.dSide;
    S.kickWait = 2.4;
    S.ball = { ...S.ball, x: PL / 2, y: CY, z: 0, mode: "dead", holder: null };
  } else if (after === "goalkick") {
    const gk = keeperOf(S, H.dSide);
    const spot = { x: H.gx - H.dir * 5.5, y: CY + (S.ball.y < CY ? -6 : 6) };
    S.ball = { ...S.ball, x: spot.x, y: spot.y, z: 0, mode: "dead", holder: null };
    S.poss = H.dSide;
    S.mode = "goalkick";
    S.kickWait = 1.4;
    if (gk) S.goalKicker = gk.pid;
  } else {
    S.mode = "ambient";
    if (S.ball.mode === "held") S.holdLeft = 0.6;
  }
  S.overlay = null;
}

/* ---------------------------------------------------------- main tick */

function tick(S, dt, ctx) {
  const { running, share, rnd } = ctx;
  const H = S.hl;
  const frozen = !H && !running && S.mode === "ambient";
  if (frozen) return false;
  S.time += dt;

  if (H) {
    runHighlight(S, dt);
    if (H.done && !H.finishedAt) {
      H.finishedAt = S.time;
      ctx.onHighlightDone && ctx.onHighlightDone(H.key);
    }
  } else if (S.mode === "ambient") {
    ambientDecide(S, dt, rnd, share);
  } else if (S.mode === "kickoff" || S.mode === "rest") {
    S.ball.x = PL / 2;
    S.ball.y = CY;
    S.ball.z = 0;
    S.ball.mode = "dead";
    if (S.mode === "kickoff" && running) {
      S.kickWait -= dt;
      if (S.kickWait <= 0) {
        const fw = outfield(S, S.kickSide).sort((a, b) => b.slot.d - a.slot.d)[0];
        if (fw) {
          fw.x = PL / 2 - dirOf(S.kickSide) * 0.6;
          fw.y = CY;
          giveBall(S, fw, 0.15);
        }
        S.mode = "ambient";
      }
    }
  } else if (S.mode === "goalkick") {
    const gk = S.players.get(S.goalKicker);
    if (gk) {
      gk.tx = S.ball.x - dirOf(gk.side) * 0.6;
      gk.ty = S.ball.y;
      gk.speed = 4;
    }
    S.kickWait -= dt;
    if (S.kickWait <= 0 && running && gk && dist(gk, S.ball) < 1.6) {
      giveBall(S, gk, 0.2);
      S.mode = "ambient";
    }
  }

  // targets
  const b = S.ball;
  const restLike = S.mode === "kickoff" || S.mode === "rest";
  const defenders = b.mode === "held" ? teamOf(S, 1 - S.poss) : [];
  const presser = defenders.length ? nearest(defenders.filter((p) => p.role !== "GK"), b) : null;
  for (const p of S.players.values()) {
    if (H && H.lock.has(p.pid)) continue;
    if (H && H.gkDive && H.gkDive.pid === p.pid) continue;
    if (!H && S.recv === p.pid) continue;
    if (!H && b.mode === "held" && b.holder === p.pid) continue;
    if (S.mode === "goalkick" && p.pid === S.goalKicker) continue;
    if (restLike) {
      const k = kickoffPos(p, S.kickSide);
      p.tx = k.x;
      p.ty = k.y;
      p.speed = 5;
      continue;
    }
    if (H && H.ev && H.after === "goal") {
      // others jog back towards their kick-off positions during the celebration
      const k = kickoffPos(p, H.dSide);
      p.tx = k.x;
      p.ty = k.y;
      p.speed = 3.2;
      continue;
    }
    const t = shapeTarget(p, S);
    p.tx = t.x;
    p.ty = t.y;
    p.speed = 5.6;
    if (presser && presser.p === p) {
      const dg = dirOf(p.side);
      p.tx = b.x - dg * 1.1;
      p.ty = b.y;
      p.speed = H ? 5.4 : 6.6;
    }
  }
  if (!restLike && S.mode !== "goalkick" && (b.mode === "still" || (b.mode === "loose" && !H))) {
    const n = nearest([...S.players.values()].filter((p) => !(H && H.lock.has(p.pid))), b);
    if (n) {
      n.p.tx = b.x;
      n.p.ty = b.y;
      n.p.speed = 7;
    }
  }
  if (H && H.gkDive && S.time >= H.gkDive.at) {
    const gk = S.players.get(H.gkDive.pid);
    if (gk) {
      gk.tx = H.gkDive.to.x;
      gk.ty = H.gkDive.to.y;
      gk.speed = H.gkDive.speed;
      gk.diving = true;
    }
  }

  for (const p of S.players.values()) {
    movePlayer(p, dt);
    p.x = clamp(p.x, -2, PL + 2);
    p.y = clamp(p.y, -1, PW + 2.5);
  }
  updateBall(S, dt);
  S.cards = S.cards.filter((c) => c.until > S.time);
  return true;
}

/* ------------------------------------------------------------ rendering */

export function createMatch2D(deps) {
  if (typeof document !== "undefined" && !document.getElementById("m2d-css")) {
    const link = document.createElement("link");
    link.id = "m2d-css";
    link.rel = "stylesheet";
    link.href = new URL("./match2d.css?v=5", import.meta.url).href;
    document.head.appendChild(link);
  }
  const { React, useGame, useI18n, getClub, shortName, Button, ReplayIcon, formations, ClubBadge } = deps;
  const { useEffect, useMemo, useRef, useState, useCallback } = React;
  const h = React.createElement;

  function PitchMarkings() {
    const line = { fill: "none", stroke: "rgba(255,255,255,.78)", strokeWidth: 0.32 };
    const stripes = [];
    for (let i = 0; i < 14; i++)
      stripes.push(h("rect", { key: i, x: i * 7.5, y: 0, width: 7.5, height: PW, fill: i % 2 ? "#1d7436" : "#21803c" }));
    const goal = (x, s) =>
      h(
        "g",
        { key: "goal" + x },
        h("rect", {
          x: s > 0 ? x : x - 2.2,
          y: CY - GOAL_HALF,
          width: 2.2,
          height: GOAL_HALF * 2,
          fill: "url(#m2d-net)",
          stroke: "rgba(255,255,255,.9)",
          strokeWidth: 0.28,
        }),
      );
    return h(
      "g",
      null,
      h("rect", { x: -5, y: -5, width: PL + 10, height: PW + 10, fill: "#185f2d" }),
      ...stripes,
      h(
        "g",
        line,
        h("rect", { x: 0, y: 0, width: PL, height: PW }),
        h("line", { x1: PL / 2, y1: 0, x2: PL / 2, y2: PW }),
        h("circle", { cx: PL / 2, cy: CY, r: 9.15 }),
        h("circle", { cx: PL / 2, cy: CY, r: 0.35, fill: "rgba(255,255,255,.85)" }),
        h("rect", { x: 0, y: CY - 20.16, width: 16.5, height: 40.32 }),
        h("rect", { x: PL - 16.5, y: CY - 20.16, width: 16.5, height: 40.32 }),
        h("rect", { x: 0, y: CY - 9.16, width: 5.5, height: 18.32 }),
        h("rect", { x: PL - 5.5, y: CY - 9.16, width: 5.5, height: 18.32 }),
        h("circle", { cx: 11, cy: CY, r: 0.3, fill: "rgba(255,255,255,.85)" }),
        h("circle", { cx: PL - 11, cy: CY, r: 0.3, fill: "rgba(255,255,255,.85)" }),
        h("path", { d: `M16.5 ${CY - 7.31} A9.15 9.15 0 0 1 16.5 ${CY + 7.31}` }),
        h("path", { d: `M${PL - 16.5} ${CY - 7.31} A9.15 9.15 0 0 0 ${PL - 16.5} ${CY + 7.31}` }),
        h("path", { d: `M0 1 A1 1 0 0 0 1 0` }),
        h("path", { d: `M${PL - 1} 0 A1 1 0 0 0 ${PL} 1` }),
        h("path", { d: `M0 ${PW - 1} A1 1 0 0 1 1 ${PW}` }),
        h("path", { d: `M${PL - 1} ${PW} A1 1 0 0 1 ${PL} ${PW - 1}` }),
      ),
      goal(0, -1),
      goal(PL, 1),
    );
  }

  const OVERLAY_TEXT = {
    goal: ["GOL!", "GOAL!"],
    save: ["KURTARIŞ!", "SAVED!"],
    post: ["DİREK!", "OFF THE POST!"],
    miss: ["AUT", "WIDE"],
  };

  return function Match2D({ ms, highlight, onDone, running = false, hidden = null, score = null }) {
    const { game, act } = useGame();
    const { L, tt } = useI18n();
    const [, setFrame] = useState(0);
    const [stadUrl, setStadUrl] = useState(null);
    const simRef = useRef(null);
    const msRef = useRef(null);
    const doneRef = useRef(onDone);
    const runningRef = useRef(running);
    const hlRef = useRef(null);
    const reduced = useMemo(
      () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
      [],
    );
    useEffect(() => {
      doneRef.current = onDone;
    }, [onDone]);
    useEffect(() => {
      runningRef.current = running;
    }, [running]);

    const home = getClub(game, ms.sides[0].clubId);
    const away = getClub(game, ms.sides[1].clubId);
    useEffect(() => {
      if (!home) return;
      const id = setTimeout(() => {
        let plan = null;
        try { plan = __stadiumPlan(home, away); } catch { plan = null; }
        setStadUrl(plan ? { plan } : { bg: __stadiumImage(home, { pitch: false }) });
      }, 20);
      return () => clearTimeout(id);
    }, [home?.id, away?.id]);
    const kits = useMemo(() => pickKits(home?.colors, away?.colors), [home?.id, away?.id]);

    // (re)initialise the simulation for a new match
    if (msRef.current !== ms || !simRef.current) {
      msRef.current = ms;
      const S = newSim();
      S.kickSide = ms.minute >= 45 && ms.minute < 90 ? 1 : 0;
      syncPlayers(S, game, ms, getClub, formations, true);
      S.mode = ms.minute > 0 && ms.minute !== 45 && !ms.finished ? "ambient" : "rest";
      if (S.mode === "ambient") {
        const fw = outfield(S, 0)[0];
        if (fw) giveBall(S, fw, 0.5);
      }
      S.lastEvents = ms.events.length;
      simRef.current = S;
      // a highlight that was already playing before mount (e.g. view re-enabled
      // while the match runs) is treated as seen
      hlRef.current = highlight && running ? highlight.key : null;
    }
    const S = simRef.current;

    const startHighlight = useCallback(
      (hl, replay) => {
        const S = simRef.current;
        if (!S || !hl) return;
        if (replay && S.hlSnap && S.hlSnap.key === hl.key) restore(S, S.hlSnap.snap);
        else S.hlSnap = { key: hl.key, snap: snapshot(S) };
        S.mode = "ambient";
        S.hl = buildHighlight(S, hl.ev, hl.key, game, shortName);
        if (!S.hl) {
          if (!replay) doneRef.current?.();
          return;
        }
        S.hl.replay = !!replay;
        S.trail = [];
      },
      [game],
    );

    // new key moment from the match engine
    useEffect(() => {
      if (!highlight || hlRef.current === highlight.key) return;
      hlRef.current = highlight.key;
      startHighlight(highlight, false);
    }, [highlight?.key, startHighlight]);

    // animation loop
    useEffect(() => {
      let raf = 0;
      let last = performance.now();
      const rnd = Math.random;
      const loop = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const S = simRef.current;
        const live = msRef.current;
        if (S && live) {
          syncPlayers(S, game, live, getClub, formations, false);
          if (live.events.length > S.lastEvents) S.lastEvents = live.events.length;
          const isRest = !runningRef.current && !S.hl && (live.minute === 0 || live.minute === 45 || live.finished);
          if (isRest && S.mode !== "rest") {
            S.mode = "rest";
            S.kickSide = live.minute === 45 ? 1 : 0;
          } else if (!isRest && S.mode === "rest" && runningRef.current) {
            S.mode = "kickoff";
            S.kickWait = 0.8;
          }
          const p0 = live.sides[0].poss || 0;
          const p1 = live.sides[1].poss || 0;
          const s0 = p0 + p1 > 0 ? p0 / (p0 + p1) : 0.5;
          const steps = reduced && S.hl ? 40 : 1;
          let changed = false;
          for (let i = 0; i < steps; i++) {
            changed =
              tick(S, reduced && S.hl ? 0.05 : dt, {
                running: runningRef.current,
                share: [s0, 1 - s0],
                rnd,
                onHighlightDone: (key) => {
                  S.pendingDone = { key, at: S.time + 0.05 };
                },
              }) || changed;
          }
          if (S.pendingDone && S.time >= S.pendingDone.at) {
            const fin = S.hl;
            S.pendingDone = null;
            const wasReplay = fin?.replay;
            finishHighlight(S);
            if (!wasReplay) doneRef.current?.();
          }
          if (changed) setFrame((f) => (f + 1) % 1e6);
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(raf);
    }, [game, reduced]);

    /* ---------- render ---------- */
    const b = S.ball;
    const H = S.hl;
    // Teams change ends at half-time: the simulation keeps home attacking +x and the
    // second half is drawn mirrored (180° rotation keeps both goals in place).
    const flip = ms.minute > 45 || (ms.minute === 45 && !H && S.mode === "rest" && !running && ms.events.some((e) => e.kind === "whistle" && e.min === 45));
    const FX = (x) => (flip ? PL - x : x);
    const FY = (y) => (flip ? PW - y : y);
    const ev = highlight?.ev;
    const holder = b.mode === "held" ? S.players.get(b.holder) : null;
    const labelPids = new Set();
    if (holder) labelPids.add(holder.pid);
    if (H?.shooter != null) labelPids.add(H.shooter);
    if (H?.gkDive && (H.outcome === "save" || S.overlay?.kind === "save")) labelPids.add(H.gkDive.pid);

    const players = [...S.players.values()].sort((a, c) => (flip ? c.y - a.y : a.y - c.y));
    const playerEls = players.map((p) => {
      const kit = p.role === "GK" ? kits[p.side].gk : kits[p.side];
      const pl = game.players[p.pid];
      const isHolder = holder && holder.pid === p.pid;
      const sp = Math.hypot(p.vx, p.vy);
      const ang = (sp > 0.4 ? Math.atan2(p.vy, p.vx) : p.side === 0 ? 0 : Math.PI) + (flip ? Math.PI : 0);
      return h(
        "g",
        { key: p.pid, transform: `translate(${FX(p.x).toFixed(2)} ${FY(p.y).toFixed(2)}) scale(1 1.16)` },
        h("ellipse", { cx: 0.35, cy: 0.55, rx: 1.75, ry: 1.05, fill: "rgba(0,0,0,.28)" }),
        isHolder && h("circle", { r: 2.55, fill: "none", stroke: "rgba(255,255,255,.75)", strokeWidth: 0.22, strokeDasharray: "0.8 0.5" }),
        h("path", {
          d: "M0 -2.15 L0.9 -1.55 L0 -1.75 L-0.9 -1.55 Z",
          transform: `rotate(${((ang * 180) / Math.PI + 90).toFixed(1)})`,
          fill: kit.trim,
          opacity: 0.9,
        }),
        h("circle", { r: 1.95, fill: "rgba(0,0,0,.35)", cy: 0.25 }),
        h("circle", { r: 1.8, fill: kit.shirt, stroke: isHolder ? "#fff" : kit.trim, strokeWidth: isHolder ? 0.5 : 0.36 }),
        h("circle", { r: 1.35, fill: "none", stroke: "rgba(255,255,255,.28)", strokeWidth: 0.12 }),
        h(
          "text",
          { y: 0.66, textAnchor: "middle", fontSize: 1.75, fontWeight: 700, fill: kit.ink, className: "m2d-num" },
          p.num ?? "",
        ),
        labelPids.has(p.pid) &&
          pl &&
          h(
            "text",
            {
              y: -2.9,
              textAnchor: "middle",
              fontSize: 2.15,
              fontWeight: 700,
              fill: "#fff",
              stroke: "rgba(0,0,0,.65)",
              strokeWidth: 0.42,
              paintOrder: "stroke",
              className: "m2d-label",
            },
            shortName(pl),
          ),
      );
    });

    // goal net bulge
    let netEl = null;
    if (S.net && !S.net.post) {
      const age = S.time - S.net.t;
      const bulge = Math.max(0, Math.sin(Math.min(Math.PI, age * 6))) * 1.1 * Math.exp(-age * 0.8);
      const x0 = FX(S.net.x);
      const dx = flip ? -S.net.dir : S.net.dir;
      netEl = h("path", {
        d: `M${x0} ${CY - GOAL_HALF} L${x0 + dx * (2.2 + bulge)} ${CY - GOAL_HALF + 0.5} L${x0 + dx * (2.2 + bulge)} ${CY + GOAL_HALF - 0.5} L${x0} ${CY + GOAL_HALF}`,
        fill: "rgba(255,255,255,.18)",
        stroke: "#fff",
        strokeWidth: 0.35,
      });
    }

    const trailEl =
      S.trail.length > 1 &&
      h("polyline", {
        points: S.trail.map((p) => `${FX(p.x).toFixed(2)},${FY(p.y).toFixed(2)}`).join(" "),
        fill: "none",
        stroke: "url(#m2d-trail)",
        strokeWidth: 0.55,
        strokeLinecap: "round",
        opacity: 0.85,
      });

    const bz = b.z || 0;
    const bx = FX(b.x);
    const by = FY(b.y);
    const ballEl = h(
      "g",
      null,
      h("ellipse", { cx: bx + bz * 0.25, cy: by + bz * 0.25 + 0.2, rx: 0.75, ry: 0.45, fill: "rgba(0,0,0,.35)" }),
      h("circle", {
        cx: bx,
        cy: by - bz * 0.45,
        r: 0.72 + Math.min(0.5, bz * 0.09),
        fill: "#fff",
        stroke: "#111",
        strokeWidth: 0.2,
      }),
      h("circle", { cx: bx - 0.12, cy: by - bz * 0.45 - 0.1, r: 0.25, fill: "#1f2937" }),
    );

    const ov = S.overlay;
    let overlayEl = null;
    if (ov) {
      const kit = kits[ov.side];
      const [tr, en] = OVERLAY_TEXT[ov.kind] || ["", ""];
      overlayEl = h(
        "div",
        { className: `m2d-overlay m2d-overlay--${ov.kind}`, key: ov.t },
        ov.kind === "goal" && h("div", { className: "m2d-flash", style: { background: `radial-gradient(circle, ${kit.shirt}88 0%, transparent 70%)` } }),
        h(
          "div",
          { className: "m2d-banner", style: { borderColor: kit.shirt } },
          h("span", { className: "m2d-banner-title" }, L(tr, en)),
          h("span", { className: "m2d-banner-sub" }, `${ov.name || ""}${ov.min != null ? ` · ${ov.min}'` : ""}`),
          ov.kind === "goal" && h("span", { className: "m2d-banner-team" }, getClub(game, ms.sides[ov.side].clubId)?.name ?? ""),
        ),
      );
    }

    const p0 = ms.sides[0].poss || 0;
    const p1 = ms.sides[1].poss || 0;
    const poss0 = p0 + p1 > 0 ? Math.round((p0 / (p0 + p1)) * 100) : 50;
    const shown = hidden == null ? ms.events : ms.events.slice(0, hidden);
    const lastEv = [...shown].reverse().find((e) => e.kind !== "whistle" || e.min === 0 || e.min >= 45);
    const revealed = !!(H && S.overlay);
    const buildUp = (e) => {
      const team = getClub(game, ms.sides[e.side === 1 ? 1 : 0].clubId);
      return /penalt/i.test(e.text?.tr || "") ? L("Penaltı! Top beyaz noktada…", "Penalty! The ball is on the spot…") : L(`${team?.short || ""} atakta…`, `${team?.short || ""} on the attack…`);
    };
    const ticker = ev && H ? (revealed || H.replay ? tt(ev.text) : buildUp(ev)) : lastEv ? tt(lastEv.text) : "";
    const tickerMin = ev && H ? ev.min : lastEv?.min;
    const mlabel = (m) => (m > 90 ? `90+${m - 90}` : `${m}`);
    const status = ms.finished ? L("MS", "FT") : ms.minute === 45 && !running ? L("DA", "HT") : `${mlabel(ms.minute)}'`;
    const actual = [ms.sides[0].goals, ms.sides[1].goals];
    const sc = score && !(revealed && S.overlay?.kind === "goal") ? score : actual;

    const speed = game.settings?.matchSpeed ?? 2;
    const setSpeed = (v) => act((g) => void ((g.settings ??= {}).matchSpeed = v));
    const svgEl = h(
      "svg",
      {
        viewBox: `-4 -4 ${PL + 8} ${PW + 8}`,
        className: "m2d-svg",
        role: "img",
        "aria-label": ticker || L("Saha", "Pitch"),
      },
      h(
        "defs",
        null,
        h(
          "pattern",
          { id: "m2d-net", width: 0.8, height: 0.8, patternUnits: "userSpaceOnUse" },
          h("rect", { width: 0.8, height: 0.8, fill: "rgba(255,255,255,.08)" }),
          h("path", { d: "M0 0 L0.8 0.8 M0.8 0 L0 0.8", stroke: "rgba(255,255,255,.45)", strokeWidth: 0.07 }),
        ),
        h(
          "linearGradient",
          { id: "m2d-trail", gradientUnits: "objectBoundingBox" },
          h("stop", { offset: "0%", stopColor: "#fff", stopOpacity: 0 }),
          h("stop", { offset: "100%", stopColor: "#fff", stopOpacity: 0.9 }),
        ),
      ),
      h(PitchMarkings, null),
      netEl,
      trailEl,
      ...playerEls,
      ballEl,
    );
    const crest = (club, side) =>
      ClubBadge && club
        ? h(ClubBadge, { club, size: "sm" })
        : h("i", { className: "m2d-swatch", style: { background: kits[side].shirt, borderColor: kits[side].trim } });

    return h(
      "section",
      { className: "m2d m2d--kaiser overflow-hidden rounded-xl border bg-card" },
      h(
        "div",
        { className: "m2d-board" },
        h("div", { className: "m2d-bteam" }, crest(home, 0), h("span", { className: "m2d-bname" }, home?.name), h("i", { className: "m2d-kit", style: { background: kits[0].shirt } })),
        h(
          "div",
          { className: "m2d-bscore" },
          h("b", null, sc[0]),
          h("span", { className: `m2d-bclock ${running && !ms.finished ? "is-live" : ""}` }, status),
          h("b", null, sc[1]),
        ),
        h("div", { className: "m2d-bteam m2d-bteam--away" }, h("i", { className: "m2d-kit", style: { background: kits[1].shirt } }), h("span", { className: "m2d-bname" }, away?.name), crest(away, 1)),
      ),
      h(
        "div",
        { className: `m2d-stage${stadUrl?.plan ? " m2d-stage--bowl" : ""}`, style: stadUrl?.bg ? { backgroundImage: `url(${stadUrl.bg})` } : undefined },
        home?.stadium && h("span", { className: "m2d-venue" }, home.stadium),
        h("div", { className: "m2d-tilt" }, stadUrl?.plan && h("img", { className: "m2d-bowl", src: stadUrl.plan, alt: "", "aria-hidden": "true", draggable: false }), svgEl),
        overlayEl,
      ),
      h(
        "div",
        { className: "m2d-bar" },
        h(
          "div",
          { className: "m2d-title" },
          h("span", { className: `m2d-live ${running && !ms.finished ? "is-on" : ""}` }),
          h("span", null, L("Canlı", "Live")),
        ),
        h(
          "div",
          { className: "m2d-poss", title: L("Topla oynama", "Possession") },
          h("span", { style: { width: `${poss0}%`, background: kits[0].shirt } }),
          h("span", { style: { width: `${100 - poss0}%`, background: kits[1].shirt } }),
          h("em", null, `${poss0}% · ${100 - poss0}%`),
        ),
        h(
          "div",
          { className: "m2d-speed", role: "group", "aria-label": L("Maç hızı", "Match speed") },
          [1, 2, 4, 8].map((v) =>
            h("button", { key: v, type: "button", className: speed === v ? "is-on" : "", "aria-pressed": speed === v, onClick: () => setSpeed(v) }, `${v}x`),
          ),
          highlight &&
            h(
              "button",
              { type: "button", className: "m2d-replay", onClick: () => startHighlight(highlight, true), "aria-label": L("Son pozisyonu tekrar izle", "Replay last moment") },
              h(ReplayIcon, null),
            ),
        ),
      ),
      h(
        "p",
        { className: "m2d-ticker", "aria-live": "polite" },
        tickerMin != null && h("span", { className: "m2d-ticker-min" }, `${mlabel(tickerMin)}'`),
        ticker ||
          L(
            "Goller, kurtarışlar ve önemli pozisyonlar burada canlı oynatılır.",
            "Goals, saves and big chances are played out here live.",
          ),
      ),
    );
  };
}

/** Internals exposed for unit tests only (src/test/match2d-rules.test.ts). */
export const __m2dTest = { newSim, syncPlayers, buildHighlight, tick, PL, CY };
