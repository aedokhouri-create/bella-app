// Ponte entre tarefas/contas do banco e os calendários externos (Apple + Google).
// Sempre "melhor esforço": nunca atrasa nem quebra a resposta da API se a sincronização falhar.
import {
  salvarSyncAppleTarefa,
  salvarSyncAppleConta,
  salvarSyncGoogleTarefa,
  salvarSyncGoogleConta,
} from "./db.js";
import { sincronizarEvento as sincronizarEventoApple, apagarEvento as apagarEventoApple } from "./appleCalendar.js";
import { sincronizarEvento as sincronizarEventoGoogle, apagarEvento as apagarEventoGoogle } from "./googleCalendar.js";

export function sincronizarTarefaApple(tarefa) {
  if (!tarefa) return;
  if (!tarefa.data) {
    if (tarefa.cal_apple_url) removerTarefaApple(tarefa);
    return;
  }
  sincronizarEventoApple({
    uidExistente: tarefa.cal_apple_uid,
    urlExistente: tarefa.cal_apple_url,
    titulo: tarefa.titulo,
    descricao: tarefa.descricao,
    data: tarefa.data,
    hora: tarefa.hora,
  }).then((res) => {
    if (res) salvarSyncAppleTarefa(tarefa.id, res.uid, res.url);
  });
}

export function removerTarefaApple(tarefa) {
  if (tarefa?.cal_apple_url) apagarEventoApple(tarefa.cal_apple_url);
}

export function sincronizarContaApple(conta) {
  if (!conta) return;
  if (!conta.vencimento) {
    if (conta.cal_apple_url) removerContaApple(conta);
    return;
  }
  const valorTexto = conta.valor != null ? ` — R$ ${Number(conta.valor).toFixed(2)}` : "";
  sincronizarEventoApple({
    uidExistente: conta.cal_apple_uid,
    urlExistente: conta.cal_apple_url,
    titulo: `💰 ${conta.titulo}${valorTexto}`,
    descricao: "Conta a pagar (Bella)",
    data: conta.vencimento,
    hora: null,
  }).then((res) => {
    if (res) salvarSyncAppleConta(conta.id, res.uid, res.url);
  });
}

export function removerContaApple(conta) {
  if (conta?.cal_apple_url) apagarEventoApple(conta.cal_apple_url);
}

export function sincronizarTarefaGoogle(tarefa) {
  if (!tarefa) return;
  if (!tarefa.data) {
    if (tarefa.cal_google_id) removerTarefaGoogle(tarefa);
    return;
  }
  sincronizarEventoGoogle({
    idExistente: tarefa.cal_google_id,
    titulo: tarefa.titulo,
    descricao: tarefa.descricao,
    data: tarefa.data,
    hora: tarefa.hora,
  }).then((id) => {
    if (id) salvarSyncGoogleTarefa(tarefa.id, id);
  });
}

export function removerTarefaGoogle(tarefa) {
  if (tarefa?.cal_google_id) apagarEventoGoogle(tarefa.cal_google_id);
}

export function sincronizarContaGoogle(conta) {
  if (!conta) return;
  if (!conta.vencimento) {
    if (conta.cal_google_id) removerContaGoogle(conta);
    return;
  }
  const valorTexto = conta.valor != null ? ` — R$ ${Number(conta.valor).toFixed(2)}` : "";
  sincronizarEventoGoogle({
    idExistente: conta.cal_google_id,
    titulo: `💰 ${conta.titulo}${valorTexto}`,
    descricao: "Conta a pagar (Bella)",
    data: conta.vencimento,
    hora: null,
  }).then((id) => {
    if (id) salvarSyncGoogleConta(conta.id, id);
  });
}

export function removerContaGoogle(conta) {
  if (conta?.cal_google_id) apagarEventoGoogle(conta.cal_google_id);
}
