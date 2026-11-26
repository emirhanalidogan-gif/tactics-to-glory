/* Ultimate Football Manager — tactical depth, media, career activities and national-team fixtures. */
import { PLANS } from "./kaiser-ext.js";

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const seeded = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (arr, count, seed) => { const r = seeded(hash(seed)); const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, count); };

export function altPositions(p) {
  if (!p || p.pos === "GK") return [];
  const out = new Set();
  const add = (cond, ...roles) => { if (cond) roles.forEach((r) => out.add(r)); };
  if (p.pos === "CB") { add(p.pas >= 62, "DM"); add(p.pac >= 69, "LB", "RB"); }
  if (p.pos === "LB" || p.pos === "RB") { add(p.pac >= 62, p.pos === "LB" ? "RB" : "LB"); add(p.dri >= 68, p.pos === "LB" ? "LW" : "RW"); add(p.def >= 70, "CB"); add(p.pas >= 68, "DM"); }
  if (p.pos === "DM") { add(p.pas >= 62, "CM"); add(p.def >= 69, "CB"); add(p.dri >= 70, "AM"); }
  if (p.pos === "CM") { add(p.def >= 60, "DM"); add(p.pas >= 66 && p.dri >= 62, "AM"); add(p.sho >= 72, "ST"); }
  if (p.pos === "AM") { add(p.pas >= 65, "CM"); add(p.pac >= 68 && p.dri >= 66, "LW", "RW"); add(p.sho >= 70, "ST"); }
  if (p.pos === "LW" || p.pos === "RW") { add(p.dri >= 62, p.pos === "LW" ? "RW" : "LW"); add(p.pas >= 66, "AM"); add(p.sho >= 69, "ST"); add(p.def >= 62, p.pos === "LW" ? "LB" : "RB"); }
  if (p.pos === "ST") { add(p.pas >= 67, "AM"); add(p.pac >= 68 && p.dri >= 65, "LW", "RW"); }
  return [...out];
}
export function positionFit(p, role, naturalFit = 0.5) {
  if (!p || !role) return 0.4;
  if (p.pos === role) return 1;
  if (p.pos === "GK" || role === "GK") return 0.32;
  const alts = p.altPos || altPositions(p);
  if (alts.includes(role)) return 0.96;
  if (naturalFit >= 0.8) return 0.84;
  if (naturalFit >= 0.5) return 0.72;
  return 0.58;
}
export function ensureFM(g) {
  if (!g) return;
  if (!g.fm || g.fm.v !== 1) g.fm = { v: 1, analysis: {}, activities: {}, ...(g.fm || {}) };
  g.fm.analysis ||= {}; g.fm.activities ||= {};
  for (const p of Object.values(g.players || {})) { const a = altPositions(p); if (a.length) p.altPos = a; }
}
export const analysisKey = (g, leagueId, fixtureId) => `${g.season}:${leagueId}:${fixtureId}`;

export const ANALYSIS_PLANS = [
  { id: "balanced", plan: "balanced", tr: "Dengeli kontrol", en: "Balanced control", descTr: "Rakibin gücünü karşıla, savunma-hücum dengesini koru.", descEn: "Match their strength and keep both phases balanced.", bonus: 1.13 },
  { id: "press", plan: "press", tr: "Önde baskı tuzağı", en: "High press trap", descTr: "Stoperlerin ayağını kapat, kısa pas çıkışını boz.", descEn: "Close the centre backs and disrupt their build-up.", bonus: 1.17 },
  { id: "counter", plan: "counter", tr: "Derin blok ve kontra", en: "Deep block & counter", descTr: "Güçlü rakibi üzerine çek, boşalan alana hızlı çık.", descEn: "Invite a stronger side on and attack the space behind.", bonus: 1.18 },
  { id: "wings", plan: "wings", tr: "Kenarları genişlet", en: "Stretch the wings", descTr: "Dar savunmayı aç, beklerle sürekli bindir.", descEn: "Open a narrow defence with repeated full-back runs.", bonus: 1.15 },
  { id: "overload", plan: "overload", tr: "Merkezi kalabalıklaştır", en: "Overload the centre", descTr: "Topa sahip ol, merkezde sayısal üstünlük kur.", descEn: "Keep the ball and create a central numerical advantage.", bonus: 1.16 },
];
export function recommendedPlan(opp) {
  const t = opp?.tactic || {};
  if ((opp?.rep || 70) >= 78 || t.mentality === "attacking") return "counter";
  if (t.pressing === "high" || t.mentality === "defensive") return "wings";
  if (t.width === "narrow") return "wings";
  if (t.pressing === "low") return "overload";
  return "press";
}
export function applyAnalysis(g, key, planId) {
  ensureFM(g);
  const a = ANALYSIS_PLANS.find((x) => x.id === planId) || ANALYSIS_PLANS[0];
  g.kx ||= {}; g.kx.plan = a.plan;
  g.fm.analysis[key] = { planId: a.id, plan: a.plan, applied: true };
  return g.fm.analysis[key];
}
export function analysisBoost(g, leagueId, fixtureId, clubId) {
  ensureFM(g);
  if (clubId !== g.clubId) return { att: 1, mid: 1, def: 1 };
  const a = g.fm.analysis[analysisKey(g, leagueId, fixtureId)];
  if (!a?.applied || g.kx?.plan !== a.plan) return { att: 1, mid: 1, def: 1 };
  const b = ANALYSIS_PLANS.find((x) => x.id === a.planId)?.bonus || 1.13;
  return { att: b, mid: 1 + (b - 1) * 0.85, def: 1 + (b - 1) * 0.7 };
}
export function winEstimate(g, myClub, opp, planId) {
  const players = Object.values(g.players || {});
  const rating = (c) => { const a = players.filter((p) => p.clubId === c?.id && !p.loan).sort((x, y) => (y.ovr || 0) - (x.ovr || 0)).slice(0, 11); return a.length ? a.reduce((s, p) => s + (p.ovr || 60), 0) / a.length : 65; };
  const me = rating(myClub), op = rating(opp);
  const a = ANALYSIS_PLANS.find((x) => x.id === planId);
  const edge = me - op + (a ? (a.bonus - 1) * 42 : 0);
  return Math.round(clamp(50 + edge * 2.1, 8, 88));
}

const TALKS = [
  ["Sakin kalın, ilk on dakika oyunu okuyalım.", "Stay calm and read the opening ten minutes.", "calm"],
  ["Bugün sadece kendi standartımıza odaklanıyoruz.", "Today we focus only on our own standards.", "calm"],
  ["Telaş yok; doğru pozisyon golü getirecek.", "No rush; the right opening will bring the goal.", "calm"],
  ["Herkes plana güvensin, skor er ya da geç gelecek.", "Trust the plan and the score will follow.", "calm"],
  ["Bu formanın ağırlığını sahada gösterin.", "Show what this shirt means out there.", "believe"],
  ["Taraftar enerjinizi görsün; birbiriniz için savaşın.", "Let the fans see your energy; fight for each other.", "believe"],
  ["Kalitenize inanıyorum, şimdi bunu birlikte gösterin.", "I believe in your quality; now show it together.", "believe"],
  ["Cesur oynayın, sorumluluk benim.", "Play with courage; the responsibility is mine.", "believe"],
  ["Bu maç sezonun dönüm noktası olabilir.", "This match can be the turning point of our season.", "demand"],
  ["Her ikili mücadelede standart sizsiniz.", "Set the standard in every duel.", "demand"],
  ["Galibiyet istiyorum; top rakipteyken de aynı arzuyu göreceğim.", "I want the win and the same hunger without the ball.", "demand"],
  ["Bugün bahane yok, sahada karakter göstereceğiz.", "No excuses today; we show character on the pitch.", "demand"],
  ["Skor ne olursa olsun oyunumuzdan vazgeçmiyoruz.", "Whatever the score, we do not abandon our football.", "nopressure"],
  ["Baskıyı dışarıda bırakın, birlikte oynamanın tadını çıkarın.", "Leave the pressure outside and enjoy playing together.", "nopressure"],
  ["Sonuçtan önce birlik ve mücadele istiyorum.", "Before the result, I want unity and effort.", "nopressure"],
  ["Hata olabilir; tepkiniz ve birbirinize desteğiniz önemli.", "Mistakes can happen; your response and support matter.", "nopressure"],
];
export function talkChoices(fixtureId) {
  const chosen = pick(TALKS.map((x, i) => ({ key: `talk-${i}`, tr: x[0], en: x[1], id: x[2] })), 4, `talk:${fixtureId}`);
  const groups = ["calm", "believe", "demand", "nopressure"];
  for (const id of groups) if (!chosen.some((x) => x.id === id)) chosen[chosen.length - 1] = { key: `fallback-${id}`, id, tr: TALKS.find((x) => x[2] === id)[0], en: TALKS.find((x) => x[2] === id)[1] };
  return chosen;
}

const PRE = [
  ["Rakibin son maçlardaki yükselişi sizi endişelendiriyor mu?", "Does the opponent's recent rise concern you?", "opp"],
  ["Kadronuzda sürpriz bir tercih görecek miyiz?", "Will we see a surprise selection?", "squad"],
  ["Bu maçta nasıl bir oyun planı hazırladınız?", "What game plan have you prepared?", "tactic"],
  ["Sakatlıklar planlarınızı ne kadar değiştirdi?", "How much have injuries changed your plans?", "squad"],
  ["Rakibin en tehlikeli oyuncusunu nasıl durduracaksınız?", "How will you stop their most dangerous player?", "opp"],
  ["Deplasman atmosferi takımınızı etkiler mi?", "Will the away atmosphere affect your team?", "pressure"],
  ["Taraftarınızdan özel bir beklentiniz var mı?", "Do you have a special request for your supporters?", "fans"],
  ["Genç bir oyuncuya şans vermeyi düşünüyor musunuz?", "Are you considering giving a youngster a chance?", "squad"],
  ["Son antrenmandaki tempo nasıldı?", "How was the tempo in your final training session?", "form"],
  ["Bu karşılaşma sezon hedefiniz açısından ne ifade ediyor?", "What does this match mean for your season objective?", "stakes"],
  ["Rakibinizin teknik direktörü hakkında ne düşünüyorsunuz?", "What do you think of the opposing manager?", "opp"],
  ["Hakem kararları konusunda takımınızı nasıl hazırladınız?", "How did you prepare the team for refereeing decisions?", "pressure"],
  ["Takımın morali şu anda hangi seviyede?", "Where is the team's morale right now?", "form"],
  ["Yoğun fikstürde rotasyon yapacak mısınız?", "Will you rotate during this congested schedule?", "squad"],
  ["İlk golü atmanın önemi bu maçta daha mı büyük?", "Is scoring first even more important in this match?", "tactic"],
  ["Önceki karşılaşmadan hangi dersleri çıkardınız?", "What lessons did you take from the previous meeting?", "opp"],
  ["Kaptanınız bu hafta nasıl bir liderlik gösterdi?", "How has your captain led this week?", "squad"],
  ["Rakibin baskısına karşı geriden oyun kuracak mısınız?", "Will you build from the back against their press?", "tactic"],
  ["Kenar oyuncularınızdan nasıl bir katkı bekliyorsunuz?", "What contribution do you expect from your wide players?", "tactic"],
  ["Duran toplara özel bir çalışma yaptınız mı?", "Have you done special work on set pieces?", "tactic"],
  ["Takım içinde forma rekabeti yeterince güçlü mü?", "Is competition for places strong enough?", "squad"],
  ["Transfer söylentileri oyuncularınızı etkiledi mi?", "Have transfer rumours affected your players?", "pressure"],
  ["Bu maç için en büyük riskiniz nedir?", "What is your biggest risk in this match?", "tactic"],
  ["Rakibinizin zayıf gördüğünüz bölgesi neresi?", "Where do you see the opponent's weakness?", "opp"],
  ["Gol yemeden oynamak önceliğiniz mi?", "Is keeping a clean sheet your priority?", "tactic"],
  ["Saha zemini oyun anlayışınızı değiştirir mi?", "Will the pitch condition change your approach?", "opp"],
  ["Hava koşullarına nasıl hazırlandınız?", "How have you prepared for the weather?", "form"],
  ["Oyuncularınızın kondisyonu doksan dakika için yeterli mi?", "Is your players' fitness sufficient for ninety minutes?", "squad"],
  ["Yedek kulübenizden oyunu değiştirecek hamleler bekliyor musunuz?", "Do you expect game-changing options from your bench?", "squad"],
  ["Maça hızlı başlamak için özel bir planınız var mı?", "Do you have a special plan for a fast start?", "tactic"],
  ["Takımınız baskı altında nasıl reaksiyon veriyor?", "How does your team respond under pressure?", "pressure"],
  ["Bu fikstürün en zorlu yanı nedir?", "What is the hardest part of this fixture?", "stakes"],
  ["Rakip analizinden en çok hangi veriyi öne çıkardınız?", "Which data stood out most in your opposition analysis?", "opp"],
  ["Oyuncularınıza son konuşmada ne söyleyeceksiniz?", "What will you tell the players in your final talk?", "pressure"],
  ["Yeni transferiniz bu maçta süre alabilir mi?", "Could your new signing feature in this match?", "squad"],
  ["Kadro dışı kalan oyuncuların motivasyonunu nasıl koruyorsunuz?", "How do you keep omitted players motivated?", "squad"],
  ["Oyun içinde plan değiştirmek için hangi işaretlere bakacaksınız?", "What signs will prompt an in-game plan change?", "tactic"],
  ["Bu maçta galibiyet favorisi siz misiniz?", "Are you favourites to win this match?", "pressure"],
  ["Rakibin hücum hattı savunmanızı zorlayabilir mi?", "Can their attack trouble your defence?", "opp"],
  ["Orta saha üstünlüğü için kime görev vereceksiniz?", "Who will you rely on for midfield control?", "tactic"],
  ["Kaleci tercihiniz kesinleşti mi?", "Have you decided on your goalkeeper?", "squad"],
  ["Taraftar baskısını olumlu enerjiye çevirebilir misiniz?", "Can you turn supporter pressure into positive energy?", "fans"],
  ["Son haftalardaki sonuçlar özgüveninizi etkiledi mi?", "Have recent results affected your confidence?", "form"],
  ["Bu maçın hikâyesini nasıl okuyorsunuz?", "How do you read the story of this match?", "stakes"],
  ["Oyuncularınızdan disiplin konusunda ne bekliyorsunuz?", "What do you expect from your players in terms of discipline?", "pressure"],
  ["Korner ve serbest vuruşlarda kimi öne çıkaracaksınız?", "Who will be key at corners and free kicks?", "tactic"],
  ["Rakibinizin kontra ataklarına önlem aldınız mı?", "Have you guarded against their counterattacks?", "opp"],
  ["Maçın kaderini hangi bölge belirleyecek?", "Which area will decide the match?", "tactic"],
  ["Kulübünüzün hedefleri ile bu maç arasında nasıl bir bağ var?", "How does this match connect to the club's objectives?", "stakes"],
  ["Bugün nasıl bir teknik direktör profili göstereceksiniz?", "What kind of touchline approach will you show today?", "pressure"],
];
const POST = [
  ["Galibiyetin en önemli anahtarı neydi?", "What was the key to the win?", "result"],
  ["Sonuç istediğiniz gibi olmadı; nerede zorlandınız?", "The result was not what you wanted; where did you struggle?", "result"],
  ["Maçın dönüm noktası hangi andı?", "What was the turning point?", "moment"],
  ["Oyuncularınızın mücadelesini nasıl değerlendiriyorsunuz?", "How do you assess your players' effort?", "players"],
  ["Oyun planınız sahaya ne kadar yansıdı?", "How closely did the performance match your plan?", "tactic"],
  ["İlk yarı ile ikinci yarı arasındaki fark neydi?", "What changed between the two halves?", "moment"],
  ["Değişiklikleriniz beklediğiniz etkiyi yarattı mı?", "Did your substitutions have the intended impact?", "tactic"],
  ["Yediğiniz golde neyi daha iyi yapabilirdiniz?", "What could you have done better for the goal conceded?", "tactic"],
  ["Attığınız gollerde hangi organizasyon öne çıktı?", "Which patterns stood out in your goals?", "tactic"],
  ["Hakem kararları hakkında ne söylersiniz?", "What would you say about the refereeing decisions?", "pressure"],
  ["Kalecinizin performansını nasıl buldunuz?", "How did you rate your goalkeeper's performance?", "players"],
  ["Genç oyuncunuzun performansı size ne gösterdi?", "What did your youngster's performance show you?", "players"],
  ["Taraftarın desteği sonucu etkiledi mi?", "Did the supporters influence the result?", "fans"],
  ["Takımınız fiziksel olarak son bölümde yeterince güçlü müydü?", "Was your team physically strong enough late on?", "players"],
  ["Kaçan pozisyonlar için ne söylersiniz?", "What would you say about the missed chances?", "moment"],
  ["Rakibinizin hangi özelliği sizi şaşırttı?", "Which opponent trait surprised you?", "opp"],
  ["Savunmada verilen boşlukların sebebi neydi?", "Why did your defence leave those spaces?", "tactic"],
  ["Orta sahada üstünlük neden el değiştirdi?", "Why did midfield control change hands?", "tactic"],
  ["Bu sonuç sezon hedefinizi nasıl etkiliyor?", "How does this result affect your season objective?", "stakes"],
  ["Bir sonraki maç öncesi en acil düzeltme ne olacak?", "What is the most urgent fix before the next match?", "stakes"],
  ["Kaptanınız sahada istediğiniz liderliği gösterdi mi?", "Did your captain show the leadership you wanted?", "players"],
  ["Maç sonunda oyuncularınıza ne söylediniz?", "What did you tell your players after the match?", "players"],
  ["Skordan çok oyundan memnun musunuz?", "Are you happier with the performance than the score?", "result"],
  ["Bugünkü kadro tercihinizden memnun musunuz?", "Are you satisfied with today's selection?", "tactic"],
  ["Sakatlık yaşayan oyuncunuzun durumu nasıl?", "How is the player who picked up an injury?", "players"],
  ["Kartlar oyununuzu değiştirdi mi?", "Did the cards change your approach?", "moment"],
  ["Kornerlerden daha fazla üretmeli miydiniz?", "Should you have created more from corners?", "tactic"],
  ["Rakip teknik direktörün hamleleri sizi zorladı mı?", "Did the opposing manager's changes trouble you?", "opp"],
  ["Basın toplantısı öncesi duygularınız nasıl?", "How are you feeling before this press conference?", "pressure"],
  ["Takımın moralini yeniden nasıl yükselteceksiniz?", "How will you lift morale again?", "players"],
  ["Bugün hangi oyuncu sizin için öne çıktı?", "Which player stood out for you today?", "players"],
  ["Oyun disiplininden memnun kaldınız mı?", "Were you satisfied with the team's discipline?", "players"],
  ["Tempoyu istediğiniz gibi kontrol edebildiniz mi?", "Did you control the tempo as intended?", "tactic"],
  ["Kenar hücumları neden istediğiniz kadar etkili değildi?", "Why were your wide attacks not as effective as intended?", "tactic"],
  ["Duran top savunmasında neyi konuştunuz?", "What did you discuss about set-piece defending?", "tactic"],
  ["Bu maçtan çıkarılacak en büyük ders nedir?", "What is the biggest lesson from this match?", "stakes"],
  ["Yedek kulübesinin enerjisi yeterli miydi?", "Was there enough energy from the bench?", "players"],
  ["Son düdüğe kadar mücadele sizi memnun etti mi?", "Were you pleased with the fight until the final whistle?", "players"],
  ["Gelecek hafta aynı oyun planıyla mı devam edersiniz?", "Will you continue with the same plan next week?", "stakes"],
  ["Bu akşam kutlama için oyuncularınıza izin verdiniz mi?", "Have you allowed the players to celebrate tonight?", "players"],
];
if (PRE.length !== 50 || POST.length !== 40) throw new Error("Media pool size mismatch");
function answers(kind, type) {
  const positive = { opp: "Güçlü yönlerine saygılıyız ama zaafları için hazırlandık.", tactic: "Planımız net; topa sahip olurken de savunurken de birlikte hareket edeceğiz.", squad: "Hazır olan ve plana en uygun oyuncular görev alacak.", pressure: "Baskı bu seviyenin parçası; onu enerjiye çevireceğiz.", fans: "Destekleri bize her zaman ekstra güç veriyor.", form: "Çalışma temposundan ve takımın reaksiyonundan memnunum.", stakes: "Her maç hedefimiz için önemli; sadece bugüne odaklandık.", result: "Mücadele ve doğru anlardaki kararlar sonucu belirledi.", moment: "Detaylar fark yarattı; o anları daha iyi yönetmeliyiz.", players: "Oyuncularım sorumluluk aldı ve sonuna kadar mücadele etti." };
  const balanced = { opp: "Rakibin kalitesini biliyoruz, kendi işimize odaklanacağız.", tactic: "İlk bölümde oyunu okuyup doğru anda hamle yapacağız.", squad: "Kadro kararını son antrenmandan sonra netleştirdim.", pressure: "Duyguları kontrol edip oyun disiplinini korumalıyız.", fans: "Onlar da bizim gibi son düdüğe kadar takımın yanında olsun.", form: "Bazı alanlar iyiydi, bazılarında daha iyi olmalıyız.", stakes: "Uzun bir sezon; bu maçtan doğru dersleri çıkaracağız.", result: "Skor bir yana, performansta geliştireceğimiz bölümler var.", moment: "Maçın tamamını değerlendirmeden tek bir ana bağlanamayız.", players: "İyi niyet vardı ama kolektif kaliteyi yükseltmeliyiz." };
  const bold = { opp: "Kim olduğuna bakmadan kendi oyunumuzu kabul ettireceğiz.", tactic: "Topu da kontrolü de rakibe bırakmak istemiyoruz.", squad: "Formayı hak eden alır; isimler değil performans konuşur.", pressure: "Bu takım büyük maçları seviyor, geri adım atmayacağız.", fans: "Stadı bir kaleye çevirsinler, biz de sahada karşılığını verelim.", form: "Bu takımın gerçek gücünü henüz herkes görmedi.", stakes: "Hedefimiz büyük ve bu maçı kazanmak için her şeyi yapacağız.", result: "Bundan sonraki cevabımız sahada çok daha güçlü olacak.", moment: "Aynı an yeniden gelse daha cesur karar verirdik.", players: "Karakter gösterdiler; bu grup daha fazlasını başaracak." };
  const idx = POST.length + PRE.length;
  return [positive[type] || positive.tactic, balanced[type] || balanced.tactic, bold[type] || bold.tactic].map((tr, i) => ({ key: `${kind}-${type}-${i}-${idx}`, tr, en: tr, effect: i === 0 ? "believe" : i === 1 ? "calm" : "demand" }));
}
export function mediaQuestions(kind, seed, oppName = "Rakip") {
  const src = kind === "pre" ? PRE : POST;
  return pick(src, kind === "pre" ? 4 : 3, `${kind}:${seed}:${oppName}`).map((q, i) => ({ id: `${kind}-${src.indexOf(q)}`, question: q[0], en: q[1], answers: answers(kind, q[2]).map((a, j) => ({ ...a, key: `${kind}-${src.indexOf(q)}-${j}` })), index: i }));
}

export const ACTIVITIES = [
  ["Takımla galibiyet kutlaması", "Team victory celebration", 5, -3], ["Aile ile sakin bir akşam yemeği", "Quiet dinner with family", 3, 2],
  ["Erken uyku ve dinlenme", "Early night and recovery", 0, 5], ["Takım arkadaşlarıyla bowling", "Bowling with team-mates", 4, -1],
  ["Sahilde kısa yürüyüş", "Short walk by the sea", 2, 3], ["Video analiz oturumu", "Video analysis session", 1, 1],
  ["Masaj ve havuzda yenilenme", "Massage and pool recovery", 1, 6], ["Taraftarlarla kısa buluşma", "Short supporters' meet-up", 4, 0],
  ["Aileyle film gecesi", "Movie night with family", 2, 3], ["Takım yemeği", "Team dinner", 4, 0],
  ["Tek başına müzik ve dinlenme", "Music and quiet recovery", 1, 3], ["Genç oyuncularla sohbet", "Chat with the young players", 3, 1],
  ["Kaptanlarla değerlendirme", "Review with the captains", 2, 1], ["Yardım kuruluşu ziyareti", "Charity visit", 4, -1],
  ["Hafif yoga seansı", "Light yoga session", 1, 4], ["Bir günlük tamamen izin", "A full day off", 2, 4],
  ["Kulüp personeliyle kahve", "Coffee with club staff", 2, 1], ["Eski takım arkadaşlarıyla yemek", "Dinner with former team-mates", 2, 1],
  ["Kişisel idman", "Individual training", 0, -3], ["Takım içi oyun turnuvası", "Team games tournament", 4, -1],
  ["Kitap okuyup erken dinlenme", "Reading and early recovery", 1, 3], ["Basından uzak sessiz akşam", "Quiet evening away from the media", 1, 3],
  ["Aileyle hafta sonu kaçamağı", "Short family getaway", 3, 1], ["Altyapı antrenmanını ziyaret", "Visit an academy session", 3, 0],
  ["Yenilenme için buz banyosu", "Ice bath recovery", 0, 5], ["Takımla karaokе gecesi", "Team karaoke night", 5, -3],
  ["Kişisel başarıları değerlendirme", "Review personal achievements", 2, 2], ["Yeni bir hobi için zaman", "Time for a personal hobby", 2, 2],
  ["Sakat oyuncuları ziyaret", "Visit injured players", 3, 1], ["Menajerle uzun vadeli sohbet", "Long-term chat with your agent", 1, 2],
];
if (ACTIVITIES.length !== 30) throw new Error("Activity pool size mismatch");
export function activityChoices(key) { return pick(ACTIVITIES.map((a, i) => ({ id: `activity-${i}`, tr: a[0], en: a[1], morale: a[2], fitness: a[3] })), 2, key); }
export function applyActivity(g, key, id) {
  ensureFM(g);
  if (g.fm.activities[key]) return g.fm.activities[key];
  const a = ACTIVITIES.map((x, i) => ({ id: `activity-${i}`, tr: x[0], en: x[1], morale: x[2], fitness: x[3] })).find((x) => x.id === id);
  if (!a) return null;
  for (const p of Object.values(g.players || {})) if (p.clubId === g.clubId) { p.morale = clamp((p.morale ?? 65) + a.morale, 0, 100); p.fitness = clamp((p.fitness ?? 100) + a.fitness, 20, 100); }
  g.fm.activities[key] = a;
  return a;
}

let D;
export function initFM(deps) { D = deps; ensureFM(deps.game); }
const UI = {};
function tr(L, a, b) { return L(a, b); }
function Analysis({ leagueId, fixtureId }) {
  const { React, useGame, useI18n, ClubBadge, OvrBadge, Button } = D.ui;
  const h = React.createElement;
  const { game: g, act } = useGame(); const { L } = useI18n();
  const f = D.fixture(leagueId, fixtureId); if (!f || g.clubId == null) return null;
  const oppId = f.home === g.clubId ? f.away : f.home; const opp = D.getClub(g, oppId); const me = D.getClub(g, g.clubId);
  const key = analysisKey(g, leagueId, fixtureId); const saved = g.fm?.analysis?.[key];
  const strong = D.clubPlayers(g, oppId).filter((p) => !p.loan).sort((a, b) => D.ovr(b) - D.ovr(a)).slice(0, 3);
  const rec = recommendedPlan(opp);
  return h("section", { className: "fm-card", "aria-label": L("Rakip analizi", "Opposition analysis") },
    h("div", { className: "fm-head" }, h("div", null, h("p", { className: "fm-kicker" }, L("MAÇ ÖNCESİ ANALİZ", "PRE-MATCH ANALYSIS")), h("h2", null, L(`${opp.name}: oyun planı`, `${opp.name}: game plan`))), h(ClubBadge, { club: opp, size: "md" })),
    h("div", { className: "fm-analysis-grid" }, h("div", { className: "fm-scout" },
      h("p", null, h("b", null, L("Diziliş", "Formation")), ` ${opp.tactic?.formation || "4-4-2"} · ${opp.tactic?.mentality || "balanced"}`),
      h("p", null, h("b", null, L("Öneri", "Recommendation")), ` ${L(ANALYSIS_PLANS.find((x) => x.id === rec)?.tr || "", ANALYSIS_PLANS.find((x) => x.id === rec)?.en || "")}`),
      h("p", null, h("b", null, L("Öne çıkanlar", "Key players"))),
      h("div", { className: "fm-key-players" }, strong.map((p) => h("span", { key: p.id }, p.last, " ", h(OvrBadge, { value: D.ovr(p) }))))),
      h("div", { className: "fm-odds" }, h("b", null, `%${winEstimate(g, me, opp, saved?.planId || rec)}`), h("span", null, L("tahmini galibiyet şansı", "estimated win chance")), h("small", null, L("Analizi uygulamak taktik bonusunu maç motoruna ekler.", "Applying analysis adds its tactical bonus to the match engine.")))),
    h("div", { className: "fm-plan-grid" }, ANALYSIS_PLANS.map((a) => h("button", { type: "button", key: a.id, className: `fm-plan ${saved?.planId === a.id ? "is-on" : ""}`, onClick: () => act((gg) => applyAnalysis(gg, key, a.id)), "aria-pressed": saved?.planId === a.id },
      h("b", null, L(a.tr, a.en)), h("span", null, L(a.descTr, a.descEn)), h("em", null, rec === a.id ? L("ANALİZ ÖNERİSİ", "SCOUT PICK") : saved?.planId === a.id ? L("UYGULANDI", "APPLIED") : `+${Math.round((a.bonus - 1) * 100)}%`)))),
    saved && h("p", { className: "fm-applied", role: "status" }, "✓ ", L("Rakip analizi uygulandı. Bu planı korursan hücum, orta saha ve savunma gücün artacak.", "Analysis applied. Keep this plan to boost attack, midfield and defence.")));
}
function PostActivity({ leagueId, fixtureId }) {
  const { React, useGame, useI18n } = D.ui; const h = React.createElement;
  const { game: g, act } = useGame(); const { L } = useI18n();
  const key = analysisKey(g, leagueId, fixtureId); const saved = g.fm?.activities?.[key]; const options = activityChoices(key);
  return h("section", { className: "fm-card", "aria-label": L("Maç sonrası etkinlik", "Post-match activity") },
    h("p", { className: "fm-kicker" }, L("MAÇ SONRASI SEÇİMİ", "POST-MATCH CHOICE")),
    h("h2", null, saved ? L("Akşam planın", "Your evening plan") : L("Bu akşam nasıl geçsin?", "How will you spend the evening?")),
    saved ? h("div", { className: "fm-activity-done" }, h("b", null, L(saved.tr, saved.en)), h("span", null, `${L("Moral", "Morale")} ${saved.morale >= 0 ? "+" : ""}${saved.morale} · ${L("Kondisyon", "Fitness")} ${saved.fitness >= 0 ? "+" : ""}${saved.fitness}`)) :
      h("div", { className: "fm-activities" }, options.map((a) => h("button", { type: "button", key: a.id, onClick: () => act((gg) => applyActivity(gg, key, a.id)) }, h("b", null, L(a.tr, a.en)), h("span", null, `${L("Moral", "Morale")} ${a.morale >= 0 ? "+" : ""}${a.morale} · ${L("Kondisyon", "Fitness")} ${a.fitness >= 0 ? "+" : ""}${a.fitness}`)))),
    h("p", { className: "fm-hint" }, L("Bir seçim yapabilirsin; etkisi kulübündeki tüm oyunculara bir kez uygulanır.", "Choose once; its effect applies to every player at your club.")));
}
function IntlFixtures() {
  const { React, useGame, useI18n } = D.ui; const h = React.createElement;
  const { game: g } = useGame(); const { L, tt } = useI18n(); const nat = g.kx?.userNat; const t = g.kx?.intl;
  if (!nat || !t || t.season !== g.season) return null;
  const fixtures = [...(t.groups || []).flatMap((x) => x.fixtures || []), ...(t.knockout || [])].filter((f) => f.home === nat || f.away === nat).sort((a, b) => (a.round || 0) - (b.round || 0));
  if (!fixtures.length) return null;
  return h("section", { className: "fm-card fm-intl-fixtures" }, h("div", null, h("p", { className: "fm-kicker" }, L("MİLLİ TAKIM FİKSTÜRÜ", "NATIONAL TEAM CALENDAR")), h("h2", null, `${nat} · ${t.kind === "wc" ? L("Dünya Kupası", "World Cup") : t.kind === "euro" ? "EURO" : L("Uluslar Ligi", "Nations League")}`)),
    h("ol", null, fixtures.map((f) => { const mine = f.home === nat; const opp = mine ? f.away : f.home; const result = f.played ? `${f.hg}-${f.ag}` : "—"; return h("li", { key: f.id }, h("span", null, tt(f.stage || f.label || f.round || "Grup")), h("b", null, opp), h("em", null, result), h("small", null, f.played && f.stats ? `${L("Şut", "Shots")} ${mine ? f.stats.hs : f.stats.as}:${mine ? f.stats.as : f.stats.hs} · ${L("Korner", "Corners")} ${mine ? f.stats.hc : f.stats.ac}:${mine ? f.stats.ac : f.stats.hc}` : L("Oynanmadı", "Upcoming"))); })));
}
export function createFMUI() {
  UI.Analysis = Analysis; UI.PostActivity = PostActivity; UI.IntlFixtures = IntlFixtures;
  return UI;
}
export function fmUI() { return UI; }
