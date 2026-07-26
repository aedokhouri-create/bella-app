# Onde paramos — Nina (Assistente Pessoal)

_Atualizado na noite de 25/07/2026._

## ✅ O que JÁ está pronto e testado

- App PWA completo (React + Vite) com visual teal, instalável no celular.
- Backend Node/Express + SQLite funcionando (criar/listar/concluir/apagar/adiar tarefas).
- Integração com a IA (Claude) pronta no código: você fala/escreve em linguagem
  natural e a IA cria a tarefa com título, data, hora, categoria e prioridade.
- Voz: ditado (microfone) e resposta falada (botão 🔊), ambos em português.
- Abas **Conversa** e **Tarefas**, filtro **Hoje/Todas**, botão **adiar (💤)**.
- Histórico da conversa do dia salvo no aparelho.

## ⏳ O ÚNICO passo que depende de você (rápido)

Para o chat com IA funcionar de verdade, falta **sua chave da Anthropic**:

1. Crie em https://console.anthropic.com → **API Keys**.
2. Em `backend/.env`, cole em `ANTHROPIC_API_KEY=...`.

(Sem ela, o app abre e as tarefas funcionam; só o chat responde avisando que falta a chave.)

## ▶️ Como abrir amanhã (2 terminais)

```bash
# Terminal 1 — backend
cd ~/Desktop/nina/backend && npm start

# Terminal 2 — frontend
cd ~/Desktop/nina/frontend && npm run dev
```
Abra o endereço do frontend (ex.: http://localhost:5173) no navegador.

## 🗺️ Ideias para os próximos dias (a decidir juntos)

- Editar o texto de uma tarefa direto na lista.
- Tela **"Meu Dia"**: resumo com tarefas de hoje + contas a vencer.
- **Contas a pagar** com lembrete antes do vencimento.
- **Gastos pessoais** (quanto gastou no mês, por categoria).
- Notificações push (lembrete chega no celular na hora).
- Publicar no Railway com login só seu (HTTPS + instalar no iPhone de verdade).
- Escolher o nome definitivo (hoje está "Nina" — muda em `frontend/src/config.js`).

Bom descanso! Amanhã é só me chamar que continuamos daqui. 💙
