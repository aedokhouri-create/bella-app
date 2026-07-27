// Integração com a IA da Anthropic (Claude).
// A IA conversa em português e, quando você pede para lembrar/agendar algo,
// ela usa a ferramenta "criar_tarefa" para transformar a fala em uma tarefa.
import Anthropic from "@anthropic-ai/sdk";
import {
  criarTarefa,
  criarConta,
  buscarContatos,
  listarMemorias,
  criarMemoria,
  listarModelos,
  criarModelo,
} from "./db.js";
import { gerarDocumentoDocx } from "./documentos.js";
import { cadastrarCirurgiaNoCmot } from "./cmot.js";
import { sincronizarTarefaApple, sincronizarContaApple, sincronizarTarefaGoogle, sincronizarContaGoogle } from "./calendarioSync.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

// Cliente criado sob demanda para dar uma mensagem clara se faltar a chave.
// A chave é "limpa" de qualquer caractere fora do ASCII visível (espaços, quebras
// de linha ou caracteres estranhos que às vezes entram ao colar em painéis como o
// do Render) — headers HTTP não aceitam caracteres fora da faixa 0-255.
function getClient() {
  const chave = process.env.ANTHROPIC_API_KEY?.replace(/[^\x21-\x7E]/g, "");
  if (!chave) return null;
  return new Anthropic({ apiKey: chave });
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

const ferramentaGerarDocumento = {
  name: "gerar_documento_docx",
  description:
    "Gera um documento médico/legal de verdade (arquivo .docx para baixar) — use quando " +
    "ele pedir um relatório médico, laudo, contestação de glosa, orçamento hospitalar/de " +
    "honorários ou atestado (por foto de guia/documento + comando, ou só por comando). " +
    "Ele é médico ASSISTENTE, não perito: nunca escreva conclusão pericial, nexo causal " +
    "com trabalho/acidente ou linguagem de parecer, salvo se ele pedir isso expressamente " +
    "— descreva quadro clínico, diagnóstico, evolução, tratamento e limitação funcional. " +
    "Confira coerência antes de gerar: datas (trauma/cirurgia/relatório) não podem se " +
    "contradizer; 'definitivo/permanente' só se compatível com o tempo desde a última " +
    "cirurgia; CID-10 citado deve bater com o quadro clínico descrito — se notar " +
    "divergência, não gere ainda, pergunte antes. Se um dado só ele pode saber (nº de " +
    "dias de afastamento, data, achado de exame), use '[____]' no campo em vez de inventar.",
  input_schema: {
    type: "object",
    properties: {
      titulo: {
        type: "string",
        description:
          "Tipo do documento em maiúsculas, ex.: 'RELATÓRIO MÉDICO', 'CONTESTAÇÃO DE GLOSA', " +
          "'ORÇAMENTO DE HONORÁRIOS MÉDICOS', 'SOLICITAÇÃO DE ORÇAMENTO HOSPITALAR', 'ATESTADO MÉDICO'",
      },
      subtitulo: {
        type: "string",
        description: "Subtítulo curto do procedimento/contexto, ex.: 'Cirurgia do Punho com Lesões Associadas'",
      },
      identificacao: {
        type: "object",
        description:
          "Pares rótulo/valor para o bloco de identificação (Paciente, Data de Nascimento, " +
          "Convênio/Carteirinha, Hospital, Data do Procedimento, Cirurgião — sempre 'Dr. Aedo " +
          "Khouri — CRM-BA 27014' salvo se ele pedir outro nome). Use '[____]' quando faltar dado.",
        additionalProperties: { type: "string" },
      },
      secoes: {
        type: "array",
        description:
          "Seções numeradas do corpo, em ordem (ex.: Diagnóstico, Procedimentos Realizados, " +
          "Fundamentação Técnica — citando ANS/CBHPM/SBOT/CFM quando for glosa —, Conclusão e Pedido).",
        items: {
          type: "object",
          properties: {
            titulo: { type: "string" },
            texto: { type: "string", description: "Texto da seção; parágrafos separados por \\n" },
          },
          required: ["titulo", "texto"],
        },
      },
      fechamento: {
        type: "object",
        properties: {
          local: { type: "string", description: "Cidade, ex.: 'Salvador/BA'" },
          data: { type: "string", description: "Data por extenso, ou '[data]' se não souber" },
          nome: { type: "string", description: "Ex.: 'Dr. Aedo Khouri'" },
          especialidade: { type: "string", description: "Ex.: 'Cirurgia da Mão e Microcirurgia Reconstrutiva'" },
          crm: { type: "string", description: "Ex.: 'CRM-BA 27014'" },
        },
      },
      bilingue: {
        type: "boolean",
        description: "true se for documento para seguradora internacional (JAG/AIG) — nesse caso escreva cada seção em português seguido da tradução em inglês.",
      },
      avisos: {
        type: "string",
        description:
          "O que ele precisa revisar/preencher antes de usar (campos faltando, divergências de " +
          "data/CID-10 notadas). NÃO entra no documento — é só para você contar pra ele no chat.",
      },
    },
    required: ["titulo", "identificacao", "secoes"],
  },
};

const ferramentaSalvarMemoria = {
  name: "salvar_memoria",
  description:
    "Guarda um fato/preferência/contexto permanente sobre o Dr. Aedo e a vida dele, pra " +
    "você lembrar em QUALQUER conversa futura, não só hoje (a conversa normal reinicia " +
    "todo dia, isso não). Use por conta própria, sem precisar que ele peça, quando ele " +
    "contar algo que vale a pena lembrar sempre: nomes da família, preferências " +
    "recorrentes, contexto sobre um problema/projeto em andamento, decisões importantes. " +
    "Não guarde coisas triviais ou só do momento (ex.: 'hoje está chovendo'). Se ele pedir " +
    "explicitamente ('guarda isso', 'lembra disso sempre'), sempre use a ferramenta. " +
    "Escreva o conteúdo de um jeito que faça sentido sozinho, sem depender do resto da " +
    "conversa pra entender.",
  input_schema: {
    type: "object",
    properties: {
      conteudo: { type: "string", description: "O fato/contexto a lembrar, em uma ou duas frases claras" },
    },
    required: ["conteudo"],
  },
};

const ferramentaSalvarModeloDocumento = {
  name: "salvar_modelo_documento",
  description:
    "Guarda a estrutura de um documento (título, subtítulo, seções, fechamento) como " +
    "modelo reutilizável, pra próxima vez que ele pedir algo parecido você já usar como " +
    "base — sem repetir o trabalho de montar do zero. Use SÓ quando ele pedir " +
    "explicitamente ('salva isso como modelo', 'guarda esse formato pra próxima vez'). " +
    "Guarde a ESTRUTURA (títulos de seção, texto genérico de exemplo), não dados " +
    "específicos de um paciente — troque nome/CPF/datas por marcadores tipo [NOME], " +
    "[DATA] antes de salvar.",
  input_schema: {
    type: "object",
    properties: {
      nome: { type: "string", description: "Nome curto pra reconhecer o modelo, ex.: 'Atestado padrão de afastamento'" },
      titulo: { type: "string" },
      subtitulo: { type: "string" },
      secoes: {
        type: "array",
        items: {
          type: "object",
          properties: { titulo: { type: "string" }, texto: { type: "string" } },
          required: ["titulo", "texto"],
        },
      },
      fechamento: {
        type: "object",
        properties: {
          local: { type: "string" },
          nome: { type: "string" },
          especialidade: { type: "string" },
          crm: { type: "string" },
        },
      },
    },
    required: ["nome", "titulo", "secoes"],
  },
};

const ferramentaCadastrarCirurgiaCmot = {
  name: "cadastrar_cirurgia_cmot",
  description:
    "Cadastra ou atualiza uma cirurgia diretamente no CMOT (sistema da clínica) — use SÓ " +
    "quando ele pedir explicitamente pra registrar/cadastrar uma cirurgia no CMOT (ex.: " +
    "'cadastra essa cirurgia no CMOT', 'registra isso lá no sistema da clínica'), por foto " +
    "da descrição cirúrgica + comando, ou só por comando. Ela reaproveita a mesma lógica do " +
    "Registro Rápido do CMOT: procura o paciente pelo nome/CPF (se já existe, usa o mesmo; " +
    "senão cria um novo) e procura uma cirurgia AGENDADA/AUTORIZADA do mesmo paciente pra " +
    "atualizar para REALIZADA — senão cria uma nova já como REALIZADA. Peça os dados que " +
    "faltarem antes de chamar (paciente e procedimento e hospital são obrigatórios) — não " +
    "invente CPF, data de nascimento nem convênio se não estiverem claros.",
  input_schema: {
    type: "object",
    properties: {
      paciente_nome: { type: "string", description: "Nome completo do paciente" },
      cpf: { type: "string", description: "CPF do paciente, se souber" },
      nascimento: { type: "string", description: "Data de nascimento YYYY-MM-DD, se souber" },
      telefone: { type: "string", description: "Telefone do paciente, se souber" },
      procedimento: { type: "string", description: "Descrição do procedimento/cirurgia realizada" },
      hospital: { type: "string", description: "Hospital onde foi realizada" },
      convenio: { type: "string", description: "Convênio/plano, se souber" },
      data: { type: "string", description: "Data da cirurgia YYYY-MM-DD (padrão: hoje)" },
      tipo: { type: "string", enum: ["ELETIVA", "URGENCIA"] },
      observacoes: { type: "string", description: "Observações clínicas/descrição cirúrgica" },
    },
    required: ["paciente_nome", "procedimento", "hospital"],
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

function sistema(memorias = [], modelos = []) {
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
    "conversa falada, e nada de emoji no meio do texto — isso é lido em voz alta e soa " +
    "estranho (alguns leitores descrevem o emoji em vez de ignorar). Se ele parecer " +
    "cansado, apressado ou estressado, seja ainda mais objetiva e gentil. Se algo estiver " +
    "ambíguo, pergunte de um jeito natural, como uma pessoa perguntaria, em vez de pedir " +
    "'mais informações'.\n\n" +
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
    "(ex.: 'Anotei, doutor — o IPTU vence dia 10' em vez de 'Conta criada com sucesso').\n\n" +
    "Quando ele mandar uma foto: se for um boleto, fatura, carnê ou conta com valor e " +
    "data de vencimento legíveis, leia os dados e use criar_conta_pagar sozinha, sem " +
    "perguntar — depois confirme em uma frase curta o que você cadastrou (título, valor " +
    "e vencimento), para ele conferir. Se a data ou o valor não estiverem legíveis, não " +
    "invente — peça para ele confirmar o que faltou. Se a foto for de outra coisa (um " +
    "documento, uma receita, uma anotação, um cartão), não crie nada sozinha — apenas " +
    "descreva o que você viu, do jeito que uma pessoa contaria o que leu.\n\n" +
    "Quando a foto for de uma APÓLICE DE SEGURO (carro, vida, residencial etc.): ela " +
    "costuma ter várias parcelas. Para CADA parcela ainda não paga, chame " +
    "criar_conta_pagar uma vez (pode chamar várias vezes na mesma resposta) — no título " +
    "inclua a seguradora, o número da apólice e a parcela, para ele reconhecer depois " +
    "(ex.: 'Seguro Porto Seguro — Apólice 123456 — Parcela 3/12'). NÃO tente guardar os " +
    "dados da apólice (seguradora, nº, cobertura, veículo/bem, vigência) em nenhuma " +
    "ferramenta — você não tem acesso ao Cofre dele por segurança (o histórico de " +
    "conversa não é criptografado). Em vez disso, escreva na sua resposta um resumo " +
    "curto e organizado desses dados e sugira que ele copie e cole isso no Cofre, na " +
    "categoria 'Seguros & Apólices', pra ficar protegido com o PIN dele.\n\n" +
    "Quando ele pedir um relatório médico, laudo, contestação de glosa, orçamento " +
    "hospitalar/de honorários ou atestado (por foto de guia/documento + comando, ou só " +
    "por comando), use a ferramenta gerar_documento_docx — ela gera um arquivo .docx de " +
    "verdade, pronto para baixar. Preencha todos os campos que a ferramenta pedir seguindo " +
    "as regras dela (médico assistente, não perito; sem campo em branco silencioso; " +
    "conferir coerência de datas/CID-10 antes). Depois de gerar, avise em uma frase curta " +
    "e natural que o arquivo está pronto pra baixar — e se houver algo para ele revisar ou " +
    "preencher, conte isso também, sempre deixando claro que é um rascunho para conferir, " +
    "nunca diga que está pronto para enviar.\n\n" +
    "Quando ele pedir EXPLICITAMENTE pra cadastrar/registrar uma cirurgia no CMOT (sistema " +
    "da clínica) — por foto da descrição cirúrgica + comando, ou só por comando — use a " +
    "ferramenta cadastrar_cirurgia_cmot. Só chame essa ferramenta se ele mencionar CMOT, " +
    "'sistema da clínica' ou deixar claro que quer isso registrado lá — nunca chame por " +
    "conta própria só porque ele descreveu uma cirurgia. Peça os dados que faltarem antes " +
    "(paciente, procedimento e hospital são obrigatórios) — não invente CPF, convênio ou " +
    "data de nascimento. Depois de cadastrar, confirme em uma frase curta e natural o que " +
    "aconteceu (paciente novo ou já existente, cirurgia criada ou atualizada), do jeito que " +
    "você contaria pra ele o que fez de verdade.\n\n" +
    "A conversa de hoje reinicia todo dia — o que você sabe de verdade, pra sempre, é só o " +
    "que está guardado como memória (lista abaixo). Use a ferramenta salvar_memoria por " +
    "conta própria quando ele contar algo que vale lembrar sempre (família, preferências, " +
    "contexto de um problema em andamento) — não precisa ele pedir, mas se pedir " +
    "explicitamente, sempre salve. Não precisa avisar que vai salvar, só faça." +
    (memorias.length
      ? "\n\nO que você já sabe sobre o Dr. Aedo (de conversas anteriores):\n" +
        memorias.map((m) => `— ${m.conteudo}`).join("\n")
      : "\n\nVocê ainda não tem nenhuma memória guardada sobre ele.") +
    "\n\nQuando ele pedir pra guardar o formato de um documento pra reusar depois " +
    "('salva isso como modelo'), use a ferramenta salvar_modelo_documento, trocando " +
    "dados específicos do paciente por marcadores tipo [NOME] antes de salvar." +
    (modelos.length
      ? "\n\nModelos de documento já salvos, que você pode usar como base quando ele " +
        "pedir algo parecido (adapte pro caso novo, não copie dados de exemplo):\n" +
        modelos.map((m) => `— "${m.nome}" (${m.titulo})`).join("\n")
      : "")
  );
}

function historicoParaMensagens(historico = []) {
  return historico
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.text)
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.text }));
}

const FERRAMENTAS = [
  ferramentaCriarTarefa,
  ferramentaCriarContaPagar,
  ferramentaWhatsApp,
  ferramentaGerarDocumento,
  ferramentaCadastrarCirurgiaCmot,
  ferramentaSalvarMemoria,
  ferramentaSalvarModeloDocumento,
];

// Recebe { message, history, imagem } e devolve { reply, tarefas, contas, acoesWhatsApp, documentos }.
// imagem (opcional): { base64, mediaType } — uma foto tirada/enviada pelo usuário.
export async function conversar({ message, history, imagem }) {
  const client = getClient();
  if (!client) {
    return {
      reply:
        "⚠️ A chave da API da Anthropic ainda não foi configurada. " +
        "Coloque ANTHROPIC_API_KEY no arquivo .env do backend para eu conversar de verdade.",
      tarefas: [],
      contas: [],
      acoesWhatsApp: [],
      documentos: [],
      cmot: [],
      memorias: [],
      modelos: [],
    };
  }

  const conteudoUsuario = imagem
    ? [
        { type: "image", source: { type: "base64", media_type: imagem.mediaType, data: imagem.base64 } },
        { type: "text", text: message || "Aqui está a foto." },
      ]
    : message;

  const messages = [...historicoParaMensagens(history), { role: "user", content: conteudoUsuario }];
  const tarefasCriadas = [];
  const contasCriadas = [];
  const acoesWhatsApp = [];
  const documentosGerados = [];
  const cmotResultados = [];
  const memoriasSalvas = [];
  const modelosSalvos = [];
  const memoriasAtuais = listarMemorias();
  const modelosAtuais = listarModelos();

  let resp;
  for (let volta = 0; volta < 4; volta++) {
    resp = await client.messages.create({
      model: MODEL,
      max_tokens: 4096, // relatórios/documentos gerados podem ser longos
      system: sistema(memoriasAtuais, modelosAtuais),
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
        sincronizarTarefaApple(tarefa);
        sincronizarTarefaGoogle(tarefa);
        toolResults.push({
          type: "tool_result",
          tool_use_id: bloco.id,
          content: `Tarefa criada com sucesso (id ${tarefa.id}): "${tarefa.titulo}".`,
        });
      } else if (bloco.name === "criar_conta_pagar") {
        const conta = criarConta(bloco.input);
        contasCriadas.push(conta);
        sincronizarContaApple(conta);
        sincronizarContaGoogle(conta);
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
      } else if (bloco.name === "gerar_documento_docx") {
        const { avisos, ...dadosDocumento } = bloco.input;
        try {
          const { id } = await gerarDocumentoDocx(dadosDocumento);
          documentosGerados.push({ id, url: `/api/documentos/${id}`, titulo: dadosDocumento.titulo });
          toolResults.push({
            type: "tool_result",
            tool_use_id: bloco.id,
            content:
              `Documento gerado com sucesso (id ${id}). ` +
              (avisos ? `Avisos para o usuário: ${avisos}` : "Sem avisos pendentes.") +
              " Lembre o usuário que é um rascunho para ele revisar antes de usar.",
          });
        } catch (err) {
          console.error("Erro ao gerar documento:", err);
          toolResults.push({
            type: "tool_result",
            tool_use_id: bloco.id,
            content: "Não consegui gerar o arquivo agora. Avise o usuário para tentar de novo.",
            is_error: true,
          });
        }
      } else if (bloco.name === "cadastrar_cirurgia_cmot") {
        try {
          const r = await cadastrarCirurgiaNoCmot(bloco.input);
          cmotResultados.push({
            pacienteNome: r.paciente.nome,
            pacienteNovo: r.pacienteNovo,
            procedimento: r.cirurgia.procedimento,
            atualizada: r.atualizada,
          });
          toolResults.push({
            type: "tool_result",
            tool_use_id: bloco.id,
            content:
              `Cadastrado com sucesso no CMOT. Paciente ${r.pacienteNovo ? "criado agora" : "já existia"}: ` +
              `${r.paciente.nome}. Cirurgia ${r.atualizada ? "atualizada para REALIZADA" : "criada como REALIZADA"}: ` +
              `${r.cirurgia.procedimento}.`,
          });
        } catch (err) {
          console.error("Erro ao cadastrar no CMOT:", err);
          toolResults.push({
            type: "tool_result",
            tool_use_id: bloco.id,
            content: `Não consegui cadastrar no CMOT agora (${err.message}). Avise o usuário e sugira tentar de novo, ou fazer manualmente no app do CMOT.`,
            is_error: true,
          });
        }
      } else if (bloco.name === "salvar_memoria") {
        const memoria = criarMemoria(bloco.input.conteudo);
        memoriasSalvas.push(memoria);
        toolResults.push({
          type: "tool_result",
          tool_use_id: bloco.id,
          content: `Memória guardada com sucesso (id ${memoria.id}).`,
        });
      } else if (bloco.name === "salvar_modelo_documento") {
        const modelo = criarModelo(bloco.input);
        modelosSalvos.push(modelo);
        toolResults.push({
          type: "tool_result",
          tool_use_id: bloco.id,
          content: `Modelo "${modelo.nome}" guardado com sucesso (id ${modelo.id}).`,
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

  return {
    reply: reply || "Pronto!",
    tarefas: tarefasCriadas,
    contas: contasCriadas,
    acoesWhatsApp,
    documentos: documentosGerados,
    cmot: cmotResultados,
    memorias: memoriasSalvas,
    modelos: modelosSalvos,
  };
}
