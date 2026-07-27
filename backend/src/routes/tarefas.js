// Rotas de tarefas (listar, criar, editar, apagar).
import { Router } from "express";
import { listarTarefas, criarTarefa, atualizarTarefa, apagarTarefa, buscarTarefa } from "../db.js";
import { sincronizarTarefaApple, removerTarefaApple } from "../calendarioSync.js";

const router = Router();

router.get("/", (req, res) => {
  res.json(listarTarefas());
});

router.post("/", (req, res) => {
  const { titulo } = req.body || {};
  if (!titulo || !titulo.trim()) {
    return res.status(400).json({ erro: "O título é obrigatório." });
  }
  const tarefa = criarTarefa(req.body);
  res.status(201).json(tarefa);
  sincronizarTarefaApple(tarefa);
});

router.patch("/:id", (req, res) => {
  const tarefa = atualizarTarefa(Number(req.params.id), req.body || {});
  if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada." });
  res.json(tarefa);
  sincronizarTarefaApple(tarefa);
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const tarefa = buscarTarefa(id);
  apagarTarefa(id);
  res.status(204).end();
  removerTarefaApple(tarefa);
});

export default router;
