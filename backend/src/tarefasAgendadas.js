// Rotinas automáticas da Bella: backup semanal por e-mail e lembrete diário.
// Roda dentro do próprio processo do servidor (precisa ficar sempre rodando —
// no Render, o plano Starter não dorme, então funciona certinho).
import cron from "node-cron";
import fs from "node:fs";
import path from "node:path";
import { enviarEmail } from "./email.js";
import { enviarPush, pushAtivo } from "./push.js";
import { listarTarefas, listarContas } from "./db.js";
import { listarCirurgiasDoDia } from "./cmot.js";

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
  // Melhor esforço: se o CMOT estiver fora do ar ou mal configurado, segue sem a agenda cirúrgica.
  const cirurgias = await listarCirurgiasDoDia(hoje).catch((err) => {
    console.warn("[agendado] não consegui buscar cirurgias do CMOT:", err.message);
    return [];
  });

  if (tarefas.length === 0 && contas.length === 0 && cirurgias.length === 0) return; // nada pra avisar hoje

  const linhas = [`Bom dia, doutor! Resumo de ${hoje.split("-").reverse().join("/")}:`, ""];
  if (cirurgias.length) {
    linhas.push("Cirurgias de hoje (CMOT):");
    for (const c of cirurgias) {
      linhas.push(
        `- ${c.horario || "sem horário"} · ${c.paciente} — ${c.procedimento} — ${c.hospital}${c.tipo === "URGENCIA" ? " — URGÊNCIA" : ""}`
      );
    }
    linhas.push("");
  }
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

  const totalItens = tarefas.length + contas.length + cirurgias.length;

  if (process.env.BACKUP_EMAIL_USER && process.env.BACKUP_EMAIL_PASS) {
    try {
      await enviarEmail({
        para: EMAIL_DESTINO,
        assunto: `Bella — resumo do dia (${totalItens} itens)`,
        texto: linhas.join("\n"),
      });
      console.log(`[agendado] Lembrete diário enviado por e-mail para ${EMAIL_DESTINO}`);
    } catch (err) {
      console.error("[agendado] Erro ao enviar lembrete diário por e-mail:", err.message);
    }
  }

  if (pushAtivo()) {
    const partes = [];
    if (cirurgias.length) partes.push(`${cirurgias.length} cirurgia(s)`);
    if (tarefas.length) partes.push(`${tarefas.length} tarefa(s)`);
    if (contas.length) partes.push(`${contas.length} conta(s)`);
    await enviarPush({ titulo: "Bella — resumo do dia", corpo: partes.join(" · "), url: "/" });
    console.log("[agendado] Lembrete diário enviado por notificação push.");
  }
}

export function iniciarTarefasAgendadas() {
  const emailAtivo = process.env.BACKUP_EMAIL_USER && process.env.BACKUP_EMAIL_PASS;

  if (emailAtivo) {
    // Toda segunda-feira às 8h (Bahia) — só faz sentido por e-mail (anexa o banco inteiro).
    cron.schedule("0 8 * * 1", rodarBackupSemanal, { timezone: FUSO });
  } else {
    console.log("[agendado] BACKUP_EMAIL_USER/PASS não configurados — backup semanal desativado.");
  }

  if (emailAtivo || pushAtivo()) {
    // Todo dia às 7h (Bahia) — manda por e-mail e/ou push, o que estiver configurado.
    cron.schedule("0 7 * * *", rodarLembreteDiario, { timezone: FUSO });
    console.log(`[agendado] Lembrete diário (7h) programado. E-mail: ${emailAtivo ? "sim" : "não"}. Push: ${pushAtivo() ? "sim" : "não"}.`);
  } else {
    console.log("[agendado] Nenhum canal (e-mail/push) configurado — lembrete diário desativado.");
  }
}

// Exportadas para teste manual/debug — não chamadas automaticamente.
export { rodarBackupSemanal, rodarLembreteDiario };
