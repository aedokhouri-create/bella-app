// Cofre pessoal: área secreta protegida por PIN, com criptografia de verdade.
//
// Como funciona a segurança:
// - O PIN nunca é guardado em texto puro — só um hash (scrypt) para conferir.
// - O conteúdo das notas (título + senha/detalhes) é criptografado (AES-256-GCM)
//   com uma chave derivada do seu PIN. Sem o PIN certo, ninguém lê nada — nem
//   olhando direto no arquivo do banco de dados.
// - Se você trocar o PIN, todas as notas são descriptografadas com o PIN antigo
//   e recriptografadas com o novo, na hora, sem perder nada.
import { Router } from "express";
import crypto from "node:crypto";
import {
  getConfig,
  setConfig,
  listarNotas,
  criarNota,
  atualizarNota,
  apagarNota,
  listarArquivosNota,
  criarArquivoNota,
  buscarArquivo,
  apagarArquivo,
  listarTodosArquivosComDados,
  atualizarDadosArquivo,
} from "../db.js";
import { derivarChave, criptografar, descriptografar, estaCriptografado } from "../crypto.js";

const router = Router();
const CHAVE_PIN = "cofre_pin";
// PINs novos (ou trocados) precisam de 6 dígitos; um PIN antigo de 4 continua
// abrindo até ser trocado.
const PIN_MINIMO = 6;

// Trava contra tentativa e erro: 5 PINs errados bloqueiam o cofre por 15 minutos.
// Sem isso, um PIN de 4 dígitos (10 mil combinações) caía em poucos minutos.
const TENTATIVAS_MAX = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;
const falhasPin = { n: 0, ultima: 0 };

function minutosBloqueado() {
  if (falhasPin.n < TENTATIVAS_MAX) return 0;
  const resta = falhasPin.ultima + BLOQUEIO_MS - Date.now();
  if (resta <= 0) {
    falhasPin.n = 0;
    return 0;
  }
  return Math.ceil(resta / 60000);
}

// Confere o PIN contando os erros. Devolve null se der certo, ou a resposta de erro.
function checarPin(pin) {
  const minutos = minutosBloqueado();
  if (minutos > 0) {
    return { status: 429, erro: `Muitos PINs errados. O cofre abre de novo em ${minutos} minuto(s).` };
  }
  if (conferePin(pin, getConfig(CHAVE_PIN))) {
    falhasPin.n = 0;
    return null;
  }
  const agora = Date.now();
  if (agora - falhasPin.ultima > BLOQUEIO_MS) falhasPin.n = 0;
  falhasPin.n++;
  falhasPin.ultima = agora;
  return { status: 401, erro: "PIN inválido." };
}

function hashVerificacao(pin, salt) {
  return crypto.scryptSync(String(pin), `${salt}:verify`, 32).toString("hex");
}
function conferePin(pin, armazenado) {
  if (!armazenado || !pin) return false;
  const [salt, h] = armazenado.split(":");
  const h2 = hashVerificacao(pin, salt);
  try {
    return crypto.timingSafeEqual(Buffer.from(h, "hex"), Buffer.from(h2, "hex"));
  } catch {
    return false;
  }
}
function saltArmazenado(armazenado) {
  return armazenado.split(":")[0];
}
function chaveAtual(pin) {
  const armazenado = getConfig(CHAVE_PIN);
  const salt = saltArmazenado(armazenado);
  return derivarChave(pin, salt, "enc");
}

// Middleware: exige PIN válido no cabeçalho para acessar as notas.
function exigePin(req, res, next) {
  const pin = req.get("x-cofre-pin");
  const falha = checarPin(pin);
  if (falha) return res.status(falha.status).json({ erro: falha.erro });
  req.cofrePin = pin;
  next();
}

// O cofre já tem PIN definido?
router.get("/status", (req, res) => {
  res.json({ configurado: !!getConfig(CHAVE_PIN) });
});

// Define o PIN (primeira vez) ou troca (exige o PIN atual).
// Em ambos os casos, garante que as notas fiquem criptografadas com a chave certa.
router.post("/definir", (req, res) => {
  const { pin, pinAtual } = req.body || {};
  if (!pin || String(pin).length < PIN_MINIMO) {
    return res.status(400).json({ erro: `O PIN precisa ter pelo menos ${PIN_MINIMO} dígitos.` });
  }
  const atualArmazenado = getConfig(CHAVE_PIN);

  if (atualArmazenado) {
    // Troca de PIN: precisa confirmar o atual, e recriptografar tudo com o novo.
    const falha = checarPin(pinAtual);
    if (falha) return res.status(falha.status).json({ erro: falha.status === 401 ? "PIN atual incorreto." : falha.erro });
    const chaveAntiga = chaveAtual(pinAtual);
    const novoSalt = crypto.randomBytes(16).toString("hex");
    const chaveNova = derivarChave(pin, novoSalt, "enc");

    for (const n of listarNotas()) {
      const tituloClaro = estaCriptografado(n.titulo) ? descriptografar(chaveAntiga, n.titulo) : n.titulo;
      const conteudoClaro = estaCriptografado(n.conteudo) ? descriptografar(chaveAntiga, n.conteudo) : n.conteudo;
      atualizarNota(n.id, {
        titulo: criptografar(chaveNova, tituloClaro),
        conteudo: criptografar(chaveNova, conteudoClaro),
      });
    }
    for (const a of listarTodosArquivosComDados()) {
      const dadosClaros = estaCriptografado(a.dados) ? descriptografar(chaveAntiga, a.dados) : a.dados;
      atualizarDadosArquivo(a.id, criptografar(chaveNova, dadosClaros));
    }
    setConfig(CHAVE_PIN, `${novoSalt}:${hashVerificacao(pin, novoSalt)}`);
  } else {
    // Primeira vez: cria o PIN e criptografa qualquer nota que já exista
    // (por exemplo, as que foram importadas antes de você definir um PIN).
    const novoSalt = crypto.randomBytes(16).toString("hex");
    const chaveNova = derivarChave(pin, novoSalt, "enc");

    for (const n of listarNotas()) {
      if (!estaCriptografado(n.titulo) || !estaCriptografado(n.conteudo)) {
        atualizarNota(n.id, {
          titulo: estaCriptografado(n.titulo) ? n.titulo : criptografar(chaveNova, n.titulo),
          conteudo: estaCriptografado(n.conteudo) ? n.conteudo : criptografar(chaveNova, n.conteudo),
        });
      }
    }
    setConfig(CHAVE_PIN, `${novoSalt}:${hashVerificacao(pin, novoSalt)}`);
  }
  res.json({ ok: true });
});

// Verifica o PIN (para desbloquear).
router.post("/verificar", (req, res) => {
  const { pin } = req.body || {};
  const falha = checarPin(pin);
  if (falha?.status === 429) return res.status(429).json({ erro: falha.erro });
  res.json({ ok: !falha });
});

// Notas (protegidas por PIN e criptografadas em repouso).
router.get("/notas", exigePin, (req, res) => {
  const chave = chaveAtual(req.cofrePin);
  const notas = listarNotas().map((n) => ({
    ...n,
    titulo: descriptografar(chave, n.titulo),
    conteudo: descriptografar(chave, n.conteudo),
  }));
  notas.sort((a, b) => {
    const ca = a.categoria || "";
    const cb = b.categoria || "";
    if (ca !== cb) return ca.localeCompare(cb, "pt-BR");
    return (a.titulo || "").localeCompare(b.titulo || "", "pt-BR");
  });
  res.json(notas);
});

router.post("/notas", exigePin, (req, res) => {
  const { titulo, conteudo, categoria } = req.body || {};
  if (!titulo || !titulo.trim()) return res.status(400).json({ erro: "O título é obrigatório." });
  const chave = chaveAtual(req.cofrePin);
  const nota = criarNota({
    titulo: criptografar(chave, titulo),
    conteudo: criptografar(chave, conteudo),
    categoria: categoria || null,
  });
  res.status(201).json({ ...nota, titulo, conteudo: conteudo || null });
});

router.put("/notas/:id", exigePin, (req, res) => {
  const { titulo, conteudo, categoria } = req.body || {};
  if (!titulo || !titulo.trim()) return res.status(400).json({ erro: "O título é obrigatório." });
  const chave = chaveAtual(req.cofrePin);
  atualizarNota(Number(req.params.id), {
    titulo: criptografar(chave, titulo),
    conteudo: criptografar(chave, conteudo),
    categoria: categoria || null,
  });
  res.json({ id: Number(req.params.id), titulo, conteudo: conteudo || null, categoria: categoria || null });
});

router.delete("/notas/:id", exigePin, (req, res) => {
  apagarNota(Number(req.params.id));
  res.status(204).end();
});

// Arquivos anexados a uma nota (fotos de apólice, documentos etc.) — mesma
// criptografia das senhas, sem PIN certo ninguém abre.
router.get("/notas/:id/arquivos", exigePin, (req, res) => {
  res.json(listarArquivosNota(Number(req.params.id)));
});

router.post("/notas/:id/arquivos", exigePin, (req, res) => {
  const { nomeOriginal, tipoMime, base64 } = req.body || {};
  if (!base64) return res.status(400).json({ erro: "Arquivo vazio." });
  const chave = chaveAtual(req.cofrePin);
  const arquivo = criarArquivoNota({
    notaId: Number(req.params.id),
    nomeOriginal,
    tipoMime,
    dados: criptografar(chave, base64),
  });
  res.status(201).json(arquivo);
});

router.get("/notas/:id/arquivos/:arquivoId/conteudo", exigePin, (req, res) => {
  const arquivo = buscarArquivo(Number(req.params.arquivoId));
  if (!arquivo || arquivo.nota_id !== Number(req.params.id)) {
    return res.status(404).json({ erro: "Arquivo não encontrado." });
  }
  const chave = chaveAtual(req.cofrePin);
  res.json({
    nomeOriginal: arquivo.nome_original,
    tipoMime: arquivo.tipo_mime,
    base64: descriptografar(chave, arquivo.dados),
  });
});

router.delete("/notas/:id/arquivos/:arquivoId", exigePin, (req, res) => {
  apagarArquivo(Number(req.params.arquivoId));
  res.status(204).end();
});

export default router;
