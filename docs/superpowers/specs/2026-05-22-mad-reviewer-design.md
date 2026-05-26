# mad-reviewer — Design

**Data:** 2026-05-22
**Status:** Aprovado (design); pré-implementação
**Autor:** denisspalenza + Claude

## 1. Objetivo

Agente que revisa Pull Requests automaticamente nos ~20 repositórios da
organização no GitHub. A cada PR aberto ou atualizado, uma ferramenta de IA
(em modo não-interativo) roda a review usando skills custom da empresa, e o
agente publica comentários inline apontando cada bug encontrado via API do
GitHub.

A memória de findings vive no próprio GitHub: a cada execução o agente
reconcilia os comentários que ele mesmo abriu antes, marca como resolvidos os
bugs que deixaram de ser apontados (alguém corrigiu), e cria comentários novos
para bugs novos — sem duplicar nem poluir threads humanas.

## 2. Decisões fechadas

| Tema | Decisão |
|---|---|
| Disparo | Webhook central (GitHub App) → servidor sempre ligado |
| Auth/identidade | GitHub App instalado na org (cobre os 20 repos) |
| Stack | Node/TypeScript + Probot |
| Ferramenta de IA | Adapter trocável via config; default `claude -p` |
| Memória de findings | GitHub como fonte da verdade (fingerprint oculto no comentário) |
| Orquestração/fila | SQLite (embedded): jobs, lock por PR, debounce, last_processed_sha |
| Identidade do bug | A3 híbrido: `dedupeKey` semântico da IA + arquivo + categoria → hash determinístico no servidor |
| Resolver | Reply (`✅ resolvido auto, commit X`) + `resolveReviewThread` (GraphQL) |
| Bug que reaparece | Cria comentário NOVO; thread resolvida vira histórico inerte |
| Falso-resolvido | Resolve na hora (1 run ausente); sem contador |
| Comentários | Inline por bug, ancorado em arquivo+linha; só bugs reais (sem nit/estilo) |
| Contexto da IA | Clona o head do PR em tmpdir; IA tem acesso total aos arquivos + diff |
| Skills | 3 tiers: `skills/defaults/` (sempre) + `skills/auto-apply/` (condicional) + `.mad-reviewer/skills/` no repo target (override) |

## 3. Arquitetura

```
GitHub org (20 repos)
   │  webhook: pull_request (opened, synchronize, reopened)
   ▼
┌─────────────────────────────────────────────┐
│  Servidor central (Node/TS + Probot)          │
│                                                │
│  webhook handler ──► enqueue(job)              │
│                         │                      │
│                  ┌──────▼───────┐  SQLite      │
│                  │ Queue/Locker │◄─(jobs,locks, │
│                  └──────┬───────┘   last_commit)│
│                         │ (debounce + lock/PR)  │
│                  ┌──────▼───────────────────┐   │
│                  │ Review Runner            │   │
│                  │ 1. mint token            │   │
│                  │ 2. clone PR head (tmp)   │   │
│                  │ 3. diff base..head       │   │
│                  │ 4. load skills (merge)   │   │
│                  │ 4.5 select auto-apply    │   │
│                  │ 5. AI adapter → findings │   │
│                  │ 6. reconcile c/ GitHub   │   │
│                  │ 7. post / resolve coments│   │
│                  │ 8. cleanup + last_sha    │   │
│                  └──────────────────────────┘   │
└─────────────────────────────────────────────┘
   │  Octokit (REST + GraphQL), git clone via App token
   ▼
GitHub API
```

### 3.1 Componentes

Cada componente tem um propósito único, interface bem-definida, e é testável
isoladamente.

1. **`webhook` (Probot app)** — valida assinatura HMAC, filtra eventos de PR
   relevantes (`opened`, `synchronize`, `reopened`), monta
   `Job{repo, prNumber, headSha, installationId}`, enfileira. Não faz review.
2. **`queue` (SQLite)** — persiste jobs; debounce por PR (coalesce rajadas de
   `synchronize`); lock por PR (1 run por vez); guarda `last_processed_sha`
   para pular runs redundantes. Sobrevive a restart.
3. **`runner`** — orquestra o ciclo de passos; cola os outros módulos.
4. **`workspace`** — clona o head do PR em tmpdir (shallow + fetch do base
   para ter o diff) usando token de installation; garante cleanup em `finally`.
5. **`skills-loader`** — resolve os 3 tiers de skills, faz merge, entrega o
   conjunto efetivo ao adapter.
6. **`ai-adapter`** — interface trocável (`review(input) → Finding[]`); impl
   default `claude -p`. Parseia output JSON estruturado e valida contra schema.
7. **`fingerprint`** — A3: combina `dedupeKey` (IA) + arquivo + categoria →
   hash determinístico. Embute/parseia `<!-- mad-reviewer:fp=… -->`.
8. **`reconciler`** — compara findings atuais × comentários ativos do bot.
   Decide: criar / manter / resolver / reaparecer.
9. **`github-comments`** — posta comentário inline (REST), resolve thread
   (GraphQL `resolveReviewThread` + reply). Identidade = bot do GitHub App.

### 3.2 Contrato `Finding`

```ts
type Finding = {
  file: string;        // path relativo ao repo
  line: number;        // linha aprox no head (para ancorar o comentário)
  category: string;    // ex: "null-safety", "security/injection"
  dedupeKey: string;   // chave semântica estável emitida pela IA
  severity: "bug";     // só bugs reais nesta versão
  title: string;
  body: string;        // explicação + sugestão
};
```

## 4. Fluxo de execução

Por job, após sair da fila (debounce + lock garantidos):

1. **Mint token** de installation (curto, por repo) via GitHub App.
2. **Clone** `headSha` em tmpdir (`--depth 1` + fetch do base para o diff).
3. **Diff** `base..head` → lista de arquivos tocados (foco do prompt).
4. **Load skills**: `skills/defaults/` (sempre).
4.5. **Select auto-apply**: escolhe de `skills/auto-apply/` as relevantes ao PR
   (ver §6 e @TODO §6.3); aplica override de `.mad-reviewer/skills/`.
5. **AI adapter** roda → `Finding[]` (JSON validado por schema; output
   malformado = run falha limpo, NÃO posta nada).
6. **Reconcile** (§5).
7. **Aplica** ações no GitHub.
8. **Cleanup** tmpdir + grava `last_processed_sha` no SQLite.

## 5. Reconciliação (núcleo da memória)

```
existentes = comentários do bot no PR
   (REST: list review comments, filtra author = app[bot])
   → extrai fp de cada via regex no HTML comment
   → considera apenas comentários ATIVOS (não-resolvidos)
   → mapa: fp → {commentId, threadId}

novos = Finding[] do run → calcula fp de cada (módulo fingerprint)
   → set de fps atuais

Para cada fp:
  ┌ atual E não existe ativo            → CRIAR comentário inline (embute fp)
  ├ atual E existe ativo                → MANTER (no-op; evita spam)
  ├ atual E só existe resolvido         → CRIAR comentário NOVO (reaparecimento)
  └ existe ativo E não está em atual    → RESOLVER (reply + resolveReviewThread)
```

### 5.1 Regras de borda

- **Só agimos em comentários do próprio bot.** Comentários humanos nunca são
  tocados.
- **Idempotência:** rodar 2x no mesmo `headSha` não duplica (MANTER cobre; e
  `last_processed_sha` pula o run inteiro se o sha não mudou).
- **Resolvido por sumiço:** só resolve quando o fp some do output atual.
  Ausência = resolvido (não tentamos "verificar se foi corrigido"). Resolve já
  no 1º run ausente; sem contador.
- **Thread resolvida por humano:** se um humano resolveu manualmente, NÃO
  reabrimos nem reusamos (respeita decisão humana — checamos quem resolveu via
  GraphQL). Reaparecimento sempre vira comentário novo, então isso fica natural.
- **Reaparecimento:** bug com fp cuja única ocorrência existente está resolvida
  → cria comentário novo. A thread resolvida antiga permanece como histórico
  inerte e é ignorada na comparação (só comentários ativos contam).
- **Anchor inválido** (linha sumiu / arquivo deletado): se não dá para ancorar
  inline, posta como comentário de PR (conversation) referenciando o arquivo,
  com o mesmo fp embutido.

## 6. Skills

### 6.1 Resolução (3 tiers)

```
skills/defaults/      # no mad-reviewer — SEMPRE carregadas em todo review
skills/auto-apply/    # no mad-reviewer — carregadas SÓ se a description casar com o PR
.mad-reviewer/skills/ # no repo TARGET do PR — override opcional

merge:
  1. carrega tudo de skills/defaults/
  2. seleciona de skills/auto-apply/ as relevantes ao PR  ← @TODO §6.3
  3. aplica override de .mad-reviewer/skills/:
        • mesmo nome de arquivo → versão do repo VENCE
        • arquivo novo → adiciona
  - output-contract.md (defaults) NÃO é sobrescrevível por repo
```

- **`skills/defaults/`** — baseline garantido nos 20 repos (ex: `null-safety.md`,
  `security.md`, `output-contract.md`). Versionam junto com o deploy do
  mad-reviewer; sem pin/versão externa.
- **`skills/auto-apply/`** — skills condicionais; cada uma declara no
  frontmatter quando se aplica (ex: "PRs que tocam SQL/migrations", "código
  React/JSX", "Dockerfile/infra"). Mantém o prompt enxuto.
- **`.mad-reviewer/skills/`** — lido do workspace já clonado (sem chamada extra
  de API). Permite regras específicas por projeto.
- **`output-contract.md`** — fica nos defaults e não é sobrescrevível; garante
  que o JSON `Finding[]` (com `dedupeKey`) sempre exista, mesmo se um repo mexer
  nas skills de detecção.

### 6.2 Formato da skill

Markdown com frontmatter (`name`, `description`, e — para auto-apply — critério
de aplicação) + corpo com checklist do que procurar e como reportar.
Compatível com `.claude/skills` quando adapter = `claude -p`; outros adapters
recebem o mesmo markdown concatenado no prompt.

### 6.3 @TODO — Step 4.5: seleção de skills auto-apply

> Criar passo no runner (antes da chamada de review) que, com base no contexto
> do PR (arquivos tocados, linguagens, diff), decide quais skills de
> `skills/auto-apply/` carregar. Decisão de implementação em aberto:
> - **(a)** match determinístico por glob/regra no frontmatter
>   (ex: `applies_to: ["**/*.sql"]`) — rápido, previsível, sem custo de IA;
> - **(b)** etapa de IA leve que lê as `description`s + resumo do PR e escolhe —
>   flexível, custa 1 chamada extra;
> - **(c)** híbrido (glob filtra candidatos, IA desempata).
>
> Definir na fase de plano/implementação.

## 7. Adapter de IA

```ts
interface AiAdapter {
  name: string;
  review(input: {
    workspaceDir: string;     // repo clonado
    changedFiles: string[];   // foco do diff
    diff: string;
    skills: EffectiveSkills;  // markdown merged (defaults + auto-apply + override)
  }): Promise<Finding[]>;     // valida JSON contra schema
}
```

- **Default `ClaudeAdapter`** — `claude -p --output-format json`, com skills
  efetivas em `.claude/skills` do workspace. A skill `output-contract.md`
  instrui a IA a emitir JSON `Finding[]`; cada finding inclui `dedupeKey`
  semântico estável no formato `<categoria>:<símbolo/escopo>:<sintoma>`.
- **Config-driven** — `MAD_REVIEWER_ADAPTER=claude|cursor|opencode`. Cada
  adapter encapsula como invoca a CLI e como extrai o JSON.
- **Parse falho** → run falha limpo, sem comentar.
- **Timeout** configurável por run; estoura → run marcado falho (log), sem
  comentar.
- **Identidade do dedupeKey:** a IA propõe a identidade semântica; o servidor
  recalcula o fingerprint final (A3) para garantir consistência entre runs.

## 8. Tratamento de erro

Princípio: **nunca poluir o PR em estado incerto.**

| Falha | Ação |
|---|---|
| Clone falha | Run falha, log, sem comentar. Próximo push reprocessa. |
| AI timeout / crash | Run falha, sem comentar. Job marcado erro (retry limitado). |
| Output JSON inválido | Run falha limpo. NÃO posta nada. |
| GitHub API rate limit | Backoff + retry; se persistir, falha e reentrega depois. |
| Falha parcial no post | Idempotência: próximo run com mesmo sha re-reconcilia (MANTER pula os já postados). |
| tmpdir cleanup | Sempre em `finally`, mesmo em erro. |
| Token de installation expira | Re-mint por run (tokens curtos). |

- **Retry:** job tem `attempts`; falha → re-enfileira até `MAX_RETRIES`, depois
  dead-letter (SQLite marcado `failed`, visível para debug).
- **Observabilidade:** log estruturado por run
  (`repo, pr, sha, #findings, #criados, #resolvidos, duração, custo`).

## 9. Testes

Unidade + integração; não mocar o que importa.

- **`fingerprint`** (unit) — mesmo finding → mesmo fp; mudança de linha não muda
  fp; mudança de `dedupeKey` muda fp.
- **`reconciler`** (unit, table-driven) — 4 casos (criar / manter / resolver /
  reaparecer-novo) + bordas (thread resolvida por humano não é reusada;
  resolvido vira histórico inerte e é ignorado).
- **`skills-loader`** (unit) — merge defaults + auto-apply + override;
  `output-contract.md` não sobrescrevível.
- **`ai-adapter`** (unit) — parse de JSON válido/inválido; timeout. Integração
  opcional: `claude -p` real atrás de flag (fora do CI padrão).
- **`queue` (SQLite)** (unit) — debounce coalesce; lock impede 2 runs/PR;
  `last_processed_sha` pula redundante; sobrevive a reabertura do arquivo.
- **`github-comments`** (unit) — montagem de payload REST/GraphQL com fixtures.
- **e2e** (atrás de flag, fora do CI default) — repo sandbox + PR fixture:
  webhook → comentário aparece; push que corrige → resolve.

## 10. Deploy & config

- **Runtime:** Node LTS. Processo único (Probot http server + worker
  in-process). SQLite em volume persistente.
- **Empacotamento:** Docker. Imagem precisa de `git` + a CLI da IA escolhida no
  PATH.
- **Secrets** (env / secret manager; nunca em repo): App ID, private key,
  webhook secret, API key da IA.
- **Config (env):**
  ```
  GITHUB_APP_ID, GITHUB_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET
  MAD_REVIEWER_ADAPTER=claude        # claude|cursor|opencode
  AI_API_KEY                          # conforme adapter
  AI_TIMEOUT_MS=...
  DEBOUNCE_MS=...
  MAX_RETRIES=...
  SQLITE_PATH=/data/queue.db
  ```
- **Permissões do GitHub App:** Pull requests (read + write p/ comments),
  Contents (read p/ clone), Metadata (read). Webhook events: `pull_request`.
- **Saúde:** endpoint `/health`; readiness verifica SQLite + git + CLI da IA.

## 11. Fora de escopo (YAGNI nesta versão)

Dashboard/UI, multi-org, fila externa / scaling horizontal, severidades além de
`bug`, auto-fix / sugestões aplicáveis, métricas em DB. As interfaces (`queue`,
`ai-adapter`) ficam isoladas para permitir esses depois sem reescrita.
