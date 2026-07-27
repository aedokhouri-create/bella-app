// Modelos de documento reutilizáveis (visualizar/apagar).
import { Router } from "express";
import { listarModelos, apagarModelo } from "../db.js";

const router = Router();

router.get("/", (req, res) => {
  res.json(listarModelos());
});

router.delete("/:id", (req, res) => {
  apagarModelo(Number(req.params.id));
  res.status(204).end();
});

export default router;
