const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const LEAGUE_IDS = {
  epl: 39,
  laliga: 140,
  bundesliga: 78,
  seriea: 135,
  ligue1: 61,
};

app.get("/fixtures/:leagueId", async (req, res) => {
  const leagueId = LEAGUE_IDS[req.params.leagueId];
  if (!leagueId) return res.status(400).json({ error: "Invalid league" });

  const apiKey = process.env.FOOTBALL_API_KEY;

  try {
    // April 2026 = still 2025/26 season, so season=2025
    // Try upcoming first, then fall back to last played
    const urls = [
      `https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=2025&status=NS&next=10`,
      `https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=2025&status=NS&from=2026-04-01&to=2026-06-30`,
      `https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=2025&last=10`,
    ];

    let fixtures = [];

    for (const url of urls) {
      const response = await fetch(url, {
        headers: {
          "x-apisports-key": apiKey,
          "x-rapidapi-key": apiKey,
          "x-rapidapi-host": "v3.football.api-sports.io",
        },
      });
      const data = await response.json();

      // Log for debugging
      console.log(`URL: ${url}`);
      console.log(`Results: ${data.results}, Errors:`, data.errors);

      if (data.response && data.response.length > 0) {
        fixtures = data.response.map((f) => ({
          id: f.fixture.id,
          home: f.teams.home.name,
          away: f.teams.away.name,
          date: f.fixture.date,
          venue: f.fixture.venue?.name || "",
          round: f.league?.round || "",
          finished: f.fixture.status?.short === "FT",
        }));
        break;
      }
    }

    res.json(fixtures);
  } catch (err) {
    console.error("Fixture fetch error:", err);
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

// Debug endpoint - test the football API key directly
app.get("/test", async (req, res) => {
  try {
    const response = await fetch(
      "https://v3.football.api-sports.io/fixtures?league=39&season=2025&status=NS&next=5",
      {
        headers: {
          "x-apisports-key": process.env.FOOTBALL_API_KEY,
        },
      }
    );
    const data = await response.json();
    res.json({ results: data.results, errors: data.errors, sample: data.response?.slice(0, 2) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => res.send("ScoutAI Proxy Server is running ✅"));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
