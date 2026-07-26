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
  listarContatos,
  criarContato,
  apagarContato,
  listarContas,
  criarConta,
  atualizarConta,
  apagarConta,
  backupInfo,
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

// Redimensiona/comprime a foto no navegador antes de mandar pro servidor
// (evita fotos de 5-10MB do iPhone travando o envio pela rede do hospital).
function redimensionarImagem(file, maxLado = 1280, qualidade = 0.82) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error("Não consegui ler a foto."));
    leitor.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Não consegui abrir a foto."));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxLado || height > maxLado) {
          const escala = maxLado / Math.max(width, height);
          width = Math.round(width * escala);
          height = Math.round(height * escala);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", qualidade);
        resolve({ base64: dataUrl.split(",")[1], mediaType: "image/jpeg", preview: dataUrl });
      };
      img.src = leitor.result;
    };
    leitor.readAsDataURL(file);
  });
}

const CATEGORIAS_COFRE = [
  "🏥 Hospitais & Sistemas Médicos",
  "🏛️ Governo & Conselhos",
  "💰 Financeiro & Bancos",
  "📱 Apps & Tecnologia",
  "🔒 Acessos Físicos",
  "🛡️ Seguros & Apólices",
  "📜 Para minha família (em caso de necessidade)",
];

export default function App() {
  const [aba, setAba] = useState("conversa"); // conversa | tarefas | contatos | cofre
  const [tarefas, setTarefas] = useState([]);
  const [contas, setContas] = useState([]);
  const [ttsOn, setTtsOn] = useState(true);
  const [backupAberto, setBackupAberto] = useState(false);

  useEffect(() => {
    recarregarTarefas();
    recarregarContas();
  }, []);

  async function recarregarTarefas() {
    try {
      setTarefas(await listarTarefas());
    } catch {
      /* offline: mantém o que tiver */
    }
  }

  async function recarregarContas() {
    try {
      setContas(await listarContas());
    } catch {
      /* offline: mantém o que tiver */
    }
  }

  const pendentes = tarefas.filter((t) => t.status !== "concluida").length;
  const contasPendentes = contas.filter((c) => c.status !== "pago").length;

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
        <div className="topo-acoes">
          <button className="backup-btn" onClick={() => setBackupAberto(true)} title="Backup dos dados">
            💾
          </button>
          <button
            className={"audio " + (ttsOn ? "on" : "")}
            onClick={() => setTtsOn((v) => !v)}
            title="Ligar/desligar a voz da assistente"
          >
            {ttsOn ? "🔊" : "🔇"}
          </button>
        </div>
      </header>

      <main className="conteudo">
        {aba === "conversa" && (
          <Conversa ttsOn={ttsOn} aposCriarTarefa={recarregarTarefas} aposCriarConta={recarregarContas} />
        )}
        {aba === "tarefas" && (
          <Agenda
            tarefas={tarefas}
            recarregarTarefas={recarregarTarefas}
            setTarefas={setTarefas}
            contas={contas}
            recarregarContas={recarregarContas}
            setContas={setContas}
          />
        )}
        {aba === "cofre" && <Cofre />}
        {aba === "contatos" && <Contatos />}
      </main>

      {backupAberto && <PainelBackup fechar={() => setBackupAberto(false)} />}

      <nav className="abas">
        <button className={aba === "conversa" ? "ativa" : ""} onClick={() => setAba("conversa")}>
          💬 Conversa
        </button>
        <button className={aba === "tarefas" ? "ativa" : ""} onClick={() => setAba("tarefas")}>
          📅 Agenda {(pendentes + contasPendentes) > 0 && <span className="badge">{pendentes + contasPendentes}</span>}
        </button>
        <button className={aba === "contatos" ? "ativa" : ""} onClick={() => setAba("contatos")}>
          📇 Contatos
        </button>
        <button className={aba === "cofre" ? "ativa" : ""} onClick={() => setAba("cofre")}>
          🔒 Cofre
        </button>
      </nav>
    </div>
  );
}

/* ---------------- Conversa (chat + voz) ---------------- */
function Conversa({ ttsOn, aposCriarTarefa, aposCriarConta }) {
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
  const fotoInputRef = useRef(null);

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
      const { reply, tarefas, contas, acoesWhatsApp } = await enviarMensagem(msg, historico);
      setMensagens((m) => [...m, { role: "assistant", text: reply, tarefas, contas, acoesWhatsApp }]);
      falar(reply, () => {
        // Modo conversa: assim que ela termina de falar, volta a escutar sozinha.
        if (modoConversaRef.current) iniciarEscuta();
      });
      if (tarefas && tarefas.length) aposCriarTarefa();
      if (contas && contas.length) aposCriarConta();
    } catch {
      setMensagens((m) => [
        ...m,
        { role: "assistant", text: "Não consegui responder agora. Tente de novo." },
      ]);
    } finally {
      setOcupado(false);
    }
  }

  async function enviarFoto(e) {
    const arquivo = e.target.files?.[0];
    e.target.value = ""; // permite escolher a mesma foto de novo depois
    if (!arquivo || ocupado) return;
    setOcupado(true);
    try {
      const { base64, mediaType, preview } = await redimensionarImagem(arquivo);
      const historico = mensagens;
      setMensagens((m) => [...m, { role: "user", text: "📷 Foto enviada", foto: preview }]);
      const { reply, tarefas, contas, acoesWhatsApp } = await enviarMensagem("", historico, { base64, mediaType });
      setMensagens((m) => [...m, { role: "assistant", text: reply, tarefas, contas, acoesWhatsApp }]);
      falar(reply, () => {
        if (modoConversaRef.current) iniciarEscuta();
      });
      if (tarefas && tarefas.length) aposCriarTarefa();
      if (contas && contas.length) aposCriarConta();
    } catch {
      setMensagens((m) => [
        ...m,
        { role: "assistant", text: "Não consegui ler essa foto. Tente tirar de novo, com mais luz." },
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
            {m.foto && <img className="foto-msg" src={m.foto} alt="Foto enviada" />}
            <div className="txt">{m.text}</div>
            {m.tarefas?.map((t) => (
              <div key={"t" + t.id} className="chip-tarefa">
                ✅ {t.titulo}
                {t.data ? ` · ${formatarData(t.data)}` : ""}
                {t.hora ? ` ${t.hora}` : ""}
              </div>
            ))}
            {m.contas?.map((c) => (
              <div key={"c" + c.id} className="chip-tarefa chip-conta">
                💰 {c.titulo}
                {c.valor != null ? ` · R$ ${Number(c.valor).toFixed(2)}` : ""}
                {` · vence ${formatarData(c.vencimento)}`}
              </div>
            ))}
            {m.acoesWhatsApp?.map((a, j) => (
              <a
                key={j}
                className="btn-whatsapp"
                href={a.url}
                onClick={(e) => {
                  // No preview/desktop não tem WhatsApp instalado — evita erro de navegação.
                  if (!/Mobi|iPhone|iPad|Android/i.test(navigator.userAgent)) {
                    e.preventDefault();
                    alert("Abrir WhatsApp só funciona no celular, com o app instalado.");
                  }
                }}
              >
                📲 Abrir WhatsApp ({a.conta}) para {a.contato}
              </a>
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
        <button
          type="button"
          className="camera"
          onClick={() => fotoInputRef.current?.click()}
          title="Enviar foto para a Bella ler"
          disabled={ocupado}
        >
          📷
        </button>
        <input
          ref={fotoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={enviarFoto}
        />
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

function Agenda({ tarefas, recarregarTarefas, setTarefas, contas, recarregarContas, setContas }) {
  const [sub, setSub] = useState("tarefas"); // tarefas | contas

  return (
    <div className="painel-tarefas">
      <div className="subabas">
        <button className={sub === "tarefas" ? "sel" : ""} onClick={() => setSub("tarefas")}>
          ✅ Tarefas
        </button>
        <button className={sub === "contas" ? "sel" : ""} onClick={() => setSub("contas")}>
          💰 Contas a pagar
        </button>
      </div>
      {sub === "tarefas" ? (
        <ListaTarefas tarefas={tarefas} recarregar={recarregarTarefas} setTarefas={setTarefas} />
      ) : (
        <ListaContas contas={contas} recarregar={recarregarContas} setContas={setContas} />
      )}
    </div>
  );
}

function ListaTarefas({ tarefas, recarregar, setTarefas }) {
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
    <div className="sub-painel">
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

function ListaContas({ contas, recarregar, setContas }) {
  const [titulo, setTitulo] = useState("");
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [categoria, setCategoria] = useState("");

  async function adicionar(e) {
    e.preventDefault();
    if (!titulo.trim() || !vencimento) return;
    const nova = await criarConta({
      titulo: titulo.trim(),
      valor: valor.trim() || null,
      vencimento,
      categoria: categoria.trim() || null,
    });
    setContas((lista) => [...lista, nova]);
    setTitulo("");
    setValor("");
    setVencimento("");
    setCategoria("");
    recarregar();
  }

  async function alternarPaga(c) {
    const novo = c.status === "pago" ? "pendente" : "pago";
    setContas((lista) => lista.map((x) => (x.id === c.id ? { ...x, status: novo } : x)));
    try {
      await atualizarConta(c.id, { status: novo });
    } finally {
      recarregar();
    }
  }

  async function remover(c) {
    if (!confirm(`Apagar "${c.titulo}"?`)) return;
    setContas((lista) => lista.filter((x) => x.id !== c.id));
    try {
      await apagarConta(c.id);
    } finally {
      recarregar();
    }
  }

  const hoje = isoDe(new Date());

  return (
    <div className="sub-painel">
      <form className="form-conta" onSubmit={adicionar}>
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Conta de luz, IPTU..." />
        <div className="linha-conta">
          <input
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="Valor (R$)"
            inputMode="decimal"
          />
          <input value={vencimento} onChange={(e) => setVencimento(e.target.value)} type="date" />
        </div>
        <input
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          placeholder="Categoria (opcional): moradia, cartão, imposto..."
        />
        <button type="submit" className="btn-principal" disabled={!titulo.trim() || !vencimento}>
          + Adicionar conta
        </button>
      </form>

      {contas.length === 0 ? (
        <div className="vazio">
          <p>Nenhuma conta cadastrada.</p>
          <p className="dica">Peça na aba Conversa: "anota que tenho que pagar o IPTU dia 10".</p>
        </div>
      ) : (
        <div className="lista-tarefas">
          {contas.map((c) => {
            const atrasada = c.status !== "pago" && c.vencimento < hoje;
            return (
              <div
                key={c.id}
                className={"cartao" + (c.status === "pago" ? " feita" : "") + (atrasada ? " atrasada" : "")}
              >
                <button className="check" onClick={() => alternarPaga(c)} title="Marcar como paga">
                  {c.status === "pago" ? "☑" : "☐"}
                </button>
                <div className="corpo">
                  <div className="titulo">{c.titulo}</div>
                  <div className="meta">
                    <span>📅 {formatarData(c.vencimento)}</span>
                    {c.valor != null && <span className="cat">R$ {Number(c.valor).toFixed(2)}</span>}
                    {c.categoria && <span className="cat">{c.categoria}</span>}
                    {atrasada && <span className="alta">atrasada</span>}
                  </div>
                </div>
                <div className="acoes">
                  <button className="apagar" onClick={() => remover(c)} title="Apagar">
                    🗑
                  </button>
                </div>
              </div>
            );
          })}
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

/* ---------------- Backup ---------------- */
function PainelBackup({ fechar }) {
  const [info, setInfo] = useState(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    backupInfo()
      .then(setInfo)
      .catch(() => setErro("Não consegui verificar o backup agora."));
  }, []);

  return (
    <div className="modal-fundo" onClick={fechar}>
      <div className="modal-backup" onClick={(e) => e.stopPropagation()}>
        <div className="modal-topo">
          <strong>💾 Backup dos dados</strong>
          <button className="fechar" onClick={fechar}>
            ✕
          </button>
        </div>

        <p className="dica">
          Este arquivo contém todas as suas tarefas, contas, contatos e senhas do Cofre
          (criptografadas). Não inclui fotos ou vídeos.
        </p>

        {erro && <p className="erro">{erro}</p>}
        {info && info.existe && (
          <p className="info-backup">
            Tamanho atual: <strong>{info.tamanhoLegivel}</strong>
            <br />
            Última alteração: {new Date(info.modificadoEm).toLocaleString("pt-BR")}
          </p>
        )}
        {info && !info.existe && <p className="dica">Ainda não há dados para fazer backup.</p>}

        <a className="btn-principal btn-baixar" href="/api/backup" download>
          ⬇️ Baixar backup agora
        </a>

        <p className="dica">
          Guarde este arquivo no iCloud Drive, Google Drive ou envie por e-mail para você
          mesmo. Recomendo baixar um novo backup pelo menos uma vez por semana.
        </p>
      </div>
    </div>
  );
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

/* ---------------- Contatos (para enviar WhatsApp) ---------------- */
function Contatos() {
  const [contatos, setContatos] = useState([]);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [conta, setConta] = useState("pessoal");
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    recarregar();
  }, []);

  async function recarregar() {
    try {
      setContatos(await listarContatos());
    } catch {
      /* offline */
    } finally {
      setCarregando(false);
    }
  }

  async function adicionar(e) {
    e.preventDefault();
    if (!nome.trim() || !telefone.trim()) return;
    const novo = await criarContato({ nome: nome.trim(), telefone: telefone.trim(), conta });
    setContatos((c) => [...c, novo].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
    setNome("");
    setTelefone("");
  }

  async function remover(id) {
    if (!confirm("Apagar este contato?")) return;
    setContatos((c) => c.filter((x) => x.id !== id));
    await apagarContato(id).catch(() => {});
  }

  return (
    <div className="painel-contatos">
      <form className="form-contato" onSubmit={adicionar}>
        <input placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
        <input
          placeholder="Telefone com DDD (ex.: 71999998888)"
          inputMode="tel"
          value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
        />
        <div className="conta-opcoes">
          <button type="button" className={conta === "pessoal" ? "sel" : ""} onClick={() => setConta("pessoal")}>
            Pessoal
          </button>
          <button
            type="button"
            className={conta === "profissional" ? "sel" : ""}
            onClick={() => setConta("profissional")}
          >
            Profissional
          </button>
        </div>
        <button type="submit" className="btn-principal" disabled={!nome.trim() || !telefone.trim()}>
          + Adicionar contato
        </button>
      </form>

      {!carregando && contatos.length === 0 && (
        <div className="vazio">
          <p>Nenhum contato salvo ainda.</p>
          <p className="dica">
            Depois de salvar, é só pedir na Conversa: <em>"Bella, manda mensagem pro Fernando no profissional"</em>.
          </p>
        </div>
      )}

      <div className="lista-contatos">
        {contatos.map((c) => (
          <div key={c.id} className="cartao-contato">
            <div className="corpo">
              <div className="titulo">{c.nome}</div>
              <div className="meta">
                <span>{c.telefone}</span>
                <span className={"selo " + c.conta}>{c.conta}</span>
              </div>
            </div>
            <button className="apagar" onClick={() => remover(c.id)} title="Apagar">🗑</button>
          </div>
        ))}
      </div>
    </div>
  );
}
