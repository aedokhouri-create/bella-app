// Banco de dados SQLite — simples e local.
// A estrutura já está pronta para trocar por Postgres depois (Railway),
// pois todo acesso ao banco passa por estas funções.
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "./data";
fs.mkdirSync(DATA_DIR, { recursive: true });
const dbPath = path.join(DATA_DIR, "nina.db");

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON"); // garante que apagar uma nota também apague seus arquivos

db.exec(`
  CREATE TABLE IF NOT EXISTS tarefas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    descricao TEXT,
    data TEXT,           -- YYYY-MM-DD (ou vazio)
    hora TEXT,           -- HH:MM (ou vazio)
    prioridade TEXT DEFAULT 'media',   -- baixa | media | alta
    categoria TEXT,                    -- trabalho | pessoal | familia | saude ...
    status TEXT DEFAULT 'pendente',    -- pendente | concluida
    criado_em TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS config (
    chave TEXT PRIMARY KEY,
    valor TEXT
  );

  CREATE TABLE IF NOT EXISTS notas_secretas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    conteudo TEXT,
    categoria TEXT,
    criado_em TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contatos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    telefone TEXT NOT NULL,     -- com DDD e código do país, ex: 5571999998888
    conta TEXT NOT NULL,        -- pessoal | profissional
    criado_em TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contas_pagar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    valor REAL,                 -- em reais, ex: 189.90 (pode ficar vazio)
    vencimento TEXT NOT NULL,   -- YYYY-MM-DD
    categoria TEXT,             -- moradia, cartao, saude, imposto...
    status TEXT DEFAULT 'pendente',  -- pendente | pago
    criado_em TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS cofre_arquivos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nota_id INTEGER NOT NULL REFERENCES notas_secretas(id) ON DELETE CASCADE,
    nome_original TEXT,
    tipo_mime TEXT,
    dados TEXT NOT NULL,        -- base64 do arquivo, criptografado (mesma chave da nota)
    criado_em TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS memorias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conteudo TEXT NOT NULL,     -- fato/preferência/contexto que a Bella deve lembrar sempre
    criado_em TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS modelos_documento (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,         -- nome curto pra reconhecer, ex.: "Atestado padrão de afastamento"
    dados TEXT NOT NULL,        -- JSON: {titulo, subtitulo, secoes, fechamento} — mesmo formato do gerar_documento_docx
    criado_em TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS push_inscricoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL UNIQUE,  -- identifica o dispositivo/navegador (iPhone, iPad...)
    dados TEXT NOT NULL,            -- JSON completo da inscrição (endpoint + keys p256dh/auth)
    criado_em TEXT DEFAULT (datetime('now'))
  );
`);

// Migração segura: garante a coluna "categoria" em bancos antigos.
{
  const cols = db.prepare("PRAGMA table_info(notas_secretas)").all().map((c) => c.name);
  if (!cols.includes("categoria")) db.exec("ALTER TABLE notas_secretas ADD COLUMN categoria TEXT");
}

// Migração segura: colunas de sincronização com Calendário da Apple/Google.
for (const tabela of ["tarefas", "contas_pagar"]) {
  const cols = db.prepare(`PRAGMA table_info(${tabela})`).all().map((c) => c.name);
  for (const coluna of ["cal_apple_uid", "cal_apple_url", "cal_google_id"]) {
    if (!cols.includes(coluna)) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} TEXT`);
  }
}

// Migração segura: tarefas recorrentes (ex.: "mensal" — repete todo mês, no mesmo dia).
{
  const cols = db.prepare("PRAGMA table_info(tarefas)").all().map((c) => c.name);
  if (!cols.includes("recorrencia")) db.exec("ALTER TABLE tarefas ADD COLUMN recorrencia TEXT");
}

/* ---------------- Config (chave/valor) ---------------- */
export function getConfig(chave) {
  const row = db.prepare("SELECT valor FROM config WHERE chave = ?").get(chave);
  return row ? row.valor : null;
}
export function setConfig(chave, valor) {
  db.prepare(
    "INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor"
  ).run(chave, valor);
}

/* ---------------- Notas do cofre ---------------- */
// Nota: a ordenação por título acontece depois de descriptografar (na rota),
// já que o título fica criptografado no banco e não pode ser ordenado em SQL.
export function listarNotas() {
  return db
    .prepare("SELECT * FROM notas_secretas ORDER BY (categoria IS NULL), categoria COLLATE NOCASE, id DESC")
    .all();
}
export function criarNota({ titulo, conteudo, categoria }) {
  const info = db
    .prepare("INSERT INTO notas_secretas (titulo, conteudo, categoria) VALUES (?, ?, ?)")
    .run(titulo, conteudo || null, categoria || null);
  return db.prepare("SELECT * FROM notas_secretas WHERE id = ?").get(info.lastInsertRowid);
}
export function atualizarNota(id, campos) {
  const permitidos = ["titulo", "conteudo", "categoria"];
  const sets = [];
  const valores = {};
  for (const c of permitidos) {
    if (c in campos) {
      sets.push(`${c} = @${c}`);
      valores[c] = campos[c];
    }
  }
  if (sets.length === 0) return;
  valores.id = id;
  db.prepare(`UPDATE notas_secretas SET ${sets.join(", ")} WHERE id = @id`).run(valores);
}
export function apagarNota(id) {
  db.prepare("DELETE FROM notas_secretas WHERE id = ?").run(id);
}

/* ---------------- Arquivos anexados às notas do cofre ---------------- */
export function listarArquivosNota(notaId) {
  return db
    .prepare("SELECT id, nota_id, nome_original, tipo_mime, criado_em FROM cofre_arquivos WHERE nota_id = ? ORDER BY id")
    .all(notaId);
}
// Igual à anterior, mas inclui o campo "dados" (criptografado) — só para uso
// interno na troca de PIN (recriptografar), nunca exposto por rota de listagem.
export function listarTodosArquivosComDados() {
  return db.prepare("SELECT * FROM cofre_arquivos").all();
}
export function atualizarDadosArquivo(id, dados) {
  db.prepare("UPDATE cofre_arquivos SET dados = ? WHERE id = ?").run(dados, id);
}
export function criarArquivoNota({ notaId, nomeOriginal, tipoMime, dados }) {
  const info = db
    .prepare("INSERT INTO cofre_arquivos (nota_id, nome_original, tipo_mime, dados) VALUES (?, ?, ?, ?)")
    .run(notaId, nomeOriginal || null, tipoMime || null, dados);
  return db
    .prepare("SELECT id, nota_id, nome_original, tipo_mime, criado_em FROM cofre_arquivos WHERE id = ?")
    .get(info.lastInsertRowid);
}
export function buscarArquivo(id) {
  return db.prepare("SELECT * FROM cofre_arquivos WHERE id = ?").get(id);
}
export function apagarArquivo(id) {
  db.prepare("DELETE FROM cofre_arquivos WHERE id = ?").run(id);
}

/* ---------------- Memória de longo prazo da Bella ---------------- */
export function listarMemorias() {
  return db.prepare("SELECT * FROM memorias ORDER BY id DESC").all();
}
export function criarMemoria(conteudo) {
  const info = db.prepare("INSERT INTO memorias (conteudo) VALUES (?)").run(conteudo);
  return db.prepare("SELECT * FROM memorias WHERE id = ?").get(info.lastInsertRowid);
}
export function apagarMemoria(id) {
  db.prepare("DELETE FROM memorias WHERE id = ?").run(id);
}

/* ---------------- Modelos de documento reutilizáveis ---------------- */
export function listarModelos() {
  return db
    .prepare("SELECT * FROM modelos_documento ORDER BY id DESC")
    .all()
    .map((m) => ({ id: m.id, nome: m.nome, criado_em: m.criado_em, ...JSON.parse(m.dados) }));
}
export function criarModelo({ nome, titulo, subtitulo, secoes, fechamento }) {
  const dados = JSON.stringify({ titulo, subtitulo, secoes, fechamento });
  const info = db.prepare("INSERT INTO modelos_documento (nome, dados) VALUES (?, ?)").run(nome, dados);
  const linha = db.prepare("SELECT * FROM modelos_documento WHERE id = ?").get(info.lastInsertRowid);
  return { id: linha.id, nome: linha.nome, criado_em: linha.criado_em, ...JSON.parse(linha.dados) };
}
export function apagarModelo(id) {
  db.prepare("DELETE FROM modelos_documento WHERE id = ?").run(id);
}

/* ---------------- Inscrições de notificação push ---------------- */
export function listarInscricoesPush() {
  return db.prepare("SELECT * FROM push_inscricoes").all().map((r) => JSON.parse(r.dados));
}
export function salvarInscricaoPush(inscricao) {
  db.prepare(
    `INSERT INTO push_inscricoes (endpoint, dados) VALUES (@endpoint, @dados)
     ON CONFLICT(endpoint) DO UPDATE SET dados = excluded.dados`
  ).run({ endpoint: inscricao.endpoint, dados: JSON.stringify(inscricao) });
}
export function apagarInscricaoPush(endpoint) {
  db.prepare("DELETE FROM push_inscricoes WHERE endpoint = ?").run(endpoint);
}

export function listarTarefas() {
  return db
    .prepare(
      `SELECT * FROM tarefas
       ORDER BY status ASC,
                (data IS NULL OR data = '') ASC,
                data ASC, hora ASC, id DESC`
    )
    .all();
}

export function buscarTarefa(id) {
  return db.prepare("SELECT * FROM tarefas WHERE id = ?").get(id);
}

export function criarTarefa(t) {
  const info = db
    .prepare(
      `INSERT INTO tarefas (titulo, descricao, data, hora, prioridade, categoria, recorrencia)
       VALUES (@titulo, @descricao, @data, @hora, @prioridade, @categoria, @recorrencia)`
    )
    .run({
      titulo: t.titulo,
      descricao: t.descricao || null,
      data: t.data || null,
      hora: t.hora || null,
      prioridade: t.prioridade || "media",
      categoria: t.categoria || null,
      recorrencia: t.recorrencia || null,
    });
  return db.prepare("SELECT * FROM tarefas WHERE id = ?").get(info.lastInsertRowid);
}

export function atualizarTarefa(id, campos) {
  const permitidos = ["titulo", "descricao", "data", "hora", "prioridade", "categoria", "status", "recorrencia"];
  const sets = [];
  const valores = {};
  for (const c of permitidos) {
    if (c in campos) {
      sets.push(`${c} = @${c}`);
      valores[c] = campos[c];
    }
  }
  if (sets.length === 0) return db.prepare("SELECT * FROM tarefas WHERE id = ?").get(id);
  valores.id = id;
  db.prepare(`UPDATE tarefas SET ${sets.join(", ")} WHERE id = @id`).run(valores);
  return db.prepare("SELECT * FROM tarefas WHERE id = ?").get(id);
}

// Empurra a data de uma tarefa recorrente alguns meses pra frente, mantendo o
// mesmo dia (ou o último dia do mês, se o mês novo for mais curto — ex.: dia 31 em fevereiro).
function somarMeses(iso, meses) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const alvo = new Date(Date.UTC(ano, mes - 1 + meses, 1));
  const ultimoDiaDoMes = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(dia, ultimoDiaDoMes));
  return alvo.toISOString().slice(0, 10);
}
function somarDias(iso, dias) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const alvo = new Date(Date.UTC(ano, mes - 1, dia));
  alvo.setUTCDate(alvo.getUTCDate() + dias);
  return alvo.toISOString().slice(0, 10);
}
function proximaOcorrencia(iso, recorrencia) {
  return recorrencia === "semanal" ? somarDias(iso, 7) : somarMeses(iso, 1);
}

// Tarefas recorrentes ('mensal' ou 'semanal') cuja data já passou viram a próxima
// ocorrência (mesmo dia do mês, ou 7 dias depois) e voltam para "pendente" — assim
// elas nunca acumulam cópias antigas na lista nem ficam esquecidas em datas passadas.
// Chamada 1x por dia.
export function avancarTarefasRecorrentes(hojeISO) {
  const candidatas = db
    .prepare("SELECT * FROM tarefas WHERE recorrencia IN ('mensal', 'semanal') AND data IS NOT NULL AND data <> ''")
    .all();
  for (const t of candidatas) {
    let novaData = t.data;
    while (novaData < hojeISO) novaData = proximaOcorrencia(novaData, t.recorrencia);
    if (novaData !== t.data) {
      db.prepare("UPDATE tarefas SET data = ?, status = 'pendente' WHERE id = ?").run(novaData, t.id);
    }
  }
}

// Limpa tarefas concluídas há muito tempo (padrão 30 dias), pra não acumular pra
// sempre nem no banco nem na lista. Usa a data da tarefa; sem data, usa quando foi criada.
export function apagarTarefasConcluidasAntigas(hojeISO, diasLimite = 30) {
  const limite = somarDias(hojeISO, -diasLimite);
  const alvo = db
    .prepare(
      `SELECT id FROM tarefas WHERE status = 'concluida' AND (
         (data IS NOT NULL AND data <> '' AND data < @limite) OR
         ((data IS NULL OR data = '') AND date(criado_em) < @limite)
       )`
    )
    .all({ limite });
  const apagar = db.prepare("DELETE FROM tarefas WHERE id = ?");
  for (const t of alvo) apagar.run(t.id);
  return alvo.length;
}

export function apagarTarefa(id) {
  db.prepare("DELETE FROM tarefas WHERE id = ?").run(id);
}

export function salvarSyncAppleTarefa(id, uid, url) {
  db.prepare("UPDATE tarefas SET cal_apple_uid = ?, cal_apple_url = ? WHERE id = ?").run(uid, url, id);
}

export function salvarSyncGoogleTarefa(id, googleId) {
  db.prepare("UPDATE tarefas SET cal_google_id = ? WHERE id = ?").run(googleId, id);
}

/* ---------------- Contatos (para enviar WhatsApp) ---------------- */
export function listarContatos() {
  return db.prepare("SELECT * FROM contatos ORDER BY nome COLLATE NOCASE").all();
}
export function criarContato({ nome, telefone, conta }) {
  const info = db
    .prepare("INSERT INTO contatos (nome, telefone, conta) VALUES (?, ?, ?)")
    .run(nome, String(telefone).replace(/\D/g, ""), conta);
  return db.prepare("SELECT * FROM contatos WHERE id = ?").get(info.lastInsertRowid);
}
export function apagarContato(id) {
  db.prepare("DELETE FROM contatos WHERE id = ?").run(id);
}

function semAcento(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Busca por nome (ignora acentos/maiúsculas) e, se informado, filtra por conta.
export function buscarContatos(nome, conta) {
  const alvo = semAcento(nome);
  return listarContatos().filter((c) => {
    const bate = semAcento(c.nome).includes(alvo) || alvo.includes(semAcento(c.nome));
    return bate && (!conta || c.conta === conta);
  });
}

/* ---------------- Contas a pagar ---------------- */
export function listarContas() {
  return db
    .prepare(`SELECT * FROM contas_pagar ORDER BY status ASC, vencimento ASC, id DESC`)
    .all();
}
export function buscarConta(id) {
  return db.prepare("SELECT * FROM contas_pagar WHERE id = ?").get(id);
}

export function criarConta(c) {
  const info = db
    .prepare(
      `INSERT INTO contas_pagar (titulo, valor, vencimento, categoria)
       VALUES (@titulo, @valor, @vencimento, @categoria)`
    )
    .run({
      titulo: c.titulo,
      valor: c.valor != null && c.valor !== "" ? Number(c.valor) : null,
      vencimento: c.vencimento,
      categoria: c.categoria || null,
    });
  return db.prepare("SELECT * FROM contas_pagar WHERE id = ?").get(info.lastInsertRowid);
}
export function atualizarConta(id, campos) {
  const permitidos = ["titulo", "valor", "vencimento", "categoria", "status"];
  const sets = [];
  const valores = {};
  for (const c of permitidos) {
    if (c in campos) {
      sets.push(`${c} = @${c}`);
      valores[c] = campos[c];
    }
  }
  if (sets.length === 0) return db.prepare("SELECT * FROM contas_pagar WHERE id = ?").get(id);
  valores.id = id;
  db.prepare(`UPDATE contas_pagar SET ${sets.join(", ")} WHERE id = @id`).run(valores);
  return db.prepare("SELECT * FROM contas_pagar WHERE id = ?").get(id);
}
export function apagarConta(id) {
  db.prepare("DELETE FROM contas_pagar WHERE id = ?").run(id);
}

export function salvarSyncAppleConta(id, uid, url) {
  db.prepare("UPDATE contas_pagar SET cal_apple_uid = ?, cal_apple_url = ? WHERE id = ?").run(uid, url, id);
}

export function salvarSyncGoogleConta(id, googleId) {
  db.prepare("UPDATE contas_pagar SET cal_google_id = ? WHERE id = ?").run(googleId, id);
}

export default db;
