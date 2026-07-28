// Notificação push de verdade (Web Push) — aparece na tela do iPhone/iPad mesmo
// com a Bella fechada, desde que o app tenha sido "Adicionado à Tela de Início".
import webpush from "web-push";
import { listarInscricoesPush, apagarInscricaoPush } from "./db.js";

function limpar(valor) {
  return valor?.replace(/[^\x21-\x7E]/g, "").trim();
}

let configurado = false;
function garantirConfigurado() {
  if (configurado) return true;
  const publica = limpar(process.env.VAPID_PUBLIC_KEY);
  const privada = limpar(process.env.VAPID_PRIVATE_KEY);
  const assunto = limpar(process.env.VAPID_SUBJECT) || "mailto:contato@bella-app.local";
  if (!publica || !privada) return false;
  webpush.setVapidDetails(assunto, publica, privada);
  configurado = true;
  return true;
}

export function pushAtivo() {
  return garantirConfigurado();
}

export function chavePublicaPush() {
  return garantirConfigurado() ? limpar(process.env.VAPID_PUBLIC_KEY) : null;
}

// Manda a notificação para todos os dispositivos inscritos (iPhone, iPad...).
// "Melhor esforço": nunca lança — inscrição expirada é removida silenciosamente.
export async function enviarPush({ titulo, corpo, url }) {
  if (!garantirConfigurado()) return;
  const inscricoes = listarInscricoesPush();
  const payload = JSON.stringify({ title: titulo, body: corpo, url: url || "/" });
  await Promise.all(
    inscricoes.map(async (inscricao) => {
      try {
        await webpush.sendNotification(inscricao, payload);
      } catch (erro) {
        if (erro.statusCode === 404 || erro.statusCode === 410) {
          apagarInscricaoPush(inscricao.endpoint);
        } else {
          console.warn("[push] não consegui enviar:", erro.message);
        }
      }
    })
  );
}
