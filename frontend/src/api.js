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
