const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const dotenv = require("dotenv");
const twilio = require("twilio");
dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const port = process.env.PORT || 3000;

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

// 🔁 Historique des conversations : callSid => messages[]
const conversations = new Map();

const fs = require("fs");
const path = require("path");

async function generateVoice(text, filename = "response.mp3") {
  const voiceId = "lgs5nvhqQFror0VJH8BU"; // Voix clone de "Paul"
  const apiKey = process.env.ELEVENLABS_API_KEY;

  const response = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      text,
      model_id: "eleven_monolingual_v1",
      voice_settings: { stability: 0.5, similarity_boost: 0.8 },
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
    writer.on("finish", () => resolve(`/public/${filename}`));
    writer.on("error", reject);
  });
}


// Endpoint Twilio appelé pendant l’appel
app.post("/twilio-webhook", async (req, res) => {
  const callSid = req.body.CallSid;
  const speech = req.body.SpeechResult;

  const twiml = new twilio.twiml.VoiceResponse();

  // 🆕 Si première interaction → salutation + écoute
  if (!conversations.has(callSid)) {
    conversations.set(callSid, [
      { role: "system", content: `
Tu prends le role d'un commercial pour la marque SourLoops Free Spirits. Tu te présentes en tant que tel. Tu commences la conversation par dire : Bonjour je suis Prune de la Marque Sourloops free Spirits, je vous appelle dans le cadre de votre activité pour savoir si vous seriez intéressé par des spiritueux sans alcool haut de gamme pour vos cocktails ou votre boutique.
Tu appelles des professionnels du secteur CHR : bars à cocktails, cavistes, hôtels, restaurants, distributeurs de boissons.
Ton objectif est de qualifier le prospect afin de savoir si il pourrait être un client de Sourloops Free Spirits.

Sois poli, professionnel, accessible et direct.
Si la personne semble intéressée, propose de lui envoyer un catalogue ou de la rappeler avec un conseiller.
Finis toujours par remercier l'interlocuteur.
` }
    ]);

    const gather = twiml.gather({
      input: "speech",
      action: "/twilio-webhook",
      method: "POST"
    });
    gather.say({ voice: "Polly.Celine" }, "Bonjour, ici SourLoops Free Spirits. Comment puis-je vous aider aujourd’hui ?");
    return res.type("text/xml").send(twiml.toString());
  }

  // ❌ Si aucune parole n’a été entendue
  if (!speech) {
    twiml.say({ voice: "Polly.Celine" }, "Je n’ai pas compris, je vais devoir raccrocher. Bonne journée !");
    conversations.delete(callSid);
    return res.type("text/xml").send(twiml.toString());
  }

  // 🧠 Mise à jour historique
  const history = conversations.get(callSid);
  history.push({ role: "user", content: speech });

  // 🗨️ Appel à OpenAI
  const response = await getOpenAIResponse(history);
  history.push({ role: "assistant", content: response });

  // 🧹 Condition d'arrêt (au revoir ou trop long)
  if (speech.toLowerCase().includes("merci") || history.length >= 10) {
    twiml.say({ voice: "Polly.Celine" }, response);
    twiml.say({ voice: "Polly.Celine" }, "Merci pour votre temps. Au revoir !");
    conversations.delete(callSid);
    return res.type("text/xml").send(twiml.toString());
  }

  // 🔁 Relancer un nouveau <Gather>
  const gather = twiml.gather({
    input: "speech",
    action: "/twilio-webhook",
    method: "POST"
  });
  gather.say({ voice: "Polly.Celine" }, response);
  return res.type("text/xml").send(twiml.toString());
});

// 👉 Endpoint pour lancer un appel manuellement
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

// 🔧 Fonction pour obtenir une réponse GPT avec tout l’historique
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
    return result.data.choices[0].message.content;
  } catch (error) {
    console.error("Erreur OpenAI:", error.message);
    return "Désolé, je n’ai pas compris.";
  }
}

app.listen(port, () => {
  console.log(`✅ Serveur SourLoops en ligne sur le port ${port}`);
});
