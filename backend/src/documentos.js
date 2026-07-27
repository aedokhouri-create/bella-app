// Gera documentos médico-legais (.docx) a partir de dados estruturados que a IA
// prepara — segue o formato observado nos documentos de referência do Dr. Aedo:
// título + subtítulo, bloco de identificação, seções numeradas, assinatura.
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  WidthType,
} from "docx";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = process.env.DATA_DIR || "./data";
const DOCS_DIR = path.join(DATA_DIR, "documentos");
fs.mkdirSync(DOCS_DIR, { recursive: true });

function celula(texto, { negrito = false, largura } = {}) {
  return new TableCell({
    width: largura ? { size: largura, type: WidthType.PERCENTAGE } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text: String(texto ?? ""), bold: negrito })] })],
  });
}

function tabelaIdentificacao(identificacao) {
  const linhas = Object.entries(identificacao || {}).filter(([, v]) => v != null && v !== "");
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: linhas.map(
      ([rotulo, valor]) =>
        new TableRow({
          children: [celula(rotulo, { negrito: true, largura: 30 }), celula(valor, { largura: 70 })],
        })
    ),
  });
}

function paragrafosSecoes(secoes) {
  return (secoes || []).flatMap((s, i) => [
    new Paragraph({
      children: [new TextRun({ text: `${i + 1}. ${String(s.titulo || "").toUpperCase()}`, bold: true, size: 24 })],
      spacing: { before: 300, after: 150 },
    }),
    ...String(s.texto || "")
      .split("\n")
      .filter((p) => p.trim())
      .map((par) => new Paragraph({ text: par, spacing: { after: 150 } })),
  ]);
}

// Recebe { titulo, subtitulo, identificacao: {rótulo: valor}, secoes: [{titulo, texto}],
// fechamento: { local, data, nome, especialidade, crm } } e devolve { id, nomeArquivo }.
export async function gerarDocumentoDocx({ titulo, subtitulo, identificacao, secoes, fechamento }) {
  const f = fechamento || {};
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [new TextRun({ text: titulo || "RELATÓRIO MÉDICO", bold: true, size: 32 })],
            alignment: AlignmentType.CENTER,
            spacing: { after: subtitulo ? 60 : 300 },
          }),
          ...(subtitulo
            ? [
                new Paragraph({
                  children: [new TextRun({ text: subtitulo, italics: true })],
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 300 },
                }),
              ]
            : []),
          tabelaIdentificacao(identificacao),
          new Paragraph({ text: "", spacing: { after: 200 } }),
          ...paragrafosSecoes(secoes),
          new Paragraph({ text: "", spacing: { before: 400, after: 400 } }),
          new Paragraph({ text: f.local && f.data ? `${f.local}, ${f.data}` : f.data || "" }),
          new Paragraph({ text: "", spacing: { before: 600 } }),
          new Paragraph({ text: "________________________________________" }),
          new Paragraph({ children: [new TextRun({ text: f.nome || "Dr. Aedo Khouri", bold: true })] }),
          new Paragraph({ text: f.especialidade || "Cirurgia da Mão e Microcirurgia Reconstrutiva" }),
          new Paragraph({ text: f.crm || "CRM-BA 27014" }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const id = crypto.randomUUID();
  const nomeArquivo = `${id}.docx`;
  fs.writeFileSync(path.join(DOCS_DIR, nomeArquivo), buffer);
  return { id, nomeArquivo };
}

export function caminhoDocumento(id) {
  const arquivo = path.join(DOCS_DIR, `${id}.docx`);
  return fs.existsSync(arquivo) ? arquivo : null;
}
