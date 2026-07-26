// Criptografia do Cofre (AES-256-GCM).
// A chave nunca é guardada — ela é derivada do PIN toda vez que você o digita
// (scrypt = função lenta de propósito, dificulta tentativa de adivinhar o PIN).
import crypto from "node:crypto";

// Deriva uma chave de 32 bytes a partir do PIN + salt + finalidade ("verify" ou "enc").
// Usar finalidades diferentes garante que a chave de verificação do PIN seja
// diferente da chave usada para criptografar o conteúdo.
export function derivarChave(pin, salt, finalidade) {
  return crypto.scryptSync(String(pin), `${salt}:${finalidade}`, 32);
}

export function criptografar(chave, texto) {
  if (texto == null || texto === "") return texto;
  const iv = crypto.randomBytes(12);
  const cifra = crypto.createCipheriv("aes-256-gcm", chave, iv);
  const enc = Buffer.concat([cifra.update(String(texto), "utf8"), cifra.final()]);
  const tag = cifra.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function estaCriptografado(valor) {
  return typeof valor === "string" && valor.startsWith("v1:");
}

export function descriptografar(chave, valor) {
  if (valor == null || valor === "") return valor;
  if (!estaCriptografado(valor)) return valor; // texto antigo, ainda não criptografado
  const [, ivHex, tagHex, dataHex] = String(valor).split(":");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const dados = Buffer.from(dataHex, "hex");
  const decifra = crypto.createDecipheriv("aes-256-gcm", chave, iv);
  decifra.setAuthTag(tag);
  return Buffer.concat([decifra.update(dados), decifra.final()]).toString("utf8");
}
