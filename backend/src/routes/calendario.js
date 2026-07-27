// Status e conexão da sincronização automática de calendário (Apple + Google).
import { Router } from "express";
import { appleAtivo } from "../appleCalendar.js";
import { googleAtivo, googleConectado, urlAutorizacao, concluirAutorizacao } from "../googleCalendar.js";

const router = Router();

router.get("/status", (req, res) => {
  res.json({ apple: appleAtivo(), google: googleConectado(), googleConfigurado: googleAtivo() });
});

// Abre a tela de consentimento do Google (o doutor precisa clicar e autorizar uma vez).
router.get("/google/conectar", (req, res) => {
  const url = urlAutorizacao();
  if (!url) return res.status(400).send("Google Calendar ainda não está configurado no servidor.");
  res.redirect(url);
});

// O Google chama esta rota de volta depois que o doutor autoriza (ou cancela).
router.get("/google/callback", async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.send(paginaResultado("Conexão cancelada.", "Você pode fechar esta janela e tentar de novo quando quiser."));
  }
  try {
    await concluirAutorizacao(code);
    res.send(paginaResultado("Google Calendar conectado! 🎉", "Pode fechar esta janela e voltar para a Bella."));
  } catch (erro) {
    res.status(500).send(paginaResultado("Não consegui conectar.", erro.message));
  }
});

function paginaResultado(titulo, texto) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Bella</title>
  <style>body{font-family:-apple-system,sans-serif;background:#f4f5f9;color:#1b2340;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}
  div{background:#fff;border-radius:16px;padding:32px 24px;max-width:360px}h1{font-size:20px}p{color:#555}</style>
  </head><body><div><h1>${titulo}</h1><p>${texto}</p></div></body></html>`;
}

export default router;
