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
`);

// Migração segura: garante a coluna "categoria" em bancos antigos.
{
  const cols = db.prepare("PRAGMA table_info(notas_secretas)").all().map((c) => c.name);
  if (!cols.includes("categoria")) db.exec("ALTER TABLE notas_secretas ADD COLUMN categoria TEXT");
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

export function criarTarefa(t) {
  const info = db
    .prepare(
      `INSERT INTO tarefas (titulo, descricao, data, hora, prioridade, categoria)
       VALUES (@titulo, @descricao, @data, @hora, @prioridade, @categoria)`
    )
    .run({
      titulo: t.titulo,
      descricao: t.descricao || null,
      data: t.data || null,
      hora: t.hora || null,
      prioridade: t.prioridade || "media",
      categoria: t.categoria || null,
    });
  return db.prepare("SELECT * FROM tarefas WHERE id = ?").get(info.lastInsertRowid);
}

export function atualizarTarefa(id, campos) {
  const permitidos = ["titulo", "descricao", "data", "hora", "prioridade", "categoria", "status"];
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

export function apagarTarefa(id) {
  db.prepare("DELETE FROM tarefas WHERE id = ?").run(id);
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

export default db;
