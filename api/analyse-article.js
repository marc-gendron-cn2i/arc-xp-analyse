// fichier : api/analyse-article.js

// Vercel fournit un runtime Node.js où `fetch` fonctionne nativement.
export default async function handler(req, res) {
  // 1. Autoriser CORS vers votre front-end GitHub Pages
  res.setHeader("Access-Control-Allow-Origin", "https://marc-gendron-cn2i.github.io");
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
  let draftJson = null;
  const draftUrlsToTry = [
   // pour tester en sandbox, modifier l'URL de cette façon: https://api.sandbox.lescoopsdelinformation.arcpublishing.com/draft/v1/story/${arcIdentifier}/revision/draft
    `https://api.lescoopsdelinformation.arcpublishing.com/draft/v1/story/${arcIdentifier}/revision/draft` 
  ];

  for (const url of draftUrlsToTry) {
    try {
      const draftResp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${process.env.ARC_ACCESS_TOKEN}`,
          Accept: "application/vnd.automate-content+json; charset=utf-8"
        }
      });
      if (draftResp.ok) {
        draftJson = await draftResp.json();
        break;
      }
      // Si c’est un 404, on essaie l’URL suivante
      if (draftResp.status !== 404) {
        const errText = await draftResp.text();
        return res
          .status(draftResp.status)
          .json({ error: "Erreur Draft API", details: errText });
      }
    } catch (e) {
      // En cas d’erreur réseau, on sort directement
      return res.status(500).json({ error: "Erreur fetch Draft API", details: e.message });
    }
  }

  // 6. Si pas de draft trouvé, basculer sur la Content API (article déjà publié)
  let payloadToOpenAI = null;
  if (draftJson) {
    payloadToOpenAI = draftJson;
  } else {
    try {
      const contentResp = await fetch(
        `https://content-api-client-org.arcxp.com/content/v4/stories/${arcIdentifier}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.ARC_ACCESS_TOKEN}`,
            Accept: "application/json"
          }
        }
      );
      if (!contentResp.ok) {
        const errText = await contentResp.text();
        return res
          .status(contentResp.status)
          .json({ error: "Erreur Content API", details: errText });
      }
      const contentJson = await contentResp.json();
      payloadToOpenAI = contentJson.story || contentJson;
    } catch (e) {
      return res.status(500).json({ error: "Échec Content API", details: e.message });
    }
  }

  // 7. Interroger OpenAI pour générer l’analyse
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
Voici le JSON ANS de l’article (draft ou publié) :
${JSON.stringify(payloadToOpenAI)}

Tu es un expert en journalisme, SEO et UX. Garde en tête :

1. Génère “user_needs” (chaîne).
2. “user_needs_scores” (tableau Markdown ou chaîne).
3. “score_explanation” (chaîne).
4. “improvement_suggestions” (array de chaînes).
5. “user_needs_tags” (array d’objets: {description, slug, text}).
6. “user_needs_json” (même structure).
7. “relevant_tags” (array d’objets).
8. “iab_categories” (array de chaînes).
9. “arc_xp_label” (objet: {label:{iab_taxonomy:{display:true,text:"…"}}}).
10. “iab_taxonomy_text” (chaîne).
11. “seo_keywords” (array de chaînes).
12. “seo_title” (chaîne).
13. “seo_title_explanation” (chaîne).
14. “viafoura” ({viafoura_question:"…", viafoura_answers:["…","…"]}).
15. “headlines_ab” ({A:"…",B:"…",C:"…"}).

Retourne **uniquement** un JSON strictement structuré ainsi :
{
  "user_needs": "...",
  "user_needs_scores": "...",
  "score_explanation": "...",
  "improvement_suggestions": [...],
  "user_needs_tags": [...],
  "user_needs_json": [...],
  "relevant_tags": [...],
  "iab_categories": [...],
  "arc_xp_label": { ... },
  "iab_taxonomy_text": "...",
  "seo_keywords": [...],
  "seo_title": "...",
  "seo_title_explanation": "...",
  "viafoura": { "viafoura_question":"...", "viafoura_answers":["...", "..."] },
  "headlines_ab": { "A":"...", "B":"...", "C":"..." }
}
`
          }
        ],
        max_tokens: 1500
      })
    });
    if (!openaiResp.ok) {
      const errText = await openaiResp.text();
      return res
        .status(openaiResp.status)
        .json({ error: "Erreur OpenAI API", details: errText });
    }
    const openaiJson = await openaiResp.json();
    const content = openaiJson.choices[0].message.content.trim();
    analysis = JSON.parse(content);
  } catch (e) {
    return res.status(500).json({ error: "Erreur OpenAI ou JSON invalide", details: e.message });
  }

  // 8. Envoyer la réponse finale au front
  return res.status(200).json({
    status: "success",
    analysis
  });
}
