import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tarefasRouter from "./routes/tarefas.js";
import chatRouter from "./routes/chat.js";
import cofreRouter from "./routes/cofre.js";
import contatosRouter from "./routes/contatos.js";
import contasRouter from "./routes/contas.js";
import backupRouter from "./routes/backup.js";
import documentosRouter from "./routes/documentos.js";
import memoriasRouter from "./routes/memorias.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" })); // fotos em base64 para a leitura por IA

app.get("/api/health", (req, res) => res.json({ ok: true, app: "Bella" }));
app.use("/api/tarefas", tarefasRouter);
app.use("/api/chat", chatRouter);
app.use("/api/cofre", cofreRouter);
app.use("/api/contatos", contatosRouter);
app.use("/api/contas", contasRouter);
app.use("/api/backup", backupRouter);
app.use("/api/documentos", documentosRouter);
app.use("/api/memorias", memoriasRouter);

// Em produção, o backend também serve o frontend já compilado (mesmo servidor).
const frontendDist = path.join(__dirname, "../../frontend/dist");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get("/*splat", (req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Bella (backend) rodando em http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("⚠️  ANTHROPIC_API_KEY não configurada — o chat responderá com um aviso até você preencher o .env");
  }
});
