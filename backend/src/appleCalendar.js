// Sincronização automática com o Calendário da Apple (iCloud) via CalDAV.
// Usa um "app-specific password" gerado em appleid.apple.com — nunca a senha normal do Apple ID.
import { DAVClient } from "tsdav";

function limpar(valor) {
  return valor?.replace(/[^\x21-\x7E]/g, "").trim();
}

function credenciais() {
  const usuario = limpar(process.env.APPLE_ID);
  const senha = limpar(process.env.APPLE_APP_PASSWORD);
  if (!usuario || !senha) return null;
  return { usuario, senha };
}

export function appleAtivo() {
  return !!credenciais();
}

let clientePromise = null;
let calendarioAlvo = null;

async function obterCliente() {
  const cred = credenciais();
  if (!cred) return null;
  if (!clientePromise) {
    clientePromise = (async () => {
      const client = new DAVClient({
        serverUrl: "https://caldav.icloud.com",
        credentials: { username: cred.usuario, password: cred.senha },
        authMethod: "Basic",
        defaultAccountType: "caldav",
      });
      await client.login();
      return client;
    })().catch((erro) => {
      clientePromise = null; // permite tentar de novo na próxima chamada
      throw erro;
    });
  }
  return clientePromise;
}

async function obterCalendario(client) {
  if (calendarioAlvo) return calendarioAlvo;
  const calendarios = await client.fetchCalendars();
  const escrivivel = calendarios.find((c) => !c.readOnly) || calendarios[0];
  calendarioAlvo = escrivivel;
  return escrivivel;
}

function montarICS({ uid, titulo, descricao, data, hora }) {
  const agora = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  let dtStart, allDay;
  if (hora) {
    dtStart = `DTSTART:${data.replace(/-/g, "")}T${hora.replace(":", "")}00`;
    allDay = false;
  } else {
    dtStart = `DTSTART;VALUE=DATE:${data.replace(/-/g, "")}`;
    allDay = true;
  }
  const escapar = (t) => String(t || "").replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bella//Assistente//PT",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${agora}`,
    dtStart,
    !allDay && `DURATION:PT1H`,
    `SUMMARY:${escapar(titulo)}`,
    descricao && `DESCRIPTION:${escapar(descricao)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}

// Cria (ou recria) o evento no Calendário da Apple. Retorna { uid, url } ou null se
// a sincronização estiver desativada ou falhar (nunca lança — é sempre "melhor esforço").
export async function sincronizarEvento({ uidExistente, urlExistente, titulo, descricao, data, hora }) {
  if (!data) return null; // sem data não faz sentido criar evento
  try {
    const client = await obterCliente();
    if (!client) return null;
    const calendario = await obterCalendario(client);
    if (!calendario) return null;

    if (urlExistente) {
      await apagarEvento(urlExistente).catch(() => {});
    }

    const uid = uidExistente || `bella-${Date.now()}-${Math.random().toString(36).slice(2)}@bella-app`;
    const filename = `${uid}.ics`;
    const resposta = await client.createCalendarObject({
      calendar: calendario,
      filename,
      iCalString: montarICS({ uid, titulo, descricao, data, hora }),
    });
    if (!resposta.ok) throw new Error(`CalDAV respondeu ${resposta.status}`);
    const url = new URL(filename, calendario.url).toString();
    return { uid, url };
  } catch (erro) {
    console.warn("[calendário Apple] não consegui sincronizar:", erro.message);
    return null;
  }
}

export async function apagarEvento(url) {
  if (!url) return;
  try {
    const client = await obterCliente();
    if (!client) return;
    await client.deleteCalendarObject({ calendarObject: { url } });
  } catch (erro) {
    console.warn("[calendário Apple] não consegui apagar evento:", erro.message);
  }
}
