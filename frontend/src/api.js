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

export const enviarMensagem = (message, history, imagem) =>
  fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, imagem }),
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

export const cofreListarArquivos = (pin, notaId) =>
  fetch(`/api/cofre/notas/${notaId}/arquivos`, { headers: { "x-cofre-pin": pin } }).then(json);

export const cofreAnexarArquivo = (pin, notaId, arquivo) =>
  fetch(`/api/cofre/notas/${notaId}/arquivos`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-cofre-pin": pin },
    body: JSON.stringify(arquivo),
  }).then(json);

export const cofreBaixarArquivo = (pin, notaId, arquivoId) =>
  fetch(`/api/cofre/notas/${notaId}/arquivos/${arquivoId}/conteudo`, { headers: { "x-cofre-pin": pin } }).then(json);

export const cofreApagarArquivo = (pin, notaId, arquivoId) =>
  fetch(`/api/cofre/notas/${notaId}/arquivos/${arquivoId}`, { method: "DELETE", headers: { "x-cofre-pin": pin } }).then(
    json
  );

/* ---------------- Contatos (para WhatsApp) ---------------- */
export const listarContatos = () => fetch("/api/contatos").then(json);

export const criarContato = (contato) =>
  fetch("/api/contatos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(contato),
  }).then(json);

export const apagarContato = (id) => fetch(`/api/contatos/${id}`, { method: "DELETE" }).then(json);

/* ---------------- Contas a pagar ---------------- */
export const listarContas = () => fetch("/api/contas").then(json);

export const criarConta = (conta) =>
  fetch("/api/contas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(conta),
  }).then(json);

export const atualizarConta = (id, campos) =>
  fetch(`/api/contas/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(campos),
  }).then(json);

export const apagarConta = (id) => fetch(`/api/contas/${id}`, { method: "DELETE" }).then(json);

/* ---------------- Backup ---------------- */
export const backupInfo = () => fetch("/api/backup/info").then(json);
