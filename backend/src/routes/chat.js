// Rota do chat com a IA.
import { Router } from "express";
import { conversar } from "../anthropic.js";

const router = Router();

router.post("/", async (req, res) => {
  const { message, history, imagem } = req.body || {};
  if ((!message || !message.trim()) && !imagem) {
    return res.status(400).json({ erro: "Mensagem vazia." });
  }
  try {
    const resultado = await conversar({ message, history: history || [], imagem });
    res.json(resultado);
  } catch (err) {
    console.error("Erro no chat:", err);
    res.status(500).json({
      erro: "Não consegui falar com a IA agora. Verifique a chave da API e a conexão.",
    });
  }
});

export default router;
