// Envio de e-mails da Bella (backup semanal, lembretes diários) via Gmail SMTP.
import nodemailer from "nodemailer";

function limpar(valor) {
  return valor?.replace(/[^\x21-\x7E]/g, "").trim();
}

function getTransportador() {
  const usuario = limpar(process.env.BACKUP_EMAIL_USER);
  const senha = limpar(process.env.BACKUP_EMAIL_PASS);
  if (!usuario || !senha) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: usuario, pass: senha },
  });
}

// anexos: [{ filename, path }] ou [{ filename, content }]
export async function enviarEmail({ para, assunto, texto, anexos }) {
  const transportador = getTransportador();
  if (!transportador) throw new Error("BACKUP_EMAIL_USER/BACKUP_EMAIL_PASS não configurados.");
  await transportador.sendMail({
    from: `"Bella" <${limpar(process.env.BACKUP_EMAIL_USER)}>`,
    to: para,
    subject: assunto,
    text: texto,
    attachments: anexos || [],
  });
}
