// Rotinas automáticas da Bella: backup semanal por e-mail e lembrete diário.
// Roda dentro do próprio processo do servidor (precisa ficar sempre rodando —
// no Render, o plano Starter não dorme, então funciona certinho).
import cron from "node-cron";
import fs from "node:fs";
import path from "node:path";
import { enviarEmail } from "./email.js";
import { listarTarefas, listarContas } from "./db.js";

const DATA_DIR = process.env.DATA_DIR || "./data";
const DB_PATH = path.join(DATA_DIR, "nina.db");
const EMAIL_DESTINO = process.env.CMOT_EMAIL || "aedokhouri@hotmail.com";
const FUSO = "America/Bahia";

async function rodarBackupSemanal() {
  if (!fs.existsSync(DB_PATH)) return;
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: FUSO });
  try {
    await enviarEmail({
      para: EMAIL_DESTINO,
      assunto: `Backup semanal da Bella — ${hoje}`,
      texto:
        "Segue em anexo o backup do banco de dados da Bella (tarefas, contas, contatos, " +
        "cofre criptografado, memórias). Guarde este e-mail — é sua cópia de segurança " +
        "semanal automática.",
      anexos: [{ filename: `bella-backup-${hoje.replace(/\//g, "-")}.db`, path: DB_PATH }],
    });
    console.log(`[agendado] Backup semanal enviado para ${EMAIL_DESTINO}`);
  } catch (err) {
    console.error("[agendado] Erro ao enviar backup semanal:", err.message);
  }
}

function isoDeHoje() {
  const agora = new Date();
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).formatToParts(agora);
  const mapa = Object.fromEntries(partes.map((p) => [p.type, p.value]));
  return `${mapa.year}-${mapa.month}-${mapa.day}`;
}

function somarDias(iso, dias) {
  const [a, m, d] = iso.split("-").map(Number);
  const data = new Date(Date.UTC(a, m - 1, d));
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

async function rodarLembreteDiario() {
  const hoje = isoDeHoje();
  const daquiA3Dias = somarDias(hoje, 3);

  const tarefas = listarTarefas().filter((t) => t.status !== "concluida" && t.data === hoje);
  const contas = listarContas().filter(
    (c) => c.status !== "pago" && c.vencimento >= hoje && c.vencimento <= daquiA3Dias
  );

  if (tarefas.length === 0 && contas.length === 0) return; // nada pra avisar hoje

  const linhas = [`Bom dia, doutor! Resumo de ${hoje.split("-").reverse().join("/")}:`, ""];
  if (tarefas.length) {
    linhas.push("Tarefas de hoje:");
    for (const t of tarefas) linhas.push(`- ${t.titulo}${t.hora ? ` (${t.hora})` : ""}`);
    linhas.push("");
  }
  if (contas.length) {
    linhas.push("Contas vencendo nos próximos 3 dias:");
    for (const c of contas) {
      const venc = c.vencimento.split("-").reverse().join("/");
      linhas.push(`- ${c.titulo}${c.valor != null ? ` — R$ ${Number(c.valor).toFixed(2)}` : ""} (vence ${venc})`);
    }
  }

  try {
    await enviarEmail({
      para: EMAIL_DESTINO,
      assunto: `Bella — resumo do dia (${tarefas.length + contas.length} itens)`,
      texto: linhas.join("\n"),
    });
    console.log(`[agendado] Lembrete diário enviado para ${EMAIL_DESTINO}`);
  } catch (err) {
    console.error("[agendado] Erro ao enviar lembrete diário:", err.message);
  }
}

export function iniciarTarefasAgendadas() {
  if (!process.env.BACKUP_EMAIL_USER || !process.env.BACKUP_EMAIL_PASS) {
    console.log("[agendado] BACKUP_EMAIL_USER/PASS não configurados — backup semanal e lembrete diário desativados.");
    return;
  }
  // Toda segunda-feira às 8h (Bahia).
  cron.schedule("0 8 * * 1", rodarBackupSemanal, { timezone: FUSO });
  // Todo dia às 7h (Bahia).
  cron.schedule("0 7 * * *", rodarLembreteDiario, { timezone: FUSO });
  console.log("[agendado] Backup semanal (seg 8h) e lembrete diário (7h) programados.");
}

// Exportadas para teste manual/debug — não chamadas automaticamente.
export { rodarBackupSemanal, rodarLembreteDiario };
