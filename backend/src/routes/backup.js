// Backup: baixa o banco de dados inteiro num arquivo só, para você guardar
// onde quiser (iCloud Drive, Google Drive, e-mail para si mesmo, etc.).
// É um arquivo pequeno (só texto/números — nenhuma foto/vídeo), então nunca
// deve passar de poucos megabytes, mesmo com muitos dados.
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";

const router = Router();
const DATA_DIR = process.env.DATA_DIR || "./data";
const DB_PATH = path.join(DATA_DIR, "nina.db");

router.get("/", (req, res) => {
  if (!fs.existsSync(DB_PATH)) {
    return res.status(404).json({ erro: "Banco de dados ainda não foi criado." });
  }
  const hoje = new Date().toISOString().slice(0, 10);
  const tamanho = fs.statSync(DB_PATH).size;
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="bella-backup-${hoje}.db"`);
  res.setHeader("Content-Length", tamanho);
  fs.createReadStream(DB_PATH).pipe(res);
});

// Só informações (tamanho, data), sem baixar — para mostrar na tela.
router.get("/info", (req, res) => {
  if (!fs.existsSync(DB_PATH)) {
    return res.json({ existe: false });
  }
  const stat = fs.statSync(DB_PATH);
  res.json({
    existe: true,
    tamanhoBytes: stat.size,
    tamanhoLegivel: formatarTamanho(stat.size),
    modificadoEm: stat.mtime,
  });
});

function formatarTamanho(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default router;
