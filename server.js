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

const AF_KEY = { "x-apisports-key": process.env.RAPID_API_KEY };
const BDL_KEY = { "Authorization": process.env.BDL_API_KEY };
const ESPN = "https://site.api.espn.com/apis/site/v2/sports";
const AFURL = "https://v3.football.api-sports.io";

// ── SMART CACHE ────────────────────────────────────────────────────────────
const cache = new Map();
function getCache(key) {
  const c = cache.get(key);
  if (!c) return null;
  if (Date.now() - c.ts > c.ttl) { cache.delete(key); return null; }
  return c.data;
}
function setCache(key, data, ttlMs) { cache.set(key, { data, ts: Date.now(), ttl: ttlMs }); }
const TTL = {
  FIXTURES: 3 * 60 * 60 * 1000,
  STANDINGS: 6 * 60 * 60 * 1000,
  LIVE: 60 * 1000,
  RESULTS: 30 * 60 * 1000,
  NBA: 5 * 60 * 1000,
  ESPN_SPORT: 2 * 60 * 1000,
  ODDS: 60 * 60 * 1000,
  STREAK: 60 * 60 * 1000,
};

// ── RETRY FETCH ────────────────────────────────────────────────────────────
async function fetchRetry(url, opts = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(12000) });
      if (r.status === 429) { await new Promise(res => setTimeout(res, 2000 * (i + 1))); continue; }
      return r;
    } catch(e) {
      if (i === retries - 1) throw e;
      await new Promise(res => setTimeout(res, 1000 * (i + 1)));
    }
  }
}

// ── LEAGUES CONFIG ─────────────────────────────────────────────────────────
const LEAGUES = {
  // 2025/26 season - all European leagues use season 2025
  PL:  { id:39,  name:"Premier League",      country:"England",     flag:"🏴󠁧󠁢󠁥󠁮󠁧󠁿", season:2025 },
  PD:  { id:140, name:"La Liga",             country:"Spain",       flag:"🇪🇸", season:2025 },
  BL1: { id:78,  name:"Bundesliga",          country:"Germany",     flag:"🇩🇪", season:2025 },
  SA:  { id:135, name:"Serie A",             country:"Italy",       flag:"🇮🇹", season:2025 },
  FL1: { id:61,  name:"Ligue 1",             country:"France",      flag:"🇫🇷", season:2025 },
  DED: { id:88,  name:"Eredivisie",          country:"Netherlands", flag:"🇳🇱", season:2025 },
  PPL: { id:94,  name:"Primeira Liga",       country:"Portugal",    flag:"🇵🇹", season:2025 },
  ELC: { id:40,  name:"Championship",        country:"England",     flag:"🏴󠁧󠁢󠁥󠁮󠁧󠁿", season:2025 },
  SPL: { id:179, name:"Scottish Prem",       country:"Scotland",    flag:"🏴󠁧󠁢󠁳󠁣󠁴󠁿", season:2025 },
  BEL: { id:144, name:"Belgian Pro League",  country:"Belgium",     flag:"🇧🇪", season:2025 },
  TUR: { id:203, name:"Super Lig",           country:"Turkey",      flag:"🇹🇷", season:2025 },
  GRE: { id:197, name:"Super League",        country:"Greece",      flag:"🇬🇷", season:2025 },
  SAU: { id:307, name:"Saudi Pro League",    country:"Saudi Arabia",flag:"🇸🇦", season:2025 },
  MLS: { id:253, name:"MLS",                 country:"USA",         flag:"🇺🇸", season:2025 },
  BSA: { id:71,  name:"Serie A",             country:"Brazil",      flag:"🇧🇷", season:2025 },
  ARG: { id:128, name:"Liga Profesional",    country:"Argentina",   flag:"🇦🇷", season:2025 },
  MEX: { id:262, name:"Liga MX",             country:"Mexico",      flag:"🇲🇽", season:2025 },
  CL:  { id:2,   name:"Champions League",    country:"Europe",      flag:"🏆", season:2025 },
  EL:  { id:3,   name:"Europa League",       country:"Europe",      flag:"🥈", season:2025 },
  WC:  { id:1,   name:"World Cup",           country:"World",       flag:"🌍", season:2026 },
};

const memPredictions = [], memSubs = [];
let predictionStreak = { current: 0, best: 0, lastResult: null };

// ── API-FOOTBALL CALL ──────────────────────────────────────────────────────
async function afGet(path) {
  const cached = getCache("af_" + path);
  if (cached !== null) return cached;
  try {
    const r = await fetchRetry(AFURL + path, { headers: AF_KEY });
    const d = await r.json();
    const result = d.response || [];
    if (result.length > 0) setCache("af_" + path, result, TTL.FIXTURES);
    return result;
  } catch(e) { console.error("AF error:", e.message); return []; }
}

function mapFixture(f, compId) {
  return {
    id: f.fixture?.id, compId,
    homeId: f.teams?.home?.id, awayId: f.teams?.away?.id,
    home: f.teams?.home?.name || "", away: f.teams?.away?.name || "",
    homeCrest: f.teams?.home?.logo || "", awayCrest: f.teams?.away?.logo || "",
    date: f.fixture?.date || "", round: f.league?.round || "",
    status: f.fixture?.status?.short || "", statusLong: f.fixture?.status?.long || "",
    elapsed: f.fixture?.status?.elapsed || null,
    homeScore: f.goals?.home ?? null, awayScore: f.goals?.away ?? null,
    venue: f.fixture?.venue?.name || "",
  };
}

// ── FIXTURES ───────────────────────────────────────────────────────────────
app.get("/fixtures/:compId", async (req, res) => {
  const id = req.params.compId.toUpperCase();
  const lg = LEAGUES[id];
  if (!lg) return res.status(400).json({ error: "Unknown league: " + id });
  const ckey = "fix_" + id;
  const cached = getCache(ckey);
  if (cached) return res.json(cached);
  try {
    const today = new Date().toISOString().split("T")[0];
    const future = new Date(Date.now() + 30*24*60*60*1000).toISOString().split("T")[0];
    const data = await afGet("/fixtures?league=" + lg.id + "&season=" + lg.season + "&from=" + today + "&to=" + future + "&status=NS-PST");
    const result = data.slice(0,15).map(f => mapFixture(f, id));
    setCache(ckey, result, TTL.FIXTURES);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── RESULTS ────────────────────────────────────────────────────────────────
app.get("/results/:compId", async (req, res) => {
  const id = req.params.compId.toUpperCase();
  const lg = LEAGUES[id];
  if (!lg) return res.status(400).json({ error: "Unknown league" });
  const ckey = "res_" + id;
  const cached = getCache(ckey);
  if (cached) return res.json(cached);
  try {
    const today = new Date().toISOString().split("T")[0];
    const past = new Date(Date.now() - 3*24*60*60*1000).toISOString().split("T")[0];
    const data = await afGet("/fixtures?league=" + lg.id + "&season=" + lg.season + "&from=" + past + "&to=" + today + "&status=FT-AET-PEN");
    const result = data.slice(0,10).map(f => mapFixture(f, id));
    setCache(ckey, result, TTL.RESULTS);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── LIVE ───────────────────────────────────────────────────────────────────
app.get("/live/:compId", async (req, res) => {
  const id = req.params.compId.toUpperCase();
  const lg = LEAGUES[id];
  if (!lg) return res.json([]);
  const ckey = "live_" + id;
  const cached = getCache(ckey);
  if (cached) return res.json(cached);
  try {
    const data = await afGet("/fixtures?live=" + lg.id);
    const result = data.map(f => mapFixture(f, id));
    setCache(ckey, result, TTL.LIVE);
    res.json(result);
  } catch(e) { res.json([]); }
});

// ── STANDINGS ──────────────────────────────────────────────────────────────
app.get("/standings/:compId", async (req, res) => {
  const id = req.params.compId.toUpperCase();
  const lg = LEAGUES[id];
  if (!lg) return res.status(400).json({ error: "Unknown league" });
  const ckey = "stand_" + id;
  const cached = getCache(ckey);
  if (cached) return res.json(cached);
  try {
    const data = await afGet("/standings?league=" + lg.id + "&season=" + lg.season);
    const table = (data[0]?.league?.standings?.[0] || []).map(e => ({
      position: e.rank, team: e.team?.name || "", crest: e.team?.logo || "", teamId: e.team?.id,
      played: e.all?.played || 0, won: e.all?.win || 0, draw: e.all?.draw || 0, lost: e.all?.lose || 0,
      gf: e.all?.goals?.for || 0, ga: e.all?.goals?.against || 0, gd: e.goalsDiff || 0,
      points: e.points || 0, form: e.form || ""
    }));
    setCache(ckey, table, TTL.STANDINGS);
    res.json(table);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SCORERS ────────────────────────────────────────────────────────────────
app.get("/scorers/:compId", async (req, res) => {
  const id = req.params.compId.toUpperCase();
  const lg = LEAGUES[id];
  if (!lg) return res.status(400).json({ error: "Unknown league" });
  const ckey = "scor_" + id;
  const cached = getCache(ckey);
  if (cached) return res.json(cached);
  try {
    const data = await afGet("/players/topscorers?league=" + lg.id + "&season=" + lg.season);
    const scorers = data.slice(0,10).map(s => ({
      name: s.player?.name || "", nationality: s.player?.nationality || "",
      team: s.statistics?.[0]?.team?.name || "", crest: s.statistics?.[0]?.team?.logo || "",
      goals: s.statistics?.[0]?.goals?.total || 0, assists: s.statistics?.[0]?.goals?.assists || 0,
      penalties: s.statistics?.[0]?.penalty?.scored || 0
    }));
    setCache(ckey, scorers, TTL.STANDINGS);
    res.json(scorers);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ODDS ───────────────────────────────────────────────────────────────────
app.get("/odds/:fixtureId", async (req, res) => {
  const fid = req.params.fixtureId;
  const ckey = "odds_" + fid;
  const cached = getCache(ckey);
  if (cached) return res.json(cached);
  try {
    const data = await afGet("/odds?fixture=" + fid + "&bet=1");
    const bookie = data[0]?.bookmakers?.[0];
    if (!bookie) return res.json(null);
    const values = bookie.bets?.[0]?.values || [];
    const home = parseFloat(values.find(v => v.value === "Home")?.odd || 0);
    const draw = parseFloat(values.find(v => v.value === "Draw")?.odd || 0);
    const away = parseFloat(values.find(v => v.value === "Away")?.odd || 0);
    const result = { home, draw, away, bookmaker: bookie.name };
    setCache(ckey, result, TTL.ODDS);
    res.json(result);
  } catch(e) { res.json(null); }
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
    const r = await fetchRetry("https://api.balldontlie.io/nba/v2/games?" + params + "&per_page=50", { headers: BDL_KEY });
    const d = await r.json();
    const games = d.data || [];
    setCache("nba_games", games, TTL.NBA);
    res.json(games);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/nba/live", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const r = await fetchRetry("https://api.balldontlie.io/nba/v2/games?dates[]=" + today + "&per_page=15", { headers: BDL_KEY });
    const d = await r.json();
    res.json(d.data || []);
  } catch(e) { res.json([]); }
});

app.get("/nba/standings", async (req, res) => {
  const cached = getCache("nba_standings");
  if (cached) return res.json(cached);
  try {
    const r = await fetchRetry("https://api.balldontlie.io/nba/v2/standings?season=2025", { headers: BDL_KEY });
    const d = await r.json();
    setCache("nba_standings", d.data || [], TTL.STANDINGS);
    res.json(d.data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/nba/teams", async (req, res) => {
  const cached = getCache("nba_teams");
  if (cached) return res.json(cached);
  try {
    const r = await fetchRetry("https://api.balldontlie.io/nba/v2/teams?per_page=30", { headers: BDL_KEY });
    const d = await r.json();
    setCache("nba_teams", d.data || [], 24*60*60*1000);
    res.json(d.data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ESPN SPORTS (free, no key needed) ─────────────────────────────────────
function mapEspn(e) {
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

async function espnGames(sport, league) {
  const key = "espn_" + sport + "_" + league;
  const cached = getCache(key);
  if (cached) return cached;
  try {
    const r = await fetchRetry(ESPN + "/" + sport + "/" + league + "/scoreboard");
    const d = await r.json();
    const games = (d.events || []).map(mapEspn);
    setCache(key, games, TTL.ESPN_SPORT);
    return games;
  } catch { return []; }
}

app.get("/nfl/games", async (req, res) => { res.json(await espnGames("football", "nfl")); });
app.get("/nhl/games", async (req, res) => { res.json(await espnGames("hockey", "nhl")); });
app.get("/rugby/games", async (req, res) => { res.json(await espnGames("rugby", "scoreboard")); });

app.get("/tennis/scores", async (req, res) => {
  try {
    const r = await fetchRetry(ESPN + "/tennis/scoreboard");
    const d = await r.json();
    res.json((d.events || []).slice(0,20).map(e => {
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
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Basketball leagues via ESPN
app.get("/basketball/wnba", async (req, res) => { res.json(await espnGames("basketball", "wnba")); });
app.get("/basketball/ncaam", async (req, res) => { res.json(await espnGames("basketball", "mens-college-basketball")); });
app.get("/basketball/ncaaw", async (req, res) => { res.json(await espnGames("basketball", "womens-college-basketball")); });
app.get("/basketball/euroleague", async (req, res) => {
  const cached = getCache("euroleague");
  if (cached) return res.json(cached);
  try {
    const r = await fetchRetry("https://site.web.api.espn.com/apis/v2/sports/basketball/euroleague/scoreboard");
    const d = await r.json();
    const games = (d.events || []).map(mapEspn);
    setCache("euroleague", games, TTL.ESPN_SPORT);
    res.json(games);
  } catch { res.json([]); }
});

// ── CURRENCY ───────────────────────────────────────────────────────────────
app.get("/currency", async (req, res) => {
  try {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
    if (!ip || ip === "127.0.0.1" || ip === "::1") return res.json({ currency:"USD", symbol:"$", country:"US" });
    const r = await fetchRetry("http://ip-api.com/json/" + ip + "?fields=country,countryCode,currency");
    const d = await r.json();
    const sym = { USD:"$",GBP:"£",EUR:"€",CAD:"C$",AUD:"A$",NGN:"₦",BRL:"R$",JPY:"¥",INR:"₹",KRW:"₩",MXN:"$",ZAR:"R",CHF:"Fr",TRY:"₺",GHS:"₵",KES:"KSh" };
    res.json({ currency: d.currency||"USD", symbol: sym[d.currency]||(d.currency||"USD"), country: d.countryCode||"US" });
  } catch { res.json({ currency:"USD", symbol:"$", country:"US" }); }
});

// ── DASHBOARD ──────────────────────────────────────────────────────────────
app.get("/dashboard", async (req, res) => {
  const cached = getCache("dashboard");
  if (cached) return res.json(cached);
  try {
    const today = new Date().toISOString().split("T")[0];
    const future = new Date(Date.now() + 3*24*60*60*1000).toISOString().split("T")[0];
    const football = await Promise.all(["PL","PD","BL1","SA","FL1"].map(async id => {
      try {
        const lg = LEAGUES[id];
        const data = await afGet("/fixtures?league=" + lg.id + "&season=" + lg.season + "&from=" + today + "&to=" + future + "&status=NS-PST");
        return { compId:id, compName:lg.name, flag:lg.flag, matches: data.slice(0,4).map(f => ({ id:f.fixture?.id, home:f.teams?.home?.name, away:f.teams?.away?.name, homeCrest:f.teams?.home?.logo, awayCrest:f.teams?.away?.logo, date:f.fixture?.date })) };
      } catch { return { compId:id, compName:LEAGUES[id].name, flag:LEAGUES[id].flag, matches:[] }; }
    }));
    const nbaR = await fetchRetry("https://api.balldontlie.io/nba/v2/games?dates[]=" + today + "&per_page=8", { headers: BDL_KEY });
    const nbaD = await nbaR.json();
    // Streak data
    const streak = getStreakData();
    const result = { football, nba: nbaD.data||[], streak };
    setCache("dashboard", result, 60*60*1000);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── STREAK TRACKER ─────────────────────────────────────────────────────────
function getStreakData() {
  const resolved = memPredictions.filter(p => p.status !== "pending");
  if (!resolved.length) return { current:0, best:0, total:0, won:0, accuracy:null };
  let current = 0, best = 0;
  for (let i = resolved.length - 1; i >= 0; i--) {
    if (resolved[i].status === "won") { current++; best = Math.max(best, current); }
    else break;
  }
  const won = resolved.filter(p => p.status === "won").length;
  return { current, best, total: resolved.length, won, accuracy: Math.round(won/resolved.length*100) };
}

app.get("/streak", async (req, res) => {
  if (SUPABASE_ENABLED) {
    try {
      const { data } = await supabase.from("predictions").select("status,created_at").order("created_at", { ascending:false }).limit(100);
      const resolved = (data||[]).filter(p => p.status !== "pending");
      let current = 0, best = 0;
      for (const p of resolved) {
        if (p.status === "won") { current++; best = Math.max(best, current); }
        else break;
      }
      const won = resolved.filter(p => p.status === "won").length;
      return res.json({ current, best, total:resolved.length, won, accuracy: resolved.length ? Math.round(won/resolved.length*100) : null });
    } catch(e) { return res.json(getStreakData()); }
  }
  res.json(getStreakData());
});

// ── SEO LEAGUE PAGES ───────────────────────────────────────────────────────
app.get("/seo/:compId", async (req, res) => {
  const id = req.params.compId.toUpperCase();
  const lg = LEAGUES[id];
  if (!lg) return res.status(404).json({ error: "Not found" });
  const ckey = "seo_" + id;
  const cached = getCache(ckey);
  if (cached) return res.json(cached);
  try {
    const today = new Date().toISOString().split("T")[0];
    const future = new Date(Date.now() + 7*24*60*60*1000).toISOString().split("T")[0];
    const [fixtures, standings] = await Promise.all([
      afGet("/fixtures?league=" + lg.id + "&season=" + lg.season + "&from=" + today + "&to=" + future + "&status=NS-PST"),
      afGet("/standings?league=" + lg.id + "&season=" + lg.season)
    ]);
    const result = {
      league: lg, fixtures: fixtures.slice(0,5).map(f => mapFixture(f, id)),
      standings: (standings[0]?.league?.standings?.[0] || []).slice(0,5).map(e => ({ position:e.rank, team:e.team?.name, crest:e.team?.logo, points:e.points, won:e.all?.win, draw:e.all?.draw, lost:e.all?.lose })),
      title: lg.name + " Predictions & Tips — ScoutAI",
      description: "AI-powered " + lg.name + " match predictions, fixtures, standings and betting tips. Updated daily by ScoutAI.",
      canonical: "https://scoutaibot.com/" + id.toLowerCase() + "-predictions"
    };
    setCache(ckey, result, TTL.STANDINGS);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── AI HELPERS ─────────────────────────────────────────────────────────────
async function callClaude(sys, msg, maxTokens, model) {
  const m = model || "claude-sonnet-4-6";
  const r = await fetchRetry("https://api.anthropic.com/v1/messages", {
    method:"POST",
    headers:{"Content-Type":"application/json","x-api-key":process.env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},
    body:JSON.stringify({ model:m, max_tokens:maxTokens||1200, system:sys, messages:[{role:"user",content:msg}] })
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  const text = (d.content||[]).map(c=>c.text||"").join("");
  return JSON.parse(text.replace(/```json|```/g,"").trim());
}

async function callClaudeText(sys, msg, maxTokens, model) {
  const m = model || "claude-opus-4-5";
  const r = await fetchRetry("https://api.anthropic.com/v1/messages", {
    method:"POST",
    headers:{"Content-Type":"application/json","x-api-key":process.env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},
    body:JSON.stringify({ model:m, max_tokens:maxTokens||2000, system:sys, messages:[{role:"user",content:msg}] })
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return (d.content||[]).map(c=>c.text||"").join("");
}

async function predictFootball(home, away, compId) {
  const lg = compId ? LEAGUES[compId] : null;
  const sys = "Expert football analyst. Analyze the teams and predict the match outcome. Respond ONLY with valid JSON: " +
    '{"result":"Home Win or Draw or Away Win","result_confidence":75,"over25":true,"over25_confidence":65,' +
    '"btts":true,"btts_confidence":60,"score":"2-1","reasoning":"2-3 sentences of analysis"}';
  const msg = "Predict: " + home + " (HOME) vs " + away + " (AWAY)" + (lg ? " in the " + lg.name : "");
  const result = await callClaude(sys, msg, 600);
  result.dataSource = "ai";
  return result;
}

async function predictSport(home, away, sport, league) {
  const sysMap = {
    basketball: "Expert NBA analyst. Respond ONLY with valid JSON: " + '{"result":"Home Win or Away Win","result_confidence":70,"over_under":"Over or Under","line":220,"over_under_confidence":65,"score":"112-108","reasoning":"2-3 sentences"}',
    nfl: "Expert NFL analyst. Respond ONLY with valid JSON: " + '{"result":"Home Win or Away Win","result_confidence":70,"score":"24-17","key_factors":["factor1","factor2","factor3"],"reasoning":"2-3 sentences"}',
    nhl: "Expert NHL analyst. Respond ONLY with valid JSON: " + '{"result":"Home Win or Away Win","result_confidence":70,"score":"3-2","key_factors":["factor1","factor2","factor3"],"reasoning":"2-3 sentences"}',
    tennis: "Expert tennis analyst. Respond ONLY with valid JSON: " + '{"result":"Player 1 Win or Player 2 Win","result_confidence":70,"score":"6-4 6-3","key_factors":["factor1","factor2","factor3"],"reasoning":"2-3 sentences"}',
    rugby: "Expert rugby analyst. Respond ONLY with valid JSON: " + '{"result":"Home Win or Away Win or Draw","result_confidence":70,"score":"24-18","key_factors":["factor1","factor2","factor3"],"reasoning":"2-3 sentences"}',
    wnba: "Expert WNBA analyst. Respond ONLY with valid JSON: " + '{"result":"Home Win or Away Win","result_confidence":70,"score":"85-78","key_factors":["factor1","factor2","factor3"],"reasoning":"2-3 sentences"}',
    euroleague: "Expert EuroLeague basketball analyst. Respond ONLY with valid JSON: " + '{"result":"Home Win or Away Win","result_confidence":70,"score":"85-78","key_factors":["factor1","factor2","factor3"],"reasoning":"2-3 sentences"}',
  };
  const sys = sysMap[sport] || sysMap.basketball;
  return await callClaude(sys, "Predict: " + home + " vs " + away + (league ? " (" + league + ")" : ""), 600);
}

app.post("/predict", async (req, res) => {
  const { home, away, homeId, awayId, compId, sport } = req.body;
  if (!home || !away) return res.status(400).json({ error:"Teams required" });
  try {
    const s = sport || "football";
    const result = s === "football" ? await predictFootball(home, away, compId) : await predictSport(home, away, s, compId);
    res.json(result);
  } catch(e) { res.status(500).json({ error:"Prediction failed: " + e.message }); }
});

app.post("/predict/sport", async (req, res) => {
  const { home, away, sport, league } = req.body;
  if (!home || !away) return res.status(400).json({ error:"Teams required" });
  try { res.json(await predictSport(home, away, sport||"nfl", league)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PREDICTIONS STORE ──────────────────────────────────────────────────────
app.post("/predictions/store", async (req, res) => {
  const { key, home, away, compId, matchId, result, score, confidence, date, sport } = req.body;
  if (!key||!home||!away) return res.status(400).json({ error:"Missing fields" });
  try {
    if (SUPABASE_ENABLED) {
      await supabase.from("predictions").upsert({ key, home, away, comp_id:compId, match_id:matchId||null, result, score, confidence, date, sport:sport||"football", status:"pending" }, { onConflict:"key", ignoreDuplicates:true });
    } else {
      if (!memPredictions.find(p => p.key===key)) memPredictions.push({ key, home, away, result, score, confidence, date, sport:sport||"football", status:"pending", created_at:new Date().toISOString() });
    }
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── PERFORMANCE ────────────────────────────────────────────────────────────
app.get("/performance", async (req, res) => {
  try {
    if (SUPABASE_ENABLED) {
      const { data:all } = await supabase.from("predictions").select("*").order("created_at",{ascending:false});
      const preds = all || [];
      const resolved = preds.filter(p => p.status !== "pending");
      const won = resolved.filter(p => p.status === "won");
      const byLeague = {};
      const bySport = {};
      resolved.forEach(p => {
        const lg = p.comp_id||"unknown";
        if (!byLeague[lg]) byLeague[lg] = { won:0, total:0 };
        byLeague[lg].total++;
        if (p.status==="won") byLeague[lg].won++;
        const sp = p.sport||"football";
        if (!bySport[sp]) bySport[sp] = { won:0, total:0 };
        bySport[sp].total++;
        if (p.status==="won") bySport[sp].won++;
      });
      // Only use parlay picks for performance (AI-selected, not user clicks)
      const parlayPreds = preds.filter(p => p.parlay_type);
      const parlayResolved = parlayPreds.filter(p => p.status !== "pending");
      const parlayWon = parlayResolved.filter(p => p.status === "won");

      // Breakdown by parlay type
      const byParlayType = { safe:{won:0,total:0}, value:{won:0,total:0}, risk:{won:0,total:0} };
      parlayResolved.forEach(p => {
        const t = p.parlay_type || "value";
        if (!byParlayType[t]) byParlayType[t] = {won:0,total:0};
        byParlayType[t].total++;
        if (p.status==="won") byParlayType[t].won++;
      });

      // By league (parlay picks only)
      const byLeagueParlays = {};
      parlayResolved.forEach(p => {
        const lg = p.comp_id||"unknown";
        if (!byLeagueParlays[lg]) byLeagueParlays[lg] = { won:0, total:0 };
        byLeagueParlays[lg].total++;
        if (p.status==="won") byLeagueParlays[lg].won++;
      });

      res.json({
        total: parlayPreds.length,
        resolved: parlayResolved.length,
        won: parlayWon.length,
        lost: parlayResolved.length - parlayWon.length,
        accuracyAll: parlayResolved.length ? Math.round(parlayWon.length/parlayResolved.length*100) : null,
        byParlayType: Object.entries(byParlayType).map(([type,s])=>({ type, won:s.won, total:s.total, accuracy:s.total?Math.round(s.won/s.total*100):null })),
        byLeague: Object.entries(byLeagueParlays).map(([id,s])=>({ id, name:LEAGUES[id]?.name||id, won:s.won, total:s.total, accuracy:Math.round(s.won/s.total*100) })).sort((a,b)=>b.total-a.total),
        bySport: [{ sport:"football", won:parlayWon.length, total:parlayResolved.length, accuracy:parlayResolved.length?Math.round(parlayWon.length/parlayResolved.length*100):null }],
        recentResults: parlayPreds.filter(p=>p.status!=="pending").slice(0,30).map(p=>({
          home:p.home, away:p.away, predicted:p.result, actual:p.actual_result,
          predictedScore:p.score, actualScore:p.actual_score,
          status:p.status, confidence:p.confidence, date:p.date,
          sport:p.sport, compId:p.comp_id, parlayType:p.parlay_type
        })),
        streak: getStreakData()
      });
    } else {
      const resolved = memPredictions.filter(p=>p.status!=="pending");
      const won = resolved.filter(p=>p.status==="won");
      res.json({ total:memPredictions.length, resolved:resolved.length, won:won.length, lost:resolved.length-won.length, accuracyAll:resolved.length?Math.round(won.length/resolved.length*100):null, byLeague:[], bySport:[], recentResults:resolved.slice(-20).reverse(), streak:getStreakData() });
    }
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── PREDICTION OF DAY ──────────────────────────────────────────────────────
app.get("/prediction-of-day", async (req, res) => {
  const cached = getCache("potd");
  if (cached) return res.json(cached);
  try {
    const today = new Date().toISOString().split("T")[0];
    const future = new Date(Date.now()+3*24*60*60*1000).toISOString().split("T")[0];
    const fixtures = [];
    for (const id of ["PL","PD","BL1","SA","FL1"]) {
      try {
        const lg = LEAGUES[id];
        const data = await afGet("/fixtures?league=" + lg.id + "&season=" + lg.season + "&from=" + today + "&to=" + future + "&status=NS-PST");
        if (data.length) fixtures.push({ compId:id, compName:lg.name, homeId:data[0].teams?.home?.id, awayId:data[0].teams?.away?.id, home:data[0].teams?.home?.name, away:data[0].teams?.away?.name, homeCrest:data[0].teams?.home?.logo, awayCrest:data[0].teams?.away?.logo, date:data[0].fixture?.date });
      } catch {}
    }
    if (!fixtures.length) return res.json(null);
    const preds = await Promise.all(fixtures.map(async f => {
      try { return { ...f, prediction: await predictFootball(f.home, f.away, f.compId) }; }
      catch { return null; }
    }));
    const valid = preds.filter(Boolean).sort((a,b)=>b.prediction.result_confidence-a.prediction.result_confidence);
    const potd = valid[0]||null;
    setCache("potd", potd, 6*60*60*1000);
    res.json(potd);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── PARLAYS ────────────────────────────────────────────────────────────────
async function storeParlayPick(pick, parlayType, fixtureId) {
  if (!SUPABASE_ENABLED) return;
  try {
    const key = "parlay_" + parlayType + "_" + pick.home.replace(/\s+/g,"_") + "_" + pick.away.replace(/\s+/g,"_") + "_" + new Date().toISOString().split("T")[0];
    const existing = await supabase.from("predictions").select("key").eq("key",key).single();
    if (existing.data) return; // already stored today
    await supabase.from("predictions").insert({
      key,
      home: pick.home,
      away: pick.away,
      comp_id: pick.compId || null,
      match_id: fixtureId || null,
      result: pick.result,
      score: pick.score || null,
      confidence: pick.confidence,
      sport: "football",
      status: "pending",
      date: pick.date || new Date().toISOString(),
      parlay_type: parlayType,
      created_at: new Date().toISOString()
    });
  } catch(e) { console.error("storeParlayPick error:", e.message); }
}

app.get("/parlays", async (req, res) => {
  const cached = getCache("parlays");
  if (cached) return res.json(cached);
  try {
    const today = new Date().toISOString().split("T")[0];
    const allFx = [];
    for (const id of ["PL","PD","BL1","SA","FL1","DED","PPL","CL","EL"]) {
      try {
        const lg = LEAGUES[id];
        // TODAY only - no future dates
        const data = await afGet("/fixtures?league=" + lg.id + "&season=" + lg.season + "&date=" + today + "&status=NS-PST");
        data.slice(0,3).forEach(f => allFx.push({
          compId: id,
          compName: lg.name,
          flag: lg.flag,
          home: f.teams?.home?.name,
          away: f.teams?.away?.name,
          homeCrest: f.teams?.home?.logo,
          awayCrest: f.teams?.away?.logo,
          date: f.fixture?.date,
          fixtureId: f.fixture?.id
        }));
      } catch {}
    }
    if (allFx.length < 3) return res.json({ safe:null, medium:null, highRisk:null, error:"Not enough fixtures today", generatedAt:new Date().toISOString() });

    const preds = await Promise.all(allFx.slice(0,10).map(async f => {
      try { return { ...f, prediction: await predictFootball(f.home, f.away, f.compId) }; }
      catch { return null; }
    }));

    const valid = preds.filter(p=>p&&p.prediction&&!p.prediction.error)
      .sort((a,b)=>b.prediction.result_confidence-a.prediction.result_confidence);

    const buildSlip = (picks, label, emoji, parlayType) => {
      if (!picks.length) return null;
      const mappedPicks = picks.map(p=>({
        home: p.home, away: p.away, flag: p.flag, compName: p.compName,
        compId: p.compId, homeCrest: p.homeCrest, awayCrest: p.awayCrest,
        date: p.date, fixtureId: p.fixtureId,
        result: p.prediction.result, confidence: p.prediction.result_confidence,
        score: p.prediction.score, odds: parseFloat((100/p.prediction.result_confidence).toFixed(2))
      }));
      const totalOdds = mappedPicks.reduce((acc,p)=>acc*p.odds,1).toFixed(2);
      const combinedConf = Math.round(mappedPicks.reduce((a,p)=>a*(p.confidence/100),1)*100);
      // Store each pick for performance tracking
      mappedPicks.forEach(pick => storeParlayPick(pick, parlayType, pick.fixtureId));
      return { label, emoji, riskColor: parlayType==="safe"?"#16a34a":parlayType==="value"?"#d97706":"#dc2626", picks:mappedPicks, totalOdds, combinedConf };
    };

    const safePicks = valid.filter(p=>p.prediction.result_confidence>=70).slice(0,3);
    const valuePicks = valid.filter(p=>p.prediction.result_confidence>=60).slice(0,5);
    const riskPicks = valid.slice(0,7);

    const result = {
      safe: buildSlip(safePicks, "Safe Parlay", "🔒", "safe"),
      medium: buildSlip(valuePicks, "Value Parlay", "🎯", "value"),
      highRisk: buildSlip(riskPicks, "High Risk Parlay", "💣", "risk"),
      generatedAt: new Date().toISOString()
    };
    setCache("parlays", result, 3*60*60*1000);
    res.json(result);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── BLOG ───────────────────────────────────────────────────────────────────
app.post("/blog/generate", async (req, res) => {
  const { home, away, compName, date, prediction } = req.body;
  if (!home||!away) return res.status(400).json({ error:"Missing match data" });
  if (!SUPABASE_ENABLED) return res.json({ success:false });
  const slug = home.toLowerCase().replace(/[^a-z0-9]+/g,"-") + "-vs-" + away.toLowerCase().replace(/[^a-z0-9]+/g,"-") + "-" + new Date(date||Date.now()).toISOString().split("T")[0];
  try {
    const existing = await supabase.from("blog_posts").select("slug").eq("slug",slug).single();
    if (existing.data) return res.json({ success:true, slug, existing:true });
    const predText = (prediction?.result||"Home Win") + " with " + (prediction?.result_confidence||70) + "% confidence" + (prediction?.score ? ", score " + prediction.score : "");
    const sys = "You are an expert football journalist writing SEO match preview articles. Write 350-400 words. Plain paragraphs only. No markdown, no headers, no bullet points.";
    const content = await callClaude(sys, "Write a match prediction article for: " + home + " vs " + away + " (" + (compName||"Football") + "). AI prediction: " + predText + ". Include team analysis, key players, and end with a call to visit scoutaibot.com for more predictions.", 800);
    await supabase.from("blog_posts").insert({ slug, title:home + " vs " + away + " Prediction — " + (compName||"Football"), content:typeof content==="string"?content:JSON.stringify(content), home, away, match_date:date, published:true, likes:0 });
    res.json({ success:true, slug });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get("/blog", async (req, res) => {
  if (!SUPABASE_ENABLED) return res.json([]);
  try {
    const { data } = await supabase.from("blog_posts")
      .select("slug,title,home,away,match_date,created_at,likes")
      .order("created_at",{ascending:false})
      .limit(50);
    res.json(data||[]);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get("/blog/:slug", async (req, res) => {
  if (!SUPABASE_ENABLED) return res.status(404).json({ error:"Not found" });
  try {
    const { data } = await supabase.from("blog_posts").select("*").eq("slug",req.params.slug).single();
    if (!data) return res.status(404).json({ error:"Not found" });
    res.json(data);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post("/blog/:slug/like", async (req, res) => {
  if (!SUPABASE_ENABLED) return res.json({ likes:0 });
  try {
    const { data:post } = await supabase.from("blog_posts").select("likes").eq("slug",req.params.slug).single();
    const newLikes = (post?.likes||0)+1;
    await supabase.from("blog_posts").update({ likes:newLikes }).eq("slug",req.params.slug);
    res.json({ likes:newLikes });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get("/blog/:slug/comments", async (req, res) => {
  if (!SUPABASE_ENABLED) return res.json([]);
  try {
    const { data } = await supabase.from("blog_comments").select("*").eq("slug",req.params.slug).order("created_at",{ascending:false}).limit(50);
    res.json(data||[]);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post("/blog/:slug/comment", async (req, res) => {
  const { name, comment } = req.body;
  if (!name||!comment) return res.status(400).json({ error:"Name and comment required" });
  if (!SUPABASE_ENABLED) return res.status(503).json({ error:"Requires database" });
  try {
    const { data, error } = await supabase.from("blog_comments").insert({ slug:req.params.slug, name:name.substring(0,50), comment:comment.substring(0,500) }).select().single();
    if (error) throw error;
    res.json({ success:true, comment:data });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── AUTO BLOG GENERATION ───────────────────────────────────────────────────
async function generateBlogArticle(home, away, lgName, lgId, fixtureId, pred, form) {
  const predText = pred.result + " with " + pred.result_confidence + "% confidence" + (pred.score ? ", predicted score " + pred.score : "");
  const homeForm = form?.homeForm || "Unknown";
  const awayForm = form?.awayForm || "Unknown";

  const sys = `You are an expert football journalist and SEO writer for ScoutAI (scoutaibot.com), an AI-powered football prediction platform.
Write a detailed, human-sounding match preview article. It must be 650-800 words.
Structure it with these exact HTML-friendly markdown headings:
## Match Overview
## Team Form & Recent Results  
## Head-to-Head Analysis
## AI Prediction & Betting Insight
## Final Verdict

Rules:
- Sound like a real sports journalist, not generic AI
- Include specific details about the teams, league position context
- Reference the AI prediction naturally in the article
- End with a call to visit scoutaibot.com for more predictions
- No placeholder text, no [brackets], no made-up statistics
- SEO optimized — use team names and league name naturally throughout
- Do NOT use JSON, return plain text article only`;

  const msg = `Write a match preview for: ${home} vs ${away} (${lgName})
AI Prediction: ${predText}
${home} recent form: ${homeForm}
${away} recent form: ${awayForm}
This is for the ${lgName} competition. Make it engaging and informative for football betting enthusiasts.`;

  return await callClaudeText(sys, msg, 1500, "claude-sonnet-4-6");
}

async function autoBlog() {
  if (!SUPABASE_ENABLED) return;
  console.log("Auto blog: starting...");
  let count = 0;
  // Blog runs at midnight CET — write previews for today and tomorrow's matches only
  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now()+1*24*60*60*1000).toISOString().split("T")[0];

  // Top European leagues + cups for blog
  const blogLeagues = ["PL","PD","BL1","SA","FL1","CL","EL","UECL","FAC","CDR","DFB","CPI"];

  for (const id of blogLeagues) {
    if (count >= 8) break;
    try {
      const lg = LEAGUES[id];
      if (!lg) continue;
      const data = await afGet("/fixtures?league=" + lg.id + "&season=" + lg.season + "&from=" + today + "&to=" + tomorrow + "&status=NS-PST");
      if (!data || !data.length) continue;

      for (const f of data.slice(0,2)) {
        if (count >= 8) break;
        const home = f.teams?.home?.name;
        const away = f.teams?.away?.name;
        if (!home || !away) continue;

        const slug = home.toLowerCase().replace(/[^a-z0-9]+/g,"-") + "-vs-" + away.toLowerCase().replace(/[^a-z0-9]+/g,"-") + "-" + today;
        const existing = await supabase.from("blog_posts").select("slug").eq("slug",slug).single();
        if (existing.data) continue;

        try {
          const fixtureId = f.fixture?.id;
          const matchDate = f.fixture?.date ? new Date(f.fixture.date).toDateString() : "upcoming";

          const sys = `You are an expert football journalist writing for ScoutAI (scoutaibot.com).
Write a match preview article of 600-700 words. Use these exact headings:
## Match Overview
## Team Form & Recent Results
## Head-to-Head Analysis
## Key Players to Watch
## ScoutAI Prediction & Betting Insight

Rules:
- Sound like a real sports journalist, specific and engaging
- Reference ScoutAI naturally as the AI prediction platform
- End with a call to visit scoutaibot.com for the full AI prediction
- No placeholders, no [brackets]
- Plain text with markdown headings only`;

          const msg = `Write a match preview for: ${home} vs ${away}
Competition: ${lg.name}
Match date: ${matchDate}
Write an engaging preview that football fans and bettors will find useful.`;

          const content = await callClaudeText(sys, msg, 1400, "claude-sonnet-4-6");

          const title = home + " vs " + away + " Prediction & Preview — " + lg.name;
          const metaDesc = "Match preview and AI prediction for " + home + " vs " + away + " in " + lg.name + ". Full analysis and betting insights on ScoutAI.";

          await supabase.from("blog_posts").insert({
            slug, title, content, home, away,
            match_date: f.fixture?.date || new Date().toISOString(),
            likes: 0
          });

          count++;
          console.log("Blog generated: " + home + " vs " + away);
          await new Promise(r => setTimeout(r, 2000));
        } catch(e) { console.error("Blog gen error:", home + " vs " + away, e.message); }
      }
    } catch(e) { console.error("Blog league error:", id, e.message); }
  }
  console.log("Auto blog done: " + count + " posts");
}

// ── CONTACT ────────────────────────────────────────────────────────────────
app.post("/contact", async (req, res) => {
  const { name, email, company, message, type } = req.body;
  if (!name||!email||!message) return res.status(400).json({ error:"Required fields missing" });
  try {
    await resend.emails.send({ from:"ScoutAI <onboarding@resend.dev>", to:process.env.OWNER_EMAIL||"owner@example.com", subject:"New Enquiry from "+name, html:"<h2>ScoutAI Enquiry</h2><p><b>Name:</b> "+name+"</p><p><b>Email:</b> "+email+"</p><p><b>Company:</b> "+(company||"N/A")+"</p><p><b>Type:</b> "+(type||"")+"</p><p><b>Message:</b> "+message+"</p>" });
  } catch(e) { console.error("Email:", e.message); }
  res.json({ success:true, message:"Message received! We will reply within 24 hours." });
});

// ── NEWSLETTER ─────────────────────────────────────────────────────────────
app.post("/subscribe", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error:"Email required" });
  try {
    if (SUPABASE_ENABLED) await supabase.from("subscribers").upsert({ email },{ onConflict:"email", ignoreDuplicates:true });
    else if (!memSubs.find(s=>s.email===email)) memSubs.push({ email });
    res.json({ success:true, message:"Subscribed! Daily predictions coming your way." });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── ACCURACY ───────────────────────────────────────────────────────────────
app.get("/accuracy", (req, res) => {
  const resolved = memPredictions.filter(p=>p.status!=="pending");
  const won = resolved.filter(p=>p.status==="won").length;
  res.json({ total:memPredictions.length, correct:won, accuracy:resolved.length?Math.round(won/resolved.length*100):null });
});

// ── CRON ───────────────────────────────────────────────────────────────────

// ── PREDICTION RESOLVER ────────────────────────────────────────────────────
async function resolvePredictions() {
  try {
    let pending = [];
    if (SUPABASE_ENABLED) {
      const { data } = await supabase.from("predictions").select("*").eq("status","pending");
      pending = data || [];
    } else {
      pending = memPredictions.filter(p => p.status === "pending");
    }
    if (!pending.length) { console.log("No pending predictions to resolve"); return 0; }

    console.log(`Resolving ${pending.length} pending predictions...`);
    let resolved = 0;

    for (const pred of pending) {
      try {
        // Need a fixture id - extract from key (format: compId_index or compId_fixtureId)
        const compId = pred.comp_id;
        if (!compId) continue;

        // Fetch recent results for this competition
        const results = await afGet("/fixtures?league=" + compId + "&season=2025&last=20&status=FT");
        if (!results || !results.length) continue;

        // Find matching fixture by team names
        const match = results.find(f => {
          const h = f.teams?.home?.name?.toLowerCase() || "";
          const a = f.teams?.away?.name?.toLowerCase() || "";
          const ph = pred.home?.toLowerCase() || "";
          const pa = pred.away?.toLowerCase() || "";
          return (h.includes(ph.substring(0,6)) || ph.includes(h.substring(0,6))) &&
                 (a.includes(pa.substring(0,6)) || pa.includes(a.substring(0,6)));
        });

        if (!match) continue;

        const homeGoals = match.goals?.home;
        const awayGoals = match.goals?.away;
        if (homeGoals === null || homeGoals === undefined) continue;

        // Determine actual result
        let actualResult;
        if (homeGoals > awayGoals) actualResult = "Home Win";
        else if (awayGoals > homeGoals) actualResult = "Away Win";
        else actualResult = "Draw";

        const status = actualResult === pred.result ? "won" : "lost";

        if (SUPABASE_ENABLED) {
          await supabase.from("predictions").update({
            status,
            actual_result: actualResult,
            actual_score: `${homeGoals}-${awayGoals}`
          }).eq("key", pred.key);
        } else {
          const mp = memPredictions.find(p => p.key === pred.key);
          if (mp) { mp.status = status; mp.actual_result = actualResult; }
        }
        resolved++;
        console.log(`Resolved: ${pred.home} vs ${pred.away} — predicted ${pred.result}, actual ${actualResult} → ${status}`);
      } catch(e) { console.error("Error resolving prediction:", pred.key, e.message); }
    }
    console.log(`Resolution complete: ${resolved}/${pending.length} resolved`);
    return resolved;
  } catch(e) { console.error("resolvePredictions error:", e.message); return 0; }
}

app.get("/cron/daily", async (req, res) => {
  const secret = req.headers["x-cron-secret"]||req.query.secret;
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) return res.status(401).json({ error:"Unauthorized" });
  // Respond immediately — run tasks in background to avoid timeout
  res.json({ success:true, timestamp:new Date().toISOString(), message:"Tasks running in background..." });
  try { await autoBlog(); } catch(e) { console.error("Cron blog error:", e.message); }
  try { await resolvePredictions(); } catch(e) { console.error("Cron resolve error:", e.message); }
  console.log("Cron daily complete:", new Date().toISOString());
});

app.get("/ping", (req, res) => res.json({ ok:true, ts:Date.now() }));

// ── STARTUP & SCHEDULED TASKS ──────────────────────────────────────────────
// Keep alive ping
setInterval(async () => { try { await fetch("https://scoutai-server.onrender.com/ping"); } catch {} }, 5*60*1000);

// Resolve predictions on startup after 30 seconds
setTimeout(async () => { try { await resolvePredictions(); } catch(e) {} }, 30000);

// Check every hour for scheduled tasks
// Midnight CET (UTC+1 winter / UTC+2 summer) = 23:00 UTC winter / 22:00 UTC summer
// We check for both to handle daylight saving
let lastBlogDate = null;
let lastResolveDate = null;
setInterval(async () => {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const today = now.toISOString().split("T")[0];

  // Midnight CET = 23:00 UTC (winter) or 22:00 UTC (summer) — run blog generation
  if ((utcHour === 23 || utcHour === 22) && lastBlogDate !== today) {
    lastBlogDate = today;
    console.log("Midnight CET: running autoBlog...");
    try { await autoBlog(); } catch(e) { console.error("Scheduled blog error:", e.message); }
  }

  // 11pm CET = 22:00 UTC (winter) or 21:00 UTC (summer) — run resolution after all European games finish
  const yesterday = new Date(now - 24*60*60*1000).toISOString().split("T")[0];
  if ((utcHour === 22 || utcHour === 21) && lastResolveDate !== today) {
    lastResolveDate = today;
    console.log("11pm CET: running resolvePredictions...");
    try { await resolvePredictions(); } catch(e) { console.error("Scheduled resolve error:", e.message); }
  }
}, 60*60*1000); // check every hour

// Auto-generate blog if empty on startup
setTimeout(async () => {
  if (!SUPABASE_ENABLED) return;
  try {
    const { data } = await supabase.from("blog_posts").select("id").limit(1);
    if (!data?.length) {
      console.log("Blog empty - generating initial posts...");
      await autoBlog();
    }
  } catch(e) { console.error("Blog check error:", e.message); }
}, 10000);

// Clear all fixture/result caches on startup to force fresh data with correct season
["PL","PD","BL1","SA","FL1","DED","PPL","ELC","SPL","BEL","TUR","GRE","SAU","MLS","BSA","ARG","MEX","CL","EL"].forEach(id => {
  cache.delete("fix_" + id);
  cache.delete("res_" + id);
  cache.delete("stand_" + id);
  cache.delete("af_/fixtures?league=" + (LEAGUES[id]?.id) + "&season=2024" + "%");
});
console.log("Cache cleared for fresh 2025/26 season data");

app.get("/", (req, res) => res.send("ScoutAI Server v5.0 — Always On · Season 2025/26"));
app.listen(PORT, () => console.log("ScoutAI on port " + PORT));
