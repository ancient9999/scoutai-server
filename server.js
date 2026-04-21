const { Resend } = require("resend");
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const resend = new Resend(process.env.RESEND_API_KEY);

const COMPETITIONS = {
  PL:  { name: "Premier League",        country: "England",     flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", category: "Top Leagues" },
  PD:  { name: "La Liga",               country: "Spain",       flag: "🇪🇸", category: "Top Leagues" },
  BL1: { name: "Bundesliga",            country: "Germany",     flag: "🇩🇪", category: "Top Leagues" },
  SA:  { name: "Serie A",               country: "Italy",       flag: "🇮🇹", category: "Top Leagues" },
  FL1: { name: "Ligue 1",               country: "France",      flag: "🇫🇷", category: "Top Leagues" },
  DED: { name: "Eredivisie",            country: "Netherlands", flag: "🇳🇱", category: "Top Leagues" },
  PPL: { name: "Primeira Liga",         country: "Portugal",    flag: "🇵🇹", category: "Top Leagues" },
  ELC: { name: "Championship",          country: "England",     flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", category: "Other Leagues" },
  BSA: { name: "Série A",               country: "Brazil",      flag: "🇧🇷", category: "Other Leagues" },
  CL:  { name: "Champions League",      country: "Europe",      flag: "🏆", category: "European" },
  EC:  { name: "European Championship", country: "Europe",      flag: "🌍", category: "European" },
  WC:  { name: "FIFA World Cup",         country: "World",       flag: "🌎", category: "World" },
};

app.get("/competitions", (req, res) => res.json(COMPETITIONS));

app.get("/fixtures/:compId", async (req, res) => {
  const compId = req.params.compId.toUpperCase();
  if (!COMPETITIONS[compId]) return res.status(400).json({ error: "Invalid competition" });

  try {
    const today = new Date();
    const from = today.toISOString().split("T")[0];
    const to = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    let response = await fetch(
      `https://api.football-data.org/v4/competitions/${compId}/matches?status=SCHEDULED&dateFrom=${from}&dateTo=${to}`,
      { headers: { "X-Auth-Token": process.env.FOOTBALL_API_KEY } }
    );
    let data = await response.json();
    let matches = data.matches || [];

    if (matches.length === 0) {
      response = await fetch(
        `https://api.football-data.org/v4/competitions/${compId}/matches?status=SCHEDULED`,
        { headers: { "X-Auth-Token": process.env.FOOTBALL_API_KEY } }
      );
      data = await response.json();
      matches = data.matches || [];
    }

    res.json(matches.slice(0, 12).map(m => ({
      id: m.id,
      homeId: m.homeTeam.id,
      awayId: m.awayTeam.id,
      home: m.homeTeam.name,
      away: m.awayTeam.name,
      date: m.utcDate,
      venue: m.venue || "",
      round: m.matchday ? `Matchday ${m.matchday}` : (m.stage || ""),
    })));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch fixtures: " + err.message });
  }
});

async function getTeamForm(teamId) {
  try {
    const r = await fetch(
      `https://api.football-data.org/v4/teams/${teamId}/matches?status=FINISHED&limit=10`,
      { headers: { "X-Auth-Token": process.env.FOOTBALL_API_KEY } }
    );
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
    const r = await fetch(
      `https://api.football-data.org/v4/teams/${homeId}/matches?status=FINISHED&limit=20`,
      { headers: { "X-Auth-Token": process.env.FOOTBALL_API_KEY } }
    );
    const data = await r.json();
    if (!data.matches) return null;
    return data.matches
      .filter(m => (m.homeTeam.id === homeId && m.awayTeam.id === awayId) || (m.homeTeam.id === awayId && m.awayTeam.id === homeId))
      .slice(-5)
      .map(m => ({ home: m.homeTeam.name, away: m.awayTeam.name, homeScore: m.score.fullTime.home, awayScore: m.score.fullTime.away, date: m.utcDate }));
  } catch { return null; }
}

async function getTeamStanding(compId, teamId) {
  try {
    const r = await fetch(
      `https://api.football-data.org/v4/competitions/${compId}/standings`,
      { headers: { "X-Auth-Token": process.env.FOOTBALL_API_KEY } }
    );
    const data = await r.json();
    if (!data.standings) return null;
    const table = data.standings.find(s => s.type === "TOTAL")?.table || [];
    const e = table.find(e => e.team.id === teamId);
    if (!e) return null;
    return { position: e.position, played: e.playedGames, won: e.won, draw: e.draw, lost: e.lost, gf: e.goalsFor, ga: e.goalsAgainst, points: e.points };
  } catch { return null; }
}

async function makePrediction(home, away, homeId, awayId, compId) {
  let homeForm = null, awayForm = null, homeStanding = null, awayStanding = null, h2h = null;

  if (homeId && awayId) {
    const code = compId?.toUpperCase() || "PL";
    [homeForm, awayForm, homeStanding, awayStanding, h2h] = await Promise.all([
      getTeamForm(homeId), getTeamForm(awayId),
      getTeamStanding(code, homeId), getTeamStanding(code, awayId),
      getH2H(homeId, awayId),
    ]);
  }

  let context = "";
  if (homeForm) context += `\n${home} last 5: ${homeForm.map(f => f.label).join(", ")}`;
  if (awayForm) context += `\n${away} last 5: ${awayForm.map(f => f.label).join(", ")}`;
  if (homeStanding) context += `\n${home}: ${homeStanding.position}th, ${homeStanding.points}pts W${homeStanding.won}D${homeStanding.draw}L${homeStanding.lost} GF${homeStanding.gf}GA${homeStanding.ga}`;
  if (awayStanding) context += `\n${away}: ${awayStanding.position}th, ${awayStanding.points}pts W${awayStanding.won}D${awayStanding.draw}L${awayStanding.lost} GF${awayStanding.gf}GA${awayStanding.ga}`;
  if (h2h?.length > 0) context += `\nH2H: ${h2h.map(m => `${m.home} ${m.homeScore}-${m.awayScore} ${m.away}`).join(", ")}`;

  const hasRealData = context.length > 0;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system: `You are an expert football analyst. Use real data as PRIMARY basis for prediction.
Always respond with ONLY valid JSON, no markdown:
{
  "result": "Home Win" | "Draw" | "Away Win",
  "result_confidence": <0-100>,
  "over25": true | false,
  "over25_confidence": <0-100>,
  "btts": true | false,
  "btts_confidence": <0-100>,
  "score": "<e.g. 2-1>",
  "reasoning": "<2-3 sentences>"
}`,
      messages: [{ role: "user", content: `Predict: ${home} (HOME) vs ${away} (AWAY).${hasRealData ? `\n\nReal data:${context}` : ""}` }],
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  const text = data.content?.map(c => c.text || "").join("") || "";
  const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
  parsed.dataSource = hasRealData ? "live" : "historical";
  parsed.homeForm = homeForm;
  parsed.awayForm = awayForm;
  parsed.homeStanding = homeStanding;
  parsed.awayStanding = awayStanding;
  parsed.h2h = h2h;
  return parsed;
}

app.post("/predict", async (req, res) => {
  const { home, away, homeId, awayId, compId } = req.body;
  if (!home || !away) return res.status(400).json({ error: "Teams required" });
  try {
    res.json(await makePrediction(home, away, homeId, awayId, compId));
  } catch (err) {
    res.status(500).json({ error: "Prediction failed: " + err.message });
  }
});

app.get("/prediction-of-day", async (req, res) => {
  try {
    const today = new Date();
    const from = today.toISOString().split("T")[0];
    const to = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const topLeagues = ["PL", "PD", "BL1", "SA", "FL1"];
    const allFixtures = [];

    for (const compId of topLeagues) {
      try {
        const r = await fetch(
          `https://api.football-data.org/v4/competitions/${compId}/matches?status=SCHEDULED&dateFrom=${from}&dateTo=${to}`,
          { headers: { "X-Auth-Token": process.env.FOOTBALL_API_KEY } }
        );
        const data = await r.json();
        if (data.matches?.length > 0) {
          const f = data.matches[0];
          allFixtures.push({ compId, compName: COMPETITIONS[compId].name, homeId: f.homeTeam.id, awayId: f.awayTeam.id, home: f.homeTeam.name, away: f.awayTeam.name, date: f.utcDate });
        }
      } catch {}
    }

    if (!allFixtures.length) return res.json(null);
    const predictions = await Promise.all(allFixtures.map(async f => {
      try { return { ...f, prediction: await makePrediction(f.home, f.away, f.homeId, f.awayId, f.compId) }; }
      catch { return null; }
    }));
    const best = predictions.filter(Boolean).sort((a, b) => b.prediction.result_confidence - a.prediction.result_confidence)[0];
    res.json(best);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Contact form — sends email via Resend
app.post("/contact", async (req, res) => {
  const { name, email, company, message, type } = req.body;
  if (!name || !email || !message) return res.status(400).json({ error: "Name, email and message required" });
  
  try {
    await resend.emails.send({
      from: "ScoutAI <onboarding@resend.dev>",
      to: process.env.OWNER_EMAIL || "your@email.com",
      subject: ,
      html: `
        <h2>New Enquiry from ScoutAI</h2>
        <table style="border-collapse:collapse;width:100%">
          <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:bold">Name</td><td style="padding:8px;border:1px solid #e2e8f0">${name}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:bold">Email</td><td style="padding:8px;border:1px solid #e2e8f0">${email}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:bold">Company</td><td style="padding:8px;border:1px solid #e2e8f0">${company || "Not provided"}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:bold">Type</td><td style="padding:8px;border:1px solid #e2e8f0">${type}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:bold">Message</td><td style="padding:8px;border:1px solid #e2e8f0">${message}</td></tr>
        </table>
        <p style="margin-top:16px;color:#64748b">Sent from ScoutAI contact form</p>
      `,
    });
    console.log("Contact email sent for:", name, email);
    res.json({ success: true, message: "Message received! We will get back to you within 24 hours." });
  } catch (err) {
    console.error("Email send error:", err);
    // Still save to logs even if email fails
    console.log("Contact (email failed):", { name, email, company, type, message });
    res.json({ success: true, message: "Message received! We will get back to you within 24 hours." });
  }
});

// Newsletter signup
const subscribers = [];
app.post("/subscribe", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });
  if (subscribers.find(s => s.email === email)) return res.json({ success: true, message: "You are already subscribed!" });
  subscribers.push({ email, timestamp: new Date().toISOString() });
  console.log("New subscriber:", email);
  try {
    await resend.emails.send({
      from: "ScoutAI <onboarding@resend.dev>",
      to: process.env.OWNER_EMAIL || "your@email.com",
      subject: "New ScoutAI Newsletter Subscriber",
      html: `<h2>New Subscriber</h2><p><strong>Email:</strong> ${email}</p><p>Total subscribers: ${subscribers.length}</p>`,
    });
  } catch (err) { console.error("Newsletter email error:", err); }
  res.json({ success: true, message: "Subscribed! You will receive daily predictions." });
});

const predictionResults = {};
app.post("/result", (req, res) => {
  const { key, predicted, actual } = req.body;
  predictionResults[key] = { predicted, actual, correct: predicted === actual, timestamp: Date.now() };
  res.json({ success: true });
});
app.get("/accuracy", (req, res) => {
  const results = Object.values(predictionResults);
  const total = results.length;
  const correct = results.filter(r => r.correct).length;
  res.json({ total, correct, accuracy: total > 0 ? Math.round((correct / total) * 100) : null });
});

app.get("/test", async (req, res) => {
  try {
    const r = await fetch("https://api.football-data.org/v4/competitions/PL/matches?status=SCHEDULED", { headers: { "X-Auth-Token": process.env.FOOTBALL_API_KEY } });
    const data = await r.json();
    res.json({ count: data.matches?.length, sample: data.matches?.slice(0, 2), error: data.error });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/", (req, res) => res.send("ScoutAI Server ✅ Running"));
app.listen(PORT, () => console.log(`ScoutAI Server running on port ${PORT}`));
