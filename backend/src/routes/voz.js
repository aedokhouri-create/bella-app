// Sintetiza voz natural (Google Cloud TTS) para o texto que a Bella responde.
import { Router } from "express";
import { sintetizarVoz, VOZES_GOOGLE } from "../voz.js";

const router = Router();

router.get("/vozes", (req, res) => {
  res.json({ disponivel: !!process.env.GOOGLE_TTS_API_KEY, vozes: VOZES_GOOGLE });
});

router.post("/sintetizar", async (req, res) => {
  const { texto, voz } = req.body || {};
  if (!texto || !texto.trim()) return res.status(400).json({ erro: "Texto vazio." });
  try {
    const audioBase64 = await sintetizarVoz(texto, voz);
    res.json({ audioBase64 });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

export default router;
