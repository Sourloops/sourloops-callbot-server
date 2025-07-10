const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const dotenv = require("dotenv");
const twilio = require("twilio");
const fs = require("fs");
const path = require("path");

dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use("/public", express.static(path.join(__dirname, "public")));

const port = process.env.PORT || 3000;

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

const conversations = new Map();

// 🎙 Fonction de génération audio ElevenLabs
async function generateVoice(text, filename = "response.mp3") {
  const voiceId = "lgs5nvhqQFror0VJH8BU"; // Ton clone ElevenLabs
  const apiKey = process.env.ELEVENLABS_API_KEY;

  try {
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.8 },
        lang: "fr",
      },
      {
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg",
        },
        responseType: "stream",
      }
    );

    const filePath = path.join(__dirname, "public", filename);
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", () => {
        console.log("✅ Fichier audio généré :", filename);
        resolve(`/public/${filename}`);
      });
      writer.on("error", (err) => {
        console.error("❌ Erreur d’écriture fichier audio :", err);
        reject(err);
      });
    });
  } catch (err) {
    console.error("❌ Erreur ElevenLabs :", err.response?.data || err.message);
    throw err;
  }
}

// 🤖 Appel OpenAI
async function getOpenAIResponse(messages) {
  try {
    const result = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-3.5-turbo",
        messages,
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    const reply = result.data.choices[0].message.content;
    console.log("💬 Réponse GPT :", reply);
    return reply;
  } catch (error) {
    console.error("❌ Erreur OpenAI:", error.message);
    return "Désolé, je n’ai pas compris.";
  }
}

// 📞 Webhook Twilio
app.post("/twilio-webhook", async (req, res) => {
  const callSid = req.body.CallSid;
  const speech = req.body.SpeechResult;
  const twiml = new twilio.twiml.VoiceResponse();

  if (!conversations.has(callSid)) {
    const intro = `Bonjour, je suis Prune de la marque SourLoops Free Spirits. 
Je vous appelle dans le cadre de votre activité pour savoir si vous seriez intéressé par des spiritueux sans alcool haut de gamme pour vos cocktails ou votre boutique.`;

    conversations.set(callSid, [
      {
        role: "system",
        content: `
Tu es Prune de la marque SourLoops Free Spirits. Tu appelles des professionnels du CHR : bars à cocktails, cavistes, hôtels, restaurants, distributeurs de boissons. 
Ton objectif est de qualifier le prospect, avec politesse et efficacité. Si la personne est intéressée, propose un catalogue ou un rappel.
Remercie toujours à la fin.`,
      },
      { role: "assistant", content: intro },
    ]);

    await generateVoice(intro);
    twiml.play(`${process.env.BASE_URL}/public/response.mp3`);
    twiml.gather({
      input: "speech",
      action: "/twilio-webhook",
      method: "POST",
    });

    return res.type("text/xml").send(twiml.toString());
  }

  if (!speech) {
    twiml.say("Je n’ai pas compris, je vais devoir raccrocher. Bonne journée !");
    conversations.delete(callSid);
    return res.type("text/xml").send(twiml.toString());
  }

  const history = conversations.get(callSid);
  history.push({ role: "user", content: speech });

  const response = await getOpenAIResponse(history);
  history.push({ role: "assistant", content: response });

  if (speech.toLowerCase().includes("merci") || history.length >= 10) {
    await generateVoice(response);
    twiml.play(`${process.env.BASE_URL}/public/response.mp3`);
    twiml.say("Merci pour votre temps. Au revoir !");
    conversations.delete(callSid);
    return res.type("text/xml").send(twiml.toString());
  }

  await generateVoice(response);
  twiml.play(`${process.env.BASE_URL}/public/response.mp3`);
  twiml.gather({
    input: "speech",
    action: "/twilio-webhook",
    method: "POST",
  });

  return res.type("text/xml").send(twiml.toString());
});

// ▶️ Endpoint de test d’appel
app.post("/call", async (req, res) => {
  const to = req.body.to;

  try {
    const call = await client.calls.create({
      url: `${process.env.BASE_URL}/twilio-webhook`,
      to,
      from: twilioPhoneNumber,
    });

    res.json({ message: `Appel lancé vers ${to}`, callSid: call.sid });
  } catch (err) {
    console.error("Erreur Twilio:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`✅ Serveur SourLoops en ligne sur le port ${port}`);
});
