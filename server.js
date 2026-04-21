const express = require("express");
const cors = require("cors");
const { Resend } = require("resend");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const resend = new Resend(process.env.RESEND_API_KEY);

// ─── COMPETITION CONFIG ────────────────────────────────────────────────────
const FOOTBALL_COMPS = {
  PL:  { name: "Premier League",        country: "England",     flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", sport: "football" },
  PD:  { name: "La Liga",               country: "Spain",       flag: "🇪🇸", sport: "football" },
  BL1: { name: "Bundesliga",            country: "Germany",     flag: "🇩🇪", sport: "football" },
  SA:  { name: "Serie A",               country: "Italy",       flag: "🇮🇹", sport: "football" },
  FL1: { name: "Ligue 1",               country: "France",      flag: "🇫🇷", sport: "football" },
  DED: { name: "Eredivisie",            country: "Netherlands", flag: "🇳🇱", sport: "football" },
  PPL: { name: "Primeira Liga",         country: "Portugal",    flag: "🇵🇹", sport: "football" },
  ELC: { name: "Championship",          country: "England",     flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", sport: "football" },
  BSA: { name: "Série A",               country: "Brazil",      flag: "🇧🇷", sport: "football" },
  CL:  { name: "Champions League",      country: "Europe",      flag: "🏆", sport: "football" },
  EC:  { name: "European Championship", country: "Europe",      flag: "🌍", sport: "football" },
  WC:  { name: "FIFA World Cup",         country: "World",       flag: "🌎", sport: "football" },
};

const FOOTBALL_HEADERS = { "X-Auth-Token": process.env.FOOTBALL_API_KEY };
const BDL_HEADERS = { "Authorization": process.env.BDL_API_KEY };

// ─── FOOTBALL FIXTURES ─────────────────────────────────────────────────────
app.get("/fixtures/:compId", async (req, res) => {
  const compId = req.params.compId.toUpperCase();
  if (!FOOTBALL_COMPS[compId]) return res.status(400).json({ error: "Invalid competition" });
  try {
    const today = new Date();
    const from = today.toISOString().split("T")[0];
    const to = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    let r = await fetch(`https://api.football-data.org/v4/competitions/${compId}/matches?status=SCHEDULED&dateFrom=${from}&dateTo=${to}`, { headers: FOOTBALL_HEADERS });
    let data = await r.json();
    let matches = data.matches || [];
    if (!matches.length) {
      r = await fetch(`https://api.football-data.org/v4/competitions/${compId}/matches?status=SCHEDULED`, { headers: FOOTBALL_HEADERS });
      data = await r.json();
      matches = data.matches || [];
    }
    res.json(matches.slice(0, 12).map(m => ({
      id: m.id, homeId: m.homeTeam.id, awayId: m.awayTeam.id,
      home: m.homeTeam.name, away: m.awayTeam.name,
      homeCrest: m.homeTeam.crest, awayCrest: m.awayTeam.crest,
      date: m.utcDate, venue: m.venue || "",
      round: m.matchday ? `Matchday ${m.matchday}` : (m.stage || ""),
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── FOOTBALL STANDINGS ────────────────────────────────────────────────────
app.get("/standings/:compId", async (req, res) => {
  const compId = req.params.compId.toUpperCase();
  try {
    const r = await fetch(`https://api.football-data.org/v4/competitions/${compId}/standings`, { headers: FOOTBALL_HEADERS });
    const data = await r.json();
    const table = data.standings?.find(s => s.type === "TOTAL")?.table || [];
    res.json(table.map(e => ({
      position: e.position, team: e.team.name, crest: e.team.crest,
      played: e.playedGames, won: e.won, draw: e.draw, lost: e.lost,
      gf: e.goalsFor, ga: e.goalsAgainst, gd: e.goalDifference, points: e.points,
      form: e.form,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── FOOTBALL TOP SCORERS ──────────────────────────────────────────────────
app.get("/scorers/:compId", async (req, res) => {
  const compId = req.params.compId.toUpperCase();
  try {
    const r = await fetch(`https://api.football-data.org/v4/competitions/${compId}/scorers?limit=10`, { headers: FOOTBALL_HEADERS });
    const data = await r.json();
    res.json((data.scorers || []).map(s => ({
      name: s.player.name, nationality: s.player.nationality,
      team: s.team.name, crest: s.team.crest,
      goals: s.goals, assists: s.assists || 0, penalties: s.penalties || 0,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── FOOTBALL TEAM INFO ────────────────────────────────────────────────────
app.get("/team/:teamId", async (req, res) => {
  try {
    const r = await fetch(`https://api.football-data.org/v4/teams/${req.params.teamId}`, { headers: FOOTBALL_HEADERS });
    const data = await r.json();
    res.json({
      id: data.id, name: data.name, shortName: data.shortName,
      crest: data.crest, website: data.website, founded: data.founded,
      venue: data.venue, clubColors: data.clubColors,
      squad: (data.squad || []).map(p => ({ id: p.id, name: p.name, position: p.position, nationality: p.nationality, dateOfBirth: p.dateOfBirth })),
      runningCompetitions: (data.runningCompetitions || []).map(c => ({ id: c.id, name: c.name, code: c.code, type: c.type })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── FOOTBALL TEAM MATCHES ─────────────────────────────────────────────────
app.get("/team/:teamId/matches", async (req, res) => {
  try {
    const r = await fetch(`https://api.football-data.org/v4/teams/${req.params.teamId}/matches?status=FINISHED&limit=10`, { headers: FOOTBALL_HEADERS });
    const data = await r.json();
    res.json((data.matches || []).slice(-10).map(m => ({
      id: m.id, date: m.utcDate,
      home: m.homeTeam.name, away: m.awayTeam.name,
      homeCrest: m.homeTeam.crest, awayCrest: m.awayTeam.crest,
      homeScore: m.score.fullTime.home, awayScore: m.score.fullTime.away,
      competition: m.competition.name,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── NBA TEAMS ─────────────────────────────────────────────────────────────
app.get("/nba/teams", async (req, res) => {
  try {
    const r = await fetch("https://api.balldontlie.io/nba/v2/teams?per_page=30", { headers: BDL_HEADERS });
    const data = await r.json();
    res.json(data.data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── NBA STANDINGS ─────────────────────────────────────────────────────────
app.get("/nba/standings", async (req, res) => {
  try {
    const r = await fetch("https://api.balldontlie.io/nba/v2/standings?season=2025", { headers: BDL_HEADERS });
    const data = await r.json();
    res.json(data.data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── NBA GAMES (today + upcoming) ─────────────────────────────────────────
app.get("/nba/games", async (req, res) => {
  try {
    const today = new Date();
    const dates = [];
    for (let i = -1; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().split("T")[0]);
    }
    const params = dates.map(d => `dates[]=${d}`).join("&");
    const r = await fetch(`https://api.balldontlie.io/nba/v2/games?${params}&per_page=50`, { headers: BDL_HEADERS });
    const data = await r.json();
    res.json(data.data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── NBA LIVE SCORES ───────────────────────────────────────────────────────
app.get("/nba/live", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const r = await fetch(`https://api.balldontlie.io/nba/v2/games?dates[]=${today}&per_page=15`, { headers: BDL_HEADERS });
    const data = await r.json();
    res.json(data.data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── NBA TEAM STATS ────────────────────────────────────────────────────────
app.get("/nba/team/:teamId/stats", async (req, res) => {
  try {
    const r = await fetch(`https://api.balldontlie.io/nba/v2/stats?team_ids[]=${req.params.teamId}&seasons[]=2025&per_page=10`, { headers: BDL_HEADERS });
    const data = await r.json();
    res.json(data.data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── NBA PLAYERS ───────────────────────────────────────────────────────────
app.get("/nba/players", async (req, res) => {
  const { team_id, search } = req.query;
  try {
    let url = `https://api.balldontlie.io/nba/v2/players/active?per_page=25`;
    if (team_id) url += `&team_ids[]=${team_id}`;
    if (search) url += `&search=${search}`;
    const r = await fetch(url, { headers: BDL_HEADERS });
    const data = await r.json();
    res.json(data.data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── NBA SEASON AVERAGES ───────────────────────────────────────────────────
app.get("/nba/averages", async (req, res) => {
  const { player_ids } = req.query;
  try {
    const ids = player_ids.split(",").map(id => `player_ids[]=${id}`).join("&");
    const r = await fetch(`https://api.balldontlie.io/nba/v2/season_averages?season=2025&${ids}`, { headers: BDL_HEADERS });
    const data = await r.json();
    res.json(data.data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── CURRENCY DETECTION ────────────────────────────────────────────────────
app.get("/currency", async (req, res) => {
  try {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress;
    if (ip === "127.0.0.1" || ip === "::1") return res.json({ currency: "USD", symbol: "$", country: "US" });
    const r = await fetch(`http://ip-api.com/json/${ip}?fields=country,countryCode,currency`);
    const data = await r.json();
    const symbolMap = { USD: "$", GBP: "£", EUR: "€", CAD: "$", AUD: "$", NGN: "₦", BRL: "R$", JPY: "¥", CNY: "¥", INR: "₹", KRW: "₩", MXN: "$", ZAR: "R", CHF: "CHF", SEK: "kr", NOK: "kr", DKK: "kr", PLN: "zł", CZK: "Kč", HUF: "Ft", RON: "lei", HRK: "kn", BGN: "lv", RUB: "₽", TRY: "₺", AED: "د.إ", SAR: "﷼", QAR: "﷼", KWD: "KD", BHD: "BD", EGP: "£", GHS: "₵", KES: "KSh", TZS: "TSh", UGX: "USh", ETB: "Br", CFA: "CFA" };
    const currency = data.currency || "USD";
    res.json({ currency, symbol: symbolMap[currency] || currency, country: data.countryCode || "US", countryName: data.country || "Unknown" });
  } catch { res.json({ currency: "USD", symbol: "$", country: "US" }); }
});

// ─── FOOTBALL PREDICTION ENGINE ────────────────────────────────────────────
async function getTeamForm(teamId) {
  try {
    const r = await fetch(`https://api.football-data.org/v4/teams/${teamId}/matches?status=FINISHED&limit=10`, { headers: FOOTBALL_HEADERS });
    const data = await r.json();
    if (!data.matches) return null;
    return data.matches.slice(-5).map(m => {
      const isHome = m.homeTeam.id === teamId;
      const ts = isHome ? m.score.fullTime.home : m.score.fullTime.away;
      const os = isHome ? m.score.fullTime.away : m.score.fullTime.home;
      const opp = isHome ? m.awayTeam.name : m.homeTeam.name;
      const result = ts > os ? "W" : ts < os ? "L" : "D";
      return { result, score: `${ts}-${os}`, opponent: opp, venue: isHome ? "H" : "A", label: `${result} ${ts}-${os} vs ${opp}` };
    });
  } catch { return null; }
}

async function getH2H(homeId, awayId) {
  try {
    const r = await fetch(`https://api.football-data.org/v4/teams/${homeId}/matches?status=FINISHED&limit=20`, { headers: FOOTBALL_HEADERS });
    const data = await r.json();
    if (!data.matches) return null;
    return data.matches.filter(m => (m.homeTeam.id === homeId && m.awayTeam.id === awayId) || (m.homeTeam.id === awayId && m.awayTeam.id === homeId)).slice(-5).map(m => ({ home: m.homeTeam.name, away: m.awayTeam.name, homeScore: m.score.fullTime.home, awayScore: m.score.fullTime.away, date: m.utcDate }));
  } catch { return null; }
}

async function getTeamStanding(compId, teamId) {
  try {
    const r = await fetch(`https://api.football-data.org/v4/competitions/${compId}/standings`, { headers: FOOTBALL_HEADERS });
    const data = await r.json();
    if (!data.standings) return null;
    const table = data.standings.find(s => s.type === "TOTAL")?.table || [];
    const e = table.find(e => e.team.id === teamId);
    if (!e) return null;
    return { position: e.position, played: e.playedGames, won: e.won, draw: e.draw, lost: e.lost, gf: e.goalsFor, ga: e.goalsAgainst, points: e.points };
  } catch { return null; }
}

async function makePrediction(home, away, homeId, awayId, compId, sport = "football") {
  let context = "";
  let homeForm = null, awayForm = null, homeStanding = null, awayStanding = null, h2h = null;

  if (sport === "football" && homeId && awayId) {
    [homeForm, awayForm, homeStanding, awayStanding, h2h] = await Promise.all([
      getTeamForm(homeId), getTeamForm(awayId),
      getTeamStanding(compId?.toUpperCase() || "PL", homeId),
      getTeamStanding(compId?.toUpperCase() || "PL", awayId),
      getH2H(homeId, awayId),
    ]);
    if (homeForm) context += `\n${home} last 5: ${homeForm.map(f => f.label).join(", ")}`;
    if (awayForm) context += `\n${away} last 5: ${awayForm.map(f => f.label).join(", ")}`;
    if (homeStanding) context += `\n${home}: ${homeStanding.position}th, ${homeStanding.points}pts W${homeStanding.won}D${homeStanding.draw}L${homeStanding.lost}`;
    if (awayStanding) context += `\n${away}: ${awayStanding.position}th, ${awayStanding.points}pts W${awayStanding.won}D${awayStanding.draw}L${awayStanding.lost}`;
    if (h2h?.length > 0) context += `\nH2H: ${h2h.map(m => `${m.home} ${m.homeScore}-${m.awayScore} ${m.away}`).join(", ")}`;
  }

  const isBasketball = sport === "basketball";
  const hasRealData = context.length > 0;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system: isBasketball
        ? `You are an expert NBA analyst. Always respond with ONLY valid JSON:
{"result":"Home Win"|"Away Win","result_confidence":<0-100>,"over_under":"Over"|"Under","line":<number>,"over_under_confidence":<0-100>,"score":"<e.g. 112-108>","reasoning":"<2-3 sentences>"}`
        : `You are an expert football analyst. Use real data as PRIMARY basis. Always respond with ONLY valid JSON:
{"result":"Home Win"|"Draw"|"Away Win","result_confidence":<0-100>,"over25":true|false,"over25_confidence":<0-100>,"btts":true|false,"btts_confidence":<0-100>,"score":"<e.g. 2-1>","reasoning":"<2-3 sentences>"}`,
      messages: [{ role: "user", content: `Predict: ${home} (HOME) vs ${away} (AWAY).${hasRealData ? `\n\nData:${context}` : ""}` }],
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  const text = data.content?.map(c => c.text || "").join("") || "";
  const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
  parsed.dataSource = hasRealData ? "live" : "historical";
  if (sport === "football") { parsed.homeForm = homeForm; parsed.awayForm = awayForm; parsed.homeStanding = homeStanding; parsed.awayStanding = awayStanding; parsed.h2h = h2h; }
  return parsed;
}

app.post("/predict", async (req, res) => {
  const { home, away, homeId, awayId, compId, sport } = req.body;
  if (!home || !away) return res.status(400).json({ error: "Teams required" });
  try { res.json(await makePrediction(home, away, homeId, awayId, compId, sport || "football")); }
  catch (err) { res.status(500).json({ error: "Prediction failed: " + err.message }); }
});

// ─── PREDICTION OF THE DAY ─────────────────────────────────────────────────
app.get("/prediction-of-day", async (req, res) => {
  try {
    const today = new Date();
    const from = today.toISOString().split("T")[0];
    const to = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const topLeagues = ["PL", "PD", "BL1", "SA", "FL1"];
    const allFixtures = [];
    for (const compId of topLeagues) {
      try {
        const r = await fetch(`https://api.football-data.org/v4/competitions/${compId}/matches?status=SCHEDULED&dateFrom=${from}&dateTo=${to}`, { headers: FOOTBALL_HEADERS });
        const data = await r.json();
        if (data.matches?.length > 0) {
          const f = data.matches[0];
          allFixtures.push({ compId, compName: FOOTBALL_COMPS[compId].name, homeId: f.homeTeam.id, awayId: f.awayTeam.id, home: f.homeTeam.name, away: f.awayTeam.name, homeCrest: f.homeTeam.crest, awayCrest: f.awayTeam.crest, date: f.utcDate });
        }
      } catch {}
    }
    if (!allFixtures.length) return res.json(null);
    const predictions = await Promise.all(allFixtures.map(async f => {
      try { return { ...f, prediction: await makePrediction(f.home, f.away, f.homeId, f.awayId, f.compId) }; }
      catch { return null; }
    }));
    res.json(predictions.filter(Boolean).sort((a, b) => b.prediction.result_confidence - a.prediction.result_confidence)[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── CONTACT FORM ──────────────────────────────────────────────────────────
app.post("/contact", async (req, res) => {
  const { name, email, company, message, type } = req.body;
  if (!name || !email || !message) return res.status(400).json({ error: "Name, email and message required" });
  try {
    await resend.emails.send({
      from: "ScoutAI <onboarding@resend.dev>",
      to: process.env.OWNER_EMAIL || "owner@example.com",
      subject: `New Enquiry from ${name} — ${type || "General"}`,
      html: `<h2>New Enquiry via ScoutAI</h2><table style="border-collapse:collapse;width:100%"><tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:bold">Name</td><td style="padding:8px;border:1px solid #e2e8f0">${name}</td></tr><tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:bold">Email</td><td style="padding:8px;border:1px solid #e2e8f0">${email}</td></tr><tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:bold">Company</td><td style="padding:8px;border:1px solid #e2e8f0">${company || "N/A"}</td></tr><tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:bold">Type</td><td style="padding:8px;border:1px solid #e2e8f0">${type}</td></tr><tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:bold">Message</td><td style="padding:8px;border:1px solid #e2e8f0">${message}</td></tr></table>`,
    });
  } catch (err) { console.error("Email error:", err); }
  res.json({ success: true, message: "Message received! We will get back to you within 24 hours." });
});

// ─── NEWSLETTER ────────────────────────────────────────────────────────────
const subscribers = [];
app.post("/subscribe", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });
  if (subscribers.find(s => s.email === email)) return res.json({ success: true, message: "Already subscribed!" });
  subscribers.push({ email, timestamp: new Date().toISOString() });
  try { await resend.emails.send({ from: "ScoutAI <onboarding@resend.dev>", to: process.env.OWNER_EMAIL || "owner@example.com", subject: "New ScoutAI Subscriber", html: `<p>New subscriber: <strong>${email}</strong></p><p>Total: ${subscribers.length}</p>` }); } catch {}
  res.json({ success: true, message: "Subscribed! Daily predictions coming your way." });
});

// ─── ACCURACY ──────────────────────────────────────────────────────────────
const predictionResults = {};
app.post("/result", (req, res) => { const { key, predicted, actual } = req.body; predictionResults[key] = { predicted, actual, correct: predicted === actual, timestamp: Date.now() }; res.json({ success: true }); });
app.get("/accuracy", (req, res) => { const results = Object.values(predictionResults); const total = results.length; const correct = results.filter(r => r.correct).length; res.json({ total, correct, accuracy: total > 0 ? Math.round((correct / total) * 100) : null }); });

app.get("/", (req, res) => res.send("ScoutAI Server ✅"));
app.listen(PORT, () => console.log(`ScoutAI running on port ${PORT}`));
