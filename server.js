const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const dotenv = require("dotenv");
const twilio = require("twilio"); // 👉 on ajoute le SDK Twilio
dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const port = process.env.PORT || 3000;

// 👉 configuration Twilio
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

// Endpoint pour Twilio webhook
app.post("/twilio-webhook", async (req, res) => {
  const userText = req.body.SpeechResult || "Bonjour";
  const response = await getOpenAIResponse(userText);
  const twiml = `<Response><Say voice="Polly.Celine">${response}</Say></Response>`;
  res.type("text/xml").send(twiml);
});

// 👉 Nouveau endpoint pour lancer un appel
app.post("/call", async (req, res) => {
  const to = req.body.to;

  try {
    const call = await client.calls.create({
      url: `${process.env.BASE_URL}/twilio-webhook`, // URL de réponse vocale
      to,
      from: twilioPhoneNumber,
    });

    res.json({ message: `Appel lancé vers ${to}`, callSid: call.sid });
  } catch (err) {
    console.error("Erreur Twilio:", err.message);
    res.status(500).json({ error: err.message });
  }
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
