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

    if (!data.matches || data.matches.length === 0) {
      const fallback = await fetch(
        `https://api.football-data.org/v4/competitions/${leagueId}/matches?status=SCHEDULED`,
        { headers: { "X-Auth-Token": process.env.FOOTBALL_API_KEY } }
      );
      const fallbackData = await fallback.json();
      const matches = (fallbackData.matches || []).slice(0, 10).map((m) => ({
        id: m.id,
        homeId: m.homeTeam.id,
        awayId: m.awayTeam.id,
        home: m.homeTeam.name,
        away: m.awayTeam.name,
        date: m.utcDate,
        venue: "",
        round: m.matchday ? `Matchday ${m.matchday}` : "",
      }));
      return res.json(matches);
    }

    const fixtures = data.matches.slice(0, 10).map((m) => ({
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

// Fetch last 5 results for a team
async function getTeamForm(teamId) {
  try {
    const response = await fetch(
      `https://api.football-data.org/v4/teams/${teamId}/matches?status=FINISHED&limit=5`,
      { headers: { "X-Auth-Token": process.env.FOOTBALL_API_KEY } }
    );
    const data = await response.json();
    if (!data.matches) return null;

    const results = data.matches.slice(-5).map((m) => {
      const isHome = m.homeTeam.id === teamId;
      const teamScore = isHome ? m.score.fullTime.home : m.score.fullTime.away;
      const oppScore = isHome ? m.score.fullTime.away : m.score.fullTime.home;
      const opponent = isHome ? m.awayTeam.name : m.homeTeam.name;
      let result = "D";
      if (teamScore > oppScore) result = "W";
      if (teamScore < oppScore) result = "L";
      return `${result} ${teamScore}-${oppScore} vs ${opponent} (${isHome ? "H" : "A"})`;
    });

    return results;
  } catch (err) {
    return null;
  }
}

// Fetch league standing for a team
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

// AI prediction with real data
app.post("/predict", async (req, res) => {
  const { home, away, homeId, awayId, leagueId } = req.body;
  if (!home || !away) return res.status(400).json({ error: "Home and away teams are required." });

  // Fetch real data in parallel
  let homeForm = null, awayForm = null, homeStanding = null, awayStanding = null;

  if (homeId && awayId) {
    const leagueCode = LEAGUE_IDS[leagueId] || "PL";
    [homeForm, awayForm, homeStanding, awayStanding] = await Promise.all([
      getTeamForm(homeId),
      getTeamForm(awayId),
      getTeamStanding(leagueCode, homeId),
      getTeamStanding(leagueCode, awayId),
    ]);
  }

  // Build context string from real data
  let context = "";

  if (homeForm) {
    context += `\n${home} last 5 results: ${homeForm.join(", ")}`;
  }
  if (awayForm) {
    context += `\n${away} last 5 results: ${awayForm.join(", ")}`;
  }
  if (homeStanding) {
    context += `\n${home} league position: ${homeStanding.position}th, ${homeStanding.points} pts, W${homeStanding.won} D${homeStanding.draw} L${homeStanding.lost}, GF${homeStanding.gf} GA${homeStanding.ga}`;
  }
  if (awayStanding) {
    context += `\n${away} league position: ${awayStanding.position}th, ${awayStanding.points} pts, W${awayStanding.won} D${awayStanding.draw} L${awayStanding.lost}, GF${awayStanding.gf} GA${awayStanding.ga}`;
  }

  const hasRealData = context.length > 0;

  try {
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
        system: `You are an expert football analyst. You will be given real up-to-date match data including recent results, league standings, and form. Use this data as the PRIMARY basis for your prediction. Always respond with ONLY valid JSON, no markdown, no extra text.
Return this exact structure:
{
  "result": "Home Win" | "Draw" | "Away Win",
  "result_confidence": <number 0-100>,
  "over25": true | false,
  "over25_confidence": <number 0-100>,
  "btts": true | false,
  "btts_confidence": <number 0-100>,
  "reasoning": "<2-3 sentence analysis based on the real data provided>"
}`,
        messages: [
          {
            role: "user",
            content: `Predict the match: ${home} (HOME) vs ${away} (AWAY).
${hasRealData ? `\nHere is the latest real data for both teams:${context}\n\nBase your prediction primarily on this real data.` : "Use your knowledge of these teams to make the best prediction possible."}`,
          },
        ],
      }),
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const text = data.content?.map((c) => c.text || "").join("") || "";
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    // Include data source info
    parsed.dataSource = hasRealData ? "live" : "historical";
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: "Prediction failed. " + err.message });
  }
});

app.get("/test", async (req, res) => {
  try {
    const response = await fetch(
      "https://api.football-data.org/v4/competitions/PL/matches?status=SCHEDULED",
      { headers: { "X-Auth-Token": process.env.FOOTBALL_API_KEY } }
    );
    const data = await response.json();
    res.json({ count: data.matches?.length, sample: data.matches?.slice(0, 2), error: data.error });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => res.send("ScoutAI Proxy Server is running ✅"));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
