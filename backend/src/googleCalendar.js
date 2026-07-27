// Sincronização automática com o Google Calendar via OAuth2.
// Diferente do Apple: precisa de um Client ID/Secret do Google Cloud (tela de
// consentimento) e de o doutor autorizar uma vez clicando em "Conectar Google Calendar".
import { google } from "googleapis";
import { getConfig, setConfig } from "./db.js";

const CHAVE_REFRESH_TOKEN = "google_calendar_refresh_token";

function limpar(valor) {
  return valor?.replace(/[^\x21-\x7E]/g, "").trim();
}

function credenciaisApp() {
  const clientId = limpar(process.env.GOOGLE_CLIENT_ID);
  const clientSecret = limpar(process.env.GOOGLE_CLIENT_SECRET);
  const redirectUri = limpar(process.env.GOOGLE_REDIRECT_URI);
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function googleAtivo() {
  return !!credenciaisApp();
}

export function googleConectado() {
  return googleAtivo() && !!getConfig(CHAVE_REFRESH_TOKEN);
}

function novoClienteOAuth() {
  const cred = credenciaisApp();
  if (!cred) return null;
  return new google.auth.OAuth2(cred.clientId, cred.clientSecret, cred.redirectUri);
}

export function urlAutorizacao() {
  const client = novoClienteOAuth();
  if (!client) return null;
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // garante que sempre devolve um refresh_token, mesmo em reconexões
    scope: ["https://www.googleapis.com/auth/calendar.events"],
  });
}

export async function concluirAutorizacao(code) {
  const client = novoClienteOAuth();
  if (!client) throw new Error("Google Calendar não está configurado no servidor.");
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "O Google não devolveu um token permanente. Desconecte o acesso da Bella em myaccount.google.com/permissions e tente conectar de novo."
    );
  }
  setConfig(CHAVE_REFRESH_TOKEN, tokens.refresh_token);
}

let clienteAutenticadoCache = null;
async function obterClienteAutenticado() {
  if (!googleConectado()) return null;
  if (!clienteAutenticadoCache) {
    const client = novoClienteOAuth();
    client.setCredentials({ refresh_token: getConfig(CHAVE_REFRESH_TOKEN) });
    clienteAutenticadoCache = client;
  }
  return clienteAutenticadoCache;
}

async function obterCalendarioApi() {
  const auth = await obterClienteAutenticado();
  if (!auth) return null;
  return google.calendar({ version: "v3", auth });
}

function montarEvento({ titulo, descricao, data, hora }) {
  if (hora) {
    const inicio = `${data}T${hora}:00`;
    const [h, m] = hora.split(":").map(Number);
    const fimData = new Date(`${data}T${hora}:00`);
    fimData.setHours(fimData.getHours() + 1);
    const fim = fimData.toISOString().slice(0, 19);
    return {
      summary: titulo,
      description: descricao || undefined,
      start: { dateTime: inicio, timeZone: "America/Bahia" },
      end: { dateTime: fim, timeZone: "America/Bahia" },
    };
  }
  return {
    summary: titulo,
    description: descricao || undefined,
    start: { date: data },
    end: { date: data },
  };
}

// Cria ou atualiza o evento. Retorna o id do evento no Google, ou null se
// desconectado/falhou (nunca lança — é sempre "melhor esforço").
export async function sincronizarEvento({ idExistente, titulo, descricao, data, hora }) {
  if (!data) return null;
  try {
    const calendar = await obterCalendarioApi();
    if (!calendar) return null;
    const corpo = montarEvento({ titulo, descricao, data, hora });
    if (idExistente) {
      const resp = await calendar.events.update({ calendarId: "primary", eventId: idExistente, requestBody: corpo });
      return resp.data.id;
    }
    const resp = await calendar.events.insert({ calendarId: "primary", requestBody: corpo });
    return resp.data.id;
  } catch (erro) {
    console.warn("[calendário Google] não consegui sincronizar:", erro.message);
    return null;
  }
}

export async function apagarEvento(id) {
  if (!id) return;
  try {
    const calendar = await obterCalendarioApi();
    if (!calendar) return;
    await calendar.events.delete({ calendarId: "primary", eventId: id });
  } catch (erro) {
    console.warn("[calendário Google] não consegui apagar evento:", erro.message);
  }
}
