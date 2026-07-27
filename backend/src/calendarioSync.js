// Ponte entre tarefas/contas do banco e os calendários externos (Apple por enquanto).
// Sempre "melhor esforço": nunca atrasa nem quebra a resposta da API se a sincronização falhar.
import { salvarSyncAppleTarefa, salvarSyncAppleConta } from "./db.js";
import { sincronizarEvento, apagarEvento } from "./appleCalendar.js";

export function sincronizarTarefaApple(tarefa) {
  if (!tarefa) return;
  if (!tarefa.data) {
    if (tarefa.cal_apple_url) removerTarefaApple(tarefa);
    return;
  }
  sincronizarEvento({
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
  if (tarefa?.cal_apple_url) apagarEvento(tarefa.cal_apple_url);
}

export function sincronizarContaApple(conta) {
  if (!conta) return;
  if (!conta.vencimento) {
    if (conta.cal_apple_url) removerContaApple(conta);
    return;
  }
  const valorTexto = conta.valor != null ? ` — R$ ${Number(conta.valor).toFixed(2)}` : "";
  sincronizarEvento({
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
  if (conta?.cal_apple_url) apagarEvento(conta.cal_apple_url);
}
