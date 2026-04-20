const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// football-data.org competition IDs
const LEAGUE_IDS = {
  epl: "PL",
  laliga: "PD",
  bundesliga: "BL1",
  seriea: "SA",
  ligue1: "FL1",
};

app.get("/fixtures/:leagueId", async (req, res) => {
  const leagueId = LEAGUE_IDS[req.params.leagueId];
  if (!leagueId) return res.status(400).json({ error: "Invalid league" });

  try {
    const today = new Date();
    const from = today.toISOString().split("T")[0];
    const to = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const response = await fetch(
      `https://api.football-data.org/v4/competitions/${leagueId}/matches?status=SCHEDULED&dateFrom=${from}&dateTo=${to}`,
      {
        headers: {
          "X-Auth-Token": process.env.FOOTBALL_API_KEY,
        },
      }
    );

    const data = await response.json();

    if (!data.matches || data.matches.length === 0) {
      // fallback: get next 10 matches regardless of date
      const fallback = await fetch(
        `https://api.football-data.org/v4/competitions/${leagueId}/matches?status=SCHEDULED`,
        { headers: { "X-Auth-Token": process.env.FOOTBALL_API_KEY } }
      );
      const fallbackData = await fallback.json();
      const matches = (fallbackData.matches || []).slice(0, 10).map((m) => ({
        id: m.id,
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

app.post("/predict", async (req, res) => {
  const { home, away } = req.body;
  if (!home || !away) return res.status(400).json({ error: "Home and away teams are required." });

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
        system: `You are an expert football analyst. Given a match between two teams, provide a structured prediction.
Always respond with ONLY valid JSON, no markdown, no extra text.
Return this exact structure:
{
  "result": "Home Win" | "Draw" | "Away Win",
  "result_confidence": <number 0-100>,
  "over25": true | false,
  "over25_confidence": <number 0-100>,
  "btts": true | false,
  "btts_confidence": <number 0-100>,
  "reasoning": "<2-3 sentence analysis>"
}`,
        messages: [
          {
            role: "user",
            content: `Predict the match: ${home} vs ${away}. Use your knowledge of these teams' recent form, head-to-head record, squad quality, and playing style.`,
          },
        ],
      }),
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const text = data.content?.map((c) => c.text || "").join("") || "";
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
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
