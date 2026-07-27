// Voz natural da Bella via Google Cloud Text-to-Speech (bem melhor que a voz
// robótica do navegador). Cota gratuita generosa: 1 milhão de caracteres/mês
// pras vozes Neural2 (as mais naturais), praticamente cobre o uso pessoal dele.
const GOOGLE_TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";

// Vozes em português (Brasil) recomendadas — Neural2 é a mais natural.
export const VOZES_GOOGLE = [
  { id: "pt-BR-Neural2-A", nome: "Bella (feminina, natural)" },
  { id: "pt-BR-Neural2-C", nome: "Feminina alternativa" },
  { id: "pt-BR-Neural2-B", nome: "Masculina" },
  { id: "pt-BR-Wavenet-A", nome: "Feminina (clássica)" },
];

function limpar(valor) {
  return valor?.replace(/[^\x21-\x7E]/g, "").trim();
}

export async function sintetizarVoz(texto, vozId) {
  const chave = limpar(process.env.GOOGLE_TTS_API_KEY);
  if (!chave) throw new Error("GOOGLE_TTS_API_KEY não configurada.");
  const voz = VOZES_GOOGLE.find((v) => v.id === vozId) ? vozId : VOZES_GOOGLE[0].id;

  const resp = await fetch(`${GOOGLE_TTS_URL}?key=${chave}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text: texto },
      voice: { languageCode: "pt-BR", name: voz },
      audioConfig: { audioEncoding: "MP3", speakingRate: 1.0, pitch: 0 },
    }),
  });
  if (!resp.ok) {
    const corpo = await resp.json().catch(() => ({}));
    throw new Error(corpo.error?.message || `Erro na síntese de voz (${resp.status}).`);
  }
  const dados = await resp.json();
  return dados.audioContent; // base64 MP3
}
