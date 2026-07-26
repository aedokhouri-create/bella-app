// Rotas de tarefas (listar, criar, editar, apagar).
import { Router } from "express";
import { listarTarefas, criarTarefa, atualizarTarefa, apagarTarefa } from "../db.js";

const router = Router();

router.get("/", (req, res) => {
  res.json(listarTarefas());
});

router.post("/", (req, res) => {
  const { titulo } = req.body || {};
  if (!titulo || !titulo.trim()) {
    return res.status(400).json({ erro: "O título é obrigatório." });
  }
  res.status(201).json(criarTarefa(req.body));
});

router.patch("/:id", (req, res) => {
  const tarefa = atualizarTarefa(Number(req.params.id), req.body || {});
  if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada." });
  res.json(tarefa);
});

router.delete("/:id", (req, res) => {
  apagarTarefa(Number(req.params.id));
  res.status(204).end();
});

export default router;
