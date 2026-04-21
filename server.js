const express = require("express");
const cors = require("cors");
const { Resend } = require("resend");

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());

const resend = new Resend(process.env.RESEND_API_KEY);
const FKEY = () => ({ "X-Auth-Token": process.env.FOOTBALL_API_KEY });
const BKEY = () => ({ "Authorization": process.env.BDL_API_KEY });

const COMPS = {
  PL:  { name:"Premier League",        country:"England",     flag:"🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  PD:  { name:"La Liga",               country:"Spain",       flag:"🇪🇸" },
  BL1: { name:"Bundesliga",            country:"Germany",     flag:"🇩🇪" },
  SA:  { name:"Serie A",               country:"Italy",       flag:"🇮🇹" },
  FL1: { name:"Ligue 1",               country:"France",      flag:"🇫🇷" },
  DED: { name:"Eredivisie",            country:"Netherlands", flag:"🇳🇱" },
  PPL: { name:"Primeira Liga",         country:"Portugal",    flag:"🇵🇹" },
  ELC: { name:"Championship",          country:"England",     flag:"🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  BSA: { name:"Serie A",               country:"Brazil",      flag:"🇧🇷" },
  CL:  { name:"Champions League",      country:"Europe",      flag:"🏆" },
  EC:  { name:"European Championship", country:"Europe",      flag:"🌍" },
  WC:  { name:"FIFA World Cup",         country:"World",       flag:"🌎" },
};

// ── FOOTBALL FIXTURES ──────────────────────────────────────────────────────
app.get("/fixtures/:compId", async (req, res) => {
  const id = req.params.compId.toUpperCase();
  if (!COMPS[id]) return res.status(400).json({ error: "Invalid competition" });
  try {
    const today = new Date();
    const from = today.toISOString().split("T")[0];
    const to   = new Date(today.getTime() + 30*24*60*60*1000).toISOString().split("T")[0];
    let r = await fetch(`https://api.football-data.org/v4/competitions/${id}/matches?status=SCHEDULED&dateFrom=${from}&dateTo=${to}`, { headers: FKEY() });
    let d = await r.json();
    let matches = d.matches || [];
    if (!matches.length) {
      r = await fetch(`https://api.football-data.org/v4/competitions/${id}/matches?status=SCHEDULED`, { headers: FKEY() });
      d = await r.json(); matches = d.matches || [];
    }
    res.json(matches.slice(0,12).map(m => ({
      id:m.id, homeId:m.homeTeam.id, awayId:m.awayTeam.id,
      home:m.homeTeam.name, away:m.awayTeam.name,
      homeCrest:m.homeTeam.crest, awayCrest:m.awayTeam.crest,
      date:m.utcDate, venue:m.venue||"",
      round:m.matchday?`Matchday ${m.matchday}`:(m.stage||""),
    })));
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ── FOOTBALL STANDINGS ─────────────────────────────────────────────────────
app.get("/standings/:compId", async (req, res) => {
  const id = req.params.compId.toUpperCase();
  try {
    let r = await fetch(`https://api.football-data.org/v4/competitions/${id}/standings`, { headers: FKEY() });
    let d = await r.json();
    if (!d.standings) {
      r = await fetch(`https://api.football-data.org/v4/competitions/${id}/standings?season=2024`, { headers: FKEY() });
      d = await r.json();
    }
    const table = d.standings?.find(s=>s.type==="TOTAL")?.table || [];
    res.json(table.map(e => ({
      position:e.position, team:e.team.name, crest:e.team.crest, teamId:e.team.id,
      played:e.playedGames, won:e.won, draw:e.draw, lost:e.lost,
      gf:e.goalsFor, ga:e.goalsAgainst, gd:e.goalDifference, points:e.points, form:e.form
    })));
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ── FOOTBALL TOP SCORERS ───────────────────────────────────────────────────
app.get("/scorers/:compId", async (req, res) => {
  const id = req.params.compId.toUpperCase();
  try {
    let r = await fetch(`https://api.football-data.org/v4/competitions/${id}/scorers?limit=10`, { headers: FKEY() });
    let d = await r.json();
    if (!d.scorers?.length) {
      r = await fetch(`https://api.football-data.org/v4/competitions/${id}/scorers?limit=10&season=2024`, { headers: FKEY() });
      d = await r.json();
    }
    res.json((d.scorers||[]).map(s => ({
      name:s.player.name, nationality:s.player.nationality,
      team:s.team.name, crest:s.team.crest,
      goals:s.goals, assists:s.assists||0, penalties:s.penalties||0
    })));
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ── FOOTBALL TEAM ──────────────────────────────────────────────────────────
app.get("/team/:teamId", async (req, res) => {
  try {
    const r = await fetch(`https://api.football-data.org/v4/teams/${req.params.teamId}`, { headers: FKEY() });
    const d = await r.json();
    res.json({
      id:d.id, name:d.name, shortName:d.shortName, crest:d.crest,
      website:d.website, founded:d.founded, venue:d.venue, clubColors:d.clubColors,
      squad:(d.squad||[]).map(p=>({ id:p.id, name:p.name, position:p.position, nationality:p.nationality, dateOfBirth:p.dateOfBirth })),
      runningCompetitions:(d.runningCompetitions||[]).map(c=>({ id:c.id, name:c.name, code:c.code }))
    });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.get("/team/:teamId/matches", async (req, res) => {
  try {
    const r = await fetch(`https://api.football-data.org/v4/teams/${req.params.teamId}/matches?status=FINISHED&limit=10`, { headers: FKEY() });
    const d = await r.json();
    res.json((d.matches||[]).map(m=>({
      id:m.id, date:m.utcDate,
      home:m.homeTeam.name, away:m.awayTeam.name,
      homeCrest:m.homeTeam.crest, awayCrest:m.awayTeam.crest,
      homeScore:m.score.fullTime.home, awayScore:m.score.fullTime.away,
      competition:m.competition.name
    })));
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ── NBA ────────────────────────────────────────────────────────────────────
app.get("/nba/teams", async (req, res) => {
  try {
    const r = await fetch("https://api.balldontlie.io/nba/v2/teams?per_page=30", { headers: BKEY() });
    const d = await r.json(); res.json(d.data||[]);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.get("/nba/standings", async (req, res) => {
  try {
    const r = await fetch("https://api.balldontlie.io/nba/v2/standings?season=2025", { headers: BKEY() });
    const d = await r.json(); res.json(d.data||[]);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.get("/nba/games", async (req, res) => {
  try {
    const today = new Date();
    const dates = [];
    for (let i=-1; i<7; i++) {
      const dt = new Date(today); dt.setDate(dt.getDate()+i);
      dates.push(dt.toISOString().split("T")[0]);
    }
    const params = dates.map(d=>`dates[]=${d}`).join("&");
    const r = await fetch(`https://api.balldontlie.io/nba/v2/games?${params}&per_page=50`, { headers: BKEY() });
    const d = await r.json(); res.json(d.data||[]);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.get("/nba/live", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const r = await fetch(`https://api.balldontlie.io/nba/v2/games?dates[]=${today}&per_page=15`, { headers: BKEY() });
    const d = await r.json(); res.json(d.data||[]);
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ── CURRENCY DETECTION ─────────────────────────────────────────────────────
app.get("/currency", async (req, res) => {
  try {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
    if (!ip || ip==="127.0.0.1" || ip==="::1") return res.json({ currency:"USD", symbol:"$", country:"US" });
    const r = await fetch(`http://ip-api.com/json/${ip}?fields=country,countryCode,currency`);
    const d = await r.json();
    const sym = { USD:"$",GBP:"£",EUR:"€",CAD:"C$",AUD:"A$",NGN:"₦",BRL:"R$",JPY:"¥",CNY:"¥",INR:"₹",KRW:"₩",MXN:"$",ZAR:"R",CHF:"Fr",SEK:"kr",NOK:"kr",DKK:"kr",PLN:"zł",TRY:"₺",AED:"د.إ",EGP:"£",GHS:"₵",KES:"KSh",RUB:"₽",SAR:"﷼",CFA:"CFA" };
    const currency = d.currency||"USD";
    res.json({ currency, symbol:sym[currency]||currency, country:d.countryCode||"US", countryName:d.country||"" });
  } catch { res.json({ currency:"USD", symbol:"$", country:"US" }); }
});

// ── DASHBOARD ──────────────────────────────────────────────────────────────
app.get("/dashboard", async (req, res) => {
  try {
    const today = new Date();
    const from  = today.toISOString().split("T")[0];
    const to    = new Date(today.getTime()+3*24*60*60*1000).toISOString().split("T")[0];
    const leagues = ["PL","PD","BL1","SA","FL1"];
    const [football, nbaRes] = await Promise.all([
      Promise.all(leagues.map(async id => {
        try {
          const r = await fetch(`https://api.football-data.org/v4/competitions/${id}/matches?status=SCHEDULED&dateFrom=${from}&dateTo=${to}`, { headers: FKEY() });
          const d = await r.json();
          return { compId:id, compName:COMPS[id].name, flag:COMPS[id].flag, matches:(d.matches||[]).slice(0,4).map(m=>({ id:m.id, home:m.homeTeam.name, away:m.awayTeam.name, homeCrest:m.homeTeam.crest, awayCrest:m.awayTeam.crest, date:m.utcDate })) };
        } catch { return { compId:id, compName:COMPS[id].name, flag:COMPS[id].flag, matches:[] }; }
      })),
      fetch(`https://api.balldontlie.io/nba/v2/games?dates[]=${from}&per_page=8`, { headers: BKEY() }).then(r=>r.json()).catch(()=>({ data:[] }))
    ]);
    res.json({ football, nba: nbaRes.data||[] });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ── PREDICTIONS ────────────────────────────────────────────────────────────
async function getForm(teamId) {
  try {
    const r = await fetch(`https://api.football-data.org/v4/teams/${teamId}/matches?status=FINISHED&limit=10`, { headers: FKEY() });
    const d = await r.json();
    if (!d.matches) return null;
    return d.matches.slice(-5).map(m => {
      const h = m.homeTeam.id===teamId;
      const ts = h?m.score.fullTime.home:m.score.fullTime.away;
      const os = h?m.score.fullTime.away:m.score.fullTime.home;
      const res = ts>os?"W":ts<os?"L":"D";
      return { result:res, score:`${ts}-${os}`, opponent:h?m.awayTeam.name:m.homeTeam.name, venue:h?"H":"A", label:`${res} ${ts}-${os} vs ${h?m.awayTeam.name:m.homeTeam.name}` };
    });
  } catch { return null; }
}

async function getH2H(hId, aId) {
  try {
    const r = await fetch(`https://api.football-data.org/v4/teams/${hId}/matches?status=FINISHED&limit=20`, { headers: FKEY() });
    const d = await r.json();
    if (!d.matches) return null;
    return d.matches.filter(m=>(m.homeTeam.id===hId&&m.awayTeam.id===aId)||(m.homeTeam.id===aId&&m.awayTeam.id===hId)).slice(-5).map(m=>({ home:m.homeTeam.name, away:m.awayTeam.name, homeScore:m.score.fullTime.home, awayScore:m.score.fullTime.away, date:m.utcDate }));
  } catch { return null; }
}

async function getStanding(compId, teamId) {
  try {
    const r = await fetch(`https://api.football-data.org/v4/competitions/${compId}/standings`, { headers: FKEY() });
    const d = await r.json();
    if (!d.standings) return null;
    const t = d.standings.find(s=>s.type==="TOTAL")?.table||[];
    const e = t.find(e=>e.team.id===teamId); if (!e) return null;
    return { position:e.position, played:e.playedGames, won:e.won, draw:e.draw, lost:e.lost, gf:e.goalsFor, ga:e.goalsAgainst, points:e.points };
  } catch { return null; }
}

async function predict(home, away, homeId, awayId, compId, sport="football") {
  let ctx="", homeForm=null, awayForm=null, homeStand=null, awayStand=null, h2h=null;
  if (sport==="football" && homeId && awayId) {
    [homeForm,awayForm,homeStand,awayStand,h2h] = await Promise.all([getForm(homeId),getForm(awayId),getStanding(compId?.toUpperCase()||"PL",homeId),getStanding(compId?.toUpperCase()||"PL",awayId),getH2H(homeId,awayId)]);
    if (homeForm) ctx+=`\n${home} last 5: ${homeForm.map(f=>f.label).join(", ")}`;
    if (awayForm) ctx+=`\n${away} last 5: ${awayForm.map(f=>f.label).join(", ")}`;
    if (homeStand) ctx+=`\n${home}: ${homeStand.position}th, ${homeStand.points}pts W${homeStand.won}D${homeStand.draw}L${homeStand.lost}`;
    if (awayStand) ctx+=`\n${away}: ${awayStand.position}th, ${awayStand.points}pts W${awayStand.won}D${awayStand.draw}L${awayStand.lost}`;
    if (h2h?.length) ctx+=`\nH2H: ${h2h.map(m=>`${m.home} ${m.homeScore}-${m.awayScore} ${m.away}`).join(", ")}`;
  }
  const isBball = sport==="basketball";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST",
    headers:{ "Content-Type":"application/json","x-api-key":process.env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01" },
    body: JSON.stringify({
      model:"claude-haiku-4-5-20251001", max_tokens:1000,
      system: isBball
        ? `Expert NBA analyst. Respond ONLY valid JSON: {"result":"Home Win"|"Away Win","result_confidence":<0-100>,"over_under":"Over"|"Under","line":<number>,"over_under_confidence":<0-100>,"score":"<e.g.112-108>","reasoning":"<2-3 sentences>"}`
        : `Expert football analyst. Use data as PRIMARY basis. Respond ONLY valid JSON: {"result":"Home Win"|"Draw"|"Away Win","result_confidence":<0-100>,"over25":true|false,"over25_confidence":<0-100>,"btts":true|false,"btts_confidence":<0-100>,"score":"<e.g.2-1>","reasoning":"<2-3 sentences>"}`,
      messages:[{ role:"user", content:`Predict: ${home} (HOME) vs ${away} (AWAY).${ctx?`\n\nData:${ctx}`:""}` }]
    })
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  const text = d.content?.map(c=>c.text||"").join("")||"";
  const parsed = JSON.parse(text.replace(/```json|```/g,"").trim());
  parsed.dataSource = ctx?"live":"historical";
  if (sport==="football") { parsed.homeForm=homeForm; parsed.awayForm=awayForm; parsed.homeStanding=homeStand; parsed.awayStanding=awayStand; parsed.h2h=h2h; }
  return parsed;
}

app.post("/predict", async (req, res) => {
  const { home, away, homeId, awayId, compId, sport } = req.body;
  if (!home||!away) return res.status(400).json({ error:"Teams required" });
  try { res.json(await predict(home,away,homeId,awayId,compId,sport||"football")); }
  catch(e){ res.status(500).json({ error:"Prediction failed: "+e.message }); }
});

app.get("/prediction-of-day", async (req, res) => {
  try {
    const today = new Date();
    const from = today.toISOString().split("T")[0];
    const to   = new Date(today.getTime()+3*24*60*60*1000).toISOString().split("T")[0];
    const fixtures = [];
    for (const id of ["PL","PD","BL1","SA","FL1"]) {
      try {
        const r = await fetch(`https://api.football-data.org/v4/competitions/${id}/matches?status=SCHEDULED&dateFrom=${from}&dateTo=${to}`, { headers: FKEY() });
        const d = await r.json();
        if (d.matches?.length) { const f=d.matches[0]; fixtures.push({ compId:id, compName:COMPS[id].name, homeId:f.homeTeam.id, awayId:f.awayTeam.id, home:f.homeTeam.name, away:f.awayTeam.name, homeCrest:f.homeTeam.crest, awayCrest:f.awayTeam.crest, date:f.utcDate }); }
      } catch {}
    }
    if (!fixtures.length) return res.json(null);
    const preds = await Promise.all(fixtures.map(async f => { try { return { ...f, prediction:await predict(f.home,f.away,f.homeId,f.awayId,f.compId) }; } catch { return null; } }));
    res.json(preds.filter(Boolean).sort((a,b)=>b.prediction.result_confidence-a.prediction.result_confidence)[0]);
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// ── CONTACT ────────────────────────────────────────────────────────────────
app.post("/contact", async (req, res) => {
  const { name, email, company, message, type } = req.body;
  if (!name||!email||!message) return res.status(400).json({ error:"Name, email and message required" });
  try {
    await resend.emails.send({
      from:"ScoutAI <onboarding@resend.dev>",
      to: process.env.OWNER_EMAIL||"owner@example.com",
      subject:`New Enquiry from ${name}`,
      html:`<h2>New ScoutAI Enquiry</h2><p><b>Name:</b> ${name}</p><p><b>Email:</b> ${email}</p><p><b>Company:</b> ${company||"N/A"}</p><p><b>Type:</b> ${type}</p><p><b>Message:</b> ${message}</p>`
    });
  } catch(e){ console.error("Email error:",e.message); }
  res.json({ success:true, message:"Message received! We will get back to you within 24 hours." });
});

// ── NEWSLETTER ─────────────────────────────────────────────────────────────
const subs = [];
app.post("/subscribe", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error:"Email required" });
  if (subs.find(s=>s.email===email)) return res.json({ success:true, message:"Already subscribed!" });
  subs.push({ email, ts:new Date().toISOString() });
  try { await resend.emails.send({ from:"ScoutAI <onboarding@resend.dev>", to:process.env.OWNER_EMAIL||"owner@example.com", subject:"New ScoutAI Subscriber", html:`<p>New subscriber: <b>${email}</b>. Total: ${subs.length}</p>` }); } catch {}
  res.json({ success:true, message:"Subscribed! Daily predictions coming your way." });
});

// ── ACCURACY ───────────────────────────────────────────────────────────────
const results = {};
app.post("/result", (req,res) => { const {key,predicted,actual}=req.body; results[key]={predicted,actual,correct:predicted===actual}; res.json({success:true}); });
app.get("/accuracy", (req,res) => { const all=Object.values(results); const c=all.filter(r=>r.correct).length; res.json({total:all.length,correct:c,accuracy:all.length?Math.round(c/all.length*100):null}); });


// ── PREDICTION STORAGE (in-memory, persists during uptime) ─────────────────
// Structure: { key, home, away, compId, result, score, confidence, date, sport, status: "pending"|"won"|"lost" }
const predictionHistory = [];
let lastResultCheck = null;

// Store a prediction for tracking
app.post("/predictions/store", (req, res) => {
  const { key, home, away, compId, matchId, result, score, confidence, date, sport } = req.body;
  if (!key || !home || !away) return res.status(400).json({ error: "Missing fields" });
  // Avoid duplicates
  if (predictionHistory.find(p => p.key === key)) return res.json({ success: true, duplicate: true });
  predictionHistory.push({ key, home, away, compId, matchId: matchId||null, result, score, confidence, date, sport: sport||"football", status: "pending", storedAt: new Date().toISOString() });
  res.json({ success: true });
});

// Get performance stats
app.get("/performance", (req, res) => {
  const now = Date.now();
  const day7  = predictionHistory.filter(p => p.status !== "pending" && new Date(p.storedAt) > new Date(now - 7*24*60*60*1000));
  const day30 = predictionHistory.filter(p => p.status !== "pending" && new Date(p.storedAt) > new Date(now - 30*24*60*60*1000));
  const all   = predictionHistory.filter(p => p.status !== "pending");
  const calc  = arr => arr.length ? Math.round(arr.filter(p => p.status === "won").length / arr.length * 100) : null;
  const recent = predictionHistory.filter(p => p.status !== "pending").slice(-20).reverse();
  res.json({
    total: predictionHistory.length,
    resolved: all.length,
    won: all.filter(p => p.status === "won").length,
    lost: all.filter(p => p.status === "lost").length,
    accuracy7d:  calc(day7),
    accuracy30d: calc(day30),
    accuracyAll: calc(all),
    recentResults: recent.map(p => ({ home: p.home, away: p.away, predicted: p.result, actual: p.actualResult||null, status: p.status, confidence: p.confidence, date: p.date, sport: p.sport })),
  });
});

// Auto check results for pending football predictions
async function checkPendingResults() {
  const pending = predictionHistory.filter(p => p.status === "pending" && p.sport === "football" && p.matchId);
  if (!pending.length) return;
  for (const pred of pending) {
    try {
      const matchDate = new Date(pred.date);
      if (Date.now() - matchDate.getTime() < 2*60*60*1000) continue; // skip if < 2hrs ago
      const r = await fetch(`https://api.football-data.org/v4/matches/${pred.matchId}`, { headers: FKEY() });
      const d = await r.json();
      if (!d.match && !d.id) { const m = d; if (!m.status || m.status !== "FINISHED") continue;
        const hs = m.score?.fullTime?.home; const as2 = m.score?.fullTime?.away;
        if (hs === null || hs === undefined) continue;
        const actual = hs > as2 ? "Home Win" : as2 > hs ? "Away Win" : "Draw";
        pred.actualResult = actual;
        pred.actualScore = `${hs}-${as2}`;
        pred.status = pred.result === actual ? "won" : "lost";
        pred.resolvedAt = new Date().toISOString();
      } else {
        const m = d.match || d;
        if (!m.status || m.status !== "FINISHED") continue;
        const hs = m.score?.fullTime?.home; const as2 = m.score?.fullTime?.away;
        if (hs === null || hs === undefined) continue;
        const actual = hs > as2 ? "Home Win" : as2 > hs ? "Away Win" : "Draw";
        pred.actualResult = actual;
        pred.actualScore = `${hs}-${as2}`;
        pred.status = pred.result === actual ? "won" : "lost";
        pred.resolvedAt = new Date().toISOString();
      }
    } catch(e) { /* skip */ }
  }
  lastResultCheck = new Date().toISOString();
}

// Check results every 2 hours
setInterval(checkPendingResults, 2*60*60*1000);
// Also run on startup after 1 min
setTimeout(checkPendingResults, 60*1000);

// ── AUTO-GENERATE DAILY PARLAYS ─────────────────────────────────────────────
app.get("/parlays", async (req, res) => {
  try {
    const today = new Date();
    const from  = today.toISOString().split("T")[0];
    const to    = new Date(today.getTime() + 2*24*60*60*1000).toISOString().split("T")[0];

    // Collect fixtures from top leagues
    const allFixtures = [];
    for (const compId of ["PL","PD","BL1","SA","FL1","DED","PPL"]) {
      try {
        const r = await fetch(`https://api.football-data.org/v4/competitions/${compId}/matches?status=SCHEDULED&dateFrom=${from}&dateTo=${to}`, { headers: FKEY() });
        const d = await r.json();
        (d.matches||[]).slice(0,3).forEach(m => allFixtures.push({
          compId, compName: COMPS[compId].name, flag: COMPS[compId].flag,
          homeId: m.homeTeam.id, awayId: m.awayTeam.id,
          home: m.homeTeam.name, away: m.awayTeam.name,
          homeCrest: m.homeTeam.crest, awayCrest: m.awayTeam.crest,
          date: m.utcDate, matchId: m.id
        }));
      } catch {}
    }

    if (allFixtures.length < 3) return res.json({ safe: null, medium: null, highRisk: null });

    // Get predictions for all fixtures (parallel, limit 8)
    const sample = allFixtures.slice(0, 8);
    const preds = await Promise.all(sample.map(async f => {
      try {
        const pred = await predict(f.home, f.away, f.homeId, f.awayId, f.compId);
        return { ...f, prediction: pred };
      } catch { return null; }
    }));
    const valid = preds.filter(p => p && !p.prediction?.error).sort((a,b) => b.prediction.result_confidence - a.prediction.result_confidence);

    const safe     = valid.slice(0, 3).filter(p => p.prediction.result_confidence >= 60);
    const medium   = valid.slice(0, 5);
    const highRisk = valid.slice(0, 7);

    const buildSlip = (picks, label, riskColor, emoji) => {
      if (!picks.length) return null;
      const totalOdds = picks.reduce((acc, p) => acc * parseFloat((100/p.prediction.result_confidence).toFixed(2)), 1).toFixed(2);
      return {
        label, emoji, riskColor,
        picks: picks.map(p => ({
          home: p.home, away: p.away, flag: p.flag, compName: p.compName,
          homeCrest: p.homeCrest, awayCrest: p.awayCrest, date: p.date,
          result: p.prediction.result, confidence: p.prediction.result_confidence,
          score: p.prediction.score, odds: parseFloat((100/p.prediction.result_confidence).toFixed(2))
        })),
        totalOdds,
        combinedConf: Math.round(picks.reduce((a,p) => a * (p.prediction.result_confidence/100), 1) * 100)
      };
    };

    res.json({
      safe:     buildSlip(safe,     "Safe Parlay",      "#16a34a", "🔒"),
      medium:   buildSlip(medium,   "Value Parlay",     "#f59e0b", "🎯"),
      highRisk: buildSlip(highRisk, "High Risk Parlay", "#dc2626", "💣"),
      generatedAt: new Date().toISOString()
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/", (req,res) => res.send("ScoutAI Server ✅"));
app.listen(PORT, () => console.log(`ScoutAI on port ${PORT}`));
