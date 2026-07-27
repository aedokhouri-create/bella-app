// Rotas de contas a pagar.
import { Router } from "express";
import { listarContas, criarConta, atualizarConta, apagarConta, buscarConta } from "../db.js";
import { sincronizarContaApple, removerContaApple, sincronizarContaGoogle, removerContaGoogle } from "../calendarioSync.js";

const router = Router();

router.get("/", (req, res) => {
  res.json(listarContas());
});

router.post("/", (req, res) => {
  const { titulo, vencimento } = req.body || {};
  if (!titulo || !titulo.trim()) return res.status(400).json({ erro: "O título é obrigatório." });
  if (!vencimento) return res.status(400).json({ erro: "A data de vencimento é obrigatória." });
  const conta = criarConta(req.body);
  res.status(201).json(conta);
  sincronizarContaApple(conta);
  sincronizarContaGoogle(conta);
});

router.patch("/:id", (req, res) => {
  const conta = atualizarConta(Number(req.params.id), req.body || {});
  if (!conta) return res.status(404).json({ erro: "Conta não encontrada." });
  res.json(conta);
  sincronizarContaApple(conta);
  sincronizarContaGoogle(conta);
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const conta = buscarConta(id);
  apagarConta(id);
  res.status(204).end();
  removerContaApple(conta);
  removerContaGoogle(conta);
});

export default router;
