# Bella — Assistente Pessoal (PWA)

Assistente pessoal por **voz e texto** que entende linguagem natural e cria suas
tarefas automaticamente. Feito para instalar na tela inicial do iPhone/iPad (PWA).

> O nome "Bella" é provisório — para trocar, edite `frontend/src/config.js`.

## O que já funciona (MVP)

- 🎤 **Voz e texto:** fale ou digite. A IA transcreve (Web Speech API) e responde
  (com voz opcional — botão 🔊 no topo).
- ✅ **Tarefas automáticas:** diga *"lembra de ligar pro Fernando amanhã de manhã"*
  e a IA cria a tarefa com título, data, hora, categoria e prioridade.
- 📋 **Lista de tarefas:** concluir, apagar, ver por data/prioridade.
- 📱 **PWA:** instalável no celular e funciona offline para ver a lista de tarefas.

## Estrutura

```
nina/
  backend/    Node.js + Express + SQLite + IA (Claude)
  frontend/   React + Vite + PWA
```

## Como rodar no seu computador

Você vai abrir **dois terminais** (um para o backend, um para o frontend).

### 1) Backend

```bash
cd backend
cp .env.example .env      # crie o arquivo de configuração
# abra o .env e cole sua chave da Anthropic em ANTHROPIC_API_KEY
npm install               # (só na primeira vez)
npm start
```

Fica em `http://localhost:3001`. A chave da API você cria em
https://console.anthropic.com → **API Keys**.
> Sem a chave, o app abre normalmente, mas o chat responde avisando que falta a chave.

### 2) Frontend

```bash
cd frontend
npm install               # (só na primeira vez)
npm run dev
```

Abra o endereço que aparecer (ex.: `http://localhost:5173`) no navegador.
No celular, use o **Safari** (iPhone) ou **Chrome** para o microfone funcionar.

## Testar rapidinho

Na aba **Conversa**, digite ou fale:
- *"anota que preciso pagar a conta de luz sexta"*
- *"lembra de comprar presente da Leti amanhã às 18h"*

As tarefas aparecem na aba **Tarefas**.

## Configuração (arquivo `backend/.env`)

| Variável | Para que serve |
|---|---|
| `ANTHROPIC_API_KEY` | Sua chave da IA (obrigatória para o chat) |
| `ANTHROPIC_MODEL` | Modelo da IA. Padrão `claude-opus-4-8`. Para gastar menos: `claude-haiku-4-5` |
| `PORT` | Porta do backend (padrão 3001) |
| `DATA_DIR` | Onde o banco é salvo (padrão `./data`) |

## Publicar depois no Railway (resumo)

1. Suba a pasta `nina/` para um repositório no GitHub.
2. No Railway, crie um serviço para o **backend** (start: `npm start`, pasta `backend`)
   e configure as variáveis de ambiente (a chave da API etc.).
3. Crie um serviço para o **frontend** (build: `npm run build`) servindo a pasta `dist`.
4. O SQLite é ótimo para começar; quando quiser, dá para trocar por Postgres —
   todo o acesso ao banco está isolado em `backend/src/db.js`.

## Privacidade

Este app é **separado do app da clínica (CMOT)**: banco de dados próprio,
sem login compartilhado. Seus dados pessoais ficam só aqui.
```
