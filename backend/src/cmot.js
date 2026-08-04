// Integração com o CMOT (app da clínica) — permite que a Bella cadastre/atualize
// cirurgias diretamente lá, do mesmo jeito que o Registro Rápido do CMOT faz.
// Login com o e-mail/senha do Dr. Aedo (guardados só no .env do backend da Bella,
// nunca no chat) — o token é renovado sozinho quando expira.
const CMOT_URL = process.env.CMOT_BASE_URL || "https://cmot-app.onrender.com";

let tokenCache = null;
let medicoIdCache = null;

// Mesma limpeza defensiva do ANTHROPIC_API_KEY — painéis como o do Render às
// vezes inserem um caractere fora do ASCII ao colar em campos de variável.
function limpar(valor) {
  return valor?.replace(/[^\x21-\x7E]/g, "").trim();
}

async function login() {
  const email = limpar(process.env.CMOT_EMAIL);
  const senha = limpar(process.env.CMOT_SENHA);
  if (!email || !senha) {
    throw new Error("CMOT_EMAIL/CMOT_SENHA não configurados no .env do backend da Bella.");
  }
  const resp = await fetch(`${CMOT_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, senha }),
  });
  if (!resp.ok) throw new Error("Não consegui entrar no CMOT (confira email/senha configurados).");
  const dados = await resp.json();
  tokenCache = dados.token;
  return dados;
}

// Chama a API do CMOT com o token atual; se der 401 (token expirado), faz login
// de novo automaticamente e tenta uma vez a mais.
async function cmotFetch(caminho, opcoes = {}) {
  if (!tokenCache) await login();
  const fazer = () =>
    fetch(`${CMOT_URL}/api${caminho}`, {
      ...opcoes,
      headers: {
        ...(opcoes.body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${tokenCache}`,
        ...opcoes.headers,
      },
    });
  let resp = await fazer();
  if (resp.status === 401) {
    await login();
    resp = await fazer();
  }
  if (!resp.ok) {
    const corpo = await resp.json().catch(() => ({}));
    throw new Error(corpo.error || `Erro ao falar com o CMOT (${resp.status}).`);
  }
  return resp.status === 204 ? null : resp.json();
}

async function obterMedicoIdPadrao() {
  if (medicoIdCache) return medicoIdCache;
  const usuarios = await cmotFetch("/auth/usuarios");
  const eu = usuarios.find((u) => u.email?.toLowerCase() === process.env.CMOT_EMAIL?.toLowerCase());
  if (!eu) throw new Error("Não achei seu usuário médico no CMOT (confira CMOT_EMAIL).");
  medicoIdCache = eu.id;
  return eu.id;
}

function semAcento(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Mesma lógica de busca do Registro Rápido do CMOT: por CPF, ou nome
// igual/contido/com todas as palavras batendo.
async function buscarOuCriarPaciente({ nome, cpf, nascimento, telefone, email }) {
  if (!nome || !nome.trim()) throw new Error("Nome do paciente é obrigatório para cadastrar no CMOT.");
  const pacientes = await cmotFetch("/pacientes");
  const nomeIA = semAcento(nome);
  const palavrasIA = nomeIA.split(/\s+/).filter((w) => w.length > 2);
  const existente = pacientes.find((p) => {
    if (cpf && p.cpf && p.cpf.replace(/\D/g, "") === String(cpf).replace(/\D/g, "")) return true;
    const reg = semAcento(p.nome);
    if (!reg || !nomeIA) return false; // nunca casar por substring vazia
    return (
      reg === nomeIA ||
      reg.includes(nomeIA) ||
      nomeIA.includes(reg) ||
      (palavrasIA.length >= 2 && palavrasIA.every((w) => reg.includes(w)))
    );
  });
  if (existente) return { paciente: existente, novo: false };
  const novo = await cmotFetch("/pacientes", {
    method: "POST",
    body: JSON.stringify({ nome, cpf: cpf || null, nascimento: nascimento || null, telefone: telefone || null, email: email || null }),
  });
  return { paciente: novo, novo: true };
}

// Mesma lógica do Registro Rápido: procura cirurgia AGENDADA/AUTORIZADA do mesmo
// paciente (hoje ou sem data) para atualizar para REALIZADA; senão cria nova.
async function registrarCirurgia({
  pacienteId,
  medicoId,
  procedimento,
  hospital,
  convenio,
  data,
  tipo,
  observacoes,
}) {
  const hoje = new Date().toISOString().split("T")[0];
  const cirurgias = await cmotFetch("/cirurgias");
  const existente = cirurgias.find((c) => {
    if (c.paciente_id !== pacienteId) return false;
    if (c.status !== "AGENDADA" && c.status !== "AUTORIZADA") return false;
    const dataC = c.data_prevista ? c.data_prevista.split("T")[0] : null;
    return !dataC || dataC === hoje;
  });

  if (existente) {
    const atualizada = await cmotFetch(`/cirurgias/${existente.id}`, {
      method: "PUT",
      body: JSON.stringify({
        ...existente,
        procedimento: procedimento || existente.procedimento,
        hospital: hospital || existente.hospital,
        convenio: convenio || existente.convenio,
        data_prevista: data || existente.data_prevista || hoje,
        observacoes: observacoes
          ? existente.observacoes
            ? `${existente.observacoes}\n\n${observacoes}`
            : observacoes
          : existente.observacoes,
        status: "REALIZADA",
        tipo: tipo || existente.tipo,
      }),
    });
    return { cirurgia: atualizada, atualizada: true };
  }

  const nova = await cmotFetch("/cirurgias", {
    method: "POST",
    body: JSON.stringify({
      paciente_id: pacienteId,
      medico_id: medicoId,
      procedimento,
      hospital,
      convenio: convenio || null,
      data_prevista: data || hoje,
      status: "REALIZADA",
      tipo: tipo || "ELETIVA",
      observacoes: observacoes || null,
    }),
  });
  return { cirurgia: nova, atualizada: false };
}

// Cirurgias do médico (dele) numa data — padrão hoje. Usado tanto pela ferramenta de
// chat quanto pelo lembrete diário automático. Nunca cancelada.
export async function listarCirurgiasDoDia(data) {
  const alvo = data || new Date().toISOString().split("T")[0];
  const medicoId = await obterMedicoIdPadrao();
  const cirurgias = await cmotFetch("/cirurgias");
  return cirurgias
    .filter((c) => c.medico_id === medicoId && c.data_prevista === alvo && c.status !== "CANCELADA")
    .sort((a, b) => (a.horario || "99:99").localeCompare(b.horario || "99:99"))
    .map((c) => ({
      paciente: c.paciente_nome,
      procedimento: c.procedimento,
      hospital: c.hospital,
      horario: c.horario,
      status: c.status,
      tipo: c.tipo,
    }));
}

// Ponto de entrada único usado pela ferramenta da Bella.
export async function cadastrarCirurgiaNoCmot(dados) {
  const medicoId = await obterMedicoIdPadrao();
  const { paciente, novo: pacienteNovo } = await buscarOuCriarPaciente({
    nome: dados.paciente_nome,
    cpf: dados.cpf,
    nascimento: dados.nascimento,
    telefone: dados.telefone,
  });
  const { cirurgia, atualizada } = await registrarCirurgia({
    pacienteId: paciente.id,
    medicoId,
    procedimento: dados.procedimento,
    hospital: dados.hospital,
    convenio: dados.convenio,
    data: dados.data,
    tipo: dados.tipo,
    observacoes: dados.observacoes,
  });
  return { paciente, pacienteNovo, cirurgia, atualizada };
}
