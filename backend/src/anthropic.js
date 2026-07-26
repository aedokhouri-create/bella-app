// Integração com a IA da Anthropic (Claude).
// A IA conversa em português e, quando você pede para lembrar/agendar algo,
// ela usa a ferramenta "criar_tarefa" para transformar a fala em uma tarefa.
import Anthropic from "@anthropic-ai/sdk";
import { criarTarefa } from "./db.js";

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
    "amanhã de manhã' em vez de 'Tarefa criada com sucesso')."
  );
}

function historicoParaMensagens(historico = []) {
  return historico
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.text)
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.text }));
}

// Recebe { message, history } e devolve { reply, tarefas }.
export async function conversar({ message, history }) {
  const client = getClient();
  if (!client) {
    return {
      reply:
        "⚠️ A chave da API da Anthropic ainda não foi configurada. " +
        "Coloque ANTHROPIC_API_KEY no arquivo .env do backend para eu conversar de verdade.",
      tarefas: [],
    };
  }

  const messages = [...historicoParaMensagens(history), { role: "user", content: message }];
  const tarefasCriadas = [];

  let resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: sistema(),
    tools: [ferramentaCriarTarefa],
    output_config: { effort: "low" }, // conversa rápida e barata — não precisa de raciocínio profundo
    messages,
  });

  // Se a IA decidiu criar tarefa(s), executamos e devolvemos o resultado a ela
  // para que gere a confirmação final em texto.
  if (resp.stop_reason === "tool_use") {
    const toolResults = [];
    for (const bloco of resp.content) {
      if (bloco.type === "tool_use" && bloco.name === "criar_tarefa") {
        const tarefa = criarTarefa(bloco.input);
        tarefasCriadas.push(tarefa);
        toolResults.push({
          type: "tool_result",
          tool_use_id: bloco.id,
          content: `Tarefa criada com sucesso (id ${tarefa.id}): "${tarefa.titulo}".`,
        });
      }
    }
    messages.push({ role: "assistant", content: resp.content });
    messages.push({ role: "user", content: toolResults });

    resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: sistema(),
      tools: [ferramentaCriarTarefa],
      messages,
    });
  }

  const reply = resp.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return { reply: reply || "Pronto!", tarefas: tarefasCriadas };
}
