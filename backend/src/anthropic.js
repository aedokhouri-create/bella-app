// Integração com a IA da Anthropic (Claude).
// A IA conversa em português e, quando você pede para lembrar/agendar algo,
// ela usa a ferramenta "criar_tarefa" para transformar a fala em uma tarefa.
import Anthropic from "@anthropic-ai/sdk";
import { criarTarefa, criarConta, buscarContatos } from "./db.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

// Cliente criado sob demanda para dar uma mensagem clara se faltar a chave.
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic(); // lê ANTHROPIC_API_KEY do ambiente
}

const ferramentaCriarTarefa = {
  name: "criar_tarefa",
  description:
    "Cria uma tarefa/lembrete quando a pessoa pede para lembrar, agendar, anotar " +
    "ou marcar algo a fazer. Resolva datas relativas (ex.: 'amanhã', 'sexta', " +
    "'semana que vem') para uma data absoluta usando a DATA DE HOJE informada no sistema.",
  input_schema: {
    type: "object",
    properties: {
      titulo: { type: "string", description: "Título curto e claro da tarefa" },
      descricao: { type: "string", description: "Detalhes opcionais" },
      data: { type: "string", description: "Data no formato YYYY-MM-DD. Vazio se não houver." },
      hora: { type: "string", description: "Hora no formato HH:MM (24h). Vazio se não houver." },
      prioridade: { type: "string", enum: ["baixa", "media", "alta"] },
      categoria: {
        type: "string",
        description: "Categoria curta: trabalho, pessoal, familia, saude, financeiro...",
      },
    },
    required: ["titulo"],
  },
};

const ferramentaCriarContaPagar = {
  name: "criar_conta_pagar",
  description:
    "Cria uma conta a pagar/lembrete de pagamento quando a pessoa mencionar uma conta, boleto, " +
    "fatura, imposto ou pagamento com data de vencimento (ex.: 'tenho que pagar o IPTU dia 10', " +
    "'a fatura do cartão vence sexta'). Resolva datas relativas para uma data absoluta usando a " +
    "DATA DE HOJE informada no sistema.",
  input_schema: {
    type: "object",
    properties: {
      titulo: { type: "string", description: "Nome curto da conta, ex.: 'Conta de luz', 'IPTU'" },
      valor: { type: "number", description: "Valor em reais, se informado" },
      vencimento: { type: "string", description: "Data de vencimento no formato YYYY-MM-DD" },
      categoria: {
        type: "string",
        description: "Categoria curta: moradia, cartao, saude, imposto, seguro...",
      },
    },
    required: ["titulo", "vencimento"],
  },
};

const ferramentaWhatsApp = {
  name: "enviar_whatsapp",
  description:
    "Prepara uma mensagem de WhatsApp para o usuário ABRIR E CONFERIR antes de enviar " +
    "— você nunca envia a mensagem sozinha, apenas deixa pronta. Use quando ele pedir " +
    "para mandar, escrever ou enviar mensagem para alguém no WhatsApp. Ele tem DUAS " +
    "contas no mesmo iPhone: 'pessoal' e 'profissional'. Se não estiver claro qual das " +
    "duas usar, e o contato não deixar isso óbvio, pergunte antes de chamar esta " +
    "ferramenta — não adivinhe.",
  input_schema: {
    type: "object",
    properties: {
      contato: { type: "string", description: "Nome da pessoa, como o usuário se referiu a ela" },
      telefone: {
        type: "string",
        description: "Número com DDD, se o usuário informou diretamente. Deixe vazio para buscar pelo nome salvo.",
      },
      conta: { type: "string", enum: ["pessoal", "profissional"], description: "Qual conta de WhatsApp usar, se souber" },
      mensagem: { type: "string", description: "Texto da mensagem" },
    },
    required: ["mensagem"],
  },
};

function montarLinkWhatsApp(numero, conta, mensagem) {
  const texto = encodeURIComponent(mensagem || "");
  if (conta === "profissional") {
    return `whatsapp-business://send?phone=${numero}&text=${texto}`;
  }
  return `https://wa.me/${numero}?text=${texto}`;
}

// Resolve o contato/telefone/conta e monta o link para o WhatsApp certo.
// Nunca envia nada — só prepara os dados para o app abrir com o texto pronto.
function prepararWhatsApp({ contato, telefone, conta, mensagem }) {
  let numero = telefone ? String(telefone).replace(/\D/g, "") : null;
  let contaFinal = conta || null;
  let nomeExibicao = contato || "";

  if (!numero && contato) {
    const achados = buscarContatos(contato, conta || null);
    if (achados.length === 1) {
      numero = achados[0].telefone;
      contaFinal = achados[0].conta;
      nomeExibicao = achados[0].nome;
    } else if (achados.length === 0) {
      return {
        ok: false,
        mensagemParaIA:
          `Não encontrei "${contato}" nos contatos salvos${conta ? ` (conta ${conta})` : ""}. ` +
          "Peça o número de telefone com DDD ao usuário, ou sugira cadastrar o contato na aba Contatos.",
      };
    } else {
      const nomes = achados.map((a) => `${a.nome} (${a.conta})`).join(", ");
      return {
        ok: false,
        mensagemParaIA: `Tem mais de um contato parecido: ${nomes}. Pergunte ao usuário qual é, e por qual conta.`,
      };
    }
  }

  if (!numero) {
    return {
      ok: false,
      mensagemParaIA: "Não tenho o número nem achei o contato salvo. Peça o telefone com DDD ao usuário.",
    };
  }
  if (!contaFinal) {
    return {
      ok: false,
      mensagemParaIA: "Preciso saber se é pela conta pessoal ou profissional do WhatsApp. Pergunte ao usuário.",
    };
  }

  const url = montarLinkWhatsApp(numero, contaFinal, mensagem);
  return {
    ok: true,
    acao: { tipo: "whatsapp", conta: contaFinal, contato: nomeExibicao || numero, url },
    mensagemParaIA:
      `Mensagem pronta para abrir no WhatsApp ${contaFinal} para ${nomeExibicao || numero}. ` +
      "Avise o usuário que está pronta para ele conferir e enviar.",
  };
}

function sistema() {
  const agora = new Date();
  const dataHoje = agora.toLocaleDateString("pt-BR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "2-digit",
    timeZone: "America/Bahia",
  });
  const horaAgora = agora.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Bahia",
  });
  return (
    "Você é a Bella, a assistente pessoal e secretária particular do Dr. Aedo Khouri, " +
    "cirurgião de mão. Vocês trabalham juntos há tempos e têm uma relação de confiança " +
    "e cordialidade — você é atenciosa, proativa, calorosa e direta, do jeito que uma " +
    "ótima secretária particular seria. Trate-o por 'doutor' (às vezes 'Dr. Aedo'), mas " +
    "sem exagerar — um toque natural na conversa, não em toda frase. Fale como se " +
    "estivesse conversando de verdade por voz: frases curtas, naturais, sem parecer um " +
    "robô nem um menu de opções. Nada de listas com marcadores ou formatação — é uma " +
    "conversa falada. Se ele parecer cansado, apressado ou estressado, seja ainda mais " +
    "objetiva e gentil. Se algo estiver ambíguo, pergunte de um jeito natural, como uma " +
    "pessoa perguntaria, em vez de pedir 'mais informações'.\n\n" +
    `Hoje é ${dataHoje}, ${horaAgora} (fuso horário da Bahia). ` +
    "Quando ele pedir para lembrar, agendar ou anotar algo, use a ferramenta criar_tarefa " +
    "— não precisa avisar que vai usar uma ferramenta, apenas aja. Se faltar hora ou data, " +
    "tudo bem, crie mesmo assim com o que tiver. Depois de criar, confirme em uma frase " +
    "curta e natural, tipo o que você diria de verdade (ex.: 'Anotado, doutor — te aviso " +
    "amanhã de manhã' em vez de 'Tarefa criada com sucesso').\n\n" +
    "Quando ele pedir para mandar/escrever mensagem para alguém no WhatsApp, use a " +
    "ferramenta enviar_whatsapp. Você NUNCA envia a mensagem de verdade — apenas deixa " +
    "pronta para ele abrir e conferir. Nunca diga 'enviei' ou 'mandei' — diga 'deixei " +
    "pronta' ou 'já preparei'. Ele tem duas contas de WhatsApp no mesmo iPhone: pessoal " +
    "e profissional. Se não estiver claro qual usar, pergunte antes de chamar a " +
    "ferramenta, do jeito que uma pessoa perguntaria.\n\n" +
    "Quando ele mencionar uma conta a pagar, boleto, fatura, imposto ou seguro com uma " +
    "data de vencimento, use a ferramenta criar_conta_pagar — não precisa avisar que vai " +
    "usar uma ferramenta, apenas aja. Confirme depois em uma frase curta e natural " +
    "(ex.: 'Anotei, doutor — o IPTU vence dia 10' em vez de 'Conta criada com sucesso')."
  );
}

function historicoParaMensagens(historico = []) {
  return historico
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.text)
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.text }));
}

const FERRAMENTAS = [ferramentaCriarTarefa, ferramentaCriarContaPagar, ferramentaWhatsApp];

// Recebe { message, history } e devolve { reply, tarefas, contas, acoesWhatsApp }.
export async function conversar({ message, history }) {
  const client = getClient();
  if (!client) {
    return {
      reply:
        "⚠️ A chave da API da Anthropic ainda não foi configurada. " +
        "Coloque ANTHROPIC_API_KEY no arquivo .env do backend para eu conversar de verdade.",
      tarefas: [],
      contas: [],
      acoesWhatsApp: [],
    };
  }

  const messages = [...historicoParaMensagens(history), { role: "user", content: message }];
  const tarefasCriadas = [];
  const contasCriadas = [];
  const acoesWhatsApp = [];

  let resp;
  for (let volta = 0; volta < 4; volta++) {
    resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: sistema(),
      tools: FERRAMENTAS,
      output_config: { effort: "low" }, // conversa rápida e barata — não precisa de raciocínio profundo
      messages,
    });

    if (resp.stop_reason !== "tool_use") break;

    const toolResults = [];
    for (const bloco of resp.content) {
      if (bloco.type !== "tool_use") continue;

      if (bloco.name === "criar_tarefa") {
        const tarefa = criarTarefa(bloco.input);
        tarefasCriadas.push(tarefa);
        toolResults.push({
          type: "tool_result",
          tool_use_id: bloco.id,
          content: `Tarefa criada com sucesso (id ${tarefa.id}): "${tarefa.titulo}".`,
        });
      } else if (bloco.name === "criar_conta_pagar") {
        const conta = criarConta(bloco.input);
        contasCriadas.push(conta);
        toolResults.push({
          type: "tool_result",
          tool_use_id: bloco.id,
          content: `Conta criada com sucesso (id ${conta.id}): "${conta.titulo}" vence em ${conta.vencimento}.`,
        });
      } else if (bloco.name === "enviar_whatsapp") {
        const resultado = prepararWhatsApp(bloco.input);
        if (resultado.ok) acoesWhatsApp.push(resultado.acao);
        toolResults.push({
          type: "tool_result",
          tool_use_id: bloco.id,
          content: resultado.mensagemParaIA,
          is_error: !resultado.ok,
        });
      }
    }
    messages.push({ role: "assistant", content: resp.content });
    messages.push({ role: "user", content: toolResults });
  }

  const reply = resp.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return { reply: reply || "Pronto!", tarefas: tarefasCriadas, contas: contasCriadas, acoesWhatsApp };
}
