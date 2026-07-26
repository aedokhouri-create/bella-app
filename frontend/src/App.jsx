import { useEffect, useRef, useState } from "react";
import { APP_NAME } from "./config.js";
import capaBella from "./assets/bella/capa-oculos.png";
import {
  listarTarefas,
  atualizarTarefa,
  apagarTarefa,
  enviarMensagem,
  cofreStatus,
  cofreDefinir,
  cofreVerificar,
  cofreListarNotas,
  cofreCriarNota,
  cofreApagarNota,
} from "./api.js";

const hojeChave = () => "nina_chat_" + new Date().toISOString().slice(0, 10);

// Escolhe a melhor voz em português disponível no navegador (varia por
// aparelho/navegador — o iOS Safari costuma ter "Luciana" como a mais natural).
function escolherVoz() {
  const vozes = window.speechSynthesis?.getVoices() || [];
  if (!vozes.length) return null;
  const brasileiras = vozes.filter((v) => v.lang?.toLowerCase().startsWith("pt-br"));
  const preferidas = ["luciana", "google português do brasil", "fernanda", "camila"];
  for (const nome of preferidas) {
    const achada = brasileiras.find((v) => v.name.toLowerCase().includes(nome));
    if (achada) return achada;
  }
  if (brasileiras.length) return brasileiras[0];
  return vozes.find((v) => v.lang?.toLowerCase().startsWith("pt")) || null;
}

const CATEGORIAS_COFRE = [
  "🏥 Hospitais & Sistemas Médicos",
  "🏛️ Governo & Conselhos",
  "💰 Financeiro & Bancos",
  "📱 Apps & Tecnologia",
  "🔒 Acessos Físicos",
];

export default function App() {
  const [aba, setAba] = useState("conversa"); // conversa | tarefas
  const [tarefas, setTarefas] = useState([]);
  const [ttsOn, setTtsOn] = useState(true);

  useEffect(() => {
    recarregarTarefas();
  }, []);

  async function recarregarTarefas() {
    try {
      setTarefas(await listarTarefas());
    } catch {
      /* offline: mantém o que tiver */
    }
  }

  const pendentes = tarefas.filter((t) => t.status !== "concluida").length;

  return (
    <div className="app">
      <header className="topo">
        <div className="marca">
          <img className="bolha-foto" src={capaBella} alt={APP_NAME} />
          <div>
            <strong>{APP_NAME}</strong>
            <small>seu assistente pessoal</small>
          </div>
        </div>
        <button
          className={"audio " + (ttsOn ? "on" : "")}
          onClick={() => setTtsOn((v) => !v)}
          title="Ligar/desligar a voz da assistente"
        >
          {ttsOn ? "🔊" : "🔇"}
        </button>
      </header>

      <main className="conteudo">
        {aba === "conversa" && (
          <Conversa ttsOn={ttsOn} aposCriarTarefa={recarregarTarefas} />
        )}
        {aba === "tarefas" && (
          <Tarefas tarefas={tarefas} recarregar={recarregarTarefas} setTarefas={setTarefas} />
        )}
        {aba === "cofre" && <Cofre />}
      </main>

      <nav className="abas">
        <button className={aba === "conversa" ? "ativa" : ""} onClick={() => setAba("conversa")}>
          💬 Conversa
        </button>
        <button className={aba === "tarefas" ? "ativa" : ""} onClick={() => setAba("tarefas")}>
          ✅ Tarefas {pendentes > 0 && <span className="badge">{pendentes}</span>}
        </button>
        <button className={aba === "cofre" ? "ativa" : ""} onClick={() => setAba("cofre")}>
          🔒 Cofre
        </button>
      </nav>
    </div>
  );
}

/* ---------------- Conversa (chat + voz) ---------------- */
function Conversa({ ttsOn, aposCriarTarefa }) {
  const [mensagens, setMensagens] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(hojeChave())) || [];
    } catch {
      return [];
    }
  });
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [ouvindo, setOuvindo] = useState(false);
  const [modoConversa, setModoConversa] = useState(false);
  const fimRef = useRef(null);
  const recogRef = useRef(null);
  const vozRef = useRef(null);
  const modoConversaRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(hojeChave(), JSON.stringify(mensagens));
    fimRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens]);

  // As vozes do navegador carregam de forma assíncrona (principalmente no
  // Safari/iOS) — escutamos o evento certo para pegar a melhor assim que estiver pronta.
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    function atualizarVoz() {
      vozRef.current = escolherVoz();
    }
    atualizarVoz();
    window.speechSynthesis.addEventListener("voiceschanged", atualizarVoz);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", atualizarVoz);
  }, []);

  useEffect(() => {
    modoConversaRef.current = modoConversa;
  }, [modoConversa]);

  function falar(txt, aoTerminar) {
    if (!ttsOn || !("speechSynthesis" in window)) {
      aoTerminar?.();
      return;
    }
    const u = new SpeechSynthesisUtterance(txt);
    u.lang = "pt-BR";
    u.rate = 1.0;
    u.pitch = 1.05;
    if (vozRef.current) u.voice = vozRef.current;
    u.onend = () => aoTerminar?.();
    u.onerror = () => aoTerminar?.();
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  async function enviar(conteudo) {
    const msg = (conteudo ?? texto).trim();
    if (!msg || ocupado) return;
    setTexto("");
    const historico = mensagens;
    setMensagens((m) => [...m, { role: "user", text: msg }]);
    setOcupado(true);
    try {
      const { reply, tarefas } = await enviarMensagem(msg, historico);
      setMensagens((m) => [...m, { role: "assistant", text: reply, tarefas }]);
      falar(reply, () => {
        // Modo conversa: assim que ela termina de falar, volta a escutar sozinha.
        if (modoConversaRef.current) iniciarEscuta();
      });
      if (tarefas && tarefas.length) aposCriarTarefa();
    } catch {
      setMensagens((m) => [
        ...m,
        { role: "assistant", text: "Não consegui responder agora. Tente de novo." },
      ]);
    } finally {
      setOcupado(false);
    }
  }

  function iniciarEscuta() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert("Seu navegador não suporta ditado por voz. Use o Safari (iPhone) ou Chrome.");
      return;
    }
    const r = new SR();
    r.lang = "pt-BR";
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onstart = () => setOuvindo(true);
    r.onend = () => setOuvindo(false);
    r.onerror = () => setOuvindo(false);
    r.onresult = (e) => {
      const t = e.results[0][0].transcript;
      enviar(t);
    };
    recogRef.current = r;
    r.start();
  }

  function toggleMic() {
    if (ouvindo) {
      recogRef.current?.stop();
      return;
    }
    iniciarEscuta();
  }

  function alternarModoConversa() {
    setModoConversa((v) => {
      const novo = !v;
      if (novo && !ouvindo && !ocupado) iniciarEscuta();
      return novo;
    });
  }

  return (
    <div className="conversa">
      <div className="mensagens">
        {mensagens.length === 0 && (
          <div className="capa-bella">
            <img src={capaBella} alt={APP_NAME} />
            <div className="capa-balao">
              <strong>Oi, doutor!</strong>
              <span>Como posso ajudar hoje?</span>
            </div>
          </div>
        )}
        {mensagens.length === 0 && (
          <div className="vazio vazio-capa">
            <p className="dica">
              Toque no microfone e fale, ou digite. Ex.:
              <br />
              <em>"Lembra de ligar pro Fernando amanhã de manhã"</em>
            </p>
          </div>
        )}
        {mensagens.map((m, i) => (
          <div key={i} className={"balao " + m.role}>
            <div className="txt">{m.text}</div>
            {m.tarefas?.map((t) => (
              <div key={t.id} className="chip-tarefa">
                ✅ {t.titulo}
                {t.data ? ` · ${formatarData(t.data)}` : ""}
                {t.hora ? ` ${t.hora}` : ""}
              </div>
            ))}
          </div>
        ))}
        {ocupado && <div className="balao assistant"><div className="txt">…</div></div>}
        <div ref={fimRef} />
      </div>

      <button
        type="button"
        className={"modo-conversa " + (modoConversa ? "on" : "")}
        onClick={alternarModoConversa}
      >
        {modoConversa ? "🎙️ Modo conversa ativado — toque para desligar" : "🎙️ Ativar modo conversa (mãos livres)"}
      </button>

      <form
        className="barra"
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
      >
        <button type="button" className={"mic " + (ouvindo ? "gravando" : "")} onClick={toggleMic}>
          {ouvindo ? "●" : "🎤"}
        </button>
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={ouvindo ? "Ouvindo…" : "Fale ou digite…"}
          enterKeyHint="send"
        />
        <button type="submit" className="enviar" disabled={!texto.trim() || ocupado}>
          ➤
        </button>
      </form>
    </div>
  );
}

/* ---------------- Tarefas ---------------- */
function isoDe(d) {
  return d.toISOString().slice(0, 10);
}

function Tarefas({ tarefas, recarregar, setTarefas }) {
  const [filtro, setFiltro] = useState("todas"); // hoje | todas

  async function alternar(t) {
    const novo = t.status === "concluida" ? "pendente" : "concluida";
    setTarefas((lista) => lista.map((x) => (x.id === t.id ? { ...x, status: novo } : x)));
    try {
      await atualizarTarefa(t.id, { status: novo });
    } finally {
      recarregar();
    }
  }
  async function adiar(t) {
    // Empurra para o dia seguinte (ou para amanhã, se não tinha data).
    const base = t.data ? new Date(t.data + "T12:00:00") : new Date();
    base.setDate(base.getDate() + 1);
    const novaData = isoDe(base);
    setTarefas((lista) => lista.map((x) => (x.id === t.id ? { ...x, data: novaData } : x)));
    try {
      await atualizarTarefa(t.id, { data: novaData });
    } finally {
      recarregar();
    }
  }
  async function remover(t) {
    if (!confirm(`Apagar "${t.titulo}"?`)) return;
    setTarefas((lista) => lista.filter((x) => x.id !== t.id));
    try {
      await apagarTarefa(t.id);
    } finally {
      recarregar();
    }
  }

  const hoje = isoDe(new Date());
  const visiveis = filtro === "hoje" ? tarefas.filter((t) => t.data === hoje) : tarefas;

  return (
    <div className="painel-tarefas">
      <div className="filtro">
        <button className={filtro === "hoje" ? "sel" : ""} onClick={() => setFiltro("hoje")}>
          Hoje
        </button>
        <button className={filtro === "todas" ? "sel" : ""} onClick={() => setFiltro("todas")}>
          Todas
        </button>
      </div>

      {visiveis.length === 0 ? (
        <div className="vazio">
          {filtro === "hoje" ? (
            <p>Nada para hoje. 🎉</p>
          ) : (
            <>
              <p>Nenhuma tarefa ainda.</p>
              <p className="dica">Peça na aba Conversa: "anota que preciso pagar a conta de luz sexta".</p>
            </>
          )}
        </div>
      ) : (
        <div className="lista-tarefas">
          {visiveis.map((t) => (
            <div key={t.id} className={"cartao prio-" + (t.prioridade || "media") + (t.status === "concluida" ? " feita" : "")}>
              <button className="check" onClick={() => alternar(t)} title="Concluir">
                {t.status === "concluida" ? "☑" : "☐"}
              </button>
              <div className="corpo">
                <div className="titulo">{t.titulo}</div>
                <div className="meta">
                  {t.data && <span>📅 {formatarData(t.data)}{t.hora ? ` · ${t.hora}` : ""}</span>}
                  {t.categoria && <span className="cat">{t.categoria}</span>}
                  {t.prioridade === "alta" && <span className="alta">alta</span>}
                </div>
                {t.descricao && <div className="desc">{t.descricao}</div>}
              </div>
              <div className="acoes">
                {t.status !== "concluida" && (
                  <button className="adiar" onClick={() => adiar(t)} title="Adiar 1 dia">
                    💤
                  </button>
                )}
                <button className="apagar" onClick={() => remover(t)} title="Apagar">
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatarData(iso) {
  if (!iso) return "";
  const [a, m, d] = iso.split("-");
  if (!d) return iso;
  return `${d}/${m}/${a}`;
}

/* ---------------- Cofre (área secreta com PIN) ---------------- */
function Cofre() {
  const [modo, setModo] = useState("carregando"); // carregando | setup | bloqueado | aberto
  const [pin, setPin] = useState("");
  const [entrada, setEntrada] = useState("");
  const [confirma, setConfirma] = useState("");
  const [erro, setErro] = useState("");
  const [notas, setNotas] = useState([]);
  const [novoTitulo, setNovoTitulo] = useState("");
  const [novoConteudo, setNovoConteudo] = useState("");
  const [novaCategoria, setNovaCategoria] = useState("");
  const [busca, setBusca] = useState("");

  useEffect(() => {
    cofreStatus()
      .then((s) => setModo(s.configurado ? "bloqueado" : "setup"))
      .catch(() => setModo("bloqueado"));
  }, []);

  async function abrirCom(p) {
    const lista = await cofreListarNotas(p);
    setNotas(lista);
    setPin(p);
    setModo("aberto");
    setEntrada("");
    setConfirma("");
    setErro("");
  }

  async function criarPin(e) {
    e.preventDefault();
    setErro("");
    if (entrada.length < 4) return setErro("O PIN precisa ter pelo menos 4 dígitos.");
    if (entrada !== confirma) return setErro("Os PINs não são iguais.");
    try {
      await cofreDefinir(entrada);
      await abrirCom(entrada);
    } catch {
      setErro("Não consegui criar o PIN.");
    }
  }

  async function desbloquear(e) {
    e.preventDefault();
    setErro("");
    try {
      const r = await cofreVerificar(entrada);
      if (r.ok) await abrirCom(entrada);
      else setErro("PIN incorreto.");
    } catch {
      setErro("Erro ao verificar o PIN.");
    }
  }

  function trancar() {
    setPin("");
    setNotas([]);
    setEntrada("");
    setModo("bloqueado");
  }

  async function adicionarNota(e) {
    e.preventDefault();
    if (!novoTitulo.trim()) return;
    const nota = await cofreCriarNota(pin, {
      titulo: novoTitulo.trim(),
      conteudo: novoConteudo.trim(),
      categoria: novaCategoria || null,
    });
    setNotas((n) => [nota, ...n]);
    setNovoTitulo("");
    setNovoConteudo("");
    setNovaCategoria("");
  }

  async function removerNota(id) {
    if (!confirm("Apagar esta nota?")) return;
    setNotas((n) => n.filter((x) => x.id !== id));
    await cofreApagarNota(pin, id).catch(() => {});
  }

  if (modo === "carregando") return <div className="vazio"><p>…</p></div>;

  if (modo === "setup" || modo === "bloqueado") {
    const criar = modo === "setup";
    return (
      <div className="cofre-lock">
        <div className="cadeado">🔒</div>
        <h2>{criar ? "Criar seu cofre" : "Cofre pessoal"}</h2>
        <p className="dica">
          {criar
            ? "Crie um PIN para proteger suas anotações privadas."
            : "Digite seu PIN para abrir."}
        </p>
        <form onSubmit={criar ? criarPin : desbloquear} className="form-pin">
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            placeholder="PIN (mín. 4 dígitos)"
            value={entrada}
            onChange={(e) => setEntrada(e.target.value.replace(/\D/g, ""))}
          />
          {criar && (
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Confirmar PIN"
              value={confirma}
              onChange={(e) => setConfirma(e.target.value.replace(/\D/g, ""))}
            />
          )}
          {erro && <div className="erro">{erro}</div>}
          <button type="submit" className="btn-principal">
            {criar ? "Criar cofre" : "Abrir"}
          </button>
        </form>
      </div>
    );
  }

  function copiar(n) {
    const txt = [n.titulo, n.conteudo].filter(Boolean).join("\n");
    navigator.clipboard?.writeText(txt);
  }

  // aberto — agrupa por categoria (com busca)
  const filtradas = notas.filter((n) => {
    if (!busca.trim()) return true;
    const q = busca.toLowerCase();
    return (
      (n.titulo || "").toLowerCase().includes(q) ||
      (n.categoria || "").toLowerCase().includes(q) ||
      (n.conteudo || "").toLowerCase().includes(q)
    );
  });
  const grupos = {};
  for (const n of filtradas) {
    const c = n.categoria || "Outros";
    (grupos[c] ||= []).push(n);
  }
  const ordem = [...CATEGORIAS_COFRE, "Outros"];
  const chaves = Object.keys(grupos).sort((a, b) => {
    const ia = ordem.indexOf(a), ib = ordem.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  return (
    <div className="cofre-aberto">
      <div className="cofre-topo">
        <span>🔓 Cofre aberto</span>
        <button className="trancar" onClick={trancar}>
          Trancar
        </button>
      </div>
      <form className="form-nota" onSubmit={adicionarNota}>
        <input
          placeholder="Título (ex.: Banco do Brasil)"
          value={novoTitulo}
          onChange={(e) => setNovoTitulo(e.target.value)}
        />
        <textarea
          placeholder="Login / senha / detalhes"
          value={novoConteudo}
          onChange={(e) => setNovoConteudo(e.target.value)}
          rows={2}
        />
        <select value={novaCategoria} onChange={(e) => setNovaCategoria(e.target.value)}>
          <option value="">Sem categoria</option>
          {CATEGORIAS_COFRE.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button type="submit" className="btn-principal" disabled={!novoTitulo.trim()}>
          + Guardar
        </button>
      </form>

      {notas.length > 0 && (
        <input
          className="busca-cofre"
          placeholder="🔎 Buscar (ex.: banco, hospital, gov)"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      )}

      {notas.length === 0 ? (
        <div className="vazio"><p className="dica">Nenhuma nota guardada ainda.</p></div>
      ) : (
        <div className="notas">
          {chaves.map((cat) => (
            <div key={cat} className="grupo">
              <div className="grupo-titulo">
                {cat} <span className="conta">{grupos[cat].length}</span>
              </div>
              {grupos[cat].map((n) => (
                <div key={n.id} className="nota">
                  <div className="nota-corpo">
                    <div className="titulo">{n.titulo}</div>
                    {n.conteudo && <div className="desc">{n.conteudo}</div>}
                  </div>
                  <div className="nota-acoes">
                    <button className="copiar" onClick={() => copiar(n)} title="Copiar">📋</button>
                    <button className="apagar" onClick={() => removerNota(n.id)} title="Apagar">🗑</button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
