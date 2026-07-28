// Rotas de notificação push (Web Push).
import { Router } from "express";
import { salvarInscricaoPush, apagarInscricaoPush } from "../db.js";
import { pushAtivo, chavePublicaPush, enviarPush } from "../push.js";

const router = Router();

router.get("/chave-publica", (req, res) => {
  res.json({ ativo: pushAtivo(), chave: chavePublicaPush() });
});

router.post("/inscrever", (req, res) => {
  const inscricao = req.body;
  if (!inscricao?.endpoint) return res.status(400).json({ erro: "Inscrição inválida." });
  salvarInscricaoPush(inscricao);
  res.status(201).json({ ok: true });
});

router.post("/desinscrever", (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) apagarInscricaoPush(endpoint);
  res.json({ ok: true });
});

// Notificação de teste — só dispara pro próprio doutor confirmar que está funcionando.
router.post("/testar", async (req, res) => {
  await enviarPush({ titulo: "Bella", corpo: "Notificação de teste — se você está vendo isso, funcionou! 🎉" });
  res.json({ ok: true });
});

export default router;
