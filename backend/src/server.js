import "dotenv/config";
import express from "express";
import cors from "cors";
import tarefasRouter from "./routes/tarefas.js";
import chatRouter from "./routes/chat.js";
import cofreRouter from "./routes/cofre.js";
import contatosRouter from "./routes/contatos.js";
import contasRouter from "./routes/contas.js";
import backupRouter from "./routes/backup.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => res.json({ ok: true, app: "Bella" }));
app.use("/api/tarefas", tarefasRouter);
app.use("/api/chat", chatRouter);
app.use("/api/cofre", cofreRouter);
app.use("/api/contatos", contatosRouter);
app.use("/api/contas", contasRouter);
app.use("/api/backup", backupRouter);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Bella (backend) rodando em http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("⚠️  ANTHROPIC_API_KEY não configurada — o chat responderá com um aviso até você preencher o .env");
  }
});
