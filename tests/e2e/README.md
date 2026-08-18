# Phase 0 browser contract

La suite usa Chromium e PostgreSQL 17 reali. Migra un database locale dedicato,
crea le sessioni attraverso l'API pubblica di Better Auth configurata soltanto
nel processo di test e completa i journey dal browser fino alle scritture
canoniche in PostgreSQL.

Il runner mantiene visibile in console l'output redatto di `drizzle-kit
migrate` e lo salva in `test-results/migration.log` subito dopo la migrazione.
Nel `finally` lo riscrive dopo gli altri processi, cosi l'evidenza non dipende
dall'esito dei gate successivi. Il file contiene esito, codice di uscita, stdout
e stderr, ma non URL di connessione o assegnazioni sensibili. CI ne verifica
presenza, successo e redazione, poi carica l'intera directory `test-results`
anche in caso di fallimento di un gate successivo.

Il journey principale attraversa esplicitamente i quattro gate Phase 0:

- onboarding canonico, import Context.dev, mirroring Blob e preview/download
  autenticati dell'Artifact;
- seconda dichiarazione Intent con replay della receipt, richiesta Product
  Marketer, consultation, refinement, reload e task `blocked` risolto soltanto
  da un turno successivo;
- isolamento di conversazione e tenant per owner, admin, member, viewer, Member
  rimosso e organizzazione estranea;
- endpoint resolution, Cron payload-free, attribuzione Gateway trusted,
  rifiuto dell'override runtime e addebito locale idempotente.

Le prove PostgreSQL controllano Action, Actor, sessione Eve, provenienza,
supersessione, question-resolution receipt, terminal event e ledger; non si
limitano allo stato renderizzato dalla UI. L'apertura del task con domande non
lo nasconde e non lo riesegue.

La prova di isolamento parte con Bob privo di membership, lo aggiunge come
`member`, lo promuove ad `admin` e infine rimuove la membership. Il prodotto
materializza l'Actor umano attraverso il boundary canonico: la fixture non
inserisce Actor raw. Bob legge Intent e Object condivisi, ma non vede la
conversazione CMO owner-private né nell'elenco né usando il suo URL diretto. Un
owner declassato a `viewer` conserva la lettura e può fermare il turno esatto;
un target stale è un no-op autorevole.

Landing, sign-in e una surface console autenticata hanno baseline Playwright
versionabili. I diff coprono i viewport primari, 200%/400% e i due lati dei
breakpoint web 1120/768 e app 1100/900/640; Axe, tastiera, focus visibile e
assenza di scroll orizzontale a 320 px restano assert separati. Per rigenerare
intenzionalmente le baseline si usa `E2E_UPDATE_SNAPSHOTS=1 pnpm test:e2e`.
Le screenshot caricano via route Playwright un singolo file Geist incluso nella
versione Next bloccata nel workspace e forzano quel font soltanto nello style di
snapshot: i byte e il rendering tipografico non dipendono dai font di sistema
macOS o Linux, senza cambiare il CSS del prodotto.

## Provider scriptati, solo E2E

`scripted-providers.mjs` viene caricato esclusivamente con Node `--import` dai
processi avviati da Playwright e rifiuta l'avvio fuori da `E2E_PROVIDER_MODE`.
Non esistono route, cookie, header o query selector E2E nel prodotto.

Il preload:

- risponde ai tre endpoint server-side reali dell'adapter Context.dev e serve un
  asset SVG HTTPS deterministico;
- intercetta `put` e `get` privati dell'SDK Vercel Blob sul suo boundary Undici,
  conservando i byte in una directory temporanea condivisa tra i processi;
- intercetta soltanto l'esatto endpoint server-side
  `https://ai-gateway.vercel.sh/v4/ai/language-model` e restituisce uno stream
  AI SDK deterministico con tool call ordinate, attribuzione Gateway, usage,
  `gateway.cost` e generation id;
- avvia i veri root CMO e Product Marketer sui normali endpoint `/eve/v1/*` e
  `/internal/dispatch`, senza `EVE_MOCK_AUTHORED_MODELS`.

Prima della build il runner prova i cinque root inattivi uno alla volta con il
confine pubblico `eve dev`/`localDev()`. Per ogni root crea uno snapshot
temporaneo byte-for-byte di `package.json` e `agent`, rifiuta symlink nella
sorgente copiata e collega soltanto il `node_modules` reale verificato. Avvia un
solo watcher, legge health e identity, completa una sessione con un prompt smoke
esatto, salva una receipt per Playwright e chiude il processo prima di passare
al root successivo. Solo per quel prompt la fixture deriva il root dal `cwd`
temporaneo e confronta l'identita con `/eve/v1/info`; nessun selettore raggiunge
il prodotto.

Terminati i preflight, il runner esegue una build nuova, sequenziale e senza
preload dei sette root. Per ciascun package richiama lo stesso
`materialize-marketing-skills` dichiarato dallo script di build e poi il normale
`eve build`. Avvia quindi gli artifact con `eve start` e il preload confinato al
solo runtime E2E. Ogni start usa un root temporaneo che contiene soltanto un
symlink alla `.output` appena costruita: la CLI pubblica conserva prewarm e
artifact reali, mentre il suo `cwd` e ogni dato locale restano nella directory
temporanea. Content, Distribution, Growth, Lifecycle e SEO Discovery usano
cinque porte proprie ed espongono health. Tutti e sei i root specialistici,
incluso Product Marketer, mantengono `/info` e `/session` protetti con `401`
sotto `eve start`; Product Marketer completa invece il proprio lavoro dal
dispatch autenticato. CMO è l'unica eccezione bridge-authenticated e completa
la propria sessione nel journey browser. Il Cron punta quindi a sette processi
distinti, non a cinque alias del CMO.

Dopo i root Eve, il runner esegue in sequenza anche i normali `next build` di
`apps/web` e `apps/app` con pnpm, senza caricare il provider scriptato e con
`NODE_ENV=production`. Durante le build, `BETTER_AUTH_URL` e i trusted origin
usano placeholder HTTPS sotto il dominio riservato `.invalid`; il valore
`NEXT_PUBLIC_APP_URL`, incorporato nel bundle web, resta invece l'origine HTTP
loopback di `apps/app`. Playwright conserva gli URL HTTP loopback e `NODE_ENV`
locali del test, poi avvia entrambi gli artifact con `next start`. Soltanto il
processo runtime di `apps/app` riceve il preload test-only. Reload, Server
Components e Route Handler sono cosi verificati con gli artifact Next di
produzione. Il server `next dev` resta uno strumento di sviluppo e non fa parte
del gate browser.

Solo durante questi due build il runner imposta
`E2E_EXPOSE_NEXT_TESTING_API=1`. Le configurazioni Next usano quel valore per
abilitare l'API ufficiale di test della navigazione nell'artifact E2E; i build
normali e hosted la lasciano disabilitata. `@next/playwright` mantiene sospeso
il contenuto dinamico mentre Playwright controlla lo shell HTML della landing e
gli shell non tenant parzialmente prefetched delle navigazioni client da
Context a Work e da Work a Context. Le asserzioni successive allo scope provano
poi che il contenuto dinamico viene completato, invece di confondere un fallback
statico con la pagina finale.

Il preload registra inoltre un loader Node version-pinned a Eve `0.31.3` e
ristretto all'URL esatto del modulo interno con cui Eve risolve
`.eve/.workflow-data`. Il preload importa subito quel modulo e fallisce se
versione, URL o hook non coincidono. Il world bundled risolve lo store dal
`cwd` temporaneo del preflight o dell'artifact; il preload imposta anche il supporto nativo
`WORKFLOW_LOCAL_DATA_DIR` alla stessa directory per gli altri componenti
Workflow. Fallisce se uno dei sette root viene avviato dal checkout reale.
Durante E2E ogni processo usa cosi uno store vuoto nella propria root
temporanea: le run locali preesistenti non vengono riprese e lo storico dello
sviluppatore non viene cancellato né spostato. La variabile non entra nei
manifest o nel contratto di deployment.

Il gate di confinement esegue anche il preload in child process: rifiuta il cwd
reale di un root Eve, accetta sia la root temporanea di preflight sia quella
dell'artifact e verifica che `apps/app` lasci `WORKFLOW_LOCAL_DATA_DIR` non
impostata.

La fixture inference interpreta le istruzioni esplicite dei prompt e attraversa
i tool canonici `declare_intent`, `request_specialist_work`, consultation,
`refine_intent`, `save_brand_context`, `finish_task` e
`resolve_product_marketer_questions`. I tool, gli hook di audit, il proxy
applicativo, il resolver del modello e le query PostgreSQL restano quelli di
produzione. Una prova di confinement scandisce `apps/**`, `packages/**` e i
manifest/deployment file root: preload, prompt smoke, selettori ed endpoint
della fixture non possono comparire nel prodotto.

## Limite del gate locale

La suite locale prova il forwarding e l'esecuzione Eve senza rete AI, ma non
sostituisce il canary hosted su AI Gateway con credenziali e telemetria reali.
Quel canary resta un gate deployment separato.
