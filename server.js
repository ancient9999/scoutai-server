const express = require("express");
const cors = require("cors");
const { Resend } = require("resend");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());

const resend = new Resend(process.env.RESEND_API_KEY);
const SUPABASE_ENABLED = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
const supabase = SUPABASE_ENABLED ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY) : null;

// ── API KEYS ───────────────────────────────────────────────────────────────
const FKEY = { "X-Auth-Token": process.env.FOOTBALL_API_KEY };
const BKEY = { "Authorization": process.env.BDL_API_KEY };
const RKEY = { "x-apisports-key": process.env.RAPID_API_KEY };
const ESPN = "https://site.api.espn.com/apis/site/v2/sports";
const APIF = "https://v3.football.api-sports.io";

// ── SMART CACHE ────────────────────────────────────────────────────────────
const cache = {};
function getCache(key) {
  const c = cache[key];
  if (!c) return null;
  if (Date.now() - c.ts > c.ttl) return null;
  return c.data;
}
function setCache(key, data, ttlMs) {
  cache[key] = { data, ts: Date.now(), ttl: ttlMs };
}

const TTL = {
  FIXTURES: 3 * 60 * 60 * 1000,      // 3 hours
  STANDINGS: 6 * 60 * 60 * 1000,     // 6 hours
  LIVE: 60 * 1000,                    // 1 minute
  RESULTS: 30 * 60 * 1000,           // 30 minutes
  NBA: 5 * 60 * 1000,                // 5 minutes
  ESPN_GAMES: 2 * 60 * 1000,         // 2 minutes
};

// ── RETRY FETCH ────────────────────────────────────────────────────────────
async function fetchWithRetry(url, opts = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(10000) });
      if (r.ok) return r;
      if (r.status === 429) {
        await new Promise(res => setTimeout(res, 2000 * (i + 1)));
        continue;
      }
      return r;
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(res => setTimeout(res, 1000 * (i + 1)));
    }
  }
}

// ── API-FOOTBALL LEAGUE IDS ────────────────────────────────────────────────
const AF_LEAGUES = {
  // Top European
  PL:   { id: 39,  name: "Premier League",      country: "England",     flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", season: 2024 },
  PD:   { id: 140, name: "La Liga",              country: "Spain",       flag: "🇪🇸", season: 2024 },
  BL1:  { id: 78,  name: "Bundesliga",           country: "Germany",     flag: "🇩🇪", season: 2024 },
  SA:   { id: 135, name: "Serie A",              country: "Italy",       flag: "🇮🇹", season: 2024 },
  FL1:  { id: 61,  name: "Ligue 1",              country: "France",      flag: "🇫🇷", season: 2024 },
  DED:  { id: 88,  name: "Eredivisie",           country: "Netherlands", flag: "🇳🇱", season: 2024 },
  PPL:  { id: 94,  name: "Primeira Liga",        country: "Portugal",    flag: "🇵🇹", season: 2024 },
  ELC:  { id: 40,  name: "Championship",         country: "England",     flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", season: 2024 },
  SPL:  { id: 179, name: "Scottish Premiership", country: "Scotland",    flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", season: 2024 },
  BEL:  { id: 144, name: "Belgian Pro League",   country: "Belgium",     flag: "🇧🇪", season: 2024 },
  // More Europe
  TUR:  { id: 203, name: "Süper Lig",            country: "Turkey",      flag: "🇹🇷", season: 2024 },
  GRE:  { id: 197, name: "Super League",         country: "Greece",      flag: "🇬🇷", season: 2024 },
  RUS:  { id: 235, name: "Premier League",       country: "Russia",      flag: "🇷🇺", season: 2024 },
  // Rest of World
  SAU:  { id: 307, name: "Saudi Pro League",     country: "Saudi Arabia",flag: "🇸🇦", season: 2024 },
  MLS:  { id: 253, name: "MLS",                  country: "USA",         flag: "🇺🇸", season: 2025 },
  BSA:  { id: 71,  name: "Serie A",              country: "Brazil",      flag: "🇧🇷", season: 2025 },
  ARG:  { id: 128, name: "Liga Profesional",     country: "Argentina",   flag: "🇦🇷", season: 2024 },
  MEX:  { id: 262, name: "Liga MX",              country: "Mexico",      flag: "🇲🇽", season: 2025 },
  // Cups
  CL:   { id: 2,   name: "Champions League",     country: "Europe",      flag: "🏆", season: 2024 },
  EL:   { id: 3,   name: "Europa League",        country: "Europe",      flag: "🥈", season: 2024 },
  WC:   { id: 1,   name: "World Cup",            country: "World",       flag: "🌍", season: 2026 },
};

const memPredictions = [], memSubs = [];

// ── API-FOOTBALL HELPERS ───────────────────────────────────────────────────
async function afGet(endpoint) {
  const cacheKey = "af_" + endpoint;
  const cached = getCache(cacheKey);
  if (cached) return cached;
  try {
    const r = await fetchWithRetry(APIF + endpoint, { headers: RKEY });
    const d = await r.json();
    if (d.results > 0 || d.response?.length > 0) {
      setCache(cacheKey, d.response || [], TTL.FIXTURES);
    }
    return d.response || [];
  } catch (e) {
    console.error("API-Football error:", e.message);
    return [];
  }
}

function mapAfFixture(f) {
  return {
    id: f.fixture?.id,
    homeId: f.teams?.home?.id,
    awayId: f.teams?.away?.id,
    home: f.teams?.home?.name || "",
    away: f.teams?.away?.name || "",
    homeCrest: f.teams?.home?.logo || "",
    awayCrest: f.teams?.away?.logo || "",
    date: f.fixture?.date || "",
    round: f.league?.round || "",
    status: f.fixture?.status?.short || "",
    statusLong: f.fixture?.status?.long || "",
    elapsed: f.fixture?.status?.elapsed || null,
    homeScore: f.goals?.home,
    awayScore: f.goals?.away,
    venue: f.fixture?.venue?.name || "",
    compId: null,
  };
}

// ── FIXTURES ENDPOINT ──────────────────────────────────────────────────────
app.get("/fixtures/:compId", async (req, res) => {
  const compId = req.params.compId.toUpperCase();
  const league = AF_LEAGUES[compId];
  if (!league) return res.status(400).json({ error: "Unknown league" });

  const cacheKey = "fixtures_" + compId;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const today = new Date().toISOString().split("T")[0];
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const data = await afGet("/fixtures?league=" + league.id + "&season=" + league.season + "&from=" + today + "&to=" + future + "&status=NS-PST");
    const fixtures = data.slice(0, 15).map(f => ({ ...mapAfFixture(f), compId }));
    setCache(cacheKey, fixtures, TTL.FIXTURES);
    res.json(fixtures);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── TODAY RESULTS ──────────────────────────────────────────────────────────
app.get("/results/:compId", async (req, res) => {
  const compId = req.params.compId.toUpperCase();
  const league = AF_LEAGUES[compId];
  if (!league) return res.status(400).json({ error: "Unknown league" });

  const cacheKey = "results_" + compId;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const data = await afGet("/fixtures?league=" + league.id + "&season=" + league.season + "&from=" + yesterday + "&to=" + today + "&status=FT-AET-PEN");
    const results = data.slice(0, 10).map(f => ({ ...mapAfFixture(f), compId }));
    setCache(cacheKey, results, TTL.RESULTS);
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── LIVE SCORES ────────────────────────────────────────────────────────────
app.get("/live/:compId", async (req, res) => {
  const compId = req.params.compId.toUpperCase();
  const league = AF_LEAGUES[compId];
  if (!league) return res.json([]);

  const cacheKey = "live_" + compId;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const data = await afGet("/fixtures?live=" + league.id);
    const live = data.map(f => ({ ...mapAfFixture(f), compId }));
    setCache(cacheKey, live, TTL.LIVE);
    res.json(live);
  } catch (e) { res.json([]); }
});

// ── STANDINGS ──────────────────────────────────────────────────────────────
app.get("/standings/:compId", async (req, res) => {
  const compId = req.params.compId.toUpperCase();
  const league = AF_LEAGUES[compId];
  if (!league) return res.status(400).json({ error: "Unknown league" });

  const cacheKey = "standings_" + compId;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const data = await afGet("/standings?league=" + league.id + "&season=" + league.season);
    const table = (data[0]?.league?.standings?.[0] || []).map(e => ({
      position: e.rank,
      team: e.team?.name || "",
      crest: e.team?.logo || "",
      teamId: e.team?.id,
      played: e.all?.played || 0,
      won: e.all?.win || 0,
      draw: e.all?.draw || 0,
      lost: e.all?.lose || 0,
      gf: e.all?.goals?.for || 0,
      ga: e.all?.goals?.against || 0,
      gd: e.goalsDiff || 0,
      points: e.points || 0,
      form: e.form || ""
    }));
    setCache(cacheKey, table, TTL.STANDINGS);
    res.json(table);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SCORERS ────────────────────────────────────────────────────────────────
app.get("/scorers/:compId", async (req, res) => {
  const compId = req.params.compId.toUpperCase();
  const league = AF_LEAGUES[compId];
  if (!league) return res.status(400).json({ error: "Unknown league" });

  const cacheKey = "scorers_" + compId;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const data = await afGet("/players/topscorers?league=" + league.id + "&season=" + league.season);
    const scorers = data.slice(0, 10).map(s => ({
      name: s.player?.name || "",
      nationality: s.player?.nationality || "",
      team: s.statistics?.[0]?.team?.name || "",
      crest: s.statistics?.[0]?.team?.logo || "",
      goals: s.statistics?.[0]?.goals?.total || 0,
      assists: s.statistics?.[0]?.goals?.assists || 0,
      penalties: s.statistics?.[0]?.penalty?.scored || 0
    }));
    setCache(cacheKey, scorers, TTL.STANDINGS);
    res.json(scorers);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── NBA ────────────────────────────────────────────────────────────────────
app.get("/nba/games", async (req, res) => {
  const cached = getCache("nba_games");
  if (cached) return res.json(cached);
  try {
    const today = new Date();
    const dates = [];
    for (let i = -1; i < 7; i++) {
      const dt = new Date(today);
      dt.setDate(dt.getDate() + i);
      dates.push(dt.toISOString().split("T")[0]);
    }
    const params = dates.map(d => "dates[]=" + d).join("&");
    const r = await fetchWithRetry("https://api.balldontlie.io/nba/v2/games?" + params + "&per_page=50", { headers: BKEY });
    const d = await r.json();
    const games = d.data || [];
    setCache("nba_games", games, TTL.NBA);
    res.json(games);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/nba/live", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const r = await fetchWithRetry("https://api.balldontlie.io/nba/v2/games?dates[]=" + today + "&per_page=15", { headers: BKEY });
    const d = await r.json();
    res.json(d.data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/nba/standings", async (req, res) => {
  const cached = getCache("nba_standings");
  if (cached) return res.json(cached);
  try {
    const r = await fetchWithRetry("https://api.balldontlie.io/nba/v2/standings?season=2025", { headers: BKEY });
    const d = await r.json();
    setCache("nba_standings", d.data || [], TTL.STANDINGS);
    res.json(d.data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/nba/teams", async (req, res) => {
  const cached = getCache("nba_teams");
  if (cached) return res.json(cached);
  try {
    const r = await fetchWithRetry("https://api.balldontlie.io/nba/v2/teams?per_page=30", { headers: BKEY });
    const d = await r.json();
    setCache("nba_teams", d.data || [], 24 * 60 * 60 * 1000);
    res.json(d.data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ESPN SPORTS ────────────────────────────────────────────────────────────
function mapEspnGame(e) {
  const c = (e.competitions || [])[0] || {};
  const home = (c.competitors || []).find(x => x.homeAway === "home") || {};
  const away = (c.competitors || []).find(x => x.homeAway === "away") || {};
  return {
    id: e.id, name: e.name, date: e.date,
    status: e.status?.type?.description || "Scheduled",
    completed: e.status?.type?.completed || false,
    live: e.status?.type?.state === "in",
    home: home.team?.displayName || "", away: away.team?.displayName || "",
    homeLogo: home.team?.logo || "", awayLogo: away.team?.logo || "",
    homeScore: home.score || "", awayScore: away.score || "",
    venue: c.venue?.fullName || ""
  };
}

async function getEspnGames(sport, league) {
  const key = "espn_" + sport + "_" + league;
  const cached = getCache(key);
  if (cached) return cached;
  try {
    const r = await fetchWithRetry(ESPN + "/" + sport + "/" + league + "/scoreboard");
    const d = await r.json();
    const games = (d.events || []).map(mapEspnGame);
    setCache(key, games, TTL.ESPN_GAMES);
    return games;
  } catch { return []; }
}

app.get("/nfl/games", async (req, res) => { res.json(await getEspnGames("football", "nfl")); });
app.get("/nfl/standings", async (req, res) => {
  try {
    const r = await fetchWithRetry(ESPN + "/football/nfl/standings");
    const d = await r.json();
    res.json((d.children || []).flatMap(conf => (conf.children || []).map(div => ({
      conference: conf.name, division: div.name,
      teams: (div.standings?.entries || []).map(e => ({
        team: e.team?.displayName || "", logo: e.team?.logos?.[0]?.href || "",
        wins: e.stats?.find(s => s.name === "wins")?.value || 0,
        losses: e.stats?.find(s => s.name === "losses")?.value || 0,
        pct: e.stats?.find(s => s.name === "winPercent")?.displayValue || ""
      }))
    }))));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/nhl/games", async (req, res) => { res.json(await getEspnGames("hockey", "nhl")); });
app.get("/tennis/scores", async (req, res) => {
  try {
    const r = await fetchWithRetry(ESPN + "/tennis/scoreboard");
    const d = await r.json();
    res.json((d.events || []).slice(0, 20).map(e => {
      const c = (e.competitions || [])[0] || {};
      const p1 = (c.competitors || [])[0] || {}, p2 = (c.competitors || [])[1] || {};
      return {
        id: e.id, name: e.name, date: e.date,
        tournament: (c.notes || [])[0]?.headline || e.name || "",
        status: e.status?.type?.description || "Scheduled",
        completed: e.status?.type?.completed || false,
        player1: p1.athlete?.displayName || "", player2: p2.athlete?.displayName || "",
        score1: p1.score || "", score2: p2.score || "",
        flag1: p1.athlete?.flag?.href || "", flag2: p2.athlete?.flag?.href || ""
      };
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/rugby/games", async (req, res) => { res.json(await getEspnGames("rugby", "scoreboard")); });

// ── CURRENCY ───────────────────────────────────────────────────────────────
app.get("/currency", async (req, res) => {
  try {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
    if (!ip || ip === "127.0.0.1" || ip === "::1") return res.json({ currency: "USD", symbol: "$", country: "US" });
    const r = await fetchWithRetry("http://ip-api.com/json/" + ip + "?fields=country,countryCode,currency");
    const d = await r.json();
    const sym = { USD:"$",GBP:"£",EUR:"€",CAD:"C$",AUD:"A$",NGN:"₦",BRL:"R$",JPY:"¥",INR:"₹",KRW:"₩",MXN:"$",ZAR:"R",CHF:"Fr",TRY:"₺",GHS:"₵",KES:"KSh" };
    res.json({ currency: d.currency || "USD", symbol: sym[d.currency] || (d.currency || "USD"), country: d.countryCode || "US" });
  } catch { res.json({ currency: "USD", symbol: "$", country: "US" }); }
});

// ── DASHBOARD ──────────────────────────────────────────────────────────────
app.get("/dashboard", async (req, res) => {
  const cached = getCache("dashboard");
  if (cached) return res.json(cached);
  try {
    const topLeagues = ["PL", "PD", "BL1", "SA", "FL1"];
    const football = await Promise.all(topLeagues.map(async id => {
      try {
        const league = AF_LEAGUES[id];
        const today = new Date().toISOString().split("T")[0];
        const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
        const data = await afGet("/fixtures?league=" + league.id + "&season=" + league.season + "&from=" + today + "&to=" + future + "&status=NS-PST");
        return {
          compId: id, compName: league.name, flag: league.flag,
          matches: data.slice(0, 4).map(f => ({
            id: f.fixture?.id, home: f.teams?.home?.name, away: f.teams?.away?.name,
            homeCrest: f.teams?.home?.logo, awayCrest: f.teams?.away?.logo, date: f.fixture?.date
          }))
        };
      } catch { return { compId: id, compName: AF_LEAGUES[id].name, flag: AF_LEAGUES[id].flag, matches: [] }; }
    }));
    const nbaR = await fetchWithRetry("https://api.balldontlie.io/nba/v2/games?dates[]=" + new Date().toISOString().split("T")[0] + "&per_page=8", { headers: BKEY });
    const nbaD = await nbaR.json();
    const result = { football, nba: nbaD.data || [] };
    setCache("dashboard", result, TTL.FIXTURES);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── AI HELPERS ─────────────────────────────────────────────────────────────
async function callClaude(systemPrompt, userMsg, maxTokens = 1200) {
  const r = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: maxTokens, system: systemPrompt, messages: [{ role: "user", content: userMsg }] })
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  const text = (d.content || []).map(c => c.text || "").join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

async function predictFootball(home, away, homeId, awayId, compId) {
  const sys = "Expert football analyst. Respond ONLY with valid JSON: {\"result\":\"Home Win or Draw or Away Win\",\"result_confidence\":70,\"over25\":true,\"over25_confidence\":65,\"btts\":true,\"btts_confidence\":60,\"score\":\"2-1\",\"reasoning\":\"analysis\"}";
  const msg = "Predict: " + home + " (HOME) vs " + away + " (AWAY)" + (compId ? " in " + (AF_LEAGUES[compId]?.name || compId) : "");
  const result = await callClaude(sys, msg);
  result.dataSource = "ai";
  return result;
}

async function predictSport(home, away, sport, league) {
  const prompts = {
    basketball: 'Expert NBA analyst. Respond ONLY with valid JSON: {"result":"Home Win or Away Win","result_confidence":70,"over_under":"Over or Under","line":220,"over_under_confidence":65,"score":"112-108","reasoning":"analysis here"}',
    nfl: 'Expert NFL analyst. Respond ONLY with valid JSON: {"result":"Home Win or Away Win","result_confidence":70,"score":"24-17","key_factors":["factor1","factor2","factor3"],"reasoning":"analysis here"}',
    nhl: 'Expert NHL analyst. Respond ONLY with valid JSON: {"result":"Home Win or Away Win","result_confidence":70,"score":"3-2","key_factors":["factor1","factor2","factor3"],"reasoning":"analysis here"}',
    tennis: 'Expert tennis analyst. Respond ONLY with valid JSON: {"result":"Player 1 Win or Player 2 Win","result_confidence":70,"score":"6-4 6-3","key_factors":["factor1","factor2","factor3"],"reasoning":"analysis here"}',
    rugby: 'Expert rugby analyst. Respond ONLY with valid JSON: {"result":"Home Win or Away Win or Draw","result_confidence":70,"score":"24-18","key_factors":["factor1","factor2","factor3"],"reasoning":"analysis here"}',
  };
    return await callClaude(prompts[sport] || prompts.nfl, "Predict: " + home + " vs " + away + (league ? " (" + league + ")" : ""));
}

app.post("/predict", async (req, res) => {
  const { home, away, homeId, awayId, compId, sport } = req.body;
  if (!home || !away) return res.status(400).json({ error: "Teams required" });
  try {
    const s = sport || "football";
    const result = s === "football" ? await predictFootball(home, away, homeId, awayId, compId) : await predictSport(home, away, s, compId);
    res.json(result);
  } catch (e) { res.status(500).json({ error: "Prediction failed: " + e.message }); }
});

app.post("/predict/sport", async (req, res) => {
  const { home, away, sport, league } = req.body;
  if (!home || !away) return res.status(400).json({ error: "Teams required" });
  try { res.json(await predictSport(home, away, sport || "nfl", league)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PREDICTION STORAGE ─────────────────────────────────────────────────────
app.post("/predictions/store", async (req, res) => {
  const { key, home, away, compId, matchId, result, score, confidence, date, sport } = req.body;
  if (!key || !home || !away) return res.status(400).json({ error: "Missing fields" });
  try {
    if (SUPABASE_ENABLED) {
      await supabase.from("predictions").upsert({ key, home, away, comp_id: compId, match_id: matchId || null, result, score, confidence, date, sport: sport || "football", status: "pending" }, { onConflict: "key", ignoreDuplicates: true });
    } else {
      if (!memPredictions.find(p => p.key === key)) memPredictions.push({ key, home, away, result, score, confidence, date, sport: sport || "football", status: "pending", created_at: new Date().toISOString() });
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PERFORMANCE ────────────────────────────────────────────────────────────
app.get("/performance", async (req, res) => {
  try {
    if (SUPABASE_ENABLED) {
      const { data: recent } = await supabase.from("predictions").select("home,away,result,actual_result,status,confidence,date,sport").neq("status", "pending").order("created_at", { ascending: false }).limit(20);
      const all = (await supabase.from("predictions").select("status")).data || [];
      const resolved = all.filter(p => p.status !== "pending");
      const won = resolved.filter(p => p.status === "won");
      res.json({ total: all.length, resolved: resolved.length, won: won.length, lost: resolved.length - won.length, accuracyAll: resolved.length ? Math.round(won.length / resolved.length * 100) : null, recentResults: (recent || []) });
    } else {
      const resolved = memPredictions.filter(p => p.status !== "pending");
      const won = resolved.filter(p => p.status === "won");
      res.json({ total: memPredictions.length, resolved: resolved.length, won: won.length, lost: resolved.length - won.length, accuracyAll: resolved.length ? Math.round(won.length / resolved.length * 100) : null, recentResults: resolved.slice(-20).reverse() });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PREDICTION OF DAY ──────────────────────────────────────────────────────
app.get("/prediction-of-day", async (req, res) => {
  const cached = getCache("potd");
  if (cached) return res.json(cached);
  try {
    const fixtures = [];
    for (const id of ["PL", "PD", "BL1", "SA", "FL1"]) {
      const league = AF_LEAGUES[id];
      const today = new Date().toISOString().split("T")[0];
      const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const data = await afGet("/fixtures?league=" + league.id + "&season=" + league.season + "&from=" + today + "&to=" + future + "&status=NS-PST");
      if (data.length) {
        const f = data[0];
        fixtures.push({ compId: id, compName: league.name, homeId: f.teams?.home?.id, awayId: f.teams?.away?.id, home: f.teams?.home?.name, away: f.teams?.away?.name, homeCrest: f.teams?.home?.logo, awayCrest: f.teams?.away?.logo, date: f.fixture?.date });
      }
    }
    if (!fixtures.length) return res.json(null);
    const preds = await Promise.all(fixtures.map(async f => {
      try { return { ...f, prediction: await predictFootball(f.home, f.away, f.homeId, f.awayId, f.compId) }; }
      catch { return null; }
    }));
    const valid = preds.filter(Boolean).sort((a, b) => b.prediction.result_confidence - a.prediction.result_confidence);
    const potd = valid[0] || null;
    setCache("potd", potd, 6 * 60 * 60 * 1000);
    res.json(potd);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PARLAYS ────────────────────────────────────────────────────────────────
app.get("/parlays", async (req, res) => {
  const cached = getCache("parlays");
  if (cached) return res.json(cached);
  try {
    const allFx = [];
    for (const id of ["PL", "PD", "BL1", "SA", "FL1", "DED", "PPL"]) {
      const league = AF_LEAGUES[id];
      const today = new Date().toISOString().split("T")[0];
      const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const data = await afGet("/fixtures?league=" + league.id + "&season=" + league.season + "&from=" + today + "&to=" + future + "&status=NS-PST");
      data.slice(0, 2).forEach(f => allFx.push({ compId: id, compName: league.name, flag: league.flag, homeId: f.teams?.home?.id, awayId: f.teams?.away?.id, home: f.teams?.home?.name, away: f.teams?.away?.name, homeCrest: f.teams?.home?.logo, awayCrest: f.teams?.away?.logo, date: f.fixture?.date }));
    }
    if (allFx.length < 3) return res.json({ safe: null, medium: null, highRisk: null });
    const preds = await Promise.all(allFx.slice(0, 8).map(async f => {
      try { return { ...f, prediction: await predictFootball(f.home, f.away, f.homeId, f.awayId, f.compId) }; }
      catch { return null; }
    }));
    const valid = preds.filter(Boolean).sort((a, b) => b.prediction.result_confidence - a.prediction.result_confidence);
    const buildSlip = (picks, label, emoji) => {
      if (!picks.length) return null;
      const totalOdds = picks.reduce((acc, p) => acc * parseFloat((100 / p.prediction.result_confidence).toFixed(2)), 1).toFixed(2);
      return { label, emoji, picks: picks.map(p => ({ home: p.home, away: p.away, flag: p.flag, compName: p.compName, homeCrest: p.homeCrest, awayCrest: p.awayCrest, date: p.date, result: p.prediction.result, confidence: p.prediction.result_confidence, score: p.prediction.score, odds: parseFloat((100 / p.prediction.result_confidence).toFixed(2)) })), totalOdds, combinedConf: Math.round(picks.reduce((a, p) => a * (p.prediction.result_confidence / 100), 1) * 100) };
    };
    const result = { safe: buildSlip(valid.filter(p => p.prediction.result_confidence >= 60).slice(0, 3), "Safe Parlay", "🔒"), medium: buildSlip(valid.slice(0, 5), "Value Parlay", "🎯"), highRisk: buildSlip(valid.slice(0, 7), "High Risk Parlay", "💣"), generatedAt: new Date().toISOString() };
    setCache("parlays", result, 3 * 60 * 60 * 1000);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── BLOG ───────────────────────────────────────────────────────────────────
app.post("/blog/generate", async (req, res) => {
  const { home, away, compName, date, prediction } = req.body;
  if (!home || !away) return res.status(400).json({ error: "Missing match data" });
  if (!SUPABASE_ENABLED) return res.json({ success: false });
  const slug = home.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-vs-" + away.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-prediction-" + new Date(date || Date.now()).toISOString().split("T")[0];
  try {
    const existing = await supabase.from("blog_posts").select("slug").eq("slug", slug).single();
    if (existing.data) return res.json({ success: true, slug, existing: true });
    const matchDate = new Date(date || Date.now()).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const predText = (prediction?.result || "Home Win") + " with " + (prediction?.result_confidence || 70) + "% confidence" + (prediction?.score ? ", predicted score " + prediction.score : "");
    const sys = "You are an expert SEO football prediction writer. Write engaging 350-450 word match preview articles. Use plain paragraphs only, no markdown headers or bullet points. Write naturally like a sports journalist.";
    const content = await callClaude(sys, "Write an SEO match prediction article for: " + home + " vs " + away + " (" + (compName || "Football") + ") on " + matchDate + ". AI prediction: " + predText + ". Analyze both teams form, key players, and end with a call to action to visit scoutaibot.com for more predictions.", 800);
    const title = home + " vs " + away + " Prediction & Preview — " + (compName || "Football");
    await supabase.from("blog_posts").insert({ slug, title, content: typeof content === "string" ? content : JSON.stringify(content), home, away, match_date: date, published: true, likes: 0 });
    res.json({ success: true, slug, title });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/blog", async (req, res) => {
  if (!SUPABASE_ENABLED) return res.json([]);
  try {
    const { data } = await supabase.from("blog_posts").select("slug,title,home,away,match_date,created_at,likes").eq("published", true).order("created_at", { ascending: false }).limit(50);
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/blog/:slug", async (req, res) => {
  if (!SUPABASE_ENABLED) return res.status(404).json({ error: "Not found" });
  try {
    const { data } = await supabase.from("blog_posts").select("*").eq("slug", req.params.slug).single();
    if (!data) return res.status(404).json({ error: "Post not found" });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/blog/:slug/like", async (req, res) => {
  if (!SUPABASE_ENABLED) return res.json({ likes: 0 });
  try {
    const { data: post } = await supabase.from("blog_posts").select("likes").eq("slug", req.params.slug).single();
    const newLikes = (post?.likes || 0) + 1;
    await supabase.from("blog_posts").update({ likes: newLikes }).eq("slug", req.params.slug);
    res.json({ likes: newLikes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/blog/:slug/comments", async (req, res) => {
  if (!SUPABASE_ENABLED) return res.json([]);
  try {
    const { data } = await supabase.from("blog_comments").select("*").eq("slug", req.params.slug).order("created_at", { ascending: false }).limit(50);
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/blog/:slug/comment", async (req, res) => {
  const { name, comment } = req.body;
  if (!name || !comment) return res.status(400).json({ error: "Name and comment required" });
  if (!SUPABASE_ENABLED) return res.status(503).json({ error: "Requires database" });
  try {
    const { data, error } = await supabase.from("blog_comments").insert({ slug: req.params.slug, name: name.substring(0, 50), comment: comment.substring(0, 500) }).select().single();
    if (error) throw error;
    res.json({ success: true, comment: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── AUTO DAILY BLOG ────────────────────────────────────────────────────────
async function autoBlog() {
  if (!SUPABASE_ENABLED) return;
  console.log("Auto blog: generating posts...");
  let count = 0;
  for (const id of ["PL", "PD", "BL1", "SA", "FL1", "DED", "PPL", "CL"]) {
    if (count >= 10) break;
    try {
      const league = AF_LEAGUES[id];
      const today = new Date().toISOString().split("T")[0];
      const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const data = await afGet("/fixtures?league=" + league.id + "&season=" + league.season + "&from=" + today + "&to=" + future + "&status=NS-PST");
      for (const f of data.slice(0, 2)) {
        if (count >= 10) break;
        const home = f.teams?.home?.name, away = f.teams?.away?.name;
        const slug = home.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-vs-" + away.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-prediction-" + today;
        const existing = await supabase.from("blog_posts").select("slug").eq("slug", slug).single();
        if (!existing.data) {
          try {
            const pred = await predictFootball(home, away, f.teams?.home?.id, f.teams?.away?.id, id);
            const predText = pred.result + " with " + pred.result_confidence + "% confidence" + (pred.score ? ", predicted score " + pred.score : "");
            const sys = "You are an expert SEO football prediction writer. Write engaging 350-450 word match preview articles. Plain paragraphs only, no markdown.";
            const content = await callClaude(sys, "Write an SEO match prediction article for: " + home + " vs " + away + " (" + league.name + ") today. AI prediction: " + predText + ". Include team analysis and end with a call to action for scoutaibot.com", 800);
            const title = home + " vs " + away + " Prediction & Preview — " + league.name;
            await supabase.from("blog_posts").insert({ slug, title, content: typeof content === "string" ? content : JSON.stringify(content), home, away, match_date: new Date().toISOString(), published: true, likes: 0 });
            count++;
            await new Promise(r => setTimeout(r, 2000));
          } catch (e) { console.error("Blog gen error:", e.message); }
        }
      }
    } catch (e) { console.error("Auto blog league error:", e.message); }
  }
  console.log("Auto blog done: " + count + " posts generated");
}

// ── CONTACT ────────────────────────────────────────────────────────────────
app.post("/contact", async (req, res) => {
  const { name, email, company, message, type } = req.body;
  if (!name || !email || !message) return res.status(400).json({ error: "Required fields missing" });
  try {
    await resend.emails.send({ from: "ScoutAI <onboarding@resend.dev>", to: process.env.OWNER_EMAIL || "owner@example.com", subject: "New Enquiry from " + name, html: "<h2>ScoutAI Enquiry</h2><p><b>Name:</b> " + name + "</p><p><b>Email:</b> " + email + "</p><p><b>Company:</b> " + (company || "N/A") + "</p><p><b>Type:</b> " + (type || "") + "</p><p><b>Message:</b> " + message + "</p>" });
  } catch (e) { console.error("Email:", e.message); }
  res.json({ success: true, message: "Message received! We will reply within 24 hours." });
});

// ── NEWSLETTER ─────────────────────────────────────────────────────────────
app.post("/subscribe", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });
  try {
    if (SUPABASE_ENABLED) await supabase.from("subscribers").upsert({ email }, { onConflict: "email", ignoreDuplicates: true });
    else if (!memSubs.find(s => s.email === email)) memSubs.push({ email });
    res.json({ success: true, message: "Subscribed! Daily predictions coming your way." });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ACCURACY ───────────────────────────────────────────────────────────────
app.get("/accuracy", (req, res) => {
  const resolved = memPredictions.filter(p => p.status !== "pending");
  const won = resolved.filter(p => p.status === "won").length;
  res.json({ total: memPredictions.length, correct: won, accuracy: resolved.length ? Math.round(won / resolved.length * 100) : null });
});

// ── DAILY CRON ─────────────────────────────────────────────────────────────
app.get("/cron/daily", async (req, res) => {
  const secret = req.headers["x-cron-secret"] || req.query.secret;
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });
  const results = { errors: [] };
  try { await autoBlog(); results.blogGenerated = true; } catch (e) { results.errors.push("Blog: " + e.message); }
  res.json({ success: true, timestamp: new Date().toISOString(), ...results });
});

// ── KEEP ALIVE ─────────────────────────────────────────────────────────────
app.get("/ping", (req, res) => res.json({ ok: true, ts: Date.now() }));

// Self-ping every 5 minutes to stay warm
setInterval(async () => {
  try {
    await fetch("https://scoutai-server.onrender.com/ping");
  } catch {}
}, 5 * 60 * 1000);

// Auto-refresh top league caches every 3 hours
setInterval(async () => {
  console.log("Cache refresh: updating top leagues...");
  for (const id of ["PL", "PD", "BL1", "SA", "FL1"]) {
    try {
      const league = AF_LEAGUES[id];
      const today = new Date().toISOString().split("T")[0];
      const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      delete cache["fixtures_" + id];
      await afGet("/fixtures?league=" + league.id + "&season=" + league.season + "&from=" + today + "&to=" + future + "&status=NS-PST");
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) { console.error("Cache refresh error:", id, e.message); }
  }
}, 3 * 60 * 60 * 1000);

// Run auto blog at 8am daily
function scheduleDailyBlog() {
  const now = new Date();
  const next8am = new Date(now);
  next8am.setHours(8, 0, 0, 0);
  if (next8am <= now) next8am.setDate(next8am.getDate() + 1);
  const ms = next8am - now;
  setTimeout(async () => {
    await autoBlog();
    setInterval(autoBlog, 24 * 60 * 60 * 1000);
  }, ms);
}
scheduleDailyBlog();

// Initial cache warm-up on server start
setTimeout(async () => {
  console.log("Warming up cache...");
  for (const id of ["PL", "PD", "BL1", "SA", "FL1"]) {
    try {
      const league = AF_LEAGUES[id];
      const today = new Date().toISOString().split("T")[0];
      const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      await afGet("/fixtures?league=" + league.id + "&season=" + league.season + "&from=" + today + "&to=" + future + "&status=NS-PST");
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) { console.error("Warmup error:", e.message); }
  }
  console.log("Cache warm-up done");
}, 5000);

app.get("/", (req, res) => res.send("ScoutAI Server v4.0 — Always On"));
app.listen(PORT, () => console.log("ScoutAI on port " + PORT));
