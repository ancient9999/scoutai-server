const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const LEAGUE_IDS = {
  epl: "PL",
  laliga: "PD",
  bundesliga: "BL1",
  seriea: "SA",
  ligue1: "FL1",
};

// Fetch upcoming fixtures
app.get("/fixtures/:leagueId", async (req, res) => {
  const leagueId = LEAGUE_IDS[req.params.leagueId];
  if (!leagueId) return res.status(400).json({ error: "Invalid league" });

  try {
    const today = new Date();
    const from = today.toISOString().split("T")[0];
    const to = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const response = await fetch(
      `https://api.football-data.org/v4/competitions/${leagueId}/matches?status=SCHEDULED&dateFrom=${from}&dateTo=${to}`,
      { headers: { "X-Auth-Token": process.env.FOOTBALL_API_KEY } }
    );
    const data = await response.json();

    let matches = data.matches || [];
    if (matches.length === 0) {
      const fallback = await fetch(
        `https://api.football-data.org/v4/competitions/${leagueId}/matches?status=SCHEDULED`,
        { headers: { "X-Auth-Token": process.env.FOOTBALL_API_KEY } }
      );
      const fallbackData = await fallback.json();
      matches = fallbackData.matches || [];
    }

    const fixtures = matches.slice(0, 10).map((m) => ({
      id: m.id,
      homeId: m.homeTeam.id,
      awayId: m.awayTeam.id,
      home: m.homeTeam.name,
      away: m.awayTeam.name,
      date: m.utcDate,
      venue: "",
      round: m.matchday ? `Matchday ${m.matchday}` : "",
    }));

    res.json(fixtures);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch fixtures: " + err.message });
  }
});

// Fetch last 5 results for a team across all available competitions
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
      return {
        result,
        score: `${teamScore}-${oppScore}`,
        opponent,
        venue: isHome ? "H" : "A",
        label: `${result} ${teamScore}-${oppScore} vs ${opponent} (${isHome ? "H" : "A"})`,
      };
    });
  } catch (err) {
    return null;
  }
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

    const h2h = data.matches.filter(m =>
      (m.homeTeam.id === homeId && m.awayTeam.id === awayId) ||
      (m.homeTeam.id === awayId && m.awayTeam.id === homeId)
    ).slice(-5).map(m => ({
      home: m.homeTeam.name,
      away: m.awayTeam.name,
      homeScore: m.score.fullTime.home,
      awayScore: m.score.fullTime.away,
      date: m.utcDate,
    }));

    return h2h;
  } catch (err) {
    return null;
  }
}

// Fetch league standing
async function getTeamStanding(leagueCode, teamId) {
  try {
    const response = await fetch(
      `https://api.football-data.org/v4/competitions/${leagueCode}/standings`,
      { headers: { "X-Auth-Token": process.env.FOOTBALL_API_KEY } }
    );
    const data = await response.json();
    if (!data.standings) return null;

    const table = data.standings.find(s => s.type === "TOTAL")?.table || [];
    const entry = table.find(e => e.team.id === teamId);
    if (!entry) return null;

    return {
      position: entry.position,
      played: entry.playedGames,
      won: entry.won,
      draw: entry.draw,
      lost: entry.lost,
      gf: entry.goalsFor,
      ga: entry.goalsAgainst,
      points: entry.points,
    };
  } catch (err) {
    return null;
  }
}

// Core prediction function
async function makePrediction(home, away, homeId, awayId, leagueId) {
  let homeForm = null, awayForm = null, homeStanding = null, awayStanding = null, h2h = null;

  if (homeId && awayId) {
    const leagueCode = LEAGUE_IDS[leagueId] || "PL";
    [homeForm, awayForm, homeStanding, awayStanding, h2h] = await Promise.all([
      getTeamForm(homeId),
      getTeamForm(awayId),
      getTeamStanding(leagueCode, homeId),
      getTeamStanding(leagueCode, awayId),
      getH2H(homeId, awayId),
    ]);
  }

  let context = "";
  if (homeForm) context += `\n${home} last 5 results: ${homeForm.map(f => f.label).join(", ")}`;
  if (awayForm) context += `\n${away} last 5 results: ${awayForm.map(f => f.label).join(", ")}`;
  if (homeStanding) context += `\n${home} standing: ${homeStanding.position}th, ${homeStanding.points} pts, W${homeStanding.won} D${homeStanding.draw} L${homeStanding.lost}, GF${homeStanding.gf} GA${homeStanding.ga}`;
  if (awayStanding) context += `\n${away} standing: ${awayStanding.position}th, ${awayStanding.points} pts, W${awayStanding.won} D${awayStanding.draw} L${awayStanding.lost}, GF${awayStanding.gf} GA${awayStanding.ga}`;
  if (h2h && h2h.length > 0) context += `\nHead to head (last ${h2h.length}): ${h2h.map(m => `${m.home} ${m.homeScore}-${m.awayScore} ${m.away}`).join(", ")}`;

  const hasRealData = context.length > 0;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system: `You are an expert football analyst. Use the real data provided as the PRIMARY basis for your prediction.
Always respond with ONLY valid JSON, no markdown, no extra text.
Return this exact structure:
{
  "result": "Home Win" | "Draw" | "Away Win",
  "result_confidence": <number 0-100>,
  "over25": true | false,
  "over25_confidence": <number 0-100>,
  "btts": true | false,
  "btts_confidence": <number 0-100>,
  "score": "<predicted score e.g. 2-1>",
  "reasoning": "<2-3 sentence analysis based on the real data provided>"
}`,
      messages: [{
        role: "user",
        content: `Predict: ${home} (HOME) vs ${away} (AWAY).${hasRealData ? `\n\nReal data:${context}\n\nBase prediction on this data.` : ""}`,
      }],
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);

  const text = data.content?.map((c) => c.text || "").join("") || "";
  const clean = text.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);

  parsed.dataSource = hasRealData ? "live" : "historical";
  parsed.homeForm = homeForm;
  parsed.awayForm = awayForm;
  parsed.homeStanding = homeStanding;
  parsed.awayStanding = awayStanding;
  parsed.h2h = h2h;

  return parsed;
}

// Regular prediction endpoint
app.post("/predict", async (req, res) => {
  const { home, away, homeId, awayId, leagueId } = req.body;
  if (!home || !away) return res.status(400).json({ error: "Home and away teams are required." });

  try {
    const result = await makePrediction(home, away, homeId, awayId, leagueId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Prediction failed. " + err.message });
  }
});

// Prediction of the day - highest confidence match across all leagues
app.get("/prediction-of-day", async (req, res) => {
  try {
    const today = new Date();
    const from = today.toISOString().split("T")[0];
    const to = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    // Fetch fixtures from all leagues
    const allFixtures = [];
    for (const [leagueId, leagueCode] of Object.entries(LEAGUE_IDS)) {
      try {
        const response = await fetch(
          `https://api.football-data.org/v4/competitions/${leagueCode}/matches?status=SCHEDULED&dateFrom=${from}&dateTo=${to}`,
          { headers: { "X-Auth-Token": process.env.FOOTBALL_API_KEY } }
        );
        const data = await response.json();
        if (data.matches && data.matches.length > 0) {
          const fixture = data.matches[0];
          allFixtures.push({
            leagueId,
            leagueName: { epl: "Premier League", laliga: "La Liga", bundesliga: "Bundesliga", seriea: "Serie A", ligue1: "Ligue 1" }[leagueId],
            id: fixture.id,
            homeId: fixture.homeTeam.id,
            awayId: fixture.awayTeam.id,
            home: fixture.homeTeam.name,
            away: fixture.awayTeam.name,
            date: fixture.utcDate,
          });
        }
      } catch (e) {}
    }

    if (allFixtures.length === 0) return res.json(null);

    // Get predictions for all fixtures and find highest confidence
    const predictions = await Promise.all(
      allFixtures.map(async (f) => {
        try {
          const pred = await makePrediction(f.home, f.away, f.homeId, f.awayId, f.leagueId);
          return { ...f, prediction: pred };
        } catch (e) {
          return null;
        }
      })
    );

    const valid = predictions.filter(Boolean);
    const best = valid.sort((a, b) => b.prediction.result_confidence - a.prediction.result_confidence)[0];
    res.json(best);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Accuracy tracking
const predictionResults = {};

app.post("/result", (req, res) => {
  const { key, predicted, actual } = req.body;
  if (!key || !predicted || !actual) return res.status(400).json({ error: "Missing fields" });
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
    const response = await fetch(
      "https://api.football-data.org/v4/competitions/PL/matches?status=SCHEDULED",
      { headers: { "X-Auth-Token": process.env.FOOTBALL_API_KEY } }
    );
    const data = await response.json();
    res.json({ count: data.matches?.length, sample: data.matches?.slice(0, 2) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => res.send("ScoutAI Proxy Server is running ✅"));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
