// Rotas de contas a pagar.
import { Router } from "express";
import { listarContas, criarConta, atualizarConta, apagarConta } from "../db.js";

const router = Router();

router.get("/", (req, res) => {
  res.json(listarContas());
});

router.post("/", (req, res) => {
  const { titulo, vencimento } = req.body || {};
  if (!titulo || !titulo.trim()) return res.status(400).json({ erro: "O título é obrigatório." });
  if (!vencimento) return res.status(400).json({ erro: "A data de vencimento é obrigatória." });
  res.status(201).json(criarConta(req.body));
});

router.patch("/:id", (req, res) => {
  const conta = atualizarConta(Number(req.params.id), req.body || {});
  if (!conta) return res.status(404).json({ erro: "Conta não encontrada." });
  res.json(conta);
});

router.delete("/:id", (req, res) => {
  apagarConta(Number(req.params.id));
  res.status(204).end();
});

export default router;
