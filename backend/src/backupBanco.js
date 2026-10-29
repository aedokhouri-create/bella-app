// Cópias do banco da Bella: uma cópia íntegra para baixar/enviar por e-mail, e um
// backup diário no Backblaze (a mesma conta que o CMOT já usa).
//
// A cópia sai pela API de backup do SQLite, não copiando o arquivo direto: o banco
// roda em modo WAL, e o arquivo sozinho pode não ter as últimas alterações.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import db, { getConfig, setConfig } from "./db.js";

const FUSO = "America/Bahia";
const DIAS_MANTIDOS = 30;

export async function gerarCopiaDoBanco() {
  const destino = path.join(os.tmpdir(), `bella-copia-${Date.now()}.db`);
  await db.backup(destino);
  return destino;
}

export function apagarCopia(caminho) {
  fs.unlink(caminho, () => {});
}

// Backblaze B2 (compatível com S3). Liga sozinho quando as quatro variáveis
// existem no Render — podem ser as mesmas do CMOT.
export function nuvemAtiva() {
  return !!(process.env.B2_ENDPOINT && process.env.B2_KEY_ID && process.env.B2_APP_KEY && process.env.B2_BUCKET);
}

let cliente = null;
function s3() {
  if (!cliente) {
    cliente = new S3Client({
      region: "us-east-005",
      endpoint: `https://${process.env.B2_ENDPOINT}`,
      credentials: { accessKeyId: process.env.B2_KEY_ID, secretAccessKey: process.env.B2_APP_KEY },
      forcePathStyle: true,
    });
  }
  return cliente;
}

function dataLocal(data) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(data);
}

// Pasta própria da Bella no bucket — não mistura com os backups do CMOT.
function chaveDoDia(data) {
  return `bella/backups/bella-${dataLocal(data)}.db`;
}

// Total de registros: se o banco subir vazio ou muito menor (disco /data não
// montado), o backup se recusa a substituir a cópia boa do dia.
function contarRegistros() {
  const tabelas = ["tarefas", "contas_pagar", "contatos", "notas_secretas", "memorias"];
  return tabelas.reduce((total, t) => {
    try {
      return total + db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
    } catch {
      return total;
    }
  }, 0);
}

export async function backupParaNuvem() {
  if (!nuvemAtiva()) return { ok: false, erro: "Backblaze não configurado" };

  const atual = contarRegistros();
  const anterior = Number(getConfig("backup_nuvem_registros") || 0);
  if (anterior && atual < anterior * 0.5) {
    const msg = `Banco com ${atual} registros, contra ${anterior} no último backup bom. Backup NÃO enviado para não substituir a cópia boa — confira o disco /data.`;
    console.error("[backup nuvem]", msg);
    setConfig("backup_nuvem_erro", `${new Date().toISOString()} — ${msg}`);
    return { ok: false, erro: msg };
  }

  let copia;
  try {
    copia = await gerarCopiaDoBanco();
    const chave = chaveDoDia(new Date());
    await s3().send(
      new PutObjectCommand({
        Bucket: process.env.B2_BUCKET,
        Key: chave,
        Body: fs.readFileSync(copia),
        ContentType: "application/x-sqlite3",
      })
    );
    setConfig("backup_nuvem_ultimo", new Date().toISOString());
    setConfig("backup_nuvem_registros", String(atual));
    console.log(`[backup nuvem] Banco enviado ao Backblaze: ${chave}`);

    const antiga = new Date();
    antiga.setDate(antiga.getDate() - DIAS_MANTIDOS);
    await s3()
      .send(new DeleteObjectCommand({ Bucket: process.env.B2_BUCKET, Key: chaveDoDia(antiga) }))
      .catch(() => {});
    return { ok: true, chave };
  } catch (err) {
    console.error("[backup nuvem] Falhou:", err.message);
    setConfig("backup_nuvem_erro", `${new Date().toISOString()} — ${err.message}`);
    return { ok: false, erro: err.message };
  } finally {
    if (copia) apagarCopia(copia);
  }
}

export function estadoBackupNuvem() {
  return {
    nuvemAtiva: nuvemAtiva(),
    ultimoBackupNuvem: getConfig("backup_nuvem_ultimo"),
    erroBackupNuvem: getConfig("backup_nuvem_erro"),
  };
}
