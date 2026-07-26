// Chamadas ao backend.
async function json(res) {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).erro || "Erro na requisição");
  return res.status === 204 ? null : res.json();
}

export const listarTarefas = () => fetch("/api/tarefas").then(json);

export const criarTarefa = (tarefa) =>
  fetch("/api/tarefas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tarefa),
  }).then(json);

export const atualizarTarefa = (id, campos) =>
  fetch(`/api/tarefas/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(campos),
  }).then(json);

export const apagarTarefa = (id) => fetch(`/api/tarefas/${id}`, { method: "DELETE" }).then(json);

export const enviarMensagem = (message, history) =>
  fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  }).then(json);

/* ---------------- Cofre (área secreta) ---------------- */
export const cofreStatus = () => fetch("/api/cofre/status").then(json);

export const cofreDefinir = (pin, pinAtual) =>
  fetch("/api/cofre/definir", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin, pinAtual }),
  }).then(json);

export const cofreVerificar = (pin) =>
  fetch("/api/cofre/verificar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin }),
  }).then(json);

export const cofreListarNotas = (pin) =>
  fetch("/api/cofre/notas", { headers: { "x-cofre-pin": pin } }).then(json);

export const cofreCriarNota = (pin, nota) =>
  fetch("/api/cofre/notas", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-cofre-pin": pin },
    body: JSON.stringify(nota),
  }).then(json);

export const cofreApagarNota = (pin, id) =>
  fetch(`/api/cofre/notas/${id}`, { method: "DELETE", headers: { "x-cofre-pin": pin } }).then(json);
