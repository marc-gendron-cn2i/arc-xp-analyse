// fichier : api/analyse-article.js

// Vercel fournit un runtime Node.js où `fetch` fonctionne nativement.
export default async function handler(req, res) {
  // 1. Autoriser CORS vers votre front-end GitHub Pages
  res.setHeader("Access-Control-Allow-Origin", "https://<votre-pseudo>.github.io");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  // 2. Répondre immédiatement aux requêtes OPTIONS (preflight)
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  // 3. Autoriser uniquement le POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // 4. Récupérer l’arcIdentifier envoyé par le front
  let arcIdentifier;
  try {
    const body = typeof req.body === "object" ? req.body : JSON.parse(req.body);
    arcIdentifier = body.arcIdentifier;
  } catch (e) {
    return res.status(400).json({ error: "Body JSON invalide" });
  }
  if (!arcIdentifier || typeof arcIdentifier !== "string") {
    return res.status(400).json({ error: "arcIdentifier manquant ou invalide" });
  }

  // 5. Appeler l’API Draft Arc XP pour récupérer le contenu
  let draftJson;
  try {
    const draftResp = await fetch(
      `https://draft-api-client-org.arcxp.com/drafts/${arcIdentifier}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.ARC_ACCESS_TOKEN}`,
          Accept: "application/vnd.automate-content+json; charset=utf-8"
        }
      }
    );
    if (!draftResp.ok) {
      const errText = await draftResp.text();
      return res
        .status(draftResp.status)
        .json({ error: "Erreur Draft API", details: errText });
    }
    draftJson = await draftResp.json();
  } catch (e) {
    return res.status(500).json({ error: "Erreur fetch Draft API", details: e.message });
  }

  // 6. Interroger OpenAI pour générer l’analyse
  let analysis;
  try {
    const openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content: "Tu es un assistant expert en journalisme, SEO et expérience utilisateur."
          },
          {
            role: "user",
            content: `
