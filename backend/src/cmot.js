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

// Tira acento, baixa a caixa e junta espaços duplicados/nas bordas — sem isso,
// "João" != "Joao" e " Nome" != "Nome" viram pacientes duplicados por engano.
// Compara dois procedimentos pelas palavras em comum — evita sobrescrever um pedido
// diferente do mesmo paciente (ex.: segundo tempo cirúrgico) só porque bateu paciente + data.
function procedimentosParecidos(a, b) {
  const palavras = (s) =>
    new Set(
      semAcento(s)
        .replace(/[^\p{L}\p{N} .-]/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3)
    );
  const pa = palavras(a || "");
  const pb = palavras(b || "");
  if (pa.size === 0 || pb.size === 0) return false;
  let comuns = 0;
  pa.forEach((w) => {
    if (pb.has(w)) comuns++;
  });
  return comuns / Math.min(pa.size, pb.size) >= 0.4;
}

function semAcento(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Distância de edição (Levenshtein) — só usada entre nomes já de tamanho parecido,
// pra tolerar 1-2 letras trocadas (erro de digitação/OCR) sem juntar pessoas diferentes.
function distanciaEdicao(a, b) {
  const m = a.length,
    n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// Mesma lógica de busca do Registro Rápido do CMOT: por CPF, nome igual/contido/com
// todas as palavras batendo, ou nome bem parecido (tolera erro de digitação/OCR).
async function buscarOuCriarPaciente({ nome, cpf, nascimento, telefone, email }) {
  if (!nome || !nome.trim()) throw new Error("Nome do paciente é obrigatório para cadastrar no CMOT.");
  const pacientes = await cmotFetch("/pacientes");
  const nomeIA = semAcento(nome);
  const palavrasIA = nomeIA.split(" ").filter((w) => w.length > 2);
  const existente = pacientes.find((p) => {
    if (cpf && p.cpf && p.cpf.replace(/\D/g, "") === String(cpf).replace(/\D/g, "")) return true;
    const reg = semAcento(p.nome);
    if (!reg || !nomeIA) return false; // nunca casar por substring vazia
    if (reg === nomeIA || reg.includes(nomeIA) || nomeIA.includes(reg)) return true;
    if (palavrasIA.length >= 2 && palavrasIA.every((w) => reg.includes(w))) return true;
    if (Math.abs(reg.length - nomeIA.length) <= 3 && distanciaEdicao(reg, nomeIA) <= 2) return true;
    return false;
  });
  if (existente) return { paciente: existente, novo: false };
  const novo = await cmotFetch("/pacientes", {
    method: "POST",
    body: JSON.stringify({ nome, cpf: cpf || null, nascimento: nascimento || null, telefone: telefone || null, email: email || null }),
  });
  return { paciente: novo, novo: true };
}

// Procura o pedido aberto (ou a cirurgia já realizada no mesmo dia) do paciente com
// procedimento parecido, para atualizar para REALIZADA; senão cria nova.
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
  const alvo = String(data || hoje).slice(0, 10);
  const cirurgias = await cmotFetch("/cirurgias");
  // Pedido aberto (pendente, autorizada ou agendada): a data planejada raramente é o
  // dia em que a cirurgia acontece — vale até 120 dias de diferença. Cirurgia já
  // REALIZADA só é a mesma se for do mesmo dia (registro repetido). Mesma regra do
  // Registro Rápido do CMOT.
  const diasAte = (d) => Math.abs(new Date(d.slice(0, 10)) - new Date(alvo)) / 86400000;
  const existente = cirurgias
    .filter((c) => {
      if (c.paciente_id !== pacienteId) return false;
      if (c.status === "CANCELADA") return false;
      const dataC = c.data_prevista ? c.data_prevista.split("T")[0] : null;
      if (c.status === "REALIZADA") {
        if (dataC !== alvo) return false;
      } else if (dataC && diasAte(dataC) > 120) return false;
      // Mesmo paciente pode ter mais de um pedido ativo (ex.: segundo tempo cirúrgico) —
      // só trata como a mesma cirurgia se o procedimento também bater.
      return procedimentosParecidos(c.procedimento, procedimento);
    })
    // Preferência: pedido aberto, do mesmo médico, com a data mais próxima.
    .sort((a, b) => {
      const peso = (c) => (c.status === "REALIZADA" ? 2 : 0) + (c.medico_id === medicoId ? 0 : 1);
      if (peso(a) !== peso(b)) return peso(a) - peso(b);
      return diasAte(a.data_prevista || alvo) - diasAte(b.data_prevista || alvo);
    })[0];

  if (existente) {
    const atualizada = await cmotFetch(`/cirurgias/${existente.id}`, {
      method: "PUT",
      body: JSON.stringify({
        ...existente,
        medico_id: medicoId,
        procedimento: procedimento || existente.procedimento,
        hospital: hospital || existente.hospital,
        convenio: convenio || existente.convenio,
        data_prevista: alvo,
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
