/*
 * Extra leagues (Kaiser-style "editions"): Portugal, Netherlands, Belgium, Scotland,
 * Brazil, Argentina, Saudi Arabia and the USA.
 *
 * extendLeagues(So, xo) runs once when the bundle loads: European clubs that already
 * live in the hidden "EUR" pool (with their real squads) move into their domestic
 * league, the rest are new clubs. Clubs with a short or empty player list are filled
 * up by the bundle's own squad generator (rep -> ability, league nationality -> names).
 * Player tuples: [name, pos, birthYear, nat, ovr, value, contractEnd].
 */

const C = (name, short, city, c1, c2, stadium, capacity, rep, players = []) => ({
  name, short, city, colors: [c1, c2], stadium, capacity, rep, players,
});

// [id, nameTr, nameEn, countryTr, countryEn, nat, level, tvPool, ticket, wageFactor, moveFromEUR[], newClubs[]]
export const EXTRA = [
  {
    id: "POR1", name: ["Liga Portugal", "Liga Portugal"], country: ["Portekiz", "Portugal"], nat: "PT",
    level: 68, tv: 2.2e8, ticket: 16, wf: 0.75, uefa: { UCL: [1, 2], UEL: [3], UECL: [4] },
    move: ["Benfica", "FC Porto", "Sporting CP", "SC Braga"],
    clubs: [
      C("Vitória SC", "VSC", "Guimarães", "#ffffff", "#111111", "Estádio D. Afonso Henriques", 30000, 66),
      C("Famalicão", "FAM", "Vila Nova de Famalicão", "#003a70", "#ffffff", "Estádio Municipal 22 de Junho", 5307, 62),
      C("Gil Vicente", "GIL", "Barcelos", "#c8102e", "#003da5", "Estádio Cidade de Barcelos", 12046, 61),
      C("Moreirense", "MOR", "Moreira de Cónegos", "#00843d", "#ffffff", "Parque Comendador Joaquim de Almeida Freitas", 6153, 59),
      C("Rio Ave", "RAV", "Vila do Conde", "#006a4e", "#ffffff", "Estádio do Rio Ave FC", 9065, 60),
      C("Estoril Praia", "EST", "Estoril", "#ffd200", "#003a8c", "Estádio António Coimbra da Mota", 8000, 61),
      C("Casa Pia", "CPA", "Lisboa", "#111111", "#ffffff", "Estádio Municipal de Rio Maior", 7000, 58),
      C("Arouca", "ARO", "Arouca", "#ffd700", "#003399", "Estádio Municipal de Arouca", 5600, 59),
      C("Santa Clara", "SCL", "Ponta Delgada", "#e30613", "#ffffff", "Estádio de São Miguel", 13277, 60),
      C("Nacional", "NAC", "Funchal", "#111111", "#ffffff", "Estádio da Madeira", 5132, 57),
      C("Estrela da Amadora", "EAM", "Amadora", "#d7002e", "#00843d", "Estádio José Gomes", 9288, 57),
      C("AVS", "AVS", "Vila das Aves", "#e30613", "#1c1c1c", "Estádio do CD Aves", 8560, 56),
      C("Tondela", "TON", "Tondela", "#ffd400", "#008000", "Estádio João Cardoso", 5000, 56),
      C("Alverca", "ALV", "Alverca do Ribatejo", "#e30613", "#ffffff", "Complexo Desportivo FC Alverca", 7705, 56),
    ],
  },
  {
    id: "NED1", name: ["Eredivisie", "Eredivisie"], country: ["Hollanda", "Netherlands"], nat: "NL",
    level: 68, tv: 1.9e8, ticket: 18, wf: 0.75, uefa: { UCL: [1, 2], UEL: [3], UECL: [4] },
    move: ["PSV Eindhoven", "Feyenoord", "AFC Ajax", "AZ Alkmaar", "FC Twente", "Utrecht"],
    clubs: [
      C("NEC Nijmegen", "NEC", "Nijmegen", "#d6001c", "#00843d", "Goffertstadion", 12500, 63),
      C("SC Heerenveen", "HEE", "Heerenveen", "#003da5", "#ffffff", "Abe Lenstra Stadion", 27224, 62),
      C("Go Ahead Eagles", "GAE", "Deventer", "#e30613", "#ffd200", "De Adelaarshorst", 10400, 61),
      C("Sparta Rotterdam", "SPA", "Rotterdam", "#e30613", "#ffffff", "Sparta-Stadion Het Kasteel", 11026, 60),
      C("Fortuna Sittard", "FOR", "Sittard", "#ffd200", "#00843d", "Fortuna Sittard Stadion", 12500, 59),
      C("FC Groningen", "GRO", "Groningen", "#00843d", "#ffffff", "Euroborg", 22525, 60),
      C("Heracles Almelo", "HER", "Almelo", "#111111", "#ffffff", "Erve Asito", 12080, 58),
      C("PEC Zwolle", "PEC", "Zwolle", "#003da5", "#ffffff", "MAC³PARK Stadion", 14000, 58),
      C("NAC Breda", "NAC", "Breda", "#ffd200", "#111111", "Rat Verlegh Stadion", 19000, 58),
      C("Excelsior", "EXC", "Rotterdam", "#e30613", "#111111", "Van Donge & De Roo Stadion", 4500, 56),
      C("Telstar", "TEL", "Velsen", "#ffffff", "#e30613", "BUKO Stadion", 3060, 55),
      C("FC Volendam", "VOL", "Volendam", "#f58025", "#ffffff", "Kras Stadion", 6984, 56),
    ],
  },
  {
    id: "BEL1", name: ["Belçika Pro Ligi", "Belgian Pro League"], country: ["Belçika", "Belgium"], nat: "BE",
    level: 66, tv: 1.2e8, ticket: 16, wf: 0.7, uefa: { UCL: [1], UEL: [2], UECL: [3] },
    move: ["Club Brugge", "Union Saint-Gilloise", "RSC Anderlecht", "KRC Genk"],
    clubs: [
      C("Royal Antwerp", "ANT", "Antwerpen", "#e30613", "#ffffff", "Bosuilstadion", 16144, 66),
      C("KAA Gent", "GNT", "Gent", "#003da5", "#ffffff", "Planet Group Arena", 20000, 66),
      C("Standard Liège", "STL", "Liège", "#e30613", "#ffffff", "Stade Maurice Dufrasne", 27670, 64),
      C("Sporting Charleroi", "CHA", "Charleroi", "#111111", "#ffffff", "Stade du Pays de Charleroi", 14000, 62),
      C("Cercle Brugge", "CER", "Brugge", "#00843d", "#111111", "Jan Breydelstadion", 29062, 60),
      C("KVC Westerlo", "WES", "Westerlo", "#ffd200", "#003da5", "Het Kuipje", 8035, 60),
      C("KV Mechelen", "MEC", "Mechelen", "#ffd200", "#e30613", "AFAS Stadion Achter de Kazerne", 16672, 61),
      C("OH Leuven", "OHL", "Leuven", "#ffffff", "#e30613", "Den Dreef", 10020, 60),
      C("Sint-Truiden", "STV", "Sint-Truiden", "#ffd200", "#003da5", "Stayen", 14600, 58),
      C("FCV Dender", "DEN", "Denderleeuw", "#ffffff", "#111111", "Van Roystadion", 6429, 56),
      C("Zulte Waregem", "ZWA", "Waregem", "#e30613", "#ffffff", "Elindus Arena", 12300, 57),
      C("RAAL La Louvière", "RAA", "La Louvière", "#00843d", "#ffffff", "Stade du Tivoli", 3000, 55),
    ],
  },
  {
    id: "SCO1", name: ["İskoçya Premiership", "Scottish Premiership"], country: ["İskoçya", "Scotland"], nat: "SCO",
    level: 62, tv: 6e7, ticket: 18, wf: 0.6, uefa: { UCL: [1], UEL: [2], UECL: [3] },
    move: ["Celtic", "Rangers", "Hearts", "Aberdeen"],
    clubs: [
      C("Hibernian", "HIB", "Edinburgh", "#00843d", "#ffffff", "Easter Road", 20421, 63),
      C("Dundee United", "DUN", "Dundee", "#f58025", "#111111", "Tannadice Park", 14223, 60),
      C("Motherwell", "MOT", "Motherwell", "#ffb81c", "#8b0000", "Fir Park", 13677, 58),
      C("Kilmarnock", "KIL", "Kilmarnock", "#003da5", "#ffffff", "Rugby Park", 15003, 58),
      C("St Mirren", "STM", "Paisley", "#111111", "#ffffff", "SMiSA Stadium", 8023, 58),
      C("Dundee FC", "DFC", "Dundee", "#002855", "#ffffff", "Dens Park", 11775, 57),
      C("Falkirk", "FAL", "Falkirk", "#002855", "#ffffff", "Falkirk Stadium", 7937, 56),
      C("Livingston", "LIV", "Livingston", "#ffd200", "#111111", "Almondvale", 9713, 55),
    ],
  },
  {
    id: "BRA1", name: ["Brasileirão Série A", "Brasileirão Série A"], country: ["Brezilya", "Brazil"], nat: "BR",
    level: 71, tv: 4.5e8, ticket: 12, wf: 0.75,
    clubs: [
      C("Flamengo", "FLA", "Rio de Janeiro", "#c8102e", "#111111", "Maracanã", 78838, 82, [
        ["Giorgian de Arrascaeta", "AM", 1994, "UY", 81, 14e6, 2026],
        ["Pedro", "ST", 1997, "BR", 79, 15e6, 2027],
        ["Jorginho", "CM", 1991, "IT", 78, 5e6, 2027],
      ]),
      C("Palmeiras", "PAL", "São Paulo", "#006437", "#ffffff", "Allianz Parque", 43713, 82, [
        ["Vitor Roque", "ST", 2005, "BR", 77, 25e6, 2029],
        ["Weverton", "GK", 1987, "BR", 76, 1.5e6, 2026],
      ]),
      C("Botafogo", "BOT", "Rio de Janeiro", "#111111", "#ffffff", "Estádio Nilton Santos", 46831, 78),
      C("São Paulo", "SAO", "São Paulo", "#ffffff", "#e30613", "MorumBIS", 66795, 77, [["Lucas Moura", "RW", 1992, "BR", 77, 4e6, 2026]]),
      C("Corinthians", "COR", "São Paulo", "#111111", "#ffffff", "Neo Química Arena", 49205, 77, [["Memphis Depay", "ST", 1994, "NL", 80, 8e6, 2027]]),
      C("Atlético Mineiro", "CAM", "Belo Horizonte", "#111111", "#ffffff", "Arena MRV", 46000, 77, [["Hulk", "ST", 1986, "BR", 77, 2e6, 2026]]),
      C("Fluminense", "FLU", "Rio de Janeiro", "#7a0026", "#006b3f", "Maracanã", 78838, 77),
      C("Internacional", "INT", "Porto Alegre", "#e30613", "#ffffff", "Beira-Rio", 50128, 76),
      C("Grêmio", "GRE", "Porto Alegre", "#0d80bf", "#111111", "Arena do Grêmio", 55662, 76),
      C("Cruzeiro", "CRU", "Belo Horizonte", "#003da5", "#ffffff", "Mineirão", 61846, 77),
      C("Bahia", "BAH", "Salvador", "#003da5", "#e30613", "Arena Fonte Nova", 47907, 74),
      C("Fortaleza", "FOR", "Fortaleza", "#e30613", "#003da5", "Arena Castelão", 57876, 72),
      C("Vasco da Gama", "VAS", "Rio de Janeiro", "#111111", "#ffffff", "São Januário", 21880, 74, [["Philippe Coutinho", "AM", 1992, "BR", 77, 3e6, 2026]]),
      C("Santos", "SAN", "Santos", "#ffffff", "#111111", "Vila Belmiro", 16068, 74, [["Neymar", "LW", 1992, "BR", 80, 10e6, 2026]]),
      C("Red Bull Bragantino", "RBB", "Bragança Paulista", "#ffffff", "#e30613", "Nabi Abi Chedid", 15010, 72),
      C("Athletico Paranaense", "CAP", "Curitiba", "#e30613", "#111111", "Ligga Arena", 42372, 73),
      C("Vitória", "VIT", "Salvador", "#e30613", "#111111", "Barradão", 30618, 70),
      C("Juventude", "JUV", "Caxias do Sul", "#00843d", "#ffffff", "Alfredo Jaconi", 19924, 68),
      C("Ceará", "CEA", "Fortaleza", "#111111", "#ffffff", "Arena Castelão", 57876, 69),
      C("Mirassol", "MIR", "Mirassol", "#ffd200", "#00843d", "Maião", 15000, 68),
    ],
  },
  {
    id: "ARG1", name: ["Liga Profesional", "Liga Profesional"], country: ["Arjantin", "Argentina"], nat: "AR",
    level: 68, tv: 1.6e8, ticket: 9, wf: 0.6,
    clubs: [
      C("River Plate", "RIV", "Buenos Aires", "#ffffff", "#e30613", "Estadio Monumental", 85018, 80, [["Franco Armani", "GK", 1986, "AR", 75, 0.8e6, 2026]]),
      C("Boca Juniors", "BOC", "Buenos Aires", "#003da5", "#ffd200", "La Bombonera", 54000, 80, [
        ["Leandro Paredes", "DM", 1994, "AR", 79, 8e6, 2028],
        ["Edinson Cavani", "ST", 1987, "UY", 74, 1e6, 2026],
      ]),
      C("Racing Club", "RAC", "Avellaneda", "#75aadb", "#ffffff", "Estadio Presidente Perón", 51389, 76),
      C("Independiente", "IND", "Avellaneda", "#e30613", "#ffffff", "Libertadores de América", 42069, 74),
      C("San Lorenzo", "SLO", "Buenos Aires", "#003da5", "#e30613", "Pedro Bidegain", 47964, 73),
      C("Estudiantes", "EST", "La Plata", "#e30613", "#ffffff", "Estadio Jorge Luis Hirschi", 32530, 74),
      C("Vélez Sarsfield", "VEL", "Buenos Aires", "#ffffff", "#003da5", "José Amalfitani", 49540, 73),
      C("Talleres", "TAL", "Córdoba", "#003da5", "#ffffff", "Mario Alberto Kempes", 57000, 73),
      C("Argentinos Juniors", "ARJ", "Buenos Aires", "#e30613", "#ffffff", "Diego Armando Maradona", 26000, 71),
      C("Rosario Central", "ROS", "Rosario", "#003da5", "#ffd200", "Gigante de Arroyito", 41654, 72, [["Ángel Di María", "RW", 1988, "AR", 77, 2e6, 2026]]),
      C("Newell's Old Boys", "NOB", "Rosario", "#e30613", "#111111", "Estadio Marcelo Bielsa", 42000, 70),
      C("Lanús", "LAN", "Lanús", "#7a0026", "#ffffff", "La Fortaleza", 47027, 71),
      C("Huracán", "HUR", "Buenos Aires", "#ffffff", "#e30613", "Tomás Adolfo Ducó", 48314, 70),
      C("Defensa y Justicia", "DYJ", "Florencio Varela", "#00843d", "#ffd200", "Norberto Tomaghello", 18000, 69),
      C("Belgrano", "BEL", "Córdoba", "#75aadb", "#ffffff", "Gigante de Alberdi", 28000, 69),
      C("Godoy Cruz", "GOD", "Mendoza", "#003da5", "#ffffff", "Malvinas Argentinas", 42000, 68),
      C("Tigre", "TIG", "Victoria", "#003da5", "#e30613", "José Dellagiovanna", 26282, 67),
      C("Platense", "PLA", "Vicente López", "#7b3f00", "#ffffff", "Ciudad de Vicente López", 28530, 67),
      C("Gimnasia La Plata", "GIM", "La Plata", "#ffffff", "#002855", "Juan Carmelo Zerillo", 21500, 67),
      C("Unión", "UNI", "Santa Fe", "#e30613", "#ffffff", "Estadio 15 de Abril", 28000, 66),
    ],
  },
  {
    id: "KSA1", name: ["Suudi Pro Ligi", "Saudi Pro League"], country: ["Suudi Arabistan", "Saudi Arabia"], nat: "SA",
    level: 69, tv: 3.5e8, ticket: 10, wf: 1.3,
    clubs: [
      C("Al Hilal", "HIL", "Riyadh", "#0057b8", "#ffffff", "Kingdom Arena", 26000, 82, [
        ["Yassine Bounou", "GK", 1991, "MA", 83, 10e6, 2027],
        ["Rúben Neves", "CM", 1997, "PT", 82, 25e6, 2027],
        ["Sergej Milinković-Savić", "CM", 1995, "RS", 83, 22e6, 2026],
        ["Malcom", "RW", 1997, "BR", 81, 20e6, 2027],
        ["Theo Hernández", "LB", 1997, "FR", 83, 30e6, 2028],
        ["Darwin Núñez", "ST", 1999, "UY", 81, 45e6, 2028],
      ]),
      C("Al Nassr", "NAS", "Riyadh", "#ffd200", "#003da5", "Al-Awwal Park", 26000, 81, [
        ["Cristiano Ronaldo", "ST", 1985, "PT", 84, 12e6, 2027],
        ["Sadio Mané", "LW", 1992, "SN", 82, 18e6, 2027],
        ["João Félix", "AM", 1999, "PT", 80, 25e6, 2030],
        ["Kingsley Coman", "RW", 1996, "FR", 81, 25e6, 2028],
        ["Iñigo Martínez", "CB", 1991, "ES", 80, 4e6, 2027],
      ]),
      C("Al Ittihad", "ITT", "Jeddah", "#ffd200", "#111111", "King Abdullah Sports City", 62345, 80, [
        ["Karim Benzema", "ST", 1987, "FR", 83, 8e6, 2026],
        ["N'Golo Kanté", "DM", 1991, "FR", 81, 12e6, 2026],
        ["Fabinho", "DM", 1993, "BR", 79, 10e6, 2026],
        ["Steven Bergwijn", "LW", 1997, "NL", 78, 12e6, 2027],
      ]),
      C("Al Ahli", "AHL", "Jeddah", "#00843d", "#ffffff", "King Abdullah Sports City", 62345, 79, [
        ["Riyad Mahrez", "RW", 1991, "DZ", 81, 12e6, 2027],
        ["Ivan Toney", "ST", 1996, "ENG", 81, 30e6, 2028],
        ["Édouard Mendy", "GK", 1992, "SN", 80, 6e6, 2026],
        ["Franck Kessié", "CM", 1996, "CI", 80, 20e6, 2026],
      ]),
      C("Al Qadsiah", "QAD", "Khobar", "#e30613", "#ffd200", "Prince Saud bin Jalawi Stadium", 15000, 74, [["Nacho", "CB", 1990, "ES", 78, 3e6, 2026]]),
      C("Al Shabab", "SHB", "Riyadh", "#ffffff", "#111111", "Prince Faisal bin Fahd Stadium", 22500, 72),
      C("Al Ettifaq", "ETT", "Dammam", "#00843d", "#e30613", "EGO Stadium", 15000, 72, [["Georginio Wijnaldum", "CM", 1990, "NL", 77, 3e6, 2026]]),
      C("Al Taawoun", "TAA", "Buraidah", "#ffd200", "#003da5", "King Abdullah Sport City Buraidah", 25000, 70),
      C("Al Fateh", "FAT", "Al-Hasa", "#003da5", "#ffffff", "Al-Fateh Club Stadium", 12000, 68),
      C("Al Khaleej", "KHA", "Saihat", "#ffd200", "#00843d", "Prince Mohamed bin Fahd Stadium", 26000, 67),
      C("Al Fayha", "FAY", "Al Majma'ah", "#f58025", "#003da5", "Al Majma'ah Sports City", 7000, 66),
      C("Al Riyadh", "RIY", "Riyadh", "#e30613", "#111111", "Prince Turki bin Abdul Aziz Stadium", 15000, 65),
      C("Damac", "DAM", "Khamis Mushait", "#e30613", "#ffd200", "Prince Sultan bin Abdul Aziz Stadium", 20000, 65),
      C("Al Okhdood", "OKH", "Najran", "#00843d", "#ffd200", "Prince Hathloul Sport City", 12000, 64),
      C("Al Kholood", "KHO", "Ar Rass", "#e30613", "#ffffff", "Al Hazm Club Stadium", 8000, 64),
      C("Al Hazem", "HAZ", "Ar Rass", "#ffd200", "#111111", "Al Hazm Club Stadium", 8000, 63),
      C("Al Najma", "NAJ", "Unaizah", "#ffd200", "#003da5", "Al Najma Club Stadium", 8000, 63),
      C("NEOM SC", "NEO", "NEOM", "#111111", "#ffd200", "King Khalid Sport City", 12000, 66),
    ],
  },
  {
    id: "USA1", name: ["MLS", "MLS"], country: ["ABD", "United States"], nat: "US",
    level: 66, tv: 3e8, ticket: 30, wf: 1.0,
    clubs: [
      C("Inter Miami", "MIA", "Miami", "#f7b5cd", "#111111", "Miami Freedom Park", 25000, 76, [
        ["Lionel Messi", "RW", 1987, "AR", 86, 18e6, 2028],
        ["Luis Suárez", "ST", 1987, "UY", 77, 3e6, 2026],
        ["Rodrigo De Paul", "CM", 1994, "AR", 81, 20e6, 2029],
      ]),
      C("LAFC", "LAFC", "Los Angeles", "#111111", "#c39e6d", "BMO Stadium", 22000, 74, [
        ["Son Heung-min", "LW", 1992, "KR", 84, 20e6, 2028],
        ["Hugo Lloris", "GK", 1986, "FR", 77, 1e6, 2026],
      ]),
      C("LA Galaxy", "LAG", "Los Angeles", "#00245d", "#ffd200", "Dignity Health Sports Park", 27000, 72, [["Marco Reus", "AM", 1989, "DE", 76, 2e6, 2026]]),
      C("Columbus Crew", "CLB", "Columbus", "#ffd200", "#111111", "Lower.com Field", 20371, 72),
      C("FC Cincinnati", "CIN", "Cincinnati", "#f05323", "#263b80", "TQL Stadium", 26000, 72),
      C("Seattle Sounders", "SEA", "Seattle", "#5d9741", "#005595", "Lumen Field", 37722, 72),
      C("Philadelphia Union", "PHI", "Chester", "#071b2c", "#b19b69", "Subaru Park", 18500, 71),
      C("Orlando City", "ORL", "Orlando", "#633492", "#fde192", "Inter&Co Stadium", 25500, 70),
      C("New York City FC", "NYC", "New York", "#6cace4", "#041e42", "Yankee Stadium", 46537, 70),
      C("New York Red Bulls", "NYRB", "Harrison", "#ed1e36", "#23326a", "Sports Illustrated Stadium", 25000, 70),
      C("Atlanta United", "ATL", "Atlanta", "#80000a", "#221f1f", "Mercedes-Benz Stadium", 42500, 70),
      C("Vancouver Whitecaps", "VAN", "Vancouver", "#00245e", "#9dc2ea", "BC Place", 54500, 70, [["Thomas Müller", "AM", 1989, "DE", 78, 3e6, 2026]]),
      C("Nashville SC", "NSH", "Nashville", "#ece83a", "#1f1646", "GEODIS Park", 30109, 69),
      C("Charlotte FC", "CLT", "Charlotte", "#1a85c8", "#111111", "Bank of America Stadium", 38000, 69),
      C("San Diego FC", "SD", "San Diego", "#111111", "#00b2a9", "Snapdragon Stadium", 35000, 69),
      C("Minnesota United", "MIN", "Saint Paul", "#8cd2f4", "#231f20", "Allianz Field", 19400, 69),
      C("Portland Timbers", "POR", "Portland", "#00482b", "#d69a00", "Providence Park", 25218, 68),
      C("Real Salt Lake", "RSL", "Sandy", "#b30838", "#013a81", "America First Field", 20213, 67),
      C("Toronto FC", "TOR", "Toronto", "#e31937", "#455560", "BMO Field", 28351, 67),
      C("Austin FC", "ATX", "Austin", "#00b140", "#111111", "Q2 Stadium", 20738, 67),
    ],
  },
];

export const NON_UEFA = new Set(EXTRA.filter((l) => !l.uefa).map((l) => l.id));
export const UEFA_SLOTS = Object.fromEntries(EXTRA.filter((l) => l.uefa).map((l) => [l.id, l.uefa]));
export const uefa = (leagueId) => !NON_UEFA.has(leagueId);

/** Domestic cups for these leagues are defined in career-ext.js (DCUPS). */

/** Mutates the bundle's league table: moves EUR clubs into their leagues and appends the new leagues. */
export function extendLeagues(So, xo) {
  if (So.__kx) return So;
  const eur = So.find((l) => l.id === "EUR");
  const eurClubs = eur ? eur.clubs : [];
  const insertAt = So.indexOf(eur) >= 0 ? So.indexOf(eur) : So.length;
  const added = [];
  for (const L of EXTRA) {
    const moved = [];
    for (const name of L.move ?? []) {
      const i = eurClubs.findIndex((c) => c.name === name);
      if (i >= 0) moved.push(...eurClubs.splice(i, 1));
    }
    const lg = xo(L.id, { tr: L.name[0], en: L.name[1] }, { tr: L.country[0], en: L.country[1] }, L.nat, L.level, L.tv, L.ticket, L.wf, [...moved, ...L.clubs]);
    added.push(lg);
  }
  So.splice(insertAt, 0, ...added);
  Object.defineProperty(So, "__kx", { value: true });
  return So;
}
