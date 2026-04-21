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
const FKEY = () => ({ "X-Auth-Token": process.env.FOOTBALL_API_KEY });
const BKEY = () => ({ "Authorization": process.env.BDL_API_KEY });
const ESPN = "https://site.api.espn.com/apis/site/v2/sports";
const memPredictions = [], memSubs = [];

const COMPS = {
  PL:  { name:"Premier League",        country:"England",     flag:"PL"  },
  PD:  { name:"La Liga",               country:"Spain",       flag:"PD"  },
  BL1: { name:"Bundesliga",            country:"Germany",     flag:"BL1" },
  SA:  { name:"Serie A",               country:"Italy",       flag:"SA"  },
  FL1: { name:"Ligue 1",               country:"France",      flag:"FL1" },
  DED: { name:"Eredivisie",            country:"Netherlands", flag:"DED" },
  PPL: { name:"Primeira Liga",         country:"Portugal",    flag:"PPL" },
  ELC: { name:"Championship",          country:"England",     flag:"ELC" },
  BSA: { name:"Serie A Brasil",        country:"Brazil",      flag:"BSA" },
  CL:  { name:"Champions League",      country:"Europe",      flag:"CL"  },
  EC:  { name:"European Championship", country:"Europe",      flag:"EC"  },
  WC:  { name:"FIFA World Cup",         country:"World",       flag:"WC"  },
};

// ── FOOTBALL FIXTURES ──────────────────────────────────────────────────────
app.get("/fixtures/:compId", async (req, res) => {
  const id = req.params.compId.toUpperCase();
  if (!COMPS[id]) return res.status(400).json({ error: "Invalid competition" });
  try {
    const today = new Date();
    const from = today.toISOString().split("T")[0];
    const to = new Date(today.getTime() + 30*24*60*60*1000).toISOString().split("T")[0];
    let r = await fetch("https://api.football-data.org/v4/competitions/" + id + "/matches?status=SCHEDULED&dateFrom=" + from + "&dateTo=" + to, { headers: FKEY() });
    let d = await r.json();
    let matches = d.matches || [];
    if (!matches.length) {
      r = await fetch("https://api.football-data.org/v4/competitions/" + id + "/matches?status=SCHEDULED", { headers: FKEY() });
      d = await r.json();
      matches = d.matches || [];
    }
    res.json(matches.slice(0, 12).map(m => ({
      id: m.id, homeId: m.homeTeam.id, awayId: m.awayTeam.id,
      home: m.homeTeam.name, away: m.awayTeam.name,
      homeCrest: m.homeTeam.crest, awayCrest: m.awayTeam.crest,
      date: m.utcDate, round: m.matchday ? "Matchday " + m.matchday : (m.stage || ""),
    })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── STANDINGS ──────────────────────────────────────────────────────────────
app.get("/standings/:compId", async (req, res) => {
  const id = req.params.compId.toUpperCase();
  try {
    let r = await fetch("https://api.football-data.org/v4/competitions/" + id + "/standings", { headers: FKEY() });
    let d = await r.json();
    if (!d.standings) {
      r = await fetch("https://api.football-data.org/v4/competitions/" + id + "/standings?season=2024", { headers: FKEY() });
      d = await r.json();
    }
    const table = (d.standings || []).find(s => s.type === "TOTAL")?.table || [];
    res.json(table.map(e => ({
      position: e.position, team: e.team.name, crest: e.team.crest, teamId: e.team.id,
      played: e.playedGames, won: e.won, draw: e.draw, lost: e.lost,
      gf: e.goalsFor, ga: e.goalsAgainst, gd: e.goalDifference, points: e.points, form: e.form
    })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SCORERS ────────────────────────────────────────────────────────────────
app.get("/scorers/:compId", async (req, res) => {
  const id = req.params.compId.toUpperCase();
  try {
    let r = await fetch("https://api.football-data.org/v4/competitions/" + id + "/scorers?limit=10", { headers: FKEY() });
    let d = await r.json();
    if (!d.scorers?.length) {
      r = await fetch("https://api.football-data.org/v4/competitions/" + id + "/scorers?limit=10&season=2024", { headers: FKEY() });
      d = await r.json();
    }
    res.json((d.scorers || []).map(s => ({
      name: s.player.name, nationality: s.player.nationality,
      team: s.team.name, crest: s.team.crest,
      goals: s.goals, assists: s.assists || 0, penalties: s.penalties || 0
    })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── TEAM ───────────────────────────────────────────────────────────────────
app.get("/team/:teamId", async (req, res) => {
  try {
    const r = await fetch("https://api.football-data.org/v4/teams/" + req.params.teamId, { headers: FKEY() });
    const d = await r.json();
    res.json({
      id: d.id, name: d.name, shortName: d.shortName, crest: d.crest,
      website: d.website, founded: d.founded, venue: d.venue, clubColors: d.clubColors,
      squad: (d.squad || []).map(p => ({ id: p.id, name: p.name, position: p.position, nationality: p.nationality, dateOfBirth: p.dateOfBirth })),
      runningCompetitions: (d.runningCompetitions || []).map(c => ({ id: c.id, name: c.name }))
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/team/:teamId/matches", async (req, res) => {
  try {
    const r = await fetch("https://api.football-data.org/v4/teams/" + req.params.teamId + "/matches?status=FINISHED&limit=10", { headers: FKEY() });
    const d = await r.json();
    res.json((d.matches || []).map(m => ({
      id: m.id, date: m.utcDate,
      home: m.homeTeam.name, away: m.awayTeam.name,
      homeCrest: m.homeTeam.crest, awayCrest: m.awayTeam.crest,
      homeScore: m.score.fullTime.home, awayScore: m.score.fullTime.away,
      competition: m.competition.name
    })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── NBA ────────────────────────────────────────────────────────────────────
app.get("/nba/teams", async (req, res) => {
  try {
    const r = await fetch("https://api.balldontlie.io/nba/v2/teams?per_page=30", { headers: BKEY() });
    const d = await r.json();
    res.json(d.data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/nba/standings", async (req, res) => {
  try {
    const r = await fetch("https://api.balldontlie.io/nba/v2/standings?season=2025", { headers: BKEY() });
    const d = await r.json();
    res.json(d.data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/nba/games", async (req, res) => {
  try {
    const today = new Date();
    const dates = [];
    for (let i = -1; i < 7; i++) {
      const dt = new Date(today);
      dt.setDate(dt.getDate() + i);
      dates.push(dt.toISOString().split("T")[0]);
    }
    const params = dates.map(d => "dates[]=" + d).join("&");
    const r = await fetch("https://api.balldontlie.io/nba/v2/games?" + params + "&per_page=50", { headers: BKEY() });
    const d = await r.json();
    res.json(d.data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/nba/live", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const r = await fetch("https://api.balldontlie.io/nba/v2/games?dates[]=" + today + "&per_page=15", { headers: BKEY() });
    const d = await r.json();
    res.json(d.data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ESPN SPORTS ────────────────────────────────────────────────────────────
function mapEspnGame(e) {
  const comps = e.competitions || [];
  const c = comps[0] || {};
  const home = (c.competitors || []).find(x => x.homeAway === "home") || {};
  const away = (c.competitors || []).find(x => x.homeAway === "away") || {};
  return {
    id: e.id, name: e.name, date: e.date,
    status: e.status?.type?.description || "Scheduled",
    completed: e.status?.type?.completed || false,
    home: home.team?.displayName || "", away: away.team?.displayName || "",
    homeLogo: home.team?.logo || "", awayLogo: away.team?.logo || "",
    homeScore: home.score || "", awayScore: away.score || "",
    venue: c.venue?.fullName || ""
  };
}

app.get("/nfl/games", async (req, res) => {
  try {
    const r = await fetch(ESPN + "/football/nfl/scoreboard");
    const d = await r.json();
    res.json((d.events || []).map(mapEspnGame));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/nfl/standings", async (req, res) => {
  try {
    const r = await fetch(ESPN + "/football/nfl/standings");
    const d = await r.json();
    const groups = (d.children || []).flatMap(conf =>
      (conf.children || []).map(div => ({
        conference: conf.name, division: div.name,
        teams: (div.standings?.entries || []).map(e => ({
          team: e.team?.displayName || "",
          logo: e.team?.logos?.[0]?.href || "",
          wins: e.stats?.find(s => s.name === "wins")?.value || 0,
          losses: e.stats?.find(s => s.name === "losses")?.value || 0,
          pct: e.stats?.find(s => s.name === "winPercent")?.displayValue || ""
        }))
      }))
    );
    res.json(groups);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/nhl/games", async (req, res) => {
  try {
    const r = await fetch(ESPN + "/hockey/nhl/scoreboard");
    const d = await r.json();
    res.json((d.events || []).map(mapEspnGame));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/nhl/standings", async (req, res) => {
  try {
    const r = await fetch(ESPN + "/hockey/nhl/standings");
    const d = await r.json();
    const groups = (d.children || []).flatMap(conf =>
      (conf.children || []).map(div => ({
        conference: conf.name, division: div.name,
        teams: (div.standings?.entries || []).map(e => ({
          team: e.team?.displayName || "",
          logo: e.team?.logos?.[0]?.href || "",
          wins: e.stats?.find(s => s.name === "wins")?.value || 0,
          losses: e.stats?.find(s => s.name === "losses")?.value || 0,
          points: e.stats?.find(s => s.name === "points")?.value || 0
        }))
      }))
    );
    res.json(groups);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/tennis/scores", async (req, res) => {
  try {
    const r = await fetch(ESPN + "/tennis/scoreboard");
    const d = await r.json();
    res.json((d.events || []).slice(0, 20).map(e => {
      const c = (e.competitions || [])[0] || {};
      const p1 = (c.competitors || [])[0] || {};
      const p2 = (c.competitors || [])[1] || {};
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

app.get("/rugby/games", async (req, res) => {
  try {
    const r = await fetch(ESPN + "/rugby/scoreboard");
    const d = await r.json();
    res.json((d.events || []).slice(0, 20).map(mapEspnGame));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CURRENCY ───────────────────────────────────────────────────────────────
app.get("/currency", async (req, res) => {
  try {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
    if (!ip || ip === "127.0.0.1" || ip === "::1") return res.json({ currency: "USD", symbol: "$", country: "US" });
    const r = await fetch("http://ip-api.com/json/" + ip + "?fields=country,countryCode,currency");
    const d = await r.json();
    const sym = { USD:"$",GBP:"£",EUR:"€",CAD:"C$",AUD:"A$",NGN:"₦",BRL:"R$",JPY:"¥",INR:"₹",KRW:"₩",MXN:"$",ZAR:"R",CHF:"Fr",TRY:"₺",GHS:"₵",KES:"KSh" };
    const currency = d.currency || "USD";
    res.json({ currency, symbol: sym[currency] || currency, country: d.countryCode || "US", countryName: d.country || "" });
  } catch { res.json({ currency: "USD", symbol: "$", country: "US" }); }
});

// ── DASHBOARD ──────────────────────────────────────────────────────────────
app.get("/dashboard", async (req, res) => {
  try {
    const today = new Date();
    const from = today.toISOString().split("T")[0];
    const to = new Date(today.getTime() + 3*24*60*60*1000).toISOString().split("T")[0];
    const [football, nbaRes] = await Promise.all([
      Promise.all(["PL","PD","BL1","SA","FL1"].map(async id => {
        try {
          const r = await fetch("https://api.football-data.org/v4/competitions/" + id + "/matches?status=SCHEDULED&dateFrom=" + from + "&dateTo=" + to, { headers: FKEY() });
          const d = await r.json();
          return {
            compId: id, compName: COMPS[id].name, flag: COMPS[id].flag,
            matches: (d.matches || []).slice(0, 4).map(m => ({
              id: m.id, home: m.homeTeam.name, away: m.awayTeam.name,
              homeCrest: m.homeTeam.crest, awayCrest: m.awayTeam.crest, date: m.utcDate
            }))
          };
        } catch { return { compId: id, compName: COMPS[id].name, flag: COMPS[id].flag, matches: [] }; }
      })),
      fetch("https://api.balldontlie.io/nba/v2/games?dates[]=" + from + "&per_page=8", { headers: BKEY() }).then(r => r.json()).catch(() => ({ data: [] }))
    ]);
    res.json({ football, nba: nbaRes.data || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── AI PREDICTION HELPERS ──────────────────────────────────────────────────
async function getForm(teamId) {
  try {
    const r = await fetch("https://api.football-data.org/v4/teams/" + teamId + "/matches?status=FINISHED&limit=10", { headers: FKEY() });
    const d = await r.json();
    if (!d.matches) return null;
    return d.matches.slice(-5).map(m => {
      const h = m.homeTeam.id === teamId;
      const ts = h ? m.score.fullTime.home : m.score.fullTime.away;
      const os = h ? m.score.fullTime.away : m.score.fullTime.home;
      const res = ts > os ? "W" : ts < os ? "L" : "D";
      const opp = h ? m.awayTeam.name : m.homeTeam.name;
      return { result: res, score: ts + "-" + os, opponent: opp, venue: h ? "H" : "A", label: res + " " + ts + "-" + os + " vs " + opp };
    });
  } catch { return null; }
}

async function getH2H(hId, aId) {
  try {
    const r = await fetch("https://api.football-data.org/v4/teams/" + hId + "/matches?status=FINISHED&limit=20", { headers: FKEY() });
    const d = await r.json();
    if (!d.matches) return null;
    return d.matches
      .filter(m => (m.homeTeam.id === hId && m.awayTeam.id === aId) || (m.homeTeam.id === aId && m.awayTeam.id === hId))
      .slice(-5)
      .map(m => ({ home: m.homeTeam.name, away: m.awayTeam.name, homeScore: m.score.fullTime.home, awayScore: m.score.fullTime.away, date: m.utcDate }));
  } catch { return null; }
}

async function getStanding(compId, teamId) {
  try {
    const r = await fetch("https://api.football-data.org/v4/competitions/" + compId + "/standings", { headers: FKEY() });
    const d = await r.json();
    if (!d.standings) return null;
    const table = (d.standings.find(s => s.type === "TOTAL")?.table || []);
    const e = table.find(e => e.team.id === teamId);
    if (!e) return null;
    return { position: e.position, played: e.playedGames, won: e.won, draw: e.draw, lost: e.lost, gf: e.goalsFor, ga: e.goalsAgainst, points: e.points };
  } catch { return null; }
}

async function callClaude(systemPrompt, userMsg) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1200, system: systemPrompt, messages: [{ role: "user", content: userMsg }] })
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  const text = (d.content || []).map(c => c.text || "").join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

// ── FOOTBALL PREDICTION ────────────────────────────────────────────────────
async function predictFootball(home, away, homeId, awayId, compId) {
  let ctx = "";
  let homeForm = null, awayForm = null, homeStand = null, awayStand = null, h2h = null;
  if (homeId && awayId) {
    [homeForm, awayForm, homeStand, awayStand, h2h] = await Promise.all([
      getForm(homeId), getForm(awayId),
      getStanding(compId?.toUpperCase() || "PL", homeId),
      getStanding(compId?.toUpperCase() || "PL", awayId),
      getH2H(homeId, awayId)
    ]);
    if (homeForm) ctx += "\n" + home + " last 5: " + homeForm.map(f => f.label).join(", ");
    if (awayForm) ctx += "\n" + away + " last 5: " + awayForm.map(f => f.label).join(", ");
    if (homeStand) ctx += "\n" + home + ": " + homeStand.position + "th, " + homeStand.points + "pts W" + homeStand.won + "D" + homeStand.draw + "L" + homeStand.lost;
    if (awayStand) ctx += "\n" + away + ": " + awayStand.position + "th, " + awayStand.points + "pts W" + awayStand.won + "D" + awayStand.draw + "L" + awayStand.lost;
    if (h2h?.length) ctx += "\nH2H: " + h2h.map(m => m.home + " " + m.homeScore + "-" + m.awayScore + " " + m.away).join(", ");
  }
  const sys = 'Expert football analyst. Use provided data as primary basis for prediction. Respond ONLY with valid JSON: {"result":"Home Win|Draw|Away Win","result_confidence":<0-100>,"over25":true|false,"over25_confidence":<0-100>,"btts":true|false,"btts_confidence":<0-100>,"score":"<e.g.2-1>","reasoning":"<2-3 sentences>"}';
  const msg = "Predict: " + home + " (HOME) vs " + away + " (AWAY)." + (ctx ? "\n\nData:" + ctx : "");
  const parsed = await callClaude(sys, msg);
  parsed.dataSource = ctx ? "live" : "historical";
  parsed.homeForm = homeForm;
  parsed.awayForm = awayForm;
  parsed.homeStanding = homeStand;
  parsed.awayStanding = awayStand;
  parsed.h2h = h2h;
  return parsed;
}

// ── SPORT PREDICTION ───────────────────────────────────────────────────────
async function predictSport(home, away, sport, league) {
  const systemPrompts = {
    basketball: 'Expert NBA analyst. Respond ONLY with valid JSON: {"result":"Home Win|Away Win","result_confidence":<0-100>,"over_under":"Over|Under","line":<number>,"over_under_confidence":<0-100>,"score":"<e.g.112-108>","reasoning":"<2-3 sentences>"}',
    nfl: 'Expert NFL analyst. Respond ONLY with valid JSON: {"result":"Home Win|Away Win","result_confidence":<0-100>,"score":"<e.g.24-17>","key_factors":["factor1","factor2","factor3"],"reasoning":"<2-3 sentences>"}',
    nhl: 'Expert NHL analyst. Respond ONLY with valid JSON: {"result":"Home Win|Away Win","result_confidence":<0-100>,"score":"<e.g.3-2>","key_factors":["factor1","factor2","factor3"],"reasoning":"<2-3 sentences>"}',
    tennis: 'Expert tennis analyst. Respond ONLY with valid JSON: {"result":"Player 1 Win|Player 2 Win","result_confidence":<0-100>,"score":"<e.g.6-4 6-3>","key_factors":["factor1","factor2","factor3"],"reasoning":"<2-3 sentences>"}',
    rugby: 'Expert rugby analyst. Respond ONLY with valid JSON: {"result":"Home Win|Away Win|Draw","result_confidence":<0-100>,"score":"<e.g.24-18>","key_factors":["factor1","factor2","factor3"],"reasoning":"<2-3 sentences>"}',
  };
  const sys = systemPrompts[sport] || systemPrompts.nfl;
  const msg = "Predict: " + home + " vs " + away + (league ? " (" + league + ")" : "");
  return await callClaude(sys, msg);
}

app.post("/predict", async (req, res) => {
  const { home, away, homeId, awayId, compId, sport } = req.body;
  if (!home || !away) return res.status(400).json({ error: "Teams required" });
  try {
    const s = sport || "football";
    const result = s === "football" ? await predictFootball(home, away, homeId, awayId, compId) : await predictSport(home, away, s, compId);
    res.json(result);
  } catch(e) { res.status(500).json({ error: "Prediction failed: " + e.message }); }
});

app.post("/predict/sport", async (req, res) => {
  const { home, away, sport, league } = req.body;
  if (!home || !away) return res.status(400).json({ error: "Teams required" });
  try { res.json(await predictSport(home, away, sport || "nfl", league)); }
  catch(e) { res.status(500).json({ error: e.message }); }
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
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PERFORMANCE ────────────────────────────────────────────────────────────
app.get("/performance", async (req, res) => {
  try {
    if (SUPABASE_ENABLED) {
      const [{ data: summary }, { data: recent }] = await Promise.all([
        supabase.from("performance_summary").select("*").single(),
        supabase.from("predictions").select("home,away,result,actual_result,status,confidence,date,sport").neq("status", "pending").order("created_at", { ascending: false }).limit(20)
      ]);
      res.json({
        total: summary?.total || 0, resolved: summary?.resolved || 0,
        won: summary?.won || 0, lost: summary?.lost || 0,
        accuracyAll: summary?.accuracy_all || null, accuracy7d: summary?.accuracy_7d || null, accuracy30d: summary?.accuracy_30d || null,
        recentResults: (recent || []).map(p => ({ home: p.home, away: p.away, predicted: p.result, actual: p.actual_result, status: p.status, confidence: p.confidence, date: p.date, sport: p.sport }))
      });
    } else {
      const all = memPredictions;
      const resolved = all.filter(p => p.status !== "pending");
      const won = resolved.filter(p => p.status === "won");
      res.json({ total: all.length, resolved: resolved.length, won: won.length, lost: resolved.length - won.length, accuracyAll: resolved.length ? Math.round(won.length / resolved.length * 100) : null, accuracy7d: null, accuracy30d: null, recentResults: resolved.slice(-20).reverse().map(p => ({ home: p.home, away: p.away, predicted: p.result, status: p.status, confidence: p.confidence, date: p.date, sport: p.sport })) });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── AUTO CHECK RESULTS ─────────────────────────────────────────────────────
async function checkResults() {
  try {
    const pending = SUPABASE_ENABLED
      ? (await supabase.from("predictions").select("*").eq("status", "pending").eq("sport", "football").not("match_id", "is", null)).data || []
      : memPredictions.filter(p => p.status === "pending" && p.sport === "football" && p.match_id);
    for (const pred of pending) {
      try {
        if (Date.now() - new Date(pred.date).getTime() < 2*60*60*1000) continue;
        const r = await fetch("https://api.football-data.org/v4/matches/" + (pred.match_id || pred.matchId), { headers: FKEY() });
        const m = await r.json();
        if (m.status !== "FINISHED") continue;
        const hs = m.score?.fullTime?.home;
        const as2 = m.score?.fullTime?.away;
        if (hs === null || hs === undefined) continue;
        const actual = hs > as2 ? "Home Win" : as2 > hs ? "Away Win" : "Draw";
        const won = pred.result === actual;
        if (SUPABASE_ENABLED) {
          await supabase.from("predictions").update({ status: won ? "won" : "lost", actual_result: actual, actual_score: hs + "-" + as2, resolved_at: new Date().toISOString() }).eq("id", pred.id);
        } else {
          pred.status = won ? "won" : "lost";
          pred.actual_result = actual;
        }
      } catch {}
    }
  } catch(e) { console.error("Result check error:", e.message); }
}
setInterval(checkResults, 2*60*60*1000);
setTimeout(checkResults, 60*1000);

// ── PREDICTION OF THE DAY ──────────────────────────────────────────────────
app.get("/prediction-of-day", async (req, res) => {
  try {
    const today = new Date();
    const from = today.toISOString().split("T")[0];
    const to = new Date(today.getTime() + 3*24*60*60*1000).toISOString().split("T")[0];
    const fixtures = [];
    for (const id of ["PL", "PD", "BL1", "SA", "FL1"]) {
      try {
        const r = await fetch("https://api.football-data.org/v4/competitions/" + id + "/matches?status=SCHEDULED&dateFrom=" + from + "&dateTo=" + to, { headers: FKEY() });
        const d = await r.json();
        if (d.matches?.length) {
          const f = d.matches[0];
          fixtures.push({ compId: id, compName: COMPS[id].name, homeId: f.homeTeam.id, awayId: f.awayTeam.id, home: f.homeTeam.name, away: f.awayTeam.name, homeCrest: f.homeTeam.crest, awayCrest: f.awayTeam.crest, date: f.utcDate });
        }
      } catch {}
    }
    if (!fixtures.length) return res.json(null);
    const preds = await Promise.all(fixtures.map(async f => {
      try { return { ...f, prediction: await predictFootball(f.home, f.away, f.homeId, f.awayId, f.compId) }; }
      catch { return null; }
    }));
    const valid = preds.filter(Boolean);
    valid.sort((a, b) => b.prediction.result_confidence - a.prediction.result_confidence);
    res.json(valid[0] || null);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PARLAYS ────────────────────────────────────────────────────────────────
app.get("/parlays", async (req, res) => {
  try {
    const today = new Date();
    const from = today.toISOString().split("T")[0];
    const to = new Date(today.getTime() + 2*24*60*60*1000).toISOString().split("T")[0];
    const allFx = [];
    for (const id of ["PL", "PD", "BL1", "SA", "FL1", "DED", "PPL"]) {
      try {
        const r = await fetch("https://api.football-data.org/v4/competitions/" + id + "/matches?status=SCHEDULED&dateFrom=" + from + "&dateTo=" + to, { headers: FKEY() });
        const d = await r.json();
        (d.matches || []).slice(0, 3).forEach(m => allFx.push({ compId: id, compName: COMPS[id].name, flag: COMPS[id].flag, homeId: m.homeTeam.id, awayId: m.awayTeam.id, home: m.homeTeam.name, away: m.awayTeam.name, homeCrest: m.homeTeam.crest, awayCrest: m.awayTeam.crest, date: m.utcDate }));
      } catch {}
    }
    if (allFx.length < 3) return res.json({ safe: null, medium: null, highRisk: null, generatedAt: new Date().toISOString() });
    const preds = await Promise.all(allFx.slice(0, 8).map(async f => {
      try { const p = await predictFootball(f.home, f.away, f.homeId, f.awayId, f.compId); return { ...f, prediction: p }; }
      catch { return null; }
    }));
    const valid = preds.filter(p => p && !p.prediction?.error);
    valid.sort((a, b) => b.prediction.result_confidence - a.prediction.result_confidence);
    const buildSlip = (picks, label, riskColor, emoji) => {
      if (!picks.length) return null;
      const totalOdds = picks.reduce((acc, p) => acc * parseFloat((100 / p.prediction.result_confidence).toFixed(2)), 1).toFixed(2);
      return {
        label, emoji, riskColor,
        picks: picks.map(p => ({ home: p.home, away: p.away, flag: p.flag, compName: p.compName, homeCrest: p.homeCrest, awayCrest: p.awayCrest, date: p.date, result: p.prediction.result, confidence: p.prediction.result_confidence, score: p.prediction.score, odds: parseFloat((100 / p.prediction.result_confidence).toFixed(2)) })),
        totalOdds,
        combinedConf: Math.round(picks.reduce((a, p) => a * (p.prediction.result_confidence / 100), 1) * 100)
      };
    };
    res.json({
      safe: buildSlip(valid.slice(0, 3).filter(p => p.prediction.result_confidence >= 60), "Safe Parlay", "#16a34a", "🔒"),
      medium: buildSlip(valid.slice(0, 5), "Value Parlay", "#f59e0b", "🎯"),
      highRisk: buildSlip(valid.slice(0, 7), "High Risk Parlay", "#dc2626", "💣"),
      generatedAt: new Date().toISOString()
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── BLOG ───────────────────────────────────────────────────────────────────
app.post("/blog/generate", async (req, res) => {
  const { home, away, compName, date, prediction } = req.body;
  if (!home || !away) return res.status(400).json({ error: "Missing match data" });
  if (!SUPABASE_ENABLED) return res.json({ success: false, message: "Blog requires Supabase" });
  const cleanHome = home.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const cleanAway = away.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const dateStr = new Date(date || Date.now()).toISOString().split("T")[0];
  const slug = cleanHome + "-vs-" + cleanAway + "-prediction-" + dateStr;
  try {
    const existing = await supabase.from("blog_posts").select("slug").eq("slug", slug).single();
    if (existing.data) return res.json({ success: true, slug, existing: true });
    const matchDate = new Date(date || Date.now()).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const predText = (prediction?.result || "Home Win") + " with " + (prediction?.result_confidence || 70) + "% confidence" + (prediction?.score ? ", predicted score " + prediction.score : "");
    const sys = "You are an SEO football prediction writer. Write engaging 300-400 word match preview articles optimized for Google. Write in plain paragraphs, no markdown headers.";
    const msg = "Write an SEO match prediction article for: " + home + " vs " + away + " (" + (compName || "Football") + ") on " + matchDate + ". AI prediction: " + predText + ". Include both teams analysis and end with a call to action for scoutaibot.com";
    const content = await callClaude(sys, msg);
    const title = home + " vs " + away + " Prediction & Preview — " + (compName || "Football");
    await supabase.from("blog_posts").insert({ slug, title, content: typeof content === "string" ? content : JSON.stringify(content), home, away, match_date: date, published: true });
    res.json({ success: true, slug, title });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/blog", async (req, res) => {
  if (!SUPABASE_ENABLED) return res.json([]);
  try {
    const { data } = await supabase.from("blog_posts").select("slug,title,home,away,match_date,created_at,likes").eq("published", true).order("created_at", { ascending: false }).limit(30);
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/blog/:slug", async (req, res) => {
  if (!SUPABASE_ENABLED) return res.status(404).json({ error: "Blog not available" });
  try {
    const { data } = await supabase.from("blog_posts").select("*").eq("slug", req.params.slug).single();
    if (!data) return res.status(404).json({ error: "Post not found" });
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/blog/:slug/like", async (req, res) => {
  if (!SUPABASE_ENABLED) return res.json({ likes: 0 });
  try {
    const { data: post } = await supabase.from("blog_posts").select("likes").eq("slug", req.params.slug).single();
    const newLikes = (post?.likes || 0) + 1;
    await supabase.from("blog_posts").update({ likes: newLikes }).eq("slug", req.params.slug);
    res.json({ likes: newLikes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/blog/:slug/comments", async (req, res) => {
  if (!SUPABASE_ENABLED) return res.json([]);
  try {
    const { data } = await supabase.from("blog_comments").select("*").eq("slug", req.params.slug).order("created_at", { ascending: false }).limit(50);
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/blog/:slug/comment", async (req, res) => {
  const { name, comment } = req.body;
  if (!name || !comment) return res.status(400).json({ error: "Name and comment required" });
  if (!SUPABASE_ENABLED) return res.status(503).json({ error: "Comments require database" });
  try {
    const { data, error } = await supabase.from("blog_comments").insert({ slug: req.params.slug, name: name.substring(0, 50), comment: comment.substring(0, 500) }).select().single();
    if (error) throw error;
    res.json({ success: true, comment: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CONTACT ────────────────────────────────────────────────────────────────
app.post("/contact", async (req, res) => {
  const { name, email, company, message, type } = req.body;
  if (!name || !email || !message) return res.status(400).json({ error: "Required fields missing" });
  try {
    await resend.emails.send({
      from: "ScoutAI <onboarding@resend.dev>",
      to: process.env.OWNER_EMAIL || "owner@example.com",
      subject: "New Enquiry from " + name,
      html: "<h2>ScoutAI Enquiry</h2><p><b>Name:</b> " + name + "</p><p><b>Email:</b> " + email + "</p><p><b>Company:</b> " + (company || "N/A") + "</p><p><b>Type:</b> " + (type || "") + "</p><p><b>Message:</b> " + message + "</p>"
    });
  } catch(e) { console.error("Email error:", e.message); }
  res.json({ success: true, message: "Message received! We will reply within 24 hours." });
});

// ── NEWSLETTER ─────────────────────────────────────────────────────────────
app.post("/subscribe", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });
  try {
    if (SUPABASE_ENABLED) {
      await supabase.from("subscribers").upsert({ email }, { onConflict: "email", ignoreDuplicates: true });
    } else {
      if (!memSubs.find(s => s.email === email)) memSubs.push({ email, created_at: new Date().toISOString() });
    }
    try { await resend.emails.send({ from: "ScoutAI <onboarding@resend.dev>", to: process.env.OWNER_EMAIL || "owner@example.com", subject: "New ScoutAI Subscriber", html: "<p>New subscriber: <b>" + email + "</b></p>" }); } catch {}
    res.json({ success: true, message: "Subscribed! Daily predictions coming your way." });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DAILY CRON ─────────────────────────────────────────────────────────────
app.get("/cron/daily", async (req, res) => {
  const secret = req.headers["x-cron-secret"] || req.query.secret;
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });
  const results = { errors: [] };
  try { await checkResults(); results.resultsChecked = true; } catch(e) { results.errors.push("Results: " + e.message); }
  try {
    const potdRes = await fetch("https://scoutai-server.onrender.com/prediction-of-day");
    results.potd = await potdRes.json();
    const subs = SUPABASE_ENABLED ? (await supabase.from("subscribers").select("email")).data || [] : memSubs;
    if (subs.length && results.potd && process.env.RESEND_API_KEY) {
      const potd = results.potd;
      const subject = "Today's Best Bet: " + potd.home + " vs " + potd.away + " — ScoutAI";
      const html = "<h2>ScoutAI Daily Pick</h2><h3>" + potd.home + " vs " + potd.away + "</h3><p><b>Prediction:</b> " + (potd.prediction?.result || "") + "</p><p><b>Confidence:</b> " + (potd.prediction?.result_confidence || 0) + "%</p><p>" + (potd.prediction?.reasoning || "") + "</p><p><a href='" + (process.env.SITE_URL || "https://scoutaibot.com") + "'>View all predictions</a></p>";
      let sent = 0;
      for (const sub of subs) {
        try { await resend.emails.send({ from: "ScoutAI Daily Picks <onboarding@resend.dev>", to: sub.email, subject, html }); sent++; } catch {}
      }
      results.emailsSent = sent;
    }
  } catch(e) { results.errors.push("POTD/email: " + e.message); }
  res.json({ success: true, timestamp: new Date().toISOString(), ...results });
});

app.get("/accuracy", (req, res) => {
  const all = memPredictions.filter(p => p.status !== "pending");
  const won = all.filter(p => p.status === "won").length;
  res.json({ total: memPredictions.length, correct: won, accuracy: all.length ? Math.round(won / all.length * 100) : null });
});

app.get("/", (req, res) => res.send("ScoutAI Server v3.0 OK"));
app.listen(PORT, () => console.log("ScoutAI on port " + PORT));
