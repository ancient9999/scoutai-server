const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.post("/predict", async (req, res) => {
  const { home, away } = req.body;

  if (!home || !away) {
    return res.status(400).json({ error: "Home and away teams are required." });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
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

app.get("/", (req, res) => res.send("ScoutAI Proxy Server is running ✅"));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
