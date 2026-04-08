# Plano: Automação de Posts no Twitter com NanoClaw

**Data:** 2026-04-07  
**Status:** ✅ Concluído — em produção (2026-04-07)

---

## Goal

Integrar o bot do Telegram (`@lBerserKBot` / Jarvis) com o Twitter/X para:

- Publicar 2 posts/dia com as melhores notícias de tecnologia
- Aplicar humanizer + perfil de escrita antes de postar
- Pedir aprovação via Telegram antes de publicar
- Escanear menções a cada 6h e responder automaticamente via Twitter API v2
- Usar Firecrawl MCP dentro do container para raspar conteúdo das fontes

---

## Arquitetura Geral

```
[Scheduler: 2x/dia]
       ↓
[Container: Jarvis]
  ├─ Firecrawl MCP → raspa Bloomberg + TechPowerUp
  ├─ Seleciona melhor notícia
  ├─ Gera post com perfil de escrita + humanizer
  ├─ x_post_pending → envia para aprovação no Telegram
       ↓
[Usuário aprova no Telegram: "ok" / "edita: ..." / "cancela"]
       ↓
[Host detecta aprovação → x_post → Twitter API v2]

[Scheduler: a cada 6h]
       ↓
[Container: Jarvis]
  ├─ x_get_mentions → Twitter API v2 busca menções
  ├─ Classifica: elogio / pergunta / hater / amigo
  └─ Responde conforme regra de engajamento
```

---

## Fontes de Conteúdo

| URL                                    | Tipo                        |
| -------------------------------------- | --------------------------- |
| `https://www.bloomberg.com/technology` | Notícias tech/IA/mercado    |
| `https://www.techpowerup.com/`         | Hardware, GPU, CPU, reviews |

Temas alvo: **IA, Hardware, Homeserver, Programação**

---

## Modelo

`github-copilot/claude-haiku-4.5` — configurado via:

- `.env`: `OPENCODE_MODEL=github-copilot/claude-haiku-4.5`
- `container/agent-runner/src/index.ts`: `DEFAULT_MODEL = process.env.OPENCODE_MODEL ?? 'github-copilot/claude-haiku-4.5'`

---

## Perfil de Escrita (Persona Jarvis para Twitter)

Arquivo: `container/skills/x-twitter/persona.md`

**Características:**

- Argumentativo — demonstra ou questiona coerência do autor
- Texto como "eu" escrevendo (primeira pessoa implícita)
- Formal/acadêmico, técnico mas acessível
- Frases curtas predominantes, com longas para progressão
- Metáforas ocasionais para simplificar conceitos complexos
- Dados quantitativos/qualitativos quando disponíveis
- Estrutura: introdução → desenvolvimento → conclusão

**Condições linguísticas:**

- Coerência: encadeamento lógico, progressão temática contínua
- Coesão: mecanismos linguísticos conectando frases/parágrafos
- Ritmo: fluido e objetivo
- Objetividade: sem digressões, foco direto no tema
- Terminologia técnica com clareza

**Humanizer (aplicado sempre):**

- Sem palavras AI típicas (additionally, delve, crucial, pivotal, landscape...)
- Sem em-dashes em excesso
- Sem listas bullet desnecessárias
- Sem frases de encerramento genéricas
- Sem sycofantismo
- Voz direta, personalizada, com opinião real

---

## Limite de Tokens (GitHub Copilot Pro+)

| Operação                             | Custo estimado (tokens) |
| ------------------------------------ | ----------------------- |
| Raspar 2 fontes + selecionar notícia | ~3.000                  |
| Gerar post com humanizer             | ~2.000                  |
| Aprovação + envio                    | ~500                    |
| Scan de menções (6h)                 | ~2.000                  |
| **Total diário**                     | **~15.000**             |

GitHub Copilot Pro+ tem limite generoso (~300k tokens/mês). Com 2 posts/dia + scan 4x/dia = ~350k tokens/mês — dentro do limite. Mitigações:

- Firecrawl com `onlyMainContent: true` (reduz tokens)
- Prompt do scan de menções enxuto
- Scan só das últimas 6h de menções (não histórico completo)

---

## Fluxo de Aprovação (mecanismo IPC)

### Solução: IPC `x_post_pending` + polling por resposta

1. **Container** chama `x_post_pending(content, draft)`:
   - Escreve `/workspace/ipc/tasks/x_post_pending-{requestId}.json`
   - Aguarda `/workspace/ipc/x_results/{requestId}.json` (poll por até 30min)

2. **Host** (`handleXIpc`) recebe `type: 'x_post_pending'`:
   - Envia mensagem ao usuário via Telegram:

     ```
     📝 *Post pendente de aprovação:*

     {conteúdo do post}

     Responda:
     • `ok` — postar agora
     • `edita: [novo texto]` — substituir e postar
     • `cancela` — descartar
     ```

   - Salva no SQLite: `pending_approvals(requestId, chatJid, content, status, created_at)`
   - Aguarda resposta do usuário

3. **Resposta do usuário** no Telegram:
   - `src/index.ts` detecta mensagem começando com `ok`, `edita:` ou `cancela`
   - Verifica se há `pending_approval` ativo para aquele `chatJid`
   - Escreve resultado em `data/ipc/{group}/x_results/{requestId}.json`

4. **Container** recebe resultado e:
   - Se `ok` → chama `x_post(content)` normalmente
   - Se `edita:` → chama `x_post(newContent)` com o `approvedContent` retornado pelo host
   - Se `cancela` → retorna sem postar

---

## Scan de Menções (Twitter API v2)

### MCP tool: `x_get_mentions()`

- Escreve IPC `{type: 'x_get_mentions', requestId}`
- Host consulta Twitter API v2 (OAuth 1.0a) buscando menções das últimas 6h
- Retorna lista de menções: `{ mentions: [{url, text, author, type?}] }`

### Regras de engajamento (no prompt do agente):

```
- Elogio simples → x_like(url) + x_reply(url, resposta breve de 1-2 frases)
- Pergunta técnica → x_reply(url, resposta completa mas simples)
- Hater/ofensivo → IGNORAR (sem curtir, sem responder)
- Amigo/conhecido → x_like(url) + x_reply(url, resposta pensada)
```

---

## Tools MCP Entregues

| Tool             | Descrição                                               |
| ---------------- | ------------------------------------------------------- |
| `x_post`         | Publica tweet via Twitter API v2                        |
| `x_like`         | Curte tweet via Twitter API v2                          |
| `x_reply`        | Responde tweet via Twitter API v2                       |
| `x_retweet`      | Retweeta via Twitter API v2                             |
| `x_quote`        | Quote tweet via Twitter API v2                          |
| `x_post_pending` | Envia post para aprovação do usuário via Telegram (IPC) |
| `x_get_mentions` | Busca menções das últimas 6h via Twitter API v2         |

---

## Bugs Corrigidos Durante Implementação

| Bug                                  | Causa                                                              | Fix                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Nenhuma tool MCP funcionava          | `server.connect(transport)` ausente no final de `ipc-mcp-stdio.ts` | Adicionado `await server.connect(transport)`                                           |
| Edição de post não chegava ao agente | `waitForXResult` não retornava `approvedContent`                   | Return type atualizado; `approvedContent` incluído na resposta                         |
| Sessão obsoleta travava o agente     | `Session not found` no stderr do OpenCode não era detectado        | `QueryResult` agora tem `staleSession?: boolean`; stderr monitorado; host limpa sessão |

---

## Arquivos Criados/Modificados

### Novos arquivos

| Arquivo                                            | Propósito                     |
| -------------------------------------------------- | ----------------------------- |
| `container/skills/x-twitter/persona.md`            | Perfil de escrita + humanizer |
| `.opencode/plans/2026-04-07-twitter-automation.md` | Este plano                    |

### Modificações

| Arquivo                                       | O que mudou                                                                                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `container/agent-runner/src/index.ts`         | Modelo `haiku-4.5`; stale session detection via stderr                                                                                              |
| `container/agent-runner/src/ipc-mcp-stdio.ts` | `server.connect(transport)`; tools `x_post_pending`, `x_get_mentions`, `x_post`, `x_like`, `x_reply`, `x_retweet`, `x_quote`; fix `approvedContent` |
| `.claude/skills/x-integration/host.ts`        | Handlers para todas as 7 tools x\_\*                                                                                                                |
| `src/ipc.ts`                                  | Roteamento para handlers x\_\*                                                                                                                      |
| `src/db.ts`                                   | Tabela `pending_approvals`                                                                                                                          |
| `src/index.ts`                                | Interceptação de mensagens `ok/edita/cancela` + limpeza de sessão obsoleta                                                                          |
| `.env`                                        | `OPENCODE_MODEL=github-copilot/claude-haiku-4.5` + credenciais Twitter API v2                                                                       |
| `container/build.sh`                          | Contexto de build movido para raiz do projeto                                                                                                       |
| `container/Dockerfile`                        | Paths de COPY ajustados                                                                                                                             |

---

## Tarefas Agendadas (criadas via Telegram — em produção)

| Horário    | Tarefa                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------- |
| 10h diário | Post matinal: raspa Bloomberg + TechPowerUp → seleciona notícia → gera post → envia para aprovação |
| 18h diário | Post vespertino: mesmo fluxo                                                                       |
| A cada 6h  | Scan de menções: busca Twitter API v2 → classifica → responde conforme regras de engajamento       |

---

## Riscos

| Risco                                   | Mitigação                                             |
| --------------------------------------- | ----------------------------------------------------- |
| Bloomberg bloqueia scraping             | Firecrawl usa proxy stealth; fallback: só TechPowerUp |
| X detecta automação e bana conta        | Twitter API v2 oficial com OAuth 1.0a                 |
| Token budget Copilot Pro+ estoura       | Firecrawl `onlyMainContent:true` + prompts enxutos    |
| Aprovação expira (usuário não responde) | Timeout de 30min: cancela automaticamente             |
| Menções fora do horário de scan         | Scan a cada 6h é suficiente para conta nova           |
