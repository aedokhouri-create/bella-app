// Cofre pessoal: área secreta protegida por PIN.
// O PIN é guardado com hash (nunca em texto puro). As notas ficam protegidas:
// toda leitura/gravação exige o PIN no cabeçalho "x-cofre-pin".
import { Router } from "express";
import crypto from "node:crypto";
import { getConfig, setConfig, listarNotas, criarNota, apagarNota } from "../db.js";

const router = Router();
const CHAVE_PIN = "cofre_pin";

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(String(pin), salt, 32).toString("hex");
  return salt + ":" + h;
}
function conferePin(pin, armazenado) {
  if (!armazenado) return false;
  const [salt, h] = armazenado.split(":");
  const h2 = crypto.scryptSync(String(pin), salt, 32).toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(h, "hex"), Buffer.from(h2, "hex"));
  } catch {
    return false;
  }
}

// Middleware: exige PIN válido no cabeçalho para acessar as notas.
function exigePin(req, res, next) {
  const pin = req.get("x-cofre-pin");
  if (!conferePin(pin, getConfig(CHAVE_PIN))) {
    return res.status(401).json({ erro: "PIN inválido." });
  }
  next();
}

// O cofre já tem PIN definido?
router.get("/status", (req, res) => {
  res.json({ configurado: !!getConfig(CHAVE_PIN) });
});

// Define o PIN (primeira vez) ou troca (exige o PIN atual).
router.post("/definir", (req, res) => {
  const { pin, pinAtual } = req.body || {};
  if (!pin || String(pin).length < 4) {
    return res.status(400).json({ erro: "O PIN precisa ter pelo menos 4 dígitos." });
  }
  const atual = getConfig(CHAVE_PIN);
  if (atual && !conferePin(pinAtual, atual)) {
    return res.status(401).json({ erro: "PIN atual incorreto." });
  }
  setConfig(CHAVE_PIN, hashPin(pin));
  res.json({ ok: true });
});

// Verifica o PIN (para desbloquear).
router.post("/verificar", (req, res) => {
  const { pin } = req.body || {};
  res.json({ ok: conferePin(pin, getConfig(CHAVE_PIN)) });
});

// Notas (protegidas por PIN).
router.get("/notas", exigePin, (req, res) => res.json(listarNotas()));

router.post("/notas", exigePin, (req, res) => {
  const { titulo } = req.body || {};
  if (!titulo || !titulo.trim()) return res.status(400).json({ erro: "O título é obrigatório." });
  res.status(201).json(criarNota(req.body));
});

router.delete("/notas/:id", exigePin, (req, res) => {
  apagarNota(Number(req.params.id));
  res.status(204).end();
});

export default router;
