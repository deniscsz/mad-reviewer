# mad-reviewer — Check Run no GitHub — Design

**Data:** 2026-05-29
**Status:** Aprovado (design); pré-implementação
**Autor:** denisspalenza + Claude

## 1. Objetivo

Hoje cada review do mad-reviewer publica apenas **comentários inline** no PR. O
objetivo é, adicionalmente, publicar um **Check Run** (API de Checks do GitHub)
no commit head do PR — o mesmo mecanismo que o Cursor BugBot usa para aparecer na
aba *Checks* / na caixa de status do PR.

O Check Run é uma **camada de status + resumo** por cima do fluxo atual. Os
comentários inline continuam **exatamente como hoje** (criar / manter / resolver,
com dedup por fingerprint). O check não substitui nada; ele dá visibilidade do
job no lugar onde o time já olha (status checks do PR) e resume o resultado.

Referência confirmada (engenharia reversa do check run do BugBot via
`gh api repos/.../check-runs/<id>`): App do GitHub com permissão `checks: write`,
`conclusion: "neutral"` mesmo achando bugs (não bloqueia merge), `output.summary`
em markdown com o resultado, `annotations_count: 0` (achados ficam nos review
comments, não em annotations).

## 2. Decisões fechadas

| Tema | Decisão | Porquê |
|---|---|---|
| Mecanismo | **Checks API** (não Commit Status API) | Única forma de ter `output` rico (title/summary); é o que o BugBot usa |
| Conclusão | `success` se **0 comentários do bot abertos** após o run; `neutral` se ≥1 aberto (novo OU de run anterior) | Regra definida pelo usuário; espelha o BugBot ("found 1 issue. 2 previously reported remain") |
| Run com erro/timeout | `failure` (com o erro no summary) — **só quando terminal** (esgotou retries) | Sinal honesto de "o bot não revisou"; não bloqueia merge a menos que o check vire *required* |
| Ciclo de vida | "start → done": cria `in_progress` ao **claim**, finaliza no fim | Mais simples e robusto; sem `queued`-no-push nem progresso ao vivo (adiáveis) |
| Dono do ciclo | **worker** (`tick`) | Único ponto que enxerga sucesso E falha do job |
| Achados | **Mantém review comments**; check = só resumo (sem annotations) | Não mexe na máquina de reconcile/dedup/resolve; espelha o BugBot |
| Idempotência | `checks.listForRef(headSha, name)` → reusa o check existente, senão cria | Zero migração de schema; sobrevive a retry e restart sem duplicar |
| Permissão | App ganha **`Checks: Read & write`** | Necessária p/ criar/atualizar check runs; instalações precisam re-aprovar |
| Assinatura de evento | **Nenhuma nova** | Só *criamos* checks; não reagimos a `check_run`/`check_suite` (botão "Re-run" fica fora de escopo) |
| Robustez | **Fail-soft** + flag `MAD_REVIEWER_CHECKS` (default on) | Falha no check nunca derruba o job; comentários sempre são postados |
| Texto do check | Português | Mantém a voz atual do bot (o reply de resolução já é PT) |

## 3. Ciclo de vida

O check run liga-se a um **`head_sha`**. Como a fila tem PK `(owner, repo, pr)` e
o debounce **substitui** o `head_sha` de um job pendente, criar o check no
*claim* (e não no enqueue) evita checks órfãos em commits superados.

```
worker.tick():
  job = queue.claimNext()                      # pending → running
  ───────────────────────────────────────────────────────────────
  [se checks habilitado]
    client   = getClient(job.installationId)
    checkId  = checks.start(client, {owner,repo,headSha,name})   # in_progress
        └─ listForRef(headSha, name): reusa o id se já existe, senão cria
        └─ qualquer erro aqui → log check_error; checkId = null   (fail-soft)
  ───────────────────────────────────────────────────────────────
  try:
    summary = runOne(job)                       # RunSummary {created,kept,resolved}
    queue.complete(job)                         # running → idle
    [se checkId]
      open       = summary.created + summary.kept
      conclusion = open === 0 ? "success" : "neutral"
      checks.finish(client, checkId, conclusion, formatOutput(summary, meta))
  catch err:
    dead = queue.fail(job, maxRetries)          # running → pending (retry) | failed (dead)
    [se checkId e dead]
      checks.finish(client, checkId, "failure", errorOutput(err))
    # se !dead (vai retentar): deixa o check em in_progress
```

- **Retry:** o mesmo job é re-claimado; `start()` reusa o check via `listForRef`
  e o volta para `in_progress` — sem duplicar.
- **Restart do processo:** jobs `running` viram `pending` no boot (já existe);
  ao re-claimar, `listForRef` reencontra o check criado antes do crash.

## 4. Conclusão (regra do usuário)

Derivada do resultado do reconcile — `RunSummary {created, kept, resolved}`:

```ts
function conclusionFor(s: RunSummary): "success" | "neutral" {
  const open = s.created + s.kept;   // comentários do bot abertos após o run
  return open === 0 ? "success" : "neutral";
}
```

- **`success`** (✓ verde) — nenhum comentário do bot aberto (`created + kept === 0`).
- **`neutral`** (cinza) — ≥1 aberto, seja novo deste run (`created`) ou mantido de
  run anterior (`kept`).
- `resolved` não conta (foram fechados neste run).

Isso é consistente porque `listActiveBotComments` + `reconcile` garantem que o
total de comentários do bot abertos após o run = `created + kept` (todo o resto
vira `resolved`). Nenhum caminho gera `failure` por *achar bug* → nunca bloqueia
merge por si só.

**Run com erro/timeout** (não conseguiu revisar) → `conclusion: "failure"`, com a
mensagem de erro no `output.summary`, **apenas quando o job é terminal** (esgotou
`MAX_RETRIES`). Enquanto houver retry, o check fica `in_progress`. Racional:
distinguir "revisei e há pendências" (`neutral`) de "não consegui revisar"
(`failure`). Não bloqueia merge a menos que o time torne o check *required*.
> Decisão default, revisável: se preferir nunca exibir vermelho, troca-se
> `failure` por `neutral` em `errorOutput` (1 linha).

## 5. Saída do check (`output`)

Texto em português, espelhando o nível de detalhe do BugBot (contagens, não lista
item-a-item — os detalhes vivem nos review comments). O `meta`
(`{adapter, model}`) é fornecido pelo `index.ts` a partir da config.

- **title:** `open === 0` → `"Nenhum problema em aberto"`; senão
  `"{open} problema(s) em aberto"`.
- **summary (markdown):**
  - `Revisão concluída com **{adapter}**{ model ? " (" + model + ")" : "" }.`
  - `🆕 {created} novo(s) · ♻️ {kept} mantido(s) · ✅ {resolved} resolvido(s)`
  - se `open > 0`: `**{open} problema(s) em aberto** ({kept} de revisões anteriores). Veja os comentários na aba *Files changed*.`
  - se `open === 0`: `Nenhum problema em aberto. 🎉`
- **erro/timeout:** title `"Revisão falhou"`; summary com o `status`/mensagem
  (ex.: timeout = `status 124`) e a nota de que nada foi postado.
- **annotations:** nenhuma (achados ficam nos review comments).

## 6. Componentes / arquivos (código)

| Arquivo | Mudança |
|---|---|
| **`src/github/checks.ts`** (novo) | `startCheckRun(client, opts) → checkRunId` (listForRef reusa-ou-cria + `in_progress`); `finishCheckRun(client, {checkRunId, conclusion, output})`; `conclusionFor(summary)`; `formatOutput(summary, meta)` e `errorOutput(err)` (puros) |
| `src/github/comments.ts` | estende `GitHubClient` com `rest.checks.{create, update, listForRef}` (mesmo octokit do installation) |
| `src/worker.ts` | passa a **donar o ciclo de vida**: novos deps `getClient`, `checks` (reporter), `checksEnabled`, `checkName`; `runOne` retorna `RunSummary`; wrap fail-soft |
| `src/queue/queue.ts` | `fail()` retorna `boolean` (job ficou **dead**/terminal) para o worker saber quando finalizar o check como `failure` |
| `src/runner.ts` | sem mudança de lógica — já retorna `RunSummary`; garantir o tipo no caminho até o worker |
| `src/index.ts` | `runOne` retorna o `RunSummary` (hoje é descartado); monta o `checks` reporter e passa `getClient`, config e o `meta` (`{adapter: config.adapter, model}`, p/ o `formatOutput`) para `startWorker` |
| `src/config.ts` | `MAD_REVIEWER_CHECKS` (bool, default `true`, semântica "≠ 'false'"); `MAD_REVIEWER_CHECK_NAME` (default `"mad-reviewer"`) |

Reuso (sem infra nova): `GitHubClient` (octokit do installation já tem `rest.checks`),
`RunSummary` (`src/runner.ts`), `getClient`/`getInstallationToken` (`src/index.ts`),
padrão de DI + logging estruturado já existentes.

### 6.1 Idempotência (reusa-ou-cria)

```
startCheckRun:
  runs = client.rest.checks.listForRef({ owner, repo, ref: headSha, check_name: name })
  existente = run mais recente em runs (filtrado pelo nome)
  if existente: update(check_run_id=existente.id, status="in_progress")   → retorna id
  else:         create({ name, head_sha: headSha, status:"in_progress" }) → retorna id
```

Escolha: `listForRef` (1 GET por claim) em vez de persistir `check_run_id` na
tabela `jobs`. Racional: zero migração de schema, idempotente em retry **e** em
restart. Alternativa (coluna `check_run_id`) anotada como opção futura se o custo
do GET incomodar.

## 7. Robustez e pré-requisito

- **Pré-requisito (a lição cursor/codex):** o App hoje tem só `pull_requests:write`.
  Check Runs exigem **`Checks: Read & write`**. Instalações existentes precisam
  **re-aprovar** a permissão. Documentado com destaque (§9).
- **Fail-soft:** qualquer erro nas chamadas de check (ex.: permissão ausente →
  403) → log `check_error` e **segue**. O job de review **nunca** falha por causa
  do check; os comentários são postados normalmente.
- **Flag:** `MAD_REVIEWER_CHECKS=false` desliga o recurso inteiro.

## 8. Config & Logging

**Variáveis novas** (`src/config.ts`, `.env.example`, `docs/guide/configuration.md`):

| Variável | Default | Descrição |
|---|---|---|
| `MAD_REVIEWER_CHECKS` | `true` | Liga/desliga o Check Run por PR. Qualquer valor ≠ `false` mantém ligado |
| `MAD_REVIEWER_CHECK_NAME` | `mad-reviewer` | Nome do check (GitHub agrupa re-runs pelo mesmo nome) |

**Eventos de log novos** (sempre-on; `docs/guide/configuration.md` → Logging):

| Evento | Quando | Campos |
|---|---|---|
| `check_create` | Check criado/reusado no claim | `repo`, `pr`, `headSha`, `checkRunId` |
| `check_complete` | Check finalizado | `repo`, `pr`, `checkRunId`, `conclusion`, `open` |
| `check_error` | Falha numa chamada de check (fail-soft) | `repo`, `pr`, `phase` (`start`\|`finish`), `error` |

## 9. Documentação a atualizar

> Requisito explícito do usuário: atualizar **toda** a doc, em especial onde
> descrevemos como criar o GitHub App e suas permissões.

| Arquivo | Mudança |
|---|---|
| **`docs/guide/github-app-setup.md`** | **§2 Permissions**: adicionar linha `\| Checks \| **Read & write** \| Criar/atualizar o check run por PR \|`. **§3 Event subscription**: nota de que **nenhum** evento novo é necessário (só criamos checks). **§Verify**: mencionar que um check `mad-reviewer` aparece na caixa de status do PR (success/neutral) |
| `README.md` | bullet de features (check run por PR); linhas de config (`MAD_REVIEWER_CHECKS`); **nota da permissão `Checks: write`** |
| `docs/guide/configuration.md` | tabela de variáveis (2 linhas); seção Notes (parágrafo do check: regra de conclusão, fail-soft, permissão); tabela de Logging (3 eventos); `.env` de exemplo |
| `docs/guide/getting-started.md` | "What happens on a PR" / Verify: além dos comentários, aparece um check run |
| `docs/guide/deployment.md` | requisito de permissão `Checks: write` no install; sem dependência de runtime nova |
| `docs/architecture/overview.md` | incluir o check run no fluxo + módulo `github/checks` e papel do worker |
| **`docs/architecture/check-runs.md`** (novo) | página dedicada (espelha `queue.md`/`reconciliation.md`): mecanismo, ciclo de vida, regra de conclusão, fail-soft, permissão; adicionar ao sidebar em `docs/.vitepress/config.ts` |
| `docs/reference/faq.md` | Q&A: "O check bloqueia merge?" (não, por padrão; como tornar *required*) |
| `.env.example` | linha `# MAD_REVIEWER_CHECKS=true` (+ `# MAD_REVIEWER_CHECK_NAME=mad-reviewer`) |

## 10. Testes (vitest, fakes via DI — espelha as suítes atuais)

- **`tests/checks.test.ts`** (novo):
  - `conclusionFor`: `created+kept===0` → `success`; caso contrário → `neutral`.
  - `formatOutput`: title/summary com 0 abertos vs ≥1; inclui `kept` como
    "de revisões anteriores"; `errorOutput` reflete o erro.
  - `startCheckRun`: reusa via `listForRef` quando existe; cria quando não existe.
  - fail-soft: erro do client é engolido (não propaga) e gera `check_error`.
- **`tests/worker.test.ts`** (estende):
  - cria check no claim; finaliza `success` quando `open===0`, `neutral` quando >0.
  - erro terminal → finaliza `failure`; erro não-terminal (vai retentar) → deixa
    `in_progress` (não chama `finish`).
  - `MAD_REVIEWER_CHECKS=false` → nenhuma chamada de check.
  - falha do check **não** derruba o job (`complete`/`fail` chamados mesmo assim).
- **`tests/config.test.ts`** (estende): default `true`; `"false"` desliga;
  `MAD_REVIEWER_CHECK_NAME` lido/ default.
- **`tests/queue.test.ts`** (estende): `fail()` retorna `false` enquanto
  `attempts < maxRetries` e `true` quando atinge (dead).

## 11. Fora de escopo (YAGNI)

- **Branch protection / required check** — config do lado do GitHub; documentado,
  não codado.
- **Annotations inline** via Checks API — escolha foi manter review comments.
- **`queued`-no-push**, **progresso ao vivo** no summary, botão **"Re-run"**
  (exigiria assinar `check_run` + handler) — adiáveis.
- **Coluna `check_run_id`** na fila — `listForRef` resolve a idempotência sem
  migração.
- **Lista item-a-item** de findings no `output.text` — `RunSummary` não carrega
  os findings; contagens bastam (nível BugBot). Reabordar se for pedido.

## 12. Decisões em aberto

1. **Erro/timeout → `failure` vs `neutral`.** Default escolhido: `failure`
   (sinal honesto de "não revisou"). Trocável em 1 linha se o time preferir nunca
   exibir vermelho. (Confirmar na revisão deste spec.)
