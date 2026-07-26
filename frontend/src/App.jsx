import { useEffect, useRef, useState } from "react";
import { APP_NAME } from "./config.js";
import {
  listarTarefas,
  atualizarTarefa,
  apagarTarefa,
  enviarMensagem,
} from "./api.js";

const hojeChave = () => "nina_chat_" + new Date().toISOString().slice(0, 10);

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
          <span className="bolha">⚡</span>
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
        {aba === "conversa" ? (
          <Conversa ttsOn={ttsOn} aposCriarTarefa={recarregarTarefas} />
        ) : (
          <Tarefas tarefas={tarefas} recarregar={recarregarTarefas} setTarefas={setTarefas} />
        )}
      </main>

      <nav className="abas">
        <button className={aba === "conversa" ? "ativa" : ""} onClick={() => setAba("conversa")}>
          💬 Conversa
        </button>
        <button className={aba === "tarefas" ? "ativa" : ""} onClick={() => setAba("tarefas")}>
          ✅ Tarefas {pendentes > 0 && <span className="badge">{pendentes}</span>}
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
  const fimRef = useRef(null);
  const recogRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(hojeChave(), JSON.stringify(mensagens));
    fimRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens]);

  function falar(txt) {
    if (!ttsOn || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(txt);
    u.lang = "pt-BR";
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
      falar(reply);
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

  function toggleMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert("Seu navegador não suporta ditado por voz. Use o Safari (iPhone) ou Chrome.");
      return;
    }
    if (ouvindo) {
      recogRef.current?.stop();
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

  return (
    <div className="conversa">
      <div className="mensagens">
        {mensagens.length === 0 && (
          <div className="vazio">
            <p>Olá! Sou a {APP_NAME}. 👋</p>
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
