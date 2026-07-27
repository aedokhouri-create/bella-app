// Painel de memórias de longo prazo da Bella (visualizar/apagar).
import { Router } from "express";
import { listarMemorias, apagarMemoria } from "../db.js";

const router = Router();

router.get("/", (req, res) => {
  res.json(listarMemorias());
});

router.delete("/:id", (req, res) => {
  apagarMemoria(Number(req.params.id));
  res.status(204).end();
});

export default router;
