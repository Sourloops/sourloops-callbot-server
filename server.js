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

// Endpoint Twilio appelé pendant l’appel
app.post("/twilio-webhook", async (req, res) => {
  const callSid = req.body.CallSid;
  const speech = req.body.SpeechResult;

  const twiml = new twilio.twiml.VoiceResponse();

  // 🆕 Si première interaction → salutation + écoute
  if (!conversations.has(callSid)) {
    conversations.set(callSid, [
      { role: "system", content: `
Tu es un commercial pour la marque SourLoops Free Spirits.
Tu appelles des professionnels du secteur CHR : bars à cocktails, cavistes, hôtels, restaurants, distributeurs de boissons.
Ton objectif est de qualifier le prospect.
Tu commences par te présenter (tu t'appelles Prune), puis tu demandes s’il est intéressé par des spiritueux sans alcool haut de gamme pour ses cocktails ou sa boutique.

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
