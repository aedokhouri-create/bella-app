# Onde paramos — Bella (Assistente Pessoal)

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
- Escolher o nome definitivo (hoje está "Bella" — muda em `frontend/src/config.js`).

## 💡 Ideias novas (anotadas na noite de 25/07) — todas viáveis

- **Pasta/área secreta:** uma seção privada dentro do app, protegida por **PIN ou
  Face ID** (biometria do próprio iPhone), para guardar notas e coisas pessoais.
  → Fácil e seguro. Ótimo primeiro recurso pra fazer.

- **Enviar mensagem no WhatsApp por voz:** você dita, a Bella transcreve e **abre o
  WhatsApp já com a mensagem escrita para o contato** — você só confere e toca em
  enviar. (Enviar 100% sozinho, sem tocar, exigiria a API paga do WhatsApp Business;
  a versão prática e gratuita é essa: deixa tudo pronto.)

- **Enviar e-mail por voz/texto:** duas formas —
  (a) **abre o app de e-mail já preenchido** (você toca em enviar); ou
  (b) **envia direto pelo servidor** (automático, igual ao backup por e-mail que já
  fazemos no CMOT com o Gmail). A opção (b) manda sozinho.

- Outras tarefas de assistente (à medida que forem surgindo — é só ir me dizendo).

## Sugestão de ordem pra amanhã
1. Colocar sua chave da API e testar o fluxo de voz → tarefa (o principal).
2. **Área secreta com PIN/Face ID** (rápida e útil).
3. **Mensagem por voz → WhatsApp** (prática, gratuita).
4. E-mail por voz.

Bom descanso! Amanhã é só me chamar que continuamos daqui. 💙
