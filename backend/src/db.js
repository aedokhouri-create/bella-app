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
export function listarNotas() {
  return db
    .prepare(
      "SELECT * FROM notas_secretas ORDER BY (categoria IS NULL), categoria COLLATE NOCASE, titulo COLLATE NOCASE"
    )
    .all();
}
export function criarNota({ titulo, conteudo, categoria }) {
  const info = db
    .prepare("INSERT INTO notas_secretas (titulo, conteudo, categoria) VALUES (?, ?, ?)")
    .run(titulo, conteudo || null, categoria || null);
  return db.prepare("SELECT * FROM notas_secretas WHERE id = ?").get(info.lastInsertRowid);
}
export function apagarNota(id) {
  db.prepare("DELETE FROM notas_secretas WHERE id = ?").run(id);
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

export default db;
