import { useEffect, useMemo, useRef, useState } from "react";
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
  cofreAtualizarNota,
  cofreApagarNota,
  cofreListarArquivos,
  cofreAnexarArquivo,
  cofreBaixarArquivo,
  cofreApagarArquivo,
  listarContatos,
  criarContato,
  apagarContato,
  listarContas,
  criarConta,
  atualizarConta,
  apagarConta,
  backupInfo,
  listarMemorias,
  apagarMemoria,
  vozStatus,
  sintetizarVoz,
  calendarioStatus,
  pushChavePublica,
  pushInscrever,
  pushTestar,
  listarModelos,
  apagarModelo,
} from "./api.js";

const hojeChave = () => "nina_chat_" + new Date().toISOString().slice(0, 10);

const CHAVE_VOZ_ESCOLHIDA = "bella_voz_escolhida";
const CHAVE_TEMA = "bella_tema"; // "" (automático, segue o sistema) | "claro" | "escuro"

// Alguns navegadores/vozes leem emoji em voz alta descrevendo a imagem
// ("carinha feliz com bochecha rosada") em vez de ignorar — tira antes de falar.
function removerEmojis(txt) {
  return String(txt || "")
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Presentation}|️|‍/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// Único áudio de voz (Google) tocando por vez — módulo, não estado de
// componente, pra o botão de som no topo conseguir interromper de qualquer lugar.
let audioVozAtual = null;
function pararFala() {
  window.speechSynthesis?.cancel();
  if (audioVozAtual) {
    audioVozAtual.pause();
    audioVozAtual = null;
  }
}

// Escolhe a melhor voz em português disponível no navegador (varia por
// aparelho/navegador — o iOS Safari costuma ter "Luciana" como a mais natural).
// Se o usuário já escolheu uma voz nas configurações, usa essa em vez de adivinhar.
function escolherVoz() {
  const vozes = window.speechSynthesis?.getVoices() || [];
  if (!vozes.length) return null;
  const preferidaSalva = localStorage.getItem(CHAVE_VOZ_ESCOLHIDA);
  if (preferidaSalva) {
    const escolhida = vozes.find((v) => v.name === preferidaSalva);
    if (escolhida) return escolhida;
  }
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

// O navegador exige a chave pública VAPID nesse formato (Uint8Array), não como string.
function chaveParaUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Seguro = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bruto = atob(base64Seguro);
  return Uint8Array.from([...bruto].map((c) => c.charCodeAt(0)));
}

// Pede permissão de notificação e inscreve este dispositivo no push do servidor.
// Retorna "ok", "negado" ou "indisponivel" (ex.: iPhone sem "Adicionar à Tela de Início").
async function ativarNotificacoesPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "indisponivel";
  const permissao = await Notification.requestPermission();
  if (permissao !== "granted") return "negado";
  const { ativo, chave } = await pushChavePublica();
  if (!ativo || !chave) return "indisponivel";
  const registro = await navigator.serviceWorker.ready;
  let inscricao = await registro.pushManager.getSubscription();
  if (!inscricao) {
    inscricao = await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: chaveParaUint8Array(chave),
    });
  }
  await pushInscrever(inscricao.toJSON());
  return "ok";
}

// Extrai {nome, telefone} de cada contato de um arquivo .vcf exportado do iPhone.
function parseVCF(texto) {
  const contatos = [];
  const blocos = String(texto || "").split(/BEGIN:VCARD/i).slice(1);
  for (const bloco of blocos) {
    const linhas = bloco.split(/\r\n|\n|\r/);
    let nome = "";
    let telefone = "";
    for (const linha of linhas) {
      if (!nome && /^FN[:;]/i.test(linha)) {
        nome = linha.split(":").slice(1).join(":").trim();
      } else if (!telefone && /^TEL[:;]/i.test(linha)) {
        telefone = linha
          .split(":")
          .slice(1)
          .join(":")
          .trim()
          .replace(/[^\d+]/g, "");
      }
    }
    if (nome && telefone) contatos.push({ nome, telefone });
  }
  return contatos;
}

// Lê um arquivo (ex.: PDF) como base64 puro, sem redimensionar — só faz sentido pra imagem.
function lerArquivoBase64(file) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error("Não consegui ler o arquivo."));
    leitor.onload = () => resolve({ base64: leitor.result.split(",")[1], mediaType: file.type || "application/pdf" });
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
  const [vozAberto, setVozAberto] = useState(false);
  const [memoriaAberta, setMemoriaAberta] = useState(false);
  const [sobreAberto, setSobreAberto] = useState(false);
  const [tema, setTema] = useState(() => localStorage.getItem(CHAVE_TEMA) || "");

  useEffect(() => {
    recarregarTarefas();
    recarregarContas();
  }, []);

  useEffect(() => {
    if (tema) document.documentElement.dataset.tema = tema;
    else delete document.documentElement.dataset.tema;
  }, [tema]);

  function alternarTema() {
    // automático -> escuro -> claro -> automático
    const proximo = tema === "" ? "escuro" : tema === "escuro" ? "claro" : "";
    setTema(proximo);
    if (proximo) localStorage.setItem(CHAVE_TEMA, proximo);
    else localStorage.removeItem(CHAVE_TEMA);
  }

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
          <button className="backup-btn" onClick={() => setMemoriaAberta(true)} title="O que a Bella sabe / modelos de documento">
            🧠
          </button>
          <button className="backup-btn" onClick={() => setVozAberto(true)} title="Escolher a voz da Bella">
            🗣️
          </button>
          <button className="backup-btn" onClick={() => setBackupAberto(true)} title="Backup dos dados">
            💾
          </button>
          <button
            className="backup-btn"
            onClick={alternarTema}
            title={
              tema === "escuro"
                ? "Tema: Escuro (toque pra mudar)"
                : tema === "claro"
                ? "Tema: Claro (toque pra mudar)"
                : "Tema: Automático — segue o sistema (toque pra mudar)"
            }
          >
            {tema === "escuro" ? "🌙" : tema === "claro" ? "☀️" : "🌗"}
          </button>
          <button
            className={"audio " + (ttsOn ? "on" : "")}
            onClick={() => {
              // Sempre interrompe uma fala em andamento na hora, além de alternar
              // se as próximas respostas devem falar sozinhas ou não.
              pararFala();
              setTtsOn((v) => !v);
            }}
            title="Ligar/desligar a voz da assistente (toque pra parar de falar agora)"
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

      {backupAberto && (
        <PainelBackup
          fechar={() => setBackupAberto(false)}
          abrirSobre={() => {
            setBackupAberto(false);
            setSobreAberto(true);
          }}
        />
      )}
      {vozAberto && <PainelVoz fechar={() => setVozAberto(false)} />}
      {memoriaAberta && <PainelMemoria fechar={() => setMemoriaAberta(false)} />}
      {sobreAberto && <PainelSobre fechar={() => setSobreAberto(false)} />}

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

  // Se a voz escolhida for do Google (mais natural), busca o áudio pronto no
  // servidor e toca; senão usa a síntese do navegador (mais robótica, mas grátis
  // e instantânea). aoTerminar sempre é chamado no final, dos dois jeitos.
  function falarTexto(txt, aoTerminar) {
    const limpo = removerEmojis(txt);
    const escolhida = localStorage.getItem(CHAVE_VOZ_ESCOLHIDA) || "";
    pararFala();
    if (escolhida.startsWith("google:")) {
      sintetizarVoz(limpo, escolhida.slice(7))
        .then(({ audioBase64 }) => {
          const audio = new Audio(`data:audio/mp3;base64,${audioBase64}`);
          audioVozAtual = audio;
          audio.onended = () => aoTerminar?.();
          audio.onerror = () => aoTerminar?.();
          audio.play().catch(() => aoTerminar?.());
        })
        .catch(() => aoTerminar?.());
      return;
    }
    if (!("speechSynthesis" in window)) {
      aoTerminar?.();
      return;
    }
    const u = new SpeechSynthesisUtterance(limpo);
    u.lang = "pt-BR";
    u.rate = 1.0;
    u.pitch = 1.05;
    if (vozRef.current) u.voice = vozRef.current;
    u.onend = () => aoTerminar?.();
    u.onerror = () => aoTerminar?.();
    window.speechSynthesis.speak(u);
  }

  // Fala sob demanda (botão "Ouvir" em qualquer mensagem) — ignora o ttsOn,
  // porque aqui é um pedido explícito, não a fala automática de resposta.
  function ouvirTexto(txt) {
    falarTexto(txt);
  }

  function falar(txt, aoTerminar) {
    if (!ttsOn) {
      aoTerminar?.();
      return;
    }
    falarTexto(txt, aoTerminar);
  }

  async function enviar(conteudo) {
    const msg = (conteudo ?? texto).trim();
    if (!msg || ocupado) return;
    setTexto("");
    const historico = mensagens;
    setMensagens((m) => [...m, { role: "user", text: msg }]);
    setOcupado(true);
    try {
      const { reply, tarefas, contas, acoesWhatsApp, documentos, cmot, memorias, modelos } = await enviarMensagem(msg, historico);
      setMensagens((m) => [...m, { role: "assistant", text: reply, tarefas, contas, acoesWhatsApp, documentos, cmot, memorias, modelos }]);
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
    e.target.value = ""; // permite escolher o mesmo arquivo de novo depois
    if (!arquivo || ocupado) return;
    const ehPdf = arquivo.type === "application/pdf";
    setOcupado(true);
    try {
      const { base64, mediaType, preview } = ehPdf
        ? { ...(await lerArquivoBase64(arquivo)), preview: null }
        : await redimensionarImagem(arquivo);
      const historico = mensagens;
      setMensagens((m) => [
        ...m,
        ehPdf
          ? { role: "user", text: `📄 Documento enviado: ${arquivo.name}` }
          : { role: "user", text: "📷 Foto enviada", foto: preview },
      ]);
      const { reply, tarefas, contas, acoesWhatsApp, documentos, cmot, memorias, modelos } = await enviarMensagem("", historico, { base64, mediaType });
      setMensagens((m) => [...m, { role: "assistant", text: reply, tarefas, contas, acoesWhatsApp, documentos, cmot, memorias, modelos }]);
      falar(reply, () => {
        if (modoConversaRef.current) iniciarEscuta();
      });
      if (tarefas && tarefas.length) aposCriarTarefa();
      if (contas && contas.length) aposCriarConta();
    } catch {
      setMensagens((m) => [
        ...m,
        {
          role: "assistant",
          text: ehPdf
            ? "Não consegui ler esse documento. Tente de novo."
            : "Não consegui ler essa foto. Tente tirar de novo, com mais luz.",
        },
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
    r.interimResults = true; // mostra o texto sendo captado ao vivo, e serve de rede de segurança
    r.maxAlternatives = 1;
    let recebeuResultado = false;
    let ultimoTexto = "";
    r.onstart = () => setOuvindo(true);
    r.onend = () => {
      setOuvindo(false);
      if (recebeuResultado) return;
      // Alguns navegadores (iOS Safari) encerram sem soltar o resultado final,
      // mesmo já tendo captado algo (via interimResults) — usa isso como rede de segurança
      // em vez de descartar tudo e dizer que não ouviu nada.
      if (ultimoTexto.trim()) {
        enviar(ultimoTexto);
      } else {
        setMensagens((m) => [
          ...m,
          {
            role: "assistant",
            text: "Não consegui ouvir nada. Confira se deu permissão de microfone pro Safari (Ajustes → Safari → Microfone) e tenta de novo, falando logo que tocar no microfone.",
          },
        ]);
      }
    };
    r.onerror = (e) => {
      setOuvindo(false);
      const motivos = {
        "not-allowed": "Preciso de permissão pra usar o microfone. Vai em Ajustes → Safari → Microfone e libera pro site da Bella.",
        "no-speech": "Não peguei nenhuma fala. Tenta de novo falando logo depois de tocar no microfone.",
        "audio-capture": "Não encontrei um microfone disponível.",
        network: "Deu erro de conexão no ditado por voz. Confira sua internet e tenta de novo.",
      };
      setMensagens((m) => [
        ...m,
        { role: "assistant", text: motivos[e.error] || `Não consegui usar o microfone agora (${e.error}). Tenta de novo.` },
      ]);
    };
    r.onresult = (e) => {
      const resultado = e.results[e.results.length - 1];
      const t = resultado[0].transcript;
      ultimoTexto = t;
      setTexto(t); // feedback ao vivo do que está sendo captado
      if (resultado.isFinal) {
        recebeuResultado = true;
        setTexto("");
        enviar(t);
      }
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
            <button
              type="button"
              className="btn-foto-inicial"
              onClick={() => fotoInputRef.current?.click()}
            >
              📷 Tirar foto ou anexar
            </button>
          </div>
        )}
        {mensagens.map((m, i) => (
          <div key={i} className={"balao " + m.role}>
            {m.foto && <img className="foto-msg" src={m.foto} alt="Foto enviada" />}
            <div className="txt">{m.text}</div>
            {m.role === "assistant" && m.text && (
              <button type="button" className="btn-ouvir" onClick={() => ouvirTexto(m.text)} title="Ouvir esta mensagem">
                🔊 Ouvir
              </button>
            )}
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
            {m.documentos?.map((d) => (
              <a key={d.id} className="btn-documento" href={d.url} download>
                📄 Baixar "{d.titulo}" (.docx)
              </a>
            ))}
            {m.cmot?.map((c, j) => (
              <div key={j} className="chip-tarefa chip-cmot">
                🏥 CMOT: {c.pacienteNome} ({c.pacienteNovo ? "novo" : "já existia"}) —{" "}
                {c.atualizada ? "atualizado" : "criado"}
              </div>
            ))}
            {m.memorias?.map((mm) => (
              <div key={mm.id} className="chip-tarefa chip-memoria">
                🧠 Guardei: {mm.conteudo}
              </div>
            ))}
            {m.modelos?.map((md) => (
              <div key={md.id} className="chip-tarefa chip-memoria">
                📐 Modelo salvo: {md.nome}
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
        <button
          type="button"
          className="camera"
          onClick={() => fotoInputRef.current?.click()}
          title="Tirar foto, escolher uma foto ou PDF salvo (ex.: recebido no WhatsApp) para a Bella ler"
          disabled={ocupado}
        >
          📷
        </button>
        <input
          ref={fotoInputRef}
          type="file"
          accept="image/*,.pdf"
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

// Exporta um item (tarefa ou conta) como arquivo .ics — ao tocar, o iPhone
// oferece "Adicionar ao Calendário" direto, sem precisar de conta/permissão externa.
function icsEscapar(txt) {
  return String(txt || "")
    .replace(/[\\;,]/g, (c) => "\\" + c)
    .replace(/\n/g, "\\n");
}

function gerarICS({ titulo, data, hora, descricao }) {
  const carimbo = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const uid = `bella-${data}-${Math.random().toString(36).slice(2)}@bella-app`;
  const dtStart = hora
    ? `DTSTART:${data.replace(/-/g, "")}T${hora.replace(":", "")}00`
    : `DTSTART;VALUE=DATE:${data.replace(/-/g, "")}`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bella//Agenda//PT",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${carimbo}`,
    dtStart,
    `SUMMARY:${icsEscapar(titulo)}`,
    descricao ? `DESCRIPTION:${icsEscapar(descricao)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}

function baixarICS({ titulo, data, hora, descricao }) {
  const conteudo = gerarICS({ titulo, data, hora, descricao });
  const blob = new Blob([conteudo], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${titulo.replace(/[^\w-]+/g, "_").slice(0, 40)}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function Agenda({ tarefas, recarregarTarefas, setTarefas, contas, recarregarContas, setContas }) {
  const [sub, setSub] = useState("calendario"); // calendario | tarefas | contas

  return (
    <div className="painel-tarefas">
      <div className="subabas">
        <button className={sub === "calendario" ? "sel" : ""} onClick={() => setSub("calendario")}>
          📆 Calendário
        </button>
        <button className={sub === "tarefas" ? "sel" : ""} onClick={() => setSub("tarefas")}>
          ✅ Tarefas
        </button>
        <button className={sub === "contas" ? "sel" : ""} onClick={() => setSub("contas")}>
          💰 Contas
        </button>
      </div>
      {sub === "calendario" && (
        <Calendario tarefas={tarefas} recarregar={recarregarTarefas} setTarefas={setTarefas} contas={contas} />
      )}
      {sub === "tarefas" && (
        <ListaTarefas tarefas={tarefas} recarregar={recarregarTarefas} setTarefas={setTarefas} />
      )}
      {sub === "contas" && (
        <ListaContas contas={contas} recarregar={recarregarContas} setContas={setContas} />
      )}
    </div>
  );
}

const ORDEM_GRUPOS_TAREFAS = ["Hoje", "Amanhã", "Esta semana", "Mais tarde", "Sem data"];

function ListaTarefas({ tarefas, recarregar, setTarefas }) {
  const [filtro, setFiltro] = useState("todas"); // hoje | todas
  const [mostrarAtrasadas, setMostrarAtrasadas] = useState(false);
  const [mostrarConcluidas, setMostrarConcluidas] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [edTitulo, setEdTitulo] = useState("");
  const [edData, setEdData] = useState("");
  const [edHora, setEdHora] = useState("");
  const [edCategoria, setEdCategoria] = useState("");
  const [edPrioridade, setEdPrioridade] = useState("media");

  function iniciarEdicao(t) {
    setEditandoId(t.id);
    setEdTitulo(t.titulo || "");
    setEdData(t.data || "");
    setEdHora(t.hora || "");
    setEdCategoria(t.categoria || "");
    setEdPrioridade(t.prioridade || "media");
  }
  function cancelarEdicao() {
    setEditandoId(null);
  }
  async function salvarEdicao(e) {
    e.preventDefault();
    if (!edTitulo.trim()) return;
    const campos = {
      titulo: edTitulo.trim(),
      data: edData || null,
      hora: edHora || null,
      categoria: edCategoria.trim() || null,
      prioridade: edPrioridade,
    };
    const id = editandoId;
    setTarefas((lista) => lista.map((x) => (x.id === id ? { ...x, ...campos } : x)));
    setEditandoId(null);
    try {
      await atualizarTarefa(id, campos);
    } finally {
      recarregar();
    }
  }

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

  const amanhaDate = new Date(hoje + "T12:00:00");
  amanhaDate.setDate(amanhaDate.getDate() + 1);
  const amanha = isoDe(amanhaDate);
  const fimSemanaDate = new Date(hoje + "T12:00:00");
  fimSemanaDate.setDate(fimSemanaDate.getDate() + 7);
  const fimSemana = isoDe(fimSemanaDate);

  const pendentesHoje = tarefas.filter((t) => t.data === hoje && t.status !== "concluida").length;

  // Tarefas pendentes com data anterior a hoje viram "Atrasadas" (não só de meses
  // passados — uma tarefa de ontem também está atrasada), e tarefas já concluídas
  // com data passada viram "Concluídas": as duas ficam fora da lista principal (que
  // some poluída com coisa velha) mas continuam acessíveis, recolhidas.
  const atrasadas = tarefas.filter((t) => t.status !== "concluida" && t.data && t.data < hoje);
  const idsAtrasadas = new Set(atrasadas.map((t) => t.id));
  const restantes = tarefas.filter((t) => !idsAtrasadas.has(t.id));

  const concluidas = restantes.filter((t) => t.status === "concluida" && t.data && t.data < hoje);
  const idsConcluidas = new Set(concluidas.map((t) => t.id));
  const semConcluidas = restantes.filter((t) => !idsConcluidas.has(t.id));

  const visiveis = filtro === "hoje" ? semConcluidas.filter((t) => t.data === hoje) : semConcluidas;

  function grupoDe(t) {
    if (!t.data) return "Sem data";
    if (t.data === hoje) return "Hoje";
    if (t.data === amanha) return "Amanhã";
    if (t.data < fimSemana) return "Esta semana";
    return "Mais tarde";
  }

  const grupos = {};
  if (filtro === "todas") {
    for (const t of visiveis) {
      (grupos[grupoDe(t)] ||= []).push(t);
    }
  }

  function cartaoTarefa(t) {
    if (editandoId === t.id) {
      return (
        <form key={t.id} className="form-nota cartao-edicao" onSubmit={salvarEdicao}>
          <input value={edTitulo} onChange={(e) => setEdTitulo(e.target.value)} autoFocus placeholder="Título" />
          <div className="linha-conta">
            <input type="date" value={edData} onChange={(e) => setEdData(e.target.value)} />
            <input type="time" value={edHora} onChange={(e) => setEdHora(e.target.value)} />
          </div>
          <div className="linha-conta">
            <input
              value={edCategoria}
              onChange={(e) => setEdCategoria(e.target.value)}
              placeholder="Categoria (opcional)"
            />
            <select value={edPrioridade} onChange={(e) => setEdPrioridade(e.target.value)}>
              <option value="baixa">Prioridade baixa</option>
              <option value="media">Prioridade média</option>
              <option value="alta">Prioridade alta</option>
            </select>
          </div>
          <div className="linha-conta">
            <button type="submit" className="btn-principal" disabled={!edTitulo.trim()}>
              Salvar
            </button>
            <button type="button" className="btn-cancelar" onClick={cancelarEdicao}>
              Cancelar
            </button>
          </div>
        </form>
      );
    }
    return (
      <div key={t.id} className={"cartao prio-" + (t.prioridade || "media") + (t.status === "concluida" ? " feita" : "")}>
        <button className="check" onClick={() => alternar(t)} title="Concluir">
          {t.status === "concluida" ? "☑" : "☐"}
        </button>
        <div className="corpo">
          <div className="titulo">{t.recorrencia ? "🔁 " : ""}{t.titulo}</div>
          <div className="meta">
            {t.data && <span>📅 {formatarData(t.data)}{t.hora ? ` · ${t.hora}` : ""}</span>}
            {t.categoria && <span className="cat">{t.categoria}</span>}
            {t.prioridade === "alta" && <span className="alta">alta</span>}
          </div>
          {t.descricao && <div className="desc">{t.descricao}</div>}
        </div>
        <div className="acoes">
          {t.data && (
            <button
              className="add-calendario"
              onClick={() =>
                baixarICS({ titulo: t.titulo, data: t.data, hora: t.hora, descricao: t.descricao })
              }
              title="Adicionar ao Calendário do iPhone"
            >
              📅
            </button>
          )}
          <button className="editar" onClick={() => iniciarEdicao(t)} title="Editar">
            ✏️
          </button>
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
    );
  }

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

      <div className="contador-tarefas">
        {pendentesHoje > 0 ? `${pendentesHoje} pendente${pendentesHoje === 1 ? "" : "s"} hoje` : "Tudo em dia por hoje 🎉"}
      </div>

      {filtro === "todas" && atrasadas.length > 0 && (
        <div className="atrasadas-bloco">
          <button className="toggle-atrasadas" onClick={() => setMostrarAtrasadas((v) => !v)}>
            {mostrarAtrasadas ? "▾" : "▸"} ⚠️ Atrasadas ({atrasadas.length})
          </button>
          {mostrarAtrasadas && <div className="lista-tarefas">{atrasadas.map(cartaoTarefa)}</div>}
        </div>
      )}

      {filtro === "todas" && concluidas.length > 0 && (
        <div className="atrasadas-bloco">
          <button className="toggle-atrasadas" onClick={() => setMostrarConcluidas((v) => !v)}>
            {mostrarConcluidas ? "▾" : "▸"} ✅ Concluídas ({concluidas.length})
          </button>
          {mostrarConcluidas && <div className="lista-tarefas">{concluidas.map(cartaoTarefa)}</div>}
        </div>
      )}

      {visiveis.length === 0 ? (
        <div className="vazio">
          {filtro === "hoje" ? (
            <p>Nada para hoje. 🎉</p>
          ) : atrasadas.length > 0 || concluidas.length > 0 ? (
            <p>Nada por aqui — veja acima.</p>
          ) : (
            <>
              <p>Nenhuma tarefa ainda.</p>
              <p className="dica">Peça na aba Conversa: "anota que preciso pagar a conta de luz sexta".</p>
            </>
          )}
        </div>
      ) : filtro === "todas" ? (
        <>
          {ORDEM_GRUPOS_TAREFAS.filter((g) => grupos[g]?.length).map((g) => (
            <div key={g} className="grupo-tarefas">
              <div className="grupo-titulo">{g}</div>
              <div className="lista-tarefas">{grupos[g].map(cartaoTarefa)}</div>
            </div>
          ))}
        </>
      ) : (
        <div className="lista-tarefas">{visiveis.map(cartaoTarefa)}</div>
      )}
    </div>
  );
}

const ORDEM_GRUPOS_CONTAS = ["Hoje", "Amanhã", "Esta semana", "Mais tarde"];

function ListaContas({ contas, recarregar, setContas }) {
  const [titulo, setTitulo] = useState("");
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [categoria, setCategoria] = useState("");

  const [mostrarAtrasadas, setMostrarAtrasadas] = useState(false);
  const [mostrarPagas, setMostrarPagas] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [edTitulo, setEdTitulo] = useState("");
  const [edValor, setEdValor] = useState("");
  const [edVencimento, setEdVencimento] = useState("");
  const [edCategoria, setEdCategoria] = useState("");

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

  function iniciarEdicao(c) {
    setEditandoId(c.id);
    setEdTitulo(c.titulo || "");
    setEdValor(c.valor != null ? String(c.valor) : "");
    setEdVencimento(c.vencimento || "");
    setEdCategoria(c.categoria || "");
  }
  function cancelarEdicao() {
    setEditandoId(null);
  }
  async function salvarEdicao(e) {
    e.preventDefault();
    if (!edTitulo.trim() || !edVencimento) return;
    const campos = {
      titulo: edTitulo.trim(),
      valor: edValor.trim() || null,
      vencimento: edVencimento,
      categoria: edCategoria.trim() || null,
    };
    const id = editandoId;
    setContas((lista) => lista.map((x) => (x.id === id ? { ...x, ...campos } : x)));
    setEditandoId(null);
    try {
      await atualizarConta(id, campos);
    } finally {
      recarregar();
    }
  }

  const hoje = isoDe(new Date());
  const amanhaDate = new Date(hoje + "T12:00:00");
  amanhaDate.setDate(amanhaDate.getDate() + 1);
  const amanha = isoDe(amanhaDate);
  const fimSemanaDate = new Date(hoje + "T12:00:00");
  fimSemanaDate.setDate(fimSemanaDate.getDate() + 7);
  const fimSemana = isoDe(fimSemanaDate);

  // Mesma lógica das tarefas: atrasadas e pagas ficam recolhidas por padrão, o
  // resto é agrupado por proximidade do vencimento — sem isso, contas antigas já
  // pagas ficam poluindo a lista pra sempre.
  const atrasadas = contas.filter((c) => c.status !== "pago" && c.vencimento < hoje);
  const idsAtrasadas = new Set(atrasadas.map((c) => c.id));
  const pagas = contas.filter((c) => c.status === "pago" && !idsAtrasadas.has(c.id));
  const idsPagas = new Set(pagas.map((c) => c.id));
  const visiveis = contas.filter((c) => !idsAtrasadas.has(c.id) && !idsPagas.has(c.id));

  const somaPendente = visiveis
    .concat(atrasadas)
    .reduce((soma, c) => soma + (c.valor != null ? Number(c.valor) : 0), 0);
  const totalPendentes = visiveis.length + atrasadas.length;

  function grupoDe(c) {
    if (c.vencimento === hoje) return "Hoje";
    if (c.vencimento === amanha) return "Amanhã";
    if (c.vencimento < fimSemana) return "Esta semana";
    return "Mais tarde";
  }
  const grupos = {};
  for (const c of visiveis) {
    (grupos[grupoDe(c)] ||= []).push(c);
  }

  function cartaoConta(c) {
    if (editandoId === c.id) {
      return (
        <form key={c.id} className="form-nota cartao-edicao" onSubmit={salvarEdicao}>
          <input value={edTitulo} onChange={(e) => setEdTitulo(e.target.value)} autoFocus placeholder="Título" />
          <div className="linha-conta">
            <input
              value={edValor}
              onChange={(e) => setEdValor(e.target.value)}
              placeholder="Valor (R$)"
              inputMode="decimal"
            />
            <input type="date" value={edVencimento} onChange={(e) => setEdVencimento(e.target.value)} />
          </div>
          <input
            value={edCategoria}
            onChange={(e) => setEdCategoria(e.target.value)}
            placeholder="Categoria (opcional)"
          />
          <div className="linha-conta">
            <button type="submit" className="btn-principal" disabled={!edTitulo.trim() || !edVencimento}>
              Salvar
            </button>
            <button type="button" className="btn-cancelar" onClick={cancelarEdicao}>
              Cancelar
            </button>
          </div>
        </form>
      );
    }
    const atrasada = c.status !== "pago" && c.vencimento < hoje;
    return (
      <div key={c.id} className={"cartao" + (c.status === "pago" ? " feita" : "") + (atrasada ? " atrasada" : "")}>
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
          <button
            className="add-calendario"
            onClick={() =>
              baixarICS({
                titulo: `💰 ${c.titulo}`,
                data: c.vencimento,
                descricao: c.valor != null ? `Valor: R$ ${Number(c.valor).toFixed(2)}` : "",
              })
            }
            title="Adicionar ao Calendário do iPhone"
          >
            📅
          </button>
          <button className="editar" onClick={() => iniciarEdicao(c)} title="Editar">
            ✏️
          </button>
          <button className="apagar" onClick={() => remover(c)} title="Apagar">
            🗑
          </button>
        </div>
      </div>
    );
  }

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
        <>
          <div className="contador-tarefas">
            {totalPendentes > 0
              ? `R$ ${somaPendente.toFixed(2)} em ${totalPendentes} conta${totalPendentes === 1 ? "" : "s"} pendente${totalPendentes === 1 ? "" : "s"}`
              : "Nenhuma conta pendente 🎉"}
          </div>

          {atrasadas.length > 0 && (
            <div className="atrasadas-bloco">
              <button className="toggle-atrasadas" onClick={() => setMostrarAtrasadas((v) => !v)}>
                {mostrarAtrasadas ? "▾" : "▸"} ⚠️ Atrasadas ({atrasadas.length})
              </button>
              {mostrarAtrasadas && <div className="lista-tarefas">{atrasadas.map(cartaoConta)}</div>}
            </div>
          )}

          {pagas.length > 0 && (
            <div className="atrasadas-bloco">
              <button className="toggle-atrasadas" onClick={() => setMostrarPagas((v) => !v)}>
                {mostrarPagas ? "▾" : "▸"} ✅ Pagas ({pagas.length})
              </button>
              {mostrarPagas && <div className="lista-tarefas">{pagas.map(cartaoConta)}</div>}
            </div>
          )}

          {visiveis.length === 0 ? (
            <div className="vazio">
              <p>Nada por aqui — veja acima.</p>
            </div>
          ) : (
            ORDEM_GRUPOS_CONTAS.filter((g) => grupos[g]?.length).map((g) => (
              <div key={g} className="grupo-tarefas">
                <div className="grupo-titulo">{g}</div>
                <div className="lista-tarefas">{grupos[g].map(cartaoConta)}</div>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}

const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];

function Calendario({ tarefas, recarregar, setTarefas, contas }) {
  const [mesAtual, setMesAtual] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [diaSelecionado, setDiaSelecionado] = useState(() => isoDe(new Date()));
  const [sheetAberto, setSheetAberto] = useState(false);

  const itensPorDia = useMemo(() => {
    const mapa = {};
    for (const t of tarefas) {
      if (!t.data) continue;
      if (!mapa[t.data]) mapa[t.data] = { tarefas: [], contas: [] };
      mapa[t.data].tarefas.push(t);
    }
    for (const c of contas) {
      if (!mapa[c.vencimento]) mapa[c.vencimento] = { tarefas: [], contas: [] };
      mapa[c.vencimento].contas.push(c);
    }
    return mapa;
  }, [tarefas, contas]);

  async function alternar(t) {
    const novo = t.status === "concluida" ? "pendente" : "concluida";
    setTarefas((lista) => lista.map((x) => (x.id === t.id ? { ...x, status: novo } : x)));
    try {
      await atualizarTarefa(t.id, { status: novo });
    } finally {
      recarregar();
    }
  }

  const ano = mesAtual.getFullYear();
  const mes = mesAtual.getMonth();
  const primeiroDiaSemana = new Date(ano, mes, 1).getDay();
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();

  const celulas = [];
  for (let i = 0; i < primeiroDiaSemana; i++) celulas.push(null);
  for (let d = 1; d <= diasNoMes; d++) celulas.push(d);
  const linhas = Math.ceil(celulas.length / 7);

  function isoDoDia(d) {
    return `${ano}-${String(mes + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  const hoje = isoDe(new Date());
  const itensDia = itensPorDia[diaSelecionado] || { tarefas: [], contas: [] };
  const nomeMes = mesAtual.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  const resumoMes = useMemo(() => {
    let t = 0,
      c = 0;
    for (const iso in itensPorDia) {
      if (!iso.startsWith(`${ano}-${String(mes + 1).padStart(2, "0")}`)) continue;
      t += itensPorDia[iso].tarefas.length;
      c += itensPorDia[iso].contas.length;
    }
    return { t, c };
  }, [itensPorDia, ano, mes]);

  return (
    <div className="calendario">
      <div className="cal-nav">
        <button onClick={() => setMesAtual(new Date(ano, mes - 1, 1))}>‹</button>
        <div className="cal-nav-meio">
          <strong>{nomeMes}</strong>
          {(resumoMes.t > 0 || resumoMes.c > 0) && (
            <span className="cal-resumo-mes">
              {resumoMes.t > 0 && `${resumoMes.t} tarefa${resumoMes.t > 1 ? "s" : ""}`}
              {resumoMes.t > 0 && resumoMes.c > 0 && " · "}
              {resumoMes.c > 0 && `${resumoMes.c} conta${resumoMes.c > 1 ? "s" : ""}`}
            </span>
          )}
        </div>
        <button onClick={() => setMesAtual(new Date(ano, mes + 1, 1))}>›</button>
      </div>
      {diaSelecionado !== hoje && (
        <button
          className="cal-btn-hoje"
          onClick={() => {
            setMesAtual(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
            setDiaSelecionado(hoje);
          }}
        >
          Ir para hoje
        </button>
      )}
      <div className="cal-semana">
        {DIAS_SEMANA.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="cal-grade" style={{ "--linhas": linhas }}>
        {celulas.map((d, i) => {
          if (d == null) return <div key={i} className="cal-dia vazia" />;
          const iso = isoDoDia(d);
          const item = itensPorDia[iso];
          const temAlta = item?.tarefas.some((t) => t.prioridade === "alta" && t.status !== "concluida");
          const pendentes = item ? item.tarefas.filter((t) => t.status !== "concluida").length : 0;
          const temConta = item && item.contas.length > 0;
          const total = item ? item.tarefas.length + item.contas.length : 0;
          return (
            <button
              key={i}
              className={
                "cal-dia" +
                (iso === diaSelecionado ? " sel" : "") +
                (iso === hoje ? " hoje" : "") +
                (temAlta ? " urgente" : "")
              }
              onClick={() => {
                setDiaSelecionado(iso);
                setSheetAberto(true);
              }}
            >
              <span className="cal-dia-num">{d}</span>
              {total > 0 && (
                <span className="cal-pontos">
                  {pendentes > 0 && <span className={"cal-ponto tarefa" + (temAlta ? " alta" : "")} />}
                  {temConta && <span className="cal-ponto conta" />}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {sheetAberto && (
        <div className="cal-sheet-fundo" onClick={() => setSheetAberto(false)}>
          <div className="cal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="cal-sheet-alca" />
            <div className="cal-lista-titulo">{formatarData(diaSelecionado)}</div>
            {itensDia.tarefas.length === 0 && itensDia.contas.length === 0 ? (
              <p className="dica">Nada por aqui. 🎉</p>
            ) : (
              <>
                {itensDia.tarefas.map((t) => (
                  <div key={"t" + t.id} className={"cal-item prio-" + (t.prioridade || "media") + (t.status === "concluida" ? " feita" : "")}>
                    <button className="check" onClick={() => alternar(t)} title="Concluir">
                      {t.status === "concluida" ? "☑" : "☐"}
                    </button>
                    <div className="cal-item-corpo">
                      <div className="cal-item-titulo">{t.titulo}</div>
                      {(t.hora || t.categoria) && (
                        <div className="cal-item-meta">
                          {t.hora && <span>🕐 {t.hora}</span>}
                          {t.categoria && <span>{t.categoria}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {itensDia.contas.map((c) => (
                  <div key={"c" + c.id} className="cal-item conta">
                    <span className="cal-item-icone">💰</span>
                    <div className="cal-item-corpo">
                      <div className="cal-item-titulo">{c.titulo}</div>
                      {c.valor != null && <div className="cal-item-meta">R$ {Number(c.valor).toFixed(2)}</div>}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
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
function PainelBackup({ fechar, abrirSobre }) {
  const [info, setInfo] = useState(null);
  const [erro, setErro] = useState("");
  const [calStatus, setCalStatus] = useState(null);
  const [pushEstado, setPushEstado] = useState(""); // "" | "inscrito" | "ativando" | "negado" | "indisponivel"
  const [pushTeste, setPushTeste] = useState("");

  useEffect(() => {
    backupInfo()
      .then(setInfo)
      .catch(() => setErro("Não consegui verificar o backup agora."));
    calendarioStatus()
      .then(setCalStatus)
      .catch(() => {});
    if ("serviceWorker" in navigator && "PushManager" in window) {
      navigator.serviceWorker.ready
        .then((r) => r.pushManager.getSubscription())
        .then((s) => setPushEstado(s ? "inscrito" : ""))
        .catch(() => {});
    } else {
      setPushEstado("indisponivel");
    }
  }, []);

  async function ativarPush() {
    setPushEstado("ativando");
    try {
      const resultado = await ativarNotificacoesPush();
      setPushEstado(resultado === "ok" ? "inscrito" : resultado);
    } catch {
      setPushEstado("erro");
    }
  }

  async function testarPush() {
    setPushTeste("enviando");
    try {
      await pushTestar();
      setPushTeste("enviado");
    } catch {
      setPushTeste("erro");
    }
  }

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

        {info && info.existe && (
          <p className="dica">
            {info.emailAtivo ? "🟢" : "⚪️"} Backup semanal automático por e-mail —{" "}
            {info.emailAtivo ? "ativo" : "não configurado"}
          </p>
        )}

        <hr className="separador" />

        <strong>📅 Calendário automático</strong>
        {calStatus ? (
          <ul className="lista-status-calendario">
            <li>
              {calStatus.apple ? "🟢" : "⚪️"} Calendário da Apple (iPhone/iPad) —{" "}
              {calStatus.apple ? "conectado" : "não conectado"}
            </li>
            <li>
              {calStatus.google ? "🟢" : "⚪️"} Google Calendar — {calStatus.google ? "conectado" : "não conectado"}
            </li>
          </ul>
        ) : (
          <p className="dica">Verificando…</p>
        )}
        {calStatus && !calStatus.apple && (
          <p className="dica">
            Quando você gerar a senha de app do seu Apple ID e eu configurar no servidor, toda
            tarefa e conta com data passa a aparecer sozinha no Calendário do iPhone.
          </p>
        )}
        {calStatus && calStatus.googleConfigurado && !calStatus.google && (
          <a className="btn-principal btn-baixar" href="/api/calendario/google/conectar">
            🔗 Conectar Google Calendar
          </a>
        )}
        {calStatus && !calStatus.googleConfigurado && (
          <p className="dica">Google Calendar ainda não foi configurado no servidor.</p>
        )}

        <hr className="separador" />

        <strong>🔔 Notificações no iPhone</strong>
        {pushEstado === "indisponivel" && (
          <p className="dica">
            Seu navegador não suporta isso, ou o app ainda não foi "Adicionado à Tela de Início" —
            no iPhone, a notificação só funciona depois de instalado assim.
          </p>
        )}
        {pushEstado === "negado" && (
          <p className="dica">
            Notificação bloqueada. Vá em Ajustes do iPhone → Bella → Notificações e permita, depois
            tente de novo.
          </p>
        )}
        {pushEstado === "erro" && <p className="erro">Não consegui ativar agora. Tente de novo.</p>}
        {(pushEstado === "" || pushEstado === "ativando" || pushEstado === "erro") && (
          <>
            <p className="dica">
              Ative pra receber o resumo diário e lembretes direto na tela do iPhone, mesmo com a
              Bella fechada.
            </p>
            <button type="button" className="btn-principal btn-baixar" onClick={ativarPush} disabled={pushEstado === "ativando"}>
              {pushEstado === "ativando" ? "Ativando…" : "🔔 Ativar notificações"}
            </button>
          </>
        )}
        {pushEstado === "inscrito" && (
          <>
            <p className="dica">🟢 Notificações ativadas neste dispositivo.</p>
            <button type="button" className="btn-principal btn-baixar" onClick={testarPush} disabled={pushTeste === "enviando"}>
              {pushTeste === "enviando" ? "Enviando…" : "Testar notificação"}
            </button>
            {pushTeste === "enviado" && <p className="dica">Enviada! Deve chegar em alguns segundos.</p>}
            {pushTeste === "erro" && <p className="erro">Não consegui enviar o teste agora.</p>}
          </>
        )}

        <hr className="separador" />
        <button type="button" className="link-sobre" onClick={abrirSobre}>
          ℹ️ Sobre a Bella / Ajuda
        </button>
      </div>
    </div>
  );
}

/* ---------------- Sobre / Ajuda ---------------- */
function PainelSobre({ fechar }) {
  return (
    <div className="modal-fundo" onClick={fechar}>
      <div className="modal-backup" onClick={(e) => e.stopPropagation()}>
        <div className="modal-topo">
          <strong>ℹ️ Sobre a Bella</strong>
          <button className="fechar" onClick={fechar}>
            ✕
          </button>
        </div>

        <p className="dica">
          Assistente pessoal por voz e texto — organiza tarefas, contas, contatos e senhas,
          lê fotos/PDFs de documentos, escreve relatórios médicos, cadastra cirurgias no CMOT
          quando você pedir, e te avisa todo dia às 7h com o resumo do que vem por aí.
        </p>

        <hr className="separador" />

        <strong>📱 Como instalar no celular</strong>
        <p className="dica">
          <strong>iPhone/iPad (Safari):</strong> abra a Bella no Safari → toque em Compartilhar
          ⬆️ → "Adicionar à Tela de Início". Sem isso instalado, a notificação push não funciona.
        </p>
        <p className="dica">
          <strong>Android (Chrome):</strong> abra no Chrome → ⋮ → "Instalar aplicativo".
        </p>

        <hr className="separador" />

        <strong>⚙️ O que ela faz</strong>
        <ul className="lista-sobre">
          <li>💬 Conversa por voz ou texto, lembra o que você pede (tarefas, contas)</li>
          <li>📅 Agenda em calendário — tarefas e contas por dia, marca concluído direto ali</li>
          <li>📷 Lê foto ou PDF de documento (boleto vira conta, apólice vira lembrete de parcela)</li>
          <li>🔒 Cofre de senhas com PIN, organizado em pastas, aceita anexar arquivos</li>
          <li>📇 Contatos com WhatsApp pessoal/profissional — importa tudo de uma vez via .vcf</li>
          <li>📝 Gera relatório/atestado/glosa/orçamento em .docx de verdade, sempre um rascunho</li>
          <li>🏥 Cadastra ou consulta cirurgias no CMOT, só quando você pedir</li>
          <li>🧠 Memória de longo prazo — guarda fatos que valem sempre, não só do dia</li>
          <li>🗣️ Voz natural (Google) além da voz padrão do navegador</li>
          <li>📆 Sincroniza automaticamente com o Calendário do iPhone (e Google, se conectado)</li>
          <li>🔔 Notificação push e resumo diário por e-mail, mesmo com o app fechado</li>
          <li>🌗 Modo escuro automático ou manual</li>
        </ul>

        <hr className="separador" />

        <strong>💡 Dicas rápidas</strong>
        <ul className="lista-sobre">
          <li>Toque no microfone e fale — não precisa digitar</li>
          <li>"Guarda isso" salva uma memória; "usa o modelo X" reaproveita um documento aprovado</li>
          <li>O ícone 💾 no topo mostra backup, calendário e notificações</li>
        </ul>
      </div>
    </div>
  );
}

/* ---------------- Voz da Bella ---------------- */
function PainelVoz({ fechar }) {
  const [vozes, setVozes] = useState([]);
  const [vozesGoogle, setVozesGoogle] = useState([]);
  const [googleDisponivel, setGoogleDisponivel] = useState(false);
  const [escolhida, setEscolhida] = useState(() => localStorage.getItem(CHAVE_VOZ_ESCOLHIDA) || "");
  const [testando, setTestando] = useState("");

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    function atualizar() {
      const todas = window.speechSynthesis.getVoices();
      const pt = todas.filter((v) => v.lang?.toLowerCase().startsWith("pt"));
      setVozes(pt.length ? pt : todas);
    }
    atualizar();
    window.speechSynthesis.addEventListener("voiceschanged", atualizar);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", atualizar);
  }, []);

  useEffect(() => {
    vozStatus()
      .then((s) => {
        setGoogleDisponivel(s.disponivel);
        setVozesGoogle(s.vozes || []);
      })
      .catch(() => {});
  }, []);

  function escolher(id) {
    setEscolhida(id);
    localStorage.setItem(CHAVE_VOZ_ESCOLHIDA, id);
  }

  function testarNavegador(nome) {
    if (!("speechSynthesis" in window)) return;
    const voz = vozes.find((v) => v.name === nome);
    const u = new SpeechSynthesisUtterance("Oi, doutor! Essa é a minha voz.");
    u.lang = "pt-BR";
    if (voz) u.voice = voz;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  async function testarGoogle(id) {
    setTestando(id);
    try {
      const { audioBase64 } = await sintetizarVoz("Oi, doutor! Essa é a minha voz.", id);
      const audio = new Audio(`data:audio/mp3;base64,${audioBase64}`);
      audio.onended = () => setTestando("");
      audio.onerror = () => setTestando("");
      audio.play();
    } catch {
      setTestando("");
      alert("Não consegui testar essa voz agora.");
    }
  }

  return (
    <div className="modal-fundo" onClick={fechar}>
      <div className="modal-backup" onClick={(e) => e.stopPropagation()}>
        <div className="modal-topo">
          <strong>🗣️ Voz da Bella</strong>
          <button className="fechar" onClick={fechar}>
            ✕
          </button>
        </div>

        <p className="dica">Escolha a voz que a Bella vai usar para falar com você.</p>

        {googleDisponivel && (
          <>
            <div className="categoria-titulo">✨ Vozes naturais (Google)</div>
            <div className="lista-vozes">
              {vozesGoogle.map((v) => {
                const id = `google:${v.id}`;
                return (
                  <div key={id} className={"voz-opcao" + (escolhida === id ? " sel" : "")}>
                    <button className="voz-nome" onClick={() => escolher(id)}>
                      {escolhida === id ? "●" : "○"} {v.nome}
                    </button>
                    <button className="voz-testar" onClick={() => testarGoogle(v.id)} title="Ouvir esta voz">
                      {testando === v.id ? "…" : "▶"}
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="categoria-titulo">🔊 Vozes do navegador (grátis, mais robóticas)</div>
        {vozes.length === 0 ? (
          <p className="dica">
            Seu navegador não encontrou vozes em português ainda. Tente abrir de novo, ou
            use o Safari (iPhone/iPad) ou o Chrome.
          </p>
        ) : (
          <div className="lista-vozes">
            {vozes.map((v) => (
              <div key={v.name} className={"voz-opcao" + (escolhida === v.name ? " sel" : "")}>
                <button className="voz-nome" onClick={() => escolher(v.name)}>
                  {escolhida === v.name ? "●" : "○"} {v.name}
                </button>
                <button className="voz-testar" onClick={() => testarNavegador(v.name)} title="Ouvir esta voz">
                  ▶
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Memória de longo prazo ---------------- */
function PainelMemoria({ fechar }) {
  const [sub, setSub] = useState("memorias"); // memorias | modelos
  const [memorias, setMemorias] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [modelos, setModelos] = useState([]);
  const [carregandoModelos, setCarregandoModelos] = useState(true);
  const [modeloAberto, setModeloAberto] = useState(null);

  useEffect(() => {
    listarMemorias()
      .then(setMemorias)
      .catch(() => {})
      .finally(() => setCarregando(false));
    listarModelos()
      .then(setModelos)
      .catch(() => {})
      .finally(() => setCarregandoModelos(false));
  }, []);

  async function remover(id) {
    if (!confirm("Apagar esta memória? A Bella vai esquecer disso.")) return;
    setMemorias((m) => m.filter((x) => x.id !== id));
    await apagarMemoria(id).catch(() => {});
  }

  async function removerModelo(id) {
    if (!confirm("Apagar este modelo de documento?")) return;
    setModelos((m) => m.filter((x) => x.id !== id));
    if (modeloAberto === id) setModeloAberto(null);
    await apagarModelo(id).catch(() => {});
  }

  return (
    <div className="modal-fundo" onClick={fechar}>
      <div className="modal-backup" onClick={(e) => e.stopPropagation()}>
        <div className="modal-topo">
          <strong>{sub === "memorias" ? "🧠 O que a Bella sabe" : "📐 Modelos de documento"}</strong>
          <button className="fechar" onClick={fechar}>
            ✕
          </button>
        </div>

        <div className="subabas">
          <button className={sub === "memorias" ? "sel" : ""} onClick={() => setSub("memorias")}>
            🧠 Memórias
          </button>
          <button className={sub === "modelos" ? "sel" : ""} onClick={() => setSub("modelos")}>
            📐 Modelos
          </button>
        </div>

        {sub === "memorias" && (
          <>
            <p className="dica">
              Fatos e contextos que ela guarda pra sempre, em qualquer conversa — diferente do
              chat do dia, que reinicia todo dia. Ela mesma decide o que vale guardar; aqui você
              pode conferir e apagar o que quiser.
            </p>

            {carregando && <p className="dica">Carregando…</p>}
            {!carregando && memorias.length === 0 && (
              <p className="dica">Nenhuma memória guardada ainda.</p>
            )}
            {memorias.length > 0 && (
              <div className="lista-memorias">
                {memorias.map((m) => (
                  <div key={m.id} className="memoria-item">
                    <span>{m.conteudo}</span>
                    <button onClick={() => remover(m.id)} title="Apagar esta memória">
                      🗑
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {sub === "modelos" && (
          <>
            <p className="dica">
              Estruturas de relatórios/atestados já aprovados, guardadas pra reusar sem montar
              do zero. Peça "guarda esse modelo" depois que aprovar um documento; da próxima vez
              é só pedir "usa o modelo X".
            </p>

            {carregandoModelos && <p className="dica">Carregando…</p>}
            {!carregandoModelos && modelos.length === 0 && (
              <p className="dica">Nenhum modelo guardado ainda.</p>
            )}
            {modelos.length > 0 && (
              <div className="lista-memorias">
                {modelos.map((md) => {
                  const aberto = modeloAberto === md.id;
                  return (
                    <div key={md.id} className="modelo-item">
                      <div className="modelo-cabecalho" onClick={() => setModeloAberto(aberto ? null : md.id)}>
                        <span>{aberto ? "▾" : "▸"} {md.nome}</span>
                        <button onClick={(e) => { e.stopPropagation(); removerModelo(md.id); }} title="Apagar este modelo">
                          🗑
                        </button>
                      </div>
                      {aberto && (
                        <div className="modelo-preview">
                          <strong>{md.titulo}</strong>
                          {md.subtitulo && <div className="dica">{md.subtitulo}</div>}
                          {(md.secoes || []).map((s, i) => (
                            <div key={i} className="modelo-secao">
                              <strong>{s.titulo}</strong>
                              <p>{s.texto}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
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
  const [categoriaAberta, setCategoriaAberta] = useState(null); // null = grade de pastas
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState(null); // null = criando nova nota

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

  async function salvarNota(e) {
    e.preventDefault();
    if (!novoTitulo.trim()) return;
    const dados = {
      titulo: novoTitulo.trim(),
      conteudo: novoConteudo.trim(),
      categoria: novaCategoria || null,
    };
    if (editandoId) {
      const atualizada = await cofreAtualizarNota(pin, editandoId, dados);
      setNotas((n) => n.map((x) => (x.id === editandoId ? { ...x, ...atualizada } : x)));
    } else {
      const nota = await cofreCriarNota(pin, dados);
      setNotas((n) => [nota, ...n]);
    }
    fecharForm();
  }

  function iniciarEdicao(n) {
    setEditandoId(n.id);
    setNovoTitulo(n.titulo || "");
    setNovoConteudo(n.conteudo || "");
    setNovaCategoria(n.categoria || "");
    setMostrarForm(true);
  }

  function fecharForm() {
    setNovoTitulo("");
    setNovoConteudo("");
    setNovaCategoria(categoriaAberta && categoriaAberta !== "Outros" ? categoriaAberta : "");
    setEditandoId(null);
    setMostrarForm(false);
  }

  function abrirNovaNota() {
    setEditandoId(null);
    setNovoTitulo("");
    setNovoConteudo("");
    setNovaCategoria(categoriaAberta && categoriaAberta !== "Outros" ? categoriaAberta : "");
    setMostrarForm(true);
  }

  function abrirCategoria(cat) {
    setCategoriaAberta(cat);
    setNovaCategoria(cat === "Outros" ? "" : cat);
    setMostrarForm(false);
    setEditandoId(null);
    setBusca("");
  }

  function voltarPastas() {
    setCategoriaAberta(null);
    setNovaCategoria("");
    setMostrarForm(false);
    setEditandoId(null);
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

  // Busca sempre olha tudo, independente da pasta aberta — escape hatch rápido.
  const buscaAtiva = busca.trim().length > 0;
  const filtradas = notas.filter((n) => {
    if (!buscaAtiva) return true;
    const q = busca.toLowerCase();
    return (
      (n.titulo || "").toLowerCase().includes(q) ||
      (n.categoria || "").toLowerCase().includes(q) ||
      (n.conteudo || "").toLowerCase().includes(q)
    );
  });

  const contagemPorCategoria = {};
  for (const n of notas) {
    const c = n.categoria || "Outros";
    contagemPorCategoria[c] = (contagemPorCategoria[c] || 0) + 1;
  }
  const pastas = [...CATEGORIAS_COFRE, ...(contagemPorCategoria["Outros"] ? ["Outros"] : [])];

  const notasDaPastaAberta = categoriaAberta
    ? notas.filter((n) => (n.categoria || "Outros") === categoriaAberta)
    : [];

  function separarIconeNome(cat) {
    const espaco = cat.indexOf(" ");
    return espaco === -1 ? { icone: "📁", nome: cat } : { icone: cat.slice(0, espaco), nome: cat.slice(espaco + 1) };
  }

  const formNota = (
    <form className="form-nota" onSubmit={salvarNota}>
      <input
        placeholder="Título (ex.: Banco do Brasil)"
        value={novoTitulo}
        onChange={(e) => setNovoTitulo(e.target.value)}
        autoFocus
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
        {editandoId ? "Salvar alterações" : "+ Guardar"}
      </button>
    </form>
  );

  function cartaoNota(n) {
    return (
      <div key={n.id} className="nota-bloco">
        <div className="nota">
          <div className="nota-corpo">
            <div className="titulo">{n.titulo}</div>
            {n.conteudo && <div className="desc">{n.conteudo}</div>}
          </div>
          <div className="nota-acoes">
            <button className="copiar" onClick={() => copiar(n)} title="Copiar">📋</button>
            <button className="editar" onClick={() => iniciarEdicao(n)} title="Editar">✏️</button>
            <button className="apagar" onClick={() => removerNota(n.id)} title="Apagar">🗑</button>
          </div>
        </div>
        <ArquivosNota pin={pin} nota={n} />
      </div>
    );
  }

  return (
    <div className="cofre-aberto">
      <div className="cofre-topo">
        {categoriaAberta && !buscaAtiva ? (
          <button className="voltar-pastas" onClick={voltarPastas}>‹ Pastas</button>
        ) : (
          <span>🔓 Cofre aberto</span>
        )}
        <button className="trancar" onClick={trancar}>
          Trancar
        </button>
      </div>

      <input
        className="busca-cofre"
        placeholder="🔎 Buscar em tudo (ex.: banco, hospital, gov)"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
      />

      {buscaAtiva ? (
        <div className="notas">
          {filtradas.length === 0 ? (
            <div className="vazio"><p className="dica">Nada encontrado.</p></div>
          ) : (
            filtradas.map((n) => cartaoNota(n))
          )}
        </div>
      ) : categoriaAberta === null ? (
        <>
          <button type="button" className="btn-nova-nota" onClick={mostrarForm ? fecharForm : abrirNovaNota}>
            {mostrarForm ? "Cancelar" : "+ Nova nota"}
          </button>
          {mostrarForm && formNota}
          {notas.length === 0 && !mostrarForm ? (
            <div className="vazio"><p className="dica">Nenhuma nota guardada ainda.</p></div>
          ) : (
            <div className="pastas-grade">
              {pastas.map((cat) => {
                const { icone, nome } = separarIconeNome(cat);
                return (
                  <button key={cat} className="pasta" onClick={() => abrirCategoria(cat)}>
                    <span className="pasta-icone">{icone}</span>
                    <span className="pasta-nome">{nome}</span>
                    <span className="pasta-conta">{contagemPorCategoria[cat] || 0}</span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="categoria-titulo">{separarIconeNome(categoriaAberta).icone} {separarIconeNome(categoriaAberta).nome}</div>
          <button type="button" className="btn-nova-nota" onClick={mostrarForm ? fecharForm : abrirNovaNota}>
            {mostrarForm ? "Cancelar" : "+ Nova nota aqui"}
          </button>
          {mostrarForm && formNota}
          {notasDaPastaAberta.length === 0 ? (
            <div className="vazio"><p className="dica">Nenhuma nota nesta pasta ainda.</p></div>
          ) : (
            <div className="notas">{notasDaPastaAberta.map((n) => cartaoNota(n))}</div>
          )}
        </>
      )}
    </div>
  );
}

function ArquivosNota({ pin, nota }) {
  const [aberto, setAberto] = useState(false);
  const [arquivos, setArquivos] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const fileRef = useRef(null);

  async function carregar() {
    setCarregando(true);
    try {
      setArquivos(await cofreListarArquivos(pin, nota.id));
    } catch {
      /* ignora — tenta de novo na próxima abertura */
    } finally {
      setCarregando(false);
    }
  }

  function alternar() {
    const novo = !aberto;
    setAberto(novo);
    if (novo) carregar();
  }

  async function anexar(e) {
    const arquivos = Array.from(e.target.files || []);
    e.target.value = "";
    if (!arquivos.length) return;
    setEnviando(true);
    let falhas = 0;
    for (const arquivo of arquivos) {
      try {
        const leitor = new FileReader();
        const base64 = await new Promise((resolve, reject) => {
          leitor.onerror = () => reject(new Error("Não consegui ler o arquivo."));
          leitor.onload = () => resolve(leitor.result.split(",")[1]);
          leitor.readAsDataURL(arquivo);
        });
        const novo = await cofreAnexarArquivo(pin, nota.id, {
          nomeOriginal: arquivo.name,
          tipoMime: arquivo.type,
          base64,
        });
        setArquivos((a) => [...a, novo]);
      } catch {
        falhas++;
      }
    }
    setEnviando(false);
    if (falhas) alert(`Não consegui anexar ${falhas} arquivo(s). Tenta de novo com esses.`);
  }

  async function baixar(arquivoId) {
    const { base64, tipoMime, nomeOriginal } = await cofreBaixarArquivo(pin, nota.id, arquivoId);
    const link = document.createElement("a");
    link.href = `data:${tipoMime || "application/octet-stream"};base64,${base64}`;
    link.download = nomeOriginal || "arquivo";
    link.click();
  }

  async function apagar(arquivoId) {
    if (!confirm("Apagar este arquivo?")) return;
    setArquivos((a) => a.filter((x) => x.id !== arquivoId));
    await cofreApagarArquivo(pin, nota.id, arquivoId).catch(() => {});
  }

  return (
    <div className="arquivos-nota">
      <button type="button" className="arquivos-toggle" onClick={alternar}>
        📎 {aberto ? "Ocultar arquivos" : "Ver/anexar arquivos"}
      </button>
      {aberto && (
        <div className="arquivos-lista">
          {carregando && <p className="dica">Carregando…</p>}
          {!carregando && arquivos.length === 0 && <p className="dica">Nenhum arquivo anexado ainda.</p>}
          {arquivos.map((a) => (
            <div key={a.id} className="arquivo-item">
              <span>📄 {a.nome_original || "arquivo"}</span>
              <div className="arquivo-acoes">
                <button type="button" onClick={() => baixar(a.id)} title="Baixar">⬇️</button>
                <button type="button" onClick={() => apagar(a.id)} title="Apagar">🗑</button>
              </div>
            </div>
          ))}
          <button type="button" className="anexar-btn" onClick={() => fileRef.current?.click()} disabled={enviando}>
            {enviando ? "Enviando…" : "+ Anexar foto/arquivo"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf"
            multiple
            style={{ display: "none" }}
            onChange={anexar}
          />
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
  const [importados, setImportados] = useState(null); // lista pra revisar antes de confirmar
  const [contaImportacao, setContaImportacao] = useState("pessoal");
  const [importando, setImportando] = useState(false);
  const arquivoVcfRef = useRef(null);

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

  async function selecionarArquivoVcf(e) {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;
    const texto = await arquivo.text();
    const extraidos = parseVCF(texto);
    if (extraidos.length === 0) {
      alert("Não encontrei nenhum contato válido nesse arquivo.");
      return;
    }
    const jaExistentes = new Set(contatos.map((c) => c.telefone.replace(/\D/g, "")));
    const novos = extraidos.filter((c) => !jaExistentes.has(c.telefone.replace(/\D/g, "")));
    setImportados({ novos, repetidos: extraidos.length - novos.length });
  }

  async function confirmarImportacao() {
    if (!importados) return;
    setImportando(true);
    let ok = 0;
    for (const c of importados.novos) {
      try {
        const novo = await criarContato({ nome: c.nome, telefone: c.telefone, conta: contaImportacao });
        setContatos((lista) => [...lista, novo].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
        ok++;
      } catch {
        /* pula esse e segue os outros */
      }
    }
    setImportando(false);
    setImportados(null);
    alert(`${ok} contato${ok === 1 ? "" : "s"} importado${ok === 1 ? "" : "s"} com sucesso.`);
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

      <button type="button" className="btn-importar-contatos" onClick={() => arquivoVcfRef.current?.click()}>
        📇 Importar contatos do iPhone (.vcf)
      </button>
      <input
        ref={arquivoVcfRef}
        type="file"
        accept=".vcf,text/vcard,text/x-vcard"
        style={{ display: "none" }}
        onChange={selecionarArquivoVcf}
      />

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

      {importados && (
        <div className="modal-fundo" onClick={() => !importando && setImportados(null)}>
          <div className="modal-backup" onClick={(e) => e.stopPropagation()}>
            <div className="modal-topo">
              <strong>📇 Importar contatos</strong>
              {!importando && (
                <button className="fechar" onClick={() => setImportados(null)}>
                  ✕
                </button>
              )}
            </div>
            <p className="dica">
              Encontrei <strong>{importados.novos.length}</strong> contato{importados.novos.length === 1 ? "" : "s"} novo{importados.novos.length === 1 ? "" : "s"} nesse arquivo
              {importados.repetidos > 0 && ` (${importados.repetidos} já estavam salvos e foram ignorados)`}.
            </p>
            <p className="dica">Salvar todos como:</p>
            <div className="conta-opcoes">
              <button type="button" className={contaImportacao === "pessoal" ? "sel" : ""} onClick={() => setContaImportacao("pessoal")}>
                Pessoal
              </button>
              <button type="button" className={contaImportacao === "profissional" ? "sel" : ""} onClick={() => setContaImportacao("profissional")}>
                Profissional
              </button>
            </div>
            <button type="button" className="btn-principal btn-baixar" onClick={confirmarImportacao} disabled={importando || importados.novos.length === 0}>
              {importando ? "Importando…" : `Importar ${importados.novos.length} contato${importados.novos.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
