// Login da Bella: senha + Face ID (WebAuthn), com sessão num cookie HttpOnly.
//
// Antes não havia login nenhum — qualquer pessoa com o endereço baixava o banco,
// usava o chat (e, por ele, a agenda cirúrgica do CMOT). Agora toda rota /api
// exige a sessão, menos as de login.
//
// A senha é a mesma do CMOT (CMOT_SENHA, que já está configurada no Render para a
// integração) — ou BELLA_SENHA, se você quiser uma senha só da Bella. Sem nenhuma
// das duas, o login fica fechado (nunca aberto).
import { Router } from "express";
import crypto from "node:crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import db, { getConfig, setConfig } from "./db.js";

const COOKIE = "bella_sessao";
const SESSAO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias — o Face ID deixa entrar de novo num toque

db.exec(`
  CREATE TABLE IF NOT EXISTS webauthn_credenciais (
    id TEXT PRIMARY KEY,
    chave_publica TEXT NOT NULL,
    contador INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    aparelho TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Mesma limpeza defensiva do cmot.js — o painel do Render às vezes insere um
// caractere invisível ao colar o valor.
function limpar(valor) {
  return valor?.replace(/[^\x21-\x7E]/g, "").trim();
}

function senhaEsperada() {
  return limpar(process.env.BELLA_SENHA) || limpar(process.env.CMOT_SENHA) || null;
}

// Segredo que assina as sessões. Fica guardado no banco para que reiniciar o
// servidor não derrube o login; "versão" permite sair de todos os aparelhos.
function segredo() {
  let s = getConfig("auth_segredo");
  if (!s) {
    s = crypto.randomBytes(32).toString("hex");
    setConfig("auth_segredo", s);
  }
  return s;
}

function versaoSessao() {
  return getConfig("auth_versao") || "1";
}

function assinar(texto) {
  return crypto.createHmac("sha256", segredo()).update(texto).digest("base64url");
}

function criarSessao() {
  const corpo = Buffer.from(JSON.stringify({ exp: Date.now() + SESSAO_MS, v: versaoSessao() })).toString("base64url");
  return `${corpo}.${assinar(corpo)}`;
}

function sessaoValida(token) {
  if (!token || !token.includes(".")) return false;
  const [corpo, assinatura] = token.split(".");
  const esperada = assinar(corpo);
  if (assinatura.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperada))) {
    return false;
  }
  try {
    const { exp, v } = JSON.parse(Buffer.from(corpo, "base64url").toString());
    return exp > Date.now() && v === versaoSessao();
  } catch {
    return false;
  }
}

function lerCookie(req) {
  const par = (req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${COOKIE}=`));
  return par ? par.slice(COOKIE.length + 1) : null;
}

function ehHttps(req) {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

function gravarCookie(req, res) {
  res.append(
    "Set-Cookie",
    `${COOKIE}=${criarSessao()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSAO_MS / 1000}${ehHttps(req) ? "; Secure" : ""}`
  );
}

function apagarCookie(res) {
  res.append("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function estaLogado(req) {
  return sessaoValida(lerCookie(req));
}

// Protege tudo em /api, menos o próprio login e o health check.
export function exigeLogin(req, res, next) {
  if (estaLogado(req)) return next();
  // O app usa este cabeçalho para voltar à tela de entrada (um 401 do cofre, por
  // exemplo, só quer dizer PIN errado — não pode deslogar).
  res.set("X-Bella-Login", "necessario");
  res.status(401).json({ erro: "Entre na Bella para continuar.", codigo: "LOGIN_NECESSARIO" });
}

// Trava contra tentativa e erro: 5 senhas erradas bloqueiam por 15 minutos.
// É um usuário só, então a contagem é única. O Face ID não passa por esta trava.
const TENTATIVAS_MAX = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;
const falhas = { n: 0, ultima: 0 };

function minutosBloqueado() {
  if (falhas.n < TENTATIVAS_MAX) return 0;
  const resta = falhas.ultima + BLOQUEIO_MS - Date.now();
  if (resta <= 0) {
    falhas.n = 0;
    return 0;
  }
  return Math.ceil(resta / 60000);
}

function registrarFalha() {
  const agora = Date.now();
  if (agora - falhas.ultima > BLOQUEIO_MS) falhas.n = 0;
  falhas.n++;
  falhas.ultima = agora;
}

function senhaConfere(senha) {
  const esperada = senhaEsperada();
  if (!esperada || !senha) return false;
  const a = crypto.createHash("sha256").update(String(senha)).digest();
  const b = crypto.createHash("sha256").update(esperada).digest();
  return crypto.timingSafeEqual(a, b);
}

// Desafios do Face ID: uso único, válidos por 5 minutos.
const DESAFIO_MS = 5 * 60 * 1000;
const desafios = new Map();

function guardarDesafio(chave, desafio) {
  const agora = Date.now();
  desafios.forEach((d, k) => {
    if (d.expira < agora) desafios.delete(k);
  });
  desafios.set(chave, { desafio, expira: agora + DESAFIO_MS });
}

function pegarDesafio(chave) {
  const d = desafios.get(chave);
  desafios.delete(chave);
  return d && d.expira >= Date.now() ? d.desafio : null;
}

// O RP ID é o domínio do app; a origem vem do navegador e precisa bater com ele.
function rp(req) {
  const rpID = process.env.WEBAUTHN_RP_ID || req.hostname;
  const origem = req.get("origin") || "";
  let host = "";
  try {
    host = new URL(origem).hostname;
  } catch {}
  return { rpID, origem, origemValida: host === rpID };
}

const router = Router();

router.get("/status", (req, res) => {
  res.json({ logado: estaLogado(req), senhaConfigurada: !!senhaEsperada() });
});

router.post("/login", (req, res) => {
  if (!senhaEsperada()) {
    return res.status(503).json({ erro: "Senha da Bella não configurada no servidor (CMOT_SENHA ou BELLA_SENHA)." });
  }
  const minutos = minutosBloqueado();
  if (minutos > 0) {
    return res.status(429).json({ erro: `Muitas tentativas erradas. Tente de novo em ${minutos} minuto(s) ou entre com Face ID.` });
  }
  if (!senhaConfere(req.body?.senha)) {
    registrarFalha();
    return res.status(401).json({ erro: "Senha incorreta." });
  }
  falhas.n = 0;
  gravarCookie(req, res);
  res.json({ ok: true });
});

router.post("/sair", (req, res) => {
  apagarCookie(res);
  res.json({ ok: true });
});

// Derruba a sessão em todos os aparelhos (ex.: celular perdido).
router.post("/sair-de-todos", exigeLogin, (req, res) => {
  setConfig("auth_versao", String(Number(versaoSessao()) + 1));
  apagarCookie(res);
  res.json({ ok: true });
});

router.post("/webauthn/registro/opcoes", exigeLogin, async (req, res) => {
  const { rpID } = rp(req);
  const existentes = db.prepare("SELECT id, transports FROM webauthn_credenciais").all();
  const opcoes = await generateRegistrationOptions({
    rpName: "Bella",
    rpID,
    userName: "bella",
    userDisplayName: "Bella",
    userID: Buffer.from("bella-dono"),
    attestationType: "none",
    excludeCredentials: existentes.map((c) => ({ id: c.id, transports: c.transports ? JSON.parse(c.transports) : undefined })),
    authenticatorSelection: { residentKey: "required", userVerification: "required", authenticatorAttachment: "platform" },
  });
  guardarDesafio("registro", opcoes.challenge);
  res.json(opcoes);
});

router.post("/webauthn/registro/verificar", exigeLogin, async (req, res) => {
  const { rpID, origem, origemValida } = rp(req);
  const desafio = pegarDesafio("registro");
  if (!desafio) return res.status(400).json({ erro: "O pedido de Face ID expirou. Tente de novo." });
  if (!origemValida) return res.status(400).json({ erro: "Origem inválida." });
  try {
    const { verified, registrationInfo } = await verifyRegistrationResponse({
      response: req.body.resposta,
      expectedChallenge: desafio,
      expectedOrigin: origem,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
    if (!verified || !registrationInfo) return res.status(400).json({ erro: "Não consegui confirmar o Face ID." });
    const { credential } = registrationInfo;
    db.prepare(
      "INSERT OR REPLACE INTO webauthn_credenciais (id, chave_publica, contador, transports, aparelho) VALUES (?, ?, ?, ?, ?)"
    ).run(
      credential.id,
      Buffer.from(credential.publicKey).toString("base64url"),
      credential.counter,
      JSON.stringify(credential.transports || []),
      String(req.body.aparelho || "").slice(0, 100) || null
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ erro: `Não consegui ativar o Face ID: ${err.message}` });
  }
});

router.post("/webauthn/login/opcoes", async (req, res) => {
  const { rpID } = rp(req);
  const opcoes = await generateAuthenticationOptions({ rpID, userVerification: "required" });
  const desafioId = crypto.randomBytes(16).toString("hex");
  guardarDesafio(`login:${desafioId}`, opcoes.challenge);
  res.json({ desafioId, opcoes });
});

router.post("/webauthn/login/verificar", async (req, res) => {
  const { rpID, origem, origemValida } = rp(req);
  const { desafioId, resposta } = req.body || {};
  const desafio = desafioId ? pegarDesafio(`login:${desafioId}`) : null;
  if (!desafio) return res.status(400).json({ erro: "O pedido de Face ID expirou. Tente de novo." });
  if (!origemValida) return res.status(400).json({ erro: "Origem inválida." });

  const cred = resposta?.id ? db.prepare("SELECT * FROM webauthn_credenciais WHERE id = ?").get(resposta.id) : null;
  if (!cred) {
    return res.status(404).json({ erro: "Face ID não cadastrado neste aparelho. Entre com a senha e ative de novo.", codigo: "SEM_CREDENCIAL" });
  }
  try {
    const { verified, authenticationInfo } = await verifyAuthenticationResponse({
      response: resposta,
      expectedChallenge: desafio,
      expectedOrigin: origem,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: cred.id,
        publicKey: new Uint8Array(Buffer.from(cred.chave_publica, "base64url")),
        counter: cred.contador,
        transports: cred.transports ? JSON.parse(cred.transports) : undefined,
      },
    });
    if (!verified) return res.status(401).json({ erro: "Face ID não confirmado." });
    db.prepare("UPDATE webauthn_credenciais SET contador = ? WHERE id = ?").run(authenticationInfo.newCounter, cred.id);
    gravarCookie(req, res);
    res.json({ ok: true });
  } catch (err) {
    res.status(401).json({ erro: `Face ID não confirmado: ${err.message}` });
  }
});

// Aparelhos com Face ID ativado — para desligar um aparelho perdido.
router.get("/webauthn/credenciais", exigeLogin, (req, res) => {
  res.json(db.prepare("SELECT id, aparelho, criado_em FROM webauthn_credenciais ORDER BY criado_em").all());
});

router.delete("/webauthn/credenciais/:id", exigeLogin, (req, res) => {
  db.prepare("DELETE FROM webauthn_credenciais WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
