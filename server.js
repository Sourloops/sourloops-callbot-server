const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const dotenv = require("dotenv");
dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const port = process.env.PORT || 3000;

app.post("/twilio-webhook", async (req, res) => {
  const userText = req.body.SpeechResult || "Bonjour";
  const response = await getOpenAIResponse(userText);
  const twiml = `<Response><Say voice="Polly.Celine">${response}</Say></Response>`;
  res.type("text/xml").send(twiml);
});

async function getOpenAIResponse(prompt) {
  try {
    const result = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    return result.data.choices[0].message.content;
  } catch (error) {
    console.error("Erreur GPT:", error.message);
    return "Désolé, je n’ai pas compris.";
  }
}

app.listen(port, () => {
  console.log(`Serveur en ligne sur le port ${port}`);
});
