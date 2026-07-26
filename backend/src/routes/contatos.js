// Rotas de contatos (para o recurso de enviar mensagem no WhatsApp).
import { Router } from "express";
import { listarContatos, criarContato, apagarContato } from "../db.js";

const router = Router();

router.get("/", (req, res) => {
  res.json(listarContatos());
});

router.post("/", (req, res) => {
  const { nome, telefone, conta } = req.body || {};
  if (!nome || !nome.trim()) return res.status(400).json({ erro: "O nome é obrigatório." });
  if (!telefone || !String(telefone).replace(/\D/g, "")) {
    return res.status(400).json({ erro: "O telefone é obrigatório (com DDD e código do país)." });
  }
  if (conta !== "pessoal" && conta !== "profissional") {
    return res.status(400).json({ erro: "A conta precisa ser 'pessoal' ou 'profissional'." });
  }
  res.status(201).json(criarContato({ nome: nome.trim(), telefone, conta }));
});

router.delete("/:id", (req, res) => {
  apagarContato(Number(req.params.id));
  res.status(204).end();
});

export default router;
