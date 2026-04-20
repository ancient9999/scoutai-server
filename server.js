const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// All free tier competitions from football-data.org
const COMPETITIONS = {
  // Top European Leagues
  PL:  { name: "Premier League",     country: "England",     flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", category: "Top Leagues" },
  PD:  { name: "La Liga",            country: "Spain",       flag: "🇪🇸", category: "Top Leagues" },
  BL1: { name: "Bundesliga",         country: "Germany",     flag: "🇩🇪", category: "Top Leagues" },
  SA:  { name: "Serie A",            country: "Italy",       flag: "🇮🇹", category: "Top Leagues" },
  FL1: { name: "Ligue 1",            country: "France",      flag: "🇫🇷", category: "Top Leagues" },
  DED: { name: "Eredivisie",         country: "Netherlands", flag: "🇳🇱", category: "Top Leagues" },
  PPL: { name: "Primeira Liga",      country: "Portugal",    flag: "🇵🇹", category: "Top Leagues" },
  // Other Leagues
  ELC: { name: "Championship",       country: "England",     flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", category: "Other Leagues" },
  BSA: { name: "Série A",            country: "Brazil",      flag: "🇧🇷", category: "Other Leagues" },
  // European Competitions
  CL:  { name: "Champions League",   country: "Europe",      flag: "🏆", category: "European" },
  EC:  { name: "European Championship", country: "Europe",   flag: "🌍", category: "European" },
  // World
  WC:  { name: "FIFA World Cup",     country: "World",       flag: "🌎", category: "World" },
};

// Fetch upcoming fixtures for a competition
app.get("/fixtures/:compId", async (req, res) => {
  const compId = req.params.compId.toUpperCase();
  if (!COMPETITIONS[compId]) return res.status(400).json({ error: "Invalid competition" });

  try {
    const today = new Date();
    const from = today.toISOString().split("T")[0];
    const to = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const response = await fetch(
      `https://api.football-data.org/v4/competitions/${compId}/matches?status=SCHEDULED&dateFrom=${from}&dateTo=${to}`,
      { headers: { "X-Auth-Token": process.env.FOOTBALL_API_KEY } }
    );
    const data = await response.json();

    let matches = data.matches || [];
    if (matches.length === 0) {
      const fallback = await fetch(
        `https://api.football-data.org/v4/competitions/${compId}/matches?status=SCHEDULED`,
        { headers: { "X-Auth-Token": process.env.FOOTBALL_API_KEY } }
      );
      const fb = await fallback.json();
      matches = fb.matches || [];
    }

    const fixtures = matches.slice(0, 12).map((m) => ({
      id: m.id,
      homeId: m.homeTeam.id,
      awayId: m.awayTeam.id,
      home: m.homeTeam.name,
      away: m.awayTeam.name,
      date: m.utcDate,
      venue: m.venue || "",
      round: m.matchday ? `Matchday ${m.matchday}` : (m.stage || ""),
    }));

    res.json(fixtures);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch fixtures: " + err.message });
  }
});

// Get all competitions list
app.get("/competitions", (req, res) => {
  res.json(COMPETITIONS);
});

// Fetch last 5 results for a team
async function getTeamForm(teamId) {
  try {
    const response = await fetch(
      `https://api.football-data.org/v4/teams/${teamId}/matches?status=FINISHED&limit=10`,
      { headers: { "X-Auth-Token": process.env.FOOTBALL_API_KEY } }
    );
    const data = await response.json();
    if (!data.matches) return null;

    return data.matches.slice(-5).map((m) => {
      const isHome = m.homeTeam.id === teamId;
      const teamScore = isHome ? m.score.fullTime.home : m.score.fullTime.away;
      const oppScore = isHome ? m.score.fullTime.away : m.score.fullTime.home;
      const opponent = isHome ? m.awayTeam.name : m.homeTeam.name;
      let result = "D";
      if (teamScore > oppScore) result = "W";
      if (teamScore < oppScore) result = "L";
      return { result, score: `${teamScore}-${oppScore}`, opponent, venue: isHome ? "H" : "A", label: `${result} ${teamScore}-${oppScore} vs ${opponent}` };
    });
  } catch (err) { return null; }
}

// Fetch H2H
async function getH2H(homeId, awayId) {
  try {
    const response = await fetch(
      `https://api.football-data.org/v4/teams/${homeId}/matches?status=FINISHED&limit=20`,
      { headers: { "X-Auth-Token": process.env.FOOTBALL_API_KEY } }
    );
    const data = await response.json();
    if (!data.matches) return null;

    return data.matches.filter(m =>
      (m.homeTeam.id === homeId && m.awayTeam.id === awayId) ||
      (m.homeTeam.id === awayId && m.awayTeam.id === homeId)
    ).slice(-5).map(m => ({
      home: m.homeTeam.name, away: m.awayTeam.name,
      homeScore: m.score.fullTime.home, awayScore: m.score.fullTime.away, date: m.utcDate,
    }));
  } catch (err) { return null; }
}

// Fetch standing
async function getTeamStanding(compId, teamId) {
  try {
    const response = await fetch(
      `https://api.football-data.org/v4/competitions/${compId}/standings`,
      { headers: { "X-Auth-Token": process.env.FOOTBALL_API_KEY } }
    );
    const data = await response.json();
    if (!data.standings) return null;

    const table = data.standings.find(s => s.type === "TOTAL")?.table || [];
    const entry = table.find(e => e.team.id === teamId);
    if (!entry) return null;

    return { position: entry.position, played: entry.playedGames, won: entry.won, draw: entry.draw, lost: entry.lost, gf: entry.goalsFor, ga: entry.goalsAgainst, points: entry.points };
  } catch (err) { return null; }
}

// Core prediction
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
    const result = await makePrediction(home, away, homeId, awayId, compId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Prediction failed: " + err.message });
  }
});

// Prediction of the Day
app.get("/prediction-of-day", async (req, res) => {
  try {
    const today = new Date();
    const from = today.toISOString().split("T")[0];
    const to = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const topLeagues = ["PL", "PD", "BL1", "SA", "FL1"];
    const allFixtures = [];

    for (const compId of topLeagues) {
      try {
        const response = await fetch(
          `https://api.football-data.org/v4/competitions/${compId}/matches?status=SCHEDULED&dateFrom=${from}&dateTo=${to}`,
          { headers: { "X-Auth-Token": process.env.FOOTBALL_API_KEY } }
        );
        const data = await response.json();
        if (data.matches?.length > 0) {
          const f = data.matches[0];
          allFixtures.push({
            compId, compName: COMPETITIONS[compId].name,
            homeId: f.homeTeam.id, awayId: f.awayTeam.id,
            home: f.homeTeam.name, away: f.awayTeam.name, date: f.utcDate,
          });
        }
      } catch (e) {}
    }

    if (allFixtures.length === 0) return res.json(null);

    const predictions = await Promise.all(
      allFixtures.map(async f => {
        try {
          const pred = await makePrediction(f.home, f.away, f.homeId, f.awayId, f.compId);
          return { ...f, prediction: pred };
        } catch (e) { return null; }
      })
    );

    const best = predictions.filter(Boolean).sort((a, b) => b.prediction.result_confidence - a.prediction.result_confidence)[0];
    res.json(best);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

app.get("/", (req, res) => res.send("ScoutAI Server ✅"));
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
