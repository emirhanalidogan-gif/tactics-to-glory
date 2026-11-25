/*
 * Club funding & stadium development ("Stadyum & Fon" screen).
 *
 * Game-state extension stored per club in game.clubExt[clubId]:
 *   fac      facility levels {hospitality, megastore, training, academy, medical} (0..10)
 *   base     facility levels the club started with (bonuses are relative to these)
 *   proj     running construction projects [{id, type:'stadium'|'fac', key, seats, weeks, left, cost, weekly}]
 *   loans    bank loans [{id, amount, weekly, left, total, rate}]
 *   board    season of the last board funding request
 *   campaign season of the last fan fundraising campaign
 *   naming   {name, orig, until} active stadium naming-rights deal
 *   stake    number of 10% share packages sold to investors
 *
 * Pure hooks used by the bundle's weekly simulation:
 *   extIncome(game, club, tickets, commercial) -> [tickets, commercial]
 *   extWeekly(game, club, inbox)               (loans, projects, upkeep, naming expiry)
 *   extTrainMul(game, player)                  development multiplier for the user's players
 *   extYouthBonus(game, clubId)                extra youth potential
 *   extMedChance(game, player)                 chance of an extra recovery day per week
 */

export const FAC_KEYS = ["hospitality", "megastore", "training", "academy", "medical"];
const FAC_MAX = 10;
const SPONSORS = ["Nova", "Atlas", "Vertex", "Orion", "Zenith", "Pinnacle", "Helix", "Aurora", "Titan", "Meridian"];
const tx = (tr, en) => ({ tr, en });

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export function roundMoney(e) {
  return e >= 1e7 ? Math.round(e / 1e5) * 1e5 : e >= 1e6 ? Math.round(e / 1e4) * 1e4 : e >= 1e5 ? Math.round(e / 5e3) * 5e3 : Math.round(e / 500) * 500;
}
const leagueOf = (game, club) => game.leagues.find((l) => l.id === club.leagueId) || { tvPool: 2e7, ticket: 5, clubIds: [1, 2], level: 55 };

function baseLevels(club) {
  const b = clamp(Math.round(club.rep / 15), 1, 7);
  return { hospitality: b, megastore: b, training: b, academy: clamp(b - 1, 1, 7), medical: b };
}

/** Read-only view (does not mutate state). */
export function peekExt(game, clubId) {
  const club = game.clubs.find((c) => c.id === clubId);
  const x = game.clubExt?.[clubId];
  if (x) return x;
  const base = baseLevels(club);
  return { fac: { ...base }, base, proj: [], loans: [], board: -1, campaign: -1, naming: null, stake: 0, nextId: 1 };
}
/** Mutable view (creates the record). Use inside act(). */
export function ensureExt(game, clubId) {
  game.clubExt ??= {};
  if (!game.clubExt[clubId]) game.clubExt[clubId] = peekExt(game, clubId);
  return game.clubExt[clubId];
}

const bonus = (x, k) => Math.max(0, (x.fac[k] ?? 0) - (x.base[k] ?? 0));

/** Rough yearly turnover of a club (used to size loans, grants, deals). */
export function annualRevenue(game, club) {
  const lg = leagueOf(game, club);
  const n = Math.max(2, lg.clubIds.length);
  return Math.round(club.capacity * 0.75 * lg.ticket * 19 + lg.tvPool * 0.7 / n + club.rep ** 2.5 * 4 * 38);
}

// ----------------------------------------------------------------- weekly hooks

export function extIncome(game, club, tickets, commercial) {
  const x = game.clubExt?.[club.id];
  if (!x) return [tickets, commercial];
  const t = tickets * (1 + 0.06 * bonus(x, "hospitality"));
  const c = commercial * (1 + 0.07 * bonus(x, "megastore")) * (1 - 0.05 * (x.stake || 0));
  return [Math.round(t), Math.round(c)];
}

export function upkeep(club, x) {
  const extra = FAC_KEYS.reduce((s, k) => s + bonus(x, k), 0);
  return Math.round(extra * (800 + club.rep ** 2 * 3));
}

export function extWeekly(game, club, inbox) {
  const x = game.clubExt?.[club.id];
  if (!x) return;
  const f = game.finance;
  const say = (title, body) => inbox && inbox(game, "finance", title, body);
  // loans
  let repay = 0;
  for (const l of x.loans) {
    if (l.left <= 0) continue;
    repay += l.weekly;
    l.left--;
    if (l.left === 0) say(tx("Kredi kapandı", "Loan repaid"), tx(`${fmt(l.amount)} tutarındaki banka kredisinin son taksiti ödendi.`, `The final instalment of the ${fmt(l.amount)} bank loan has been paid.`));
  }
  x.loans = x.loans.filter((l) => l.left > 0);
  club.balance -= repay;
  f.loanRepay = (f.loanRepay || 0) + repay;
  // projects
  let build = 0;
  for (const p of x.proj) {
    build += p.weekly;
    p.left--;
    if (p.left <= 0) {
      if (p.type === "stadium") {
        club.capacity += p.seats;
        say(tx("Stadyum genişletmesi tamamlandı", "Stadium expansion complete"),
          tx(`${club.stadium} artık ${club.capacity.toLocaleString("tr-TR")} kişilik. Yeni tribünler bir sonraki iç saha maçında açılıyor.`,
            `${club.stadium} now holds ${club.capacity.toLocaleString("en-GB")}. The new stands open at the next home game.`));
      } else {
        x.fac[p.key] = Math.min(FAC_MAX, (x.fac[p.key] ?? 0) + 1);
        const nm = FAC_INFO[p.key].name;
        say(tx(`${nm.tr} geliştirildi`, `${nm.en} upgraded`), tx(`${nm.tr} seviye ${x.fac[p.key]} oldu.`, `${nm.en} is now level ${x.fac[p.key]}.`));
      }
    }
  }
  x.proj = x.proj.filter((p) => p.left > 0);
  const up = upkeep(club, x);
  club.balance -= build + up;
  f.projects = (f.projects || 0) + build + up;
  // naming rights expiry
  if (x.naming && game.season >= x.naming.until) {
    say(tx("İsim hakkı anlaşması sona erdi", "Naming-rights deal ended"), tx(`${club.stadium} adı yeniden ${x.naming.orig} oldu.`, `${club.stadium} is called ${x.naming.orig} again.`));
    club.stadium = x.naming.orig;
    x.naming = null;
  }
}

export function extTrainMul(game, p) {
  if (p.clubId == null || p.clubId !== game.clubId) return 1;
  const x = game.clubExt?.[p.clubId];
  return x ? 1 + 0.08 * bonus(x, "training") : 1;
}
export function extYouthBonus(game, clubId) {
  if (clubId !== game.clubId) return 0;
  const x = game.clubExt?.[clubId];
  return x ? Math.round(2 * bonus(x, "academy")) : 0;
}
export function extMedChance(game, p) {
  if (p.clubId == null || p.clubId !== game.clubId) return 0;
  const x = game.clubExt?.[p.clubId];
  return x ? 0.12 * bonus(x, "medical") : 0;
}

// ----------------------------------------------------------------- offers / costs

export const FAC_INFO = {
  hospitality: { name: tx("VIP locaları & kombine", "Hospitality & seating"), eff: (n) => tx(`Bilet geliri +%${n * 6}`, `Ticket income +${n * 6}%`) },
  megastore: { name: tx("Mağaza & ticari alanlar", "Megastore & commercial"), eff: (n) => tx(`Ticari gelir +%${n * 7}`, `Commercial income +${n * 7}%`) },
  training: { name: tx("Antrenman tesisi", "Training ground"), eff: (n) => tx(`Oyuncu gelişimi +%${n * 8}`, `Player development +${n * 8}%`) },
  academy: { name: tx("Altyapı akademisi", "Youth academy"), eff: (n) => tx(`Altyapı potansiyeli +${n * 2}`, `Youth potential +${n * 2}`) },
  medical: { name: tx("Sağlık merkezi", "Medical centre"), eff: (n) => tx(`Sakatlıktan dönüş %${n * 12} daha hızlı`, `Injury recovery ${n * 12}% faster`) },
};

export function facCost(club, level) {
  const base = 250000 + club.rep ** 2 * 120;
  return roundMoney(base * (level + 1) ** 1.5 / 4);
}
export const facWeeks = (level) => 3 + Math.round(level * 1.5);

export function seatCost(club) {
  return Math.round(900 + club.rep * 38);
}
export function stadiumOptions(club) {
  const cap = club.capacity;
  return [0.1, 0.25, 0.5].map((p) => {
    let seats = Math.round(Math.max(p * cap, p === 0.1 ? 1000 : p === 0.25 ? 2500 : 5000) / 100) * 100;
    seats = Math.min(seats, Math.max(0, 100000 - cap));
    const cost = roundMoney(seats * seatCost(club));
    const weeks = clamp(Math.round(6 + seats / 700), 6, 40);
    return { seats, cost, weeks };
  }).filter((o) => o.seats > 0);
}

export function loanLimit(game, club) {
  const x = peekExt(game, club.id);
  const used = x.loans.reduce((s, l) => s + l.weekly * l.left, 0);
  return Math.max(0, roundMoney(annualRevenue(game, club) * 0.6 - used));
}
export const loanRate = (club) => (club.balance < 0 ? 0.11 : 0.065);

export function boardGrant(game, club) {
  return roundMoney(annualRevenue(game, club) * 0.1);
}
export function boardChance(game) {
  return clamp((game.board.confidence - 25) / 70, 0.08, 0.9);
}
export function campaignAmount(game, club) {
  const lg = leagueOf(game, club);
  return roundMoney(club.capacity * (12 + club.rep * 0.9) * (lg.tier >= 2 ? 1.25 : 1));
}
export function namingDeal(game, club) {
  const yearly = roundMoney(club.capacity * club.rep * 1.4 + club.rep ** 2.5 * 20);
  return { yearly, seasons: 3, total: roundMoney(yearly * 3 * 0.9) };
}
export function squadValue(game, clubId, valueOf) {
  return Object.values(game.players).filter((p) => p.clubId === clubId).reduce((s, p) => s + (valueOf ? valueOf(p, game.season) : 0), 0);
}
export function shareOffer(game, club, sv) {
  return roundMoney((annualRevenue(game, club) * 2.5 + sv * 0.4) * 0.1);
}

function fmt(e) {
  const t = Math.abs(e), n = e < 0 ? "-" : "";
  return t >= 1e6 ? `${n}€${(t / 1e6).toFixed(t >= 1e8 ? 0 : 1)}M` : t >= 1e3 ? `${n}€${Math.round(t / 1e3)}K` : `${n}€${Math.round(t)}`;
}

// ----------------------------------------------------------------- actions (call inside act)

function addFunds(game, club, amount, toBudget) {
  club.balance += amount;
  if (toBudget) club.transferBudget += Math.round(amount * toBudget);
  game.finance.funds = (game.finance.funds || 0) + amount;
}

export const actions = {
  board(game) {
    const club = game.clubs.find((c) => c.id === game.clubId);
    const x = ensureExt(game, club.id);
    if (x.board === game.season) return { ok: false, msg: tx("Bu sezon yönetimden zaten bütçe istediniz.", "You already asked the board this season.") };
    x.board = game.season;
    const amt = boardGrant(game, club);
    if (Math.random() < boardChance(game)) {
      addFunds(game, club, amt, 1);
      game.board.confidence = clamp(game.board.confidence - 4, 0, 100);
      return { ok: true, msg: tx(`Yönetim ${fmt(amt)} ek transfer bütçesi onayladı. Beklentiler yükseldi.`, `The board approved ${fmt(amt)} of extra transfer funds. Expectations have risen.`) };
    }
    game.board.confidence = clamp(game.board.confidence - 2, 0, 100);
    return { ok: false, msg: tx("Yönetim talebinizi reddetti. Önce sonuç bekliyorlar.", "The board turned you down. They want results first.") };
  },
  loan(game, amount, seasons) {
    const club = game.clubs.find((c) => c.id === game.clubId);
    const x = ensureExt(game, club.id);
    const lim = loanLimit(game, club);
    if (amount <= 0 || amount > lim) return { ok: false, msg: tx("Banka bu tutarı onaylamadı.", "The bank declined this amount.") };
    const rate = loanRate(club);
    const weeks = seasons * 38;
    const total = Math.round(amount * (1 + rate * seasons));
    const weekly = Math.ceil(total / weeks);
    x.loans.push({ id: x.nextId++, amount, weekly, weeks, left: weeks, total, rate, season: game.season });
    addFunds(game, club, amount, 0.8);
    return { ok: true, msg: tx(`${fmt(amount)} kredi hesabınıza geçti. Haftalık taksit ${fmt(weekly)}.`, `${fmt(amount)} loan received. Weekly instalment ${fmt(weekly)}.`) };
  },
  repay(game, id) {
    const club = game.clubs.find((c) => c.id === game.clubId);
    const x = ensureExt(game, club.id);
    const l = x.loans.find((l) => l.id === id);
    if (!l) return { ok: false };
    const due = payoffAmount(l);
    if (club.balance < due) return { ok: false, msg: tx("Kasada erken kapatma için yeterli para yok.", "Not enough cash to repay early.") };
    club.balance -= due;
    game.finance.loanRepay = (game.finance.loanRepay || 0) + due;
    x.loans = x.loans.filter((q) => q !== l);
    return { ok: true, msg: tx(`Kredi ${fmt(due)} ödenerek kapatıldı.`, `Loan closed for ${fmt(due)}.`) };
  },
  campaign(game) {
    const club = game.clubs.find((c) => c.id === game.clubId);
    const x = ensureExt(game, club.id);
    if (x.campaign === game.season) return { ok: false, msg: tx("Bu sezon zaten kampanya yaptınız.", "You already ran a campaign this season.") };
    x.campaign = game.season;
    const amt = roundMoney(campaignAmount(game, club) * (0.75 + Math.random() * 0.5));
    addFunds(game, club, amt, 0.5);
    return { ok: true, msg: tx(`Taraftar kampanyası ${fmt(amt)} topladı!`, `The fan campaign raised ${fmt(amt)}!`) };
  },
  naming(game) {
    const club = game.clubs.find((c) => c.id === game.clubId);
    const x = ensureExt(game, club.id);
    if (x.naming) return { ok: false, msg: tx("Zaten aktif bir isim hakkı anlaşması var.", "A naming-rights deal is already active.") };
    const d = namingDeal(game, club);
    const brand = SPONSORS[(club.id * 7 + game.season) % SPONSORS.length];
    const name = `${brand} ${club.city || club.name} Arena`;
    x.naming = { name, orig: club.stadium, until: game.season + d.seasons };
    club.stadium = name;
    addFunds(game, club, d.total, 0.5);
    return { ok: true, msg: tx(`İsim hakkı ${d.seasons} sezonluğuna ${fmt(d.total)} karşılığında satıldı. Stadyumun yeni adı: ${name}.`, `Naming rights sold for ${d.seasons} seasons for ${fmt(d.total)}. The ground is now ${name}.`) };
  },
  shares(game, sv) {
    const club = game.clubs.find((c) => c.id === game.clubId);
    const x = ensureExt(game, club.id);
    if ((x.stake || 0) >= 4) return { ok: false, msg: tx("Kulübün %40'ından fazlası satılamaz.", "You cannot sell more than 40% of the club.") };
    const amt = shareOffer(game, club, sv);
    x.stake = (x.stake || 0) + 1;
    addFunds(game, club, amt, 0.7);
    return { ok: true, msg: tx(`%10 hisse yatırımcıya ${fmt(amt)} karşılığında satıldı. Ticari gelirin %5'i artık yatırımcının.`, `A 10% stake was sold for ${fmt(amt)}. Investors now take 5% of commercial income.`) };
  },
  stadium(game, opt) {
    const club = game.clubs.find((c) => c.id === game.clubId);
    const x = ensureExt(game, club.id);
    if (x.proj.some((p) => p.type === "stadium")) return { ok: false, msg: tx("Stadyumda zaten bir inşaat var.", "Stadium works are already under way.") };
    const down = Math.round(opt.cost * 0.3);
    if (club.balance < down) return { ok: false, msg: tx(`Peşinat için ${fmt(down)} gerekiyor.`, `You need ${fmt(down)} for the down payment.`) };
    club.balance -= down;
    game.finance.projects = (game.finance.projects || 0) + down;
    x.proj.push({ id: x.nextId++, type: "stadium", seats: opt.seats, weeks: opt.weeks, left: opt.weeks, cost: opt.cost, weekly: Math.ceil((opt.cost - down) / opt.weeks) });
    return { ok: true, msg: tx(`+${opt.seats.toLocaleString("tr-TR")} koltukluk genişletme başladı (${opt.weeks} hafta).`, `+${opt.seats.toLocaleString("en-GB")} seat expansion started (${opt.weeks} weeks).`) };
  },
  facility(game, key) {
    const club = game.clubs.find((c) => c.id === game.clubId);
    const x = ensureExt(game, club.id);
    if (x.proj.some((p) => p.type === "fac")) return { ok: false, msg: tx("Aynı anda tek tesis projesi yürütülebilir.", "Only one facility project at a time.") };
    const lvl = x.fac[key] ?? 0;
    if (lvl >= FAC_MAX) return { ok: false, msg: tx("Tesis en üst seviyede.", "Facility is maxed out.") };
    const cost = facCost(club, lvl), weeks = facWeeks(lvl);
    const down = Math.round(cost * 0.4);
    if (club.balance < down) return { ok: false, msg: tx(`Peşinat için ${fmt(down)} gerekiyor.`, `You need ${fmt(down)} for the down payment.`) };
    club.balance -= down;
    game.finance.projects = (game.finance.projects || 0) + down;
    x.proj.push({ id: x.nextId++, type: "fac", key, weeks, left: weeks, cost, weekly: Math.ceil((cost - down) / weeks) });
    return { ok: true, msg: tx(`${FAC_INFO[key].name.tr} için inşaat başladı (${weeks} hafta).`, `${FAC_INFO[key].name.en} upgrade started (${weeks} weeks).`) };
  },
};
export const payoffAmount = (l) => roundMoney((l.weekly * l.left) / (1 + l.rate * 0.5) * 1.02);

// ----------------------------------------------------------------- UI

export function createClubExt(deps) {
  if (typeof document !== "undefined" && !document.getElementById("cx-css")) {
    const link = document.createElement("link");
    link.id = "cx-css";
    link.rel = "stylesheet";
    link.href = new URL("./club-ext.css?v=2", import.meta.url).href;
    document.head.appendChild(link);
  }
  const { React, useGame, useI18n, Button, money, playerValue } = deps;
  const { useState } = React;
  const h = React.createElement;

  function Stat({ label, value, sub, tone }) {
    return h("div", { className: "rounded-lg border bg-card p-3" },
      h("p", { className: "text-xs font-medium tracking-wide text-muted-foreground uppercase" }, label),
      h("p", { className: `mt-1 font-display text-2xl font-bold tabular cx-tone-${tone || "n"}` }, value),
      sub && h("p", { className: "text-xs text-muted-foreground" }, sub));
  }
  function Section({ title, sub, children }) {
    return h("section", { className: "rounded-xl border bg-card p-5" },
      h("h2", { className: "font-display text-lg font-bold tracking-wide uppercase" }, title),
      sub && h("p", { className: "mb-3 text-sm text-muted-foreground" }, sub),
      children);
  }
  function Bar({ v, max }) {
    return h("span", { className: "cx-bar" }, h("span", { style: { width: `${clamp((v / Math.max(1, max)) * 100, 0, 100)}%` } }));
  }

  return function ClubExtScreen() {
    const { game, act } = useGame();
    const { L } = useI18n();
    const [note, setNote] = useState(null);
    const [loanPct, setLoanPct] = useState(50);
    const [loanSeasons, setLoanSeasons] = useState(2);
    if (game.clubId == null) return h("p", { className: "text-muted-foreground" }, L("Bir kulübünüz yok.", "You have no club."));
    const club = game.clubs.find((c) => c.id === game.clubId);
    const x = peekExt(game, club.id);
    const t = (o) => L(o.tr, o.en);
    const run = (fn) => {
      const r = act((g) => fn(g));
      if (r && r.msg) setNote({ ok: r.ok, text: t(r.msg) });
    };
    const rev = annualRevenue(game, club);
    const limit = loanLimit(game, club);
    const loanAmt = roundMoney((limit * loanPct) / 100);
    const rate = loanRate(club);
    const weeklyLoan = x.loans.reduce((s, l) => s + l.weekly, 0);
    const debt = x.loans.reduce((s, l) => s + l.weekly * l.left, 0);
    const sv = squadValue(game, club.id, playerValue);
    const stadiumProj = x.proj.find((p) => p.type === "stadium");
    const facProj = x.proj.find((p) => p.type === "fac");
    const deal = namingDeal(game, club);
    const btn = (label, onClick, disabled, variant) => h(Button, { size: "sm", variant: variant || "default", disabled, onClick }, label);

    const fundCard = (title, desc, meta, button) =>
      h("div", { className: "cx-card" },
        h("div", { className: "cx-card-head" }, h("b", null, title), meta && h("span", { className: "cx-pill" }, meta)),
        h("p", { className: "text-sm text-muted-foreground" }, desc),
        h("div", { className: "cx-card-foot" }, button));

    return h("div", { className: "grid gap-6" },
      h("div", null,
        h("h1", { className: "font-display text-3xl font-bold uppercase" }, L("Stadyum & Fon", "Stadium & Funding")),
        h("p", { className: "text-sm text-muted-foreground" }, `${club.name} · ${club.stadium}`)),
      h("div", { className: "grid grid-cols-2 gap-3 md:grid-cols-4" },
        h(Stat, { label: L("Kasa", "Balance"), value: money(club.balance), tone: club.balance < 0 ? "bad" : "n" }),
        h(Stat, { label: L("Transfer bütçesi", "Transfer budget"), value: money(club.transferBudget) }),
        h(Stat, { label: L("Kapasite", "Capacity"), value: club.capacity.toLocaleString("tr-TR"), sub: stadiumProj ? L(`+${stadiumProj.seats.toLocaleString("tr-TR")} yapımda`, `+${stadiumProj.seats.toLocaleString("en-GB")} under construction`) : null }),
        h(Stat, { label: L("Kredi borcu", "Loan debt"), value: money(debt), sub: weeklyLoan ? `${money(weeklyLoan)}/${L("hafta", "week")}` : L("Borç yok", "Debt free"), tone: debt ? "warn" : "n" })),
      note && h("div", { className: `cx-note ${note.ok ? "is-ok" : "is-bad"}`, role: "status" }, note.text,
        h("button", { type: "button", className: "cx-x", "aria-label": L("Kapat", "Dismiss"), onClick: () => setNote(null) }, "×")),

      h(Section, { title: L("Fon kaynakları", "Raise funds"), sub: L(`Kulübün tahmini yıllık geliri ${money(rev)}. Toplanan fonların bir kısmı otomatik olarak transfer bütçesine eklenir.`, `Estimated yearly turnover ${money(rev)}. Part of every fund raised goes straight into the transfer budget.`) },
        h("div", { className: "cx-grid" },
          fundCard(L("Yönetimden ek bütçe", "Ask the board"),
            L(`Yönetim ikna olursa ${money(boardGrant(game, club))} doğrudan transfer bütçesine eklenir. Onay ihtimali yönetim güvenine bağlı; her sezon bir kez istenebilir.`, `If convinced the board adds ${money(boardGrant(game, club))} to your transfer budget. Odds depend on board confidence; once per season.`),
            L(`Onay şansı %${Math.round(boardChance(game) * 100)}`, `${Math.round(boardChance(game) * 100)}% chance`),
            btn(x.board === game.season ? L("Bu sezon istendi", "Asked this season") : L("Bütçe iste", "Request funds"), () => run((g) => actions.board(g)), x.board === game.season)),
          fundCard(L("Taraftar kampanyası", "Fan fundraising campaign"),
            L(`Forma, kombine ve bağış kampanyası. Tahmini ${money(campaignAmount(game, club))} toplar; sezonda bir kez.`, `Shirt, season-ticket and donation drive. Raises around ${money(campaignAmount(game, club))}; once per season.`),
            null,
            btn(x.campaign === game.season ? L("Bu sezon yapıldı", "Done this season") : L("Kampanya başlat", "Launch campaign"), () => run((g) => actions.campaign(g)), x.campaign === game.season)),
          fundCard(L("Stadyum isim hakkı", "Stadium naming rights"),
            x.naming
              ? L(`Aktif anlaşma: ${x.naming.name} (${x.naming.until}/${(x.naming.until + 1) % 100} sezonuna kadar).`, `Active deal: ${x.naming.name} (until ${x.naming.until}/${(x.naming.until + 1) % 100}).`)
              : L(`Stadyum adı ${deal.seasons} sezonluğuna bir sponsora satılır. Peşin ödeme: ${money(deal.total)}.`, `Sell the stadium name to a sponsor for ${deal.seasons} seasons. Paid up front: ${money(deal.total)}.`),
            x.naming ? L("Aktif", "Active") : null,
            btn(L("Anlaşmayı imzala", "Sign the deal"), () => run((g) => actions.naming(g)), !!x.naming)),
          fundCard(L("Yatırımcıya hisse satışı", "Sell shares to investors"),
            L(`%10 hisse için ${money(shareOffer(game, club, sv))} teklif var. Karşılığında ticari gelirin %5'i her hafta yatırımcıya gider. Satılan: %${(x.stake || 0) * 10} / %40.`, `Investors offer ${money(shareOffer(game, club, sv))} for 10%. In return they take 5% of commercial income. Sold: ${(x.stake || 0) * 10}% / 40%.`),
            null,
            btn(L("%10 hisse sat", "Sell 10%"), () => {
              if (typeof window === "undefined" || window.confirm(L("Hisse satışı geri alınamaz. Devam edilsin mi?", "Share sales are permanent. Continue?"))) run((g) => actions.shares(g, sv));
            }, (x.stake || 0) >= 4, "outline"))),
        h("div", { className: "cx-loan" },
          h("div", { className: "cx-card-head" }, h("b", null, L("Banka kredisi", "Bank loan")), h("span", { className: "cx-pill" }, L(`Yıllık faiz %${(rate * 100).toFixed(1)}`, `${(rate * 100).toFixed(1)}% a year`))),
          h("p", { className: "text-sm text-muted-foreground" }, L(`Kullanılabilir kredi limiti ${money(limit)}. Taksitler maç haftalarında kasadan düşülür.`, `Available credit ${money(limit)}. Instalments are taken from the balance each match week.`)),
          h("div", { className: "cx-loan-row" },
            h("label", null, L("Tutar", "Amount"),
              h("input", { type: "range", min: 10, max: 100, step: 10, value: loanPct, onChange: (e) => setLoanPct(+e.target.value), "aria-label": L("Kredi tutarı", "Loan amount") }),
              h("b", null, money(loanAmt))),
            h("div", { className: "cx-seg", role: "group", "aria-label": L("Vade", "Term") },
              [1, 2, 3].map((s) => h("button", { key: s, type: "button", className: loanSeasons === s ? "is-on" : "", "aria-pressed": loanSeasons === s, onClick: () => setLoanSeasons(s) }, L(`${s} sezon`, `${s} season${s > 1 ? "s" : ""}`)))),
            h("span", { className: "text-sm text-muted-foreground" }, L(`Haftalık ${money(Math.ceil((loanAmt * (1 + rate * loanSeasons)) / (loanSeasons * 38)))}`, `${money(Math.ceil((loanAmt * (1 + rate * loanSeasons)) / (loanSeasons * 38)))} a week`)),
            btn(L("Krediyi çek", "Take the loan"), () => run((g) => actions.loan(g, loanAmt, loanSeasons)), loanAmt < 10000)),
          x.loans.length > 0 && h("ul", { className: "cx-list" }, x.loans.map((l) =>
            h("li", { key: l.id },
              h("span", null, money(l.amount), " · ", L(`${l.left} hafta kaldı`, `${l.left} weeks left`)),
              h(Bar, { v: l.weeks - l.left, max: l.weeks }),
              h("span", { className: "tabular" }, `${money(l.weekly)}/${L("hf", "wk")}`),
              btn(L(`Erken kapat (${money(payoffAmount(l))})`, `Repay (${money(payoffAmount(l))})`), () => run((g) => actions.repay(g, l.id)), club.balance < payoffAmount(l), "outline"))))))
      ,
      h(Section, { title: L("Stadyum geliştirme", "Stadium development"), sub: L(`Koltuk başı maliyet ${money(seatCost(club))}. Peşinat %30, kalanı inşaat süresince haftalık ödenir. Daha büyük stadyum = daha fazla bilet geliri (ve biraz daha yüksek işletme gideri).`, `Cost per seat ${money(seatCost(club))}. 30% down, the rest paid weekly during construction. A bigger ground means more ticket income (and slightly higher running costs).`) },
        stadiumProj
          ? h("div", { className: "cx-proj" },
            h("b", null, L(`+${stadiumProj.seats.toLocaleString("tr-TR")} koltuk inşa ediliyor`, `Building +${stadiumProj.seats.toLocaleString("en-GB")} seats`)),
            h(Bar, { v: stadiumProj.weeks - stadiumProj.left, max: stadiumProj.weeks }),
            h("span", { className: "text-sm text-muted-foreground" }, L(`${stadiumProj.left} hafta kaldı · ${money(stadiumProj.weekly)}/hafta`, `${stadiumProj.left} weeks left · ${money(stadiumProj.weekly)}/week`)))
          : h("div", { className: "cx-grid" }, stadiumOptions(club).map((o, i) =>
            fundCard([L("Tribün yenileme", "Stand refurbishment"), L("Yeni tribün", "New stand"), L("Büyük genişletme", "Major expansion")][i],
              L(`+${o.seats.toLocaleString("tr-TR")} koltuk → ${(club.capacity + o.seats).toLocaleString("tr-TR")}. Süre: ${o.weeks} hafta.`, `+${o.seats.toLocaleString("en-GB")} seats → ${(club.capacity + o.seats).toLocaleString("en-GB")}. Takes ${o.weeks} weeks.`),
              money(o.cost),
              btn(L("İnşaatı başlat", "Start building"), () => run((g) => actions.stadium(g, o)), club.balance < o.cost * 0.3))))),

      h(Section, { title: L("Tesisler", "Facilities"), sub: L(`Aynı anda bir tesis projesi yürütülebilir. Geliştirilen her seviye haftalık bakım gideri getirir (şu an ${money(upkeep(club, x))}/hafta).`, `One facility project at a time. Each level gained adds weekly upkeep (currently ${money(upkeep(club, x))}/week).`) },
        h("ul", { className: "cx-fac" }, FAC_KEYS.map((k) => {
          const lvl = x.fac[k] ?? 0, b = bonus(x, k), cost = facCost(club, lvl), busy = facProj && facProj.key === k;
          return h("li", { key: k },
            h("div", null, h("b", null, t(FAC_INFO[k].name)), h("span", { className: "text-xs text-muted-foreground" }, b ? t(FAC_INFO[k].eff(b)) : L("Başlangıç seviyesi", "Starting level"))),
            h("span", { className: "cx-pips", "aria-label": L(`Seviye ${lvl}/${FAC_MAX}`, `Level ${lvl}/${FAC_MAX}`) },
              Array.from({ length: FAC_MAX }, (_, i) => h("i", { key: i, className: i < lvl ? (i < (x.base[k] ?? 0) ? "is-base" : "is-on") : busy && i === lvl ? "is-busy" : "" }))),
            busy
              ? h("span", { className: "text-sm text-muted-foreground" }, L(`${facProj.left} hafta kaldı`, `${facProj.left} weeks left`))
              : lvl >= FAC_MAX ? h("span", { className: "text-sm text-muted-foreground" }, L("Maksimum", "Maxed"))
                : btn(L(`Geliştir · ${money(cost)} · ${facWeeks(lvl)} hf`, `Upgrade · ${money(cost)} · ${facWeeks(lvl)} wk`), () => run((g) => actions.facility(g, k)), !!facProj || club.balance < cost * 0.4, "outline"));
        }))),
      h("p", { className: "text-sm text-muted-foreground" }, L("İnşaatlar ve kredi taksitleri lig haftalarında ilerler. Kulüp değiştirirseniz bu yatırımlar eski kulüpte kalır.", "Construction and loan instalments progress each league week. Investments stay with the club if you move on.")));
  };
}
