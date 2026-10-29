// Tela de entrada da Bella: senha (a mesma do CMOT) ou Face ID.
import { useEffect, useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { APP_NAME } from "./config.js";

// Marcas guardadas no aparelho: Face ID ativado aqui, ou recusado (pergunta de novo em 30 dias).
const FACEID_ATIVO = "bella_faceid_ativo";
const FACEID_RECUSADO_EM = "bella_faceid_recusado_em";

function lerLocal(chave) {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}

function gravarLocal(chave, valor) {
  try {
    if (valor === null) localStorage.removeItem(chave);
    else localStorage.setItem(chave, valor);
  } catch {}
}

async function postar(url, corpo) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo || {}),
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) {
    const erro = new Error(dados.erro || "Erro na requisição");
    erro.codigo = dados.codigo;
    throw erro;
  }
  return dados;
}

function nomeDoAparelho() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Android/.test(ua)) return "Android";
  return "Navegador";
}

async function aparelhoTemFaceId() {
  try {
    return !!window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

function deveOferecerFaceId() {
  if (lerLocal(FACEID_ATIVO)) return false;
  return Date.now() - Number(lerLocal(FACEID_RECUSADO_EM) || 0) > 30 * 24 * 60 * 60 * 1000;
}

export default function Entrada({ aoEntrar }) {
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  // Desafios buscados antes do toque — o Safari do iPhone recusa o Face ID se
  // houver uma espera de rede entre o toque no botão e o pedido.
  const [desafioLogin, setDesafioLogin] = useState(null);
  const [opcoesRegistro, setOpcoesRegistro] = useState(null);
  const [oferta, setOferta] = useState(false);
  const faceIdAtivo = !!lerLocal(FACEID_ATIVO);

  function carregarDesafio() {
    postar("/api/auth/webauthn/login/opcoes").then(setDesafioLogin).catch(() => setDesafioLogin(null));
  }

  useEffect(() => {
    if (faceIdAtivo) carregarDesafio();
  }, []);

  async function entrarComSenha(e) {
    e.preventDefault();
    setErro("");
    setOcupado(true);
    try {
      await postar("/api/auth/login", { senha });
    } catch (err) {
      setErro(err.message);
      setOcupado(false);
      return;
    }
    try {
      if (deveOferecerFaceId() && (await aparelhoTemFaceId())) {
        setOpcoesRegistro(await postar("/api/auth/webauthn/registro/opcoes"));
        setOferta(true);
        setOcupado(false);
        return;
      }
    } catch {}
    aoEntrar();
  }

  async function entrarComFaceId() {
    setErro("");
    setOcupado(true);
    try {
      const inicio = desafioLogin || (await postar("/api/auth/webauthn/login/opcoes"));
      const resposta = await startAuthentication({ optionsJSON: inicio.opcoes });
      await postar("/api/auth/webauthn/login/verificar", { desafioId: inicio.desafioId, resposta });
      aoEntrar();
    } catch (err) {
      if (err.codigo === "SEM_CREDENCIAL") gravarLocal(FACEID_ATIVO, null);
      setErro(err.codigo ? err.message : "Face ID não confirmado. Tente de novo ou entre com a senha.");
      carregarDesafio();
      setOcupado(false);
    }
  }

  async function ativarFaceId() {
    setErro("");
    setOcupado(true);
    try {
      const resposta = await startRegistration({ optionsJSON: opcoesRegistro });
      await postar("/api/auth/webauthn/registro/verificar", { resposta, aparelho: nomeDoAparelho() });
      gravarLocal(FACEID_ATIVO, "1");
      aoEntrar();
    } catch (err) {
      setErro(err.codigo || err.message?.startsWith("Não") ? err.message : "Não consegui ativar o Face ID. Você pode tentar no próximo login.");
      setOferta(false);
      setOcupado(false);
      setTimeout(aoEntrar, 2500);
    }
  }

  function recusarFaceId() {
    gravarLocal(FACEID_RECUSADO_EM, String(Date.now()));
    aoEntrar();
  }

  if (oferta) {
    return (
      <div className="cofre-lock">
        <div className="cadeado">🙂</div>
        <h2>Entrar com Face ID neste aparelho?</h2>
        <p className="dica">Da próxima vez, é só olhar para a tela — sem digitar a senha.</p>
        {erro && <div className="erro">{erro}</div>}
        <div className="form-pin">
          <button type="button" className="btn-principal" onClick={ativarFaceId} disabled={ocupado || !opcoesRegistro}>
            {ocupado ? "Ativando…" : "Ativar Face ID"}
          </button>
          <button type="button" className="btn-secundario" onClick={recusarFaceId} disabled={ocupado}>
            Agora não
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="cofre-lock">
      <div className="cadeado">🔒</div>
      <h2>{APP_NAME}</h2>
      <p className="dica">Entre para continuar. A senha é a mesma do Instituto Khouri.</p>
      <form onSubmit={entrarComSenha} className="form-pin">
        {faceIdAtivo && (
          <>
            <button type="button" className="btn-principal" onClick={entrarComFaceId} disabled={ocupado}>
              Entrar com Face ID
            </button>
            <p className="dica">ou com a senha</p>
          </>
        )}
        <input
          type="password"
          autoComplete="current-password"
          placeholder="Senha"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
        />
        {erro && <div className="erro">{erro}</div>}
        <button type="submit" className={faceIdAtivo ? "btn-secundario" : "btn-principal"} disabled={ocupado || !senha}>
          {ocupado ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
