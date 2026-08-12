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
const PIN_MINIMO = 4;

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
  if (!conferePin(pin, getConfig(CHAVE_PIN))) {
    return res.status(401).json({ erro: "PIN inválido." });
  }
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
    if (!conferePin(pinAtual, atualArmazenado)) {
      return res.status(401).json({ erro: "PIN atual incorreto." });
    }
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
  res.json({ ok: conferePin(pin, getConfig(CHAVE_PIN)) });
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
