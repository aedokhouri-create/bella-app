// Baixa um documento (.docx) gerado pela Bella.
import { Router } from "express";
import { caminhoDocumento } from "../documentos.js";

const router = Router();

router.get("/:id", (req, res) => {
  const arquivo = caminhoDocumento(req.params.id);
  if (!arquivo) return res.status(404).json({ erro: "Documento não encontrado (ou expirou)." });
  res.download(arquivo, "documento.docx");
});

export default router;
