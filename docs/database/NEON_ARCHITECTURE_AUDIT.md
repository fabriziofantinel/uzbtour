# Audit architetturale PostgreSQL / Neon - SMF Travel

Data audit: 26 agosto 2026
Ambito: modello multi-tenant, importazione preventivi, programma, famiglie, spese multi-valuta, media, quiz/sfide e feedback.

## Stato di implementazione al 26 agosto 2026

Completato e verificato:

- migrazione `012_neon_architecture_hardening` applicata prima su branch Neon e poi in produzione;
- punto di ripristino pre-migrazione `pre-012-2026-08-26` creato senza compute;
- zero vincoli non validati e zero indici invalidi dopo la migrazione;
- rimosso tutto il DDL dalle request Next.js e introdotti controlli di readiness in sola lettura;
- aggregate in una singola transazione HTTP le letture principali di programma, dashboard e viaggio;
- retry idempotenti per spese, movimenti di cassa e feedback;
- importo EUR storico memorizzato insieme al tasso applicato alle nuove spese;
- coordinate puntuali di siti e hotel disponibili nel contratto del programma;
- `pg_stat_statements` 1.12 attivata in produzione con audit automatico di ruolo,
  integrità, cache hit e query aggregate;
- ruolo SQL `smf_app` senza attributi amministrativi né membership `neon_superuser`,
  policy 013 applicata e 108 chiamate runtime autenticate verificate;
- runtime Vercel in `fra1` con `DATABASE_URL` pooled e build/deploy verificati.

Ancora da consolidare:

- branch Neon automatico e isolato per ogni Preview Vercel;
- raccogliere almeno sette giorni di statistiche prima di fissare la baseline p95 definitiva;
- backfill verificato di coordinate puntuali e importi EUR storici dove la fonte è disponibile;
- RLS e contract migration dopo test multi-tenant dedicati sul branch di collaudo.

## 1. Baseline verificata

| Area | Stato osservato |
|---|---|
| Runtime | Next.js 16 / Node.js su Vercel Functions |
| Data access | SQL nativo parametrizzato, `@neondatabase/serverless` 1.1, protocollo HTTP |
| Connessione runtime | una funzione `neon(DATABASE_URL)` riutilizzata per istanza Fluid Compute |
| Migrazioni | script JavaScript imperativi `migrate.mjs` e `migrate-platform.mjs` |
| Modello | schema legacy mono-viaggio + schema piattaforma multi-tenant 001-015 |
| Storage | metadati in Neon, oggetti privati in Cloudflare R2 |
| Carico | read-heavy sul programma; burst di upload/scritture mobile; job asincroni SQS/Lambda |
| Regione dati | Neon/AWS in `eu-central-1`; Vercel Functions in `fra1` |

Il catalogo live è stato verificato dopo le migrazioni: database circa 14,8 MB,
cache hit tabelle 99,16%, nessun indice invalido e nessun vincolo non validato.
`pg_stat_statements` raccoglie ora la baseline delle query di produzione.

## 2. Valutazione sintetica

**Stato attuale: funzionale, ma non ancora consolidato come SaaS multi-tenant ad alta affidabilità.**

Punti positivi:

- SQL parametrizzato e driver appropriato al runtime serverless.
- `agency_id` già presente nella maggior parte dei dati tenant.
- molte FK composite impediscono associazioni tra agenzie diverse.
- contenuti condivisi separati dai risultati della famiglia.
- R2 mantiene i blob fuori da PostgreSQL.
- job asincroni idempotenti a livello di agenzia.

Rischi principali:

1. **P0 - ruolo owner nel runtime e assenza di RLS.** La stringa comunicata durante la configurazione usava il ruolo owner; se è ancora così, l’applicazione ha privilegi DDL e bypassa RLS. Creare un ruolo runtime senza ownership/BYPASSRLS.
2. **P0 - region mismatch.** Le funzioni in `iad1` interrogavano dati europei. È stato aggiunto `vercel.json` con `fra1` e Fluid Compute.
3. **P0 - DDL nel percorso delle richieste.** `ensureProgrammeFeedbackSchema` e `ensureNormalizedImportSchema` eseguono `CREATE TABLE`, `ALTER TABLE` e `CREATE INDEX` durante richieste utente/job. Vanno rimossi dopo aver introdotto una pipeline di migrazione obbligatoria.
4. **P1 - due modelli sovrapposti.** Le tabelle legacy `trip_*` mono-tour convivono con quelle multi-tenant e possono creare scritture divergenti. Congelare, verificare, esportare e poi rimuovere il legacy.
5. **P1 - confusione template/partenza.** `trip_templates.starts_on`, `ends_on` e `trip_days.source_date` rendono datato ciò che dovrebbe essere riutilizzabile. Le date appartengono solo a `departures`; il giorno template conserva `day_offset`.
6. **P1 - cataloghi duplicati.** `places`/`accommodations` duplicano `cities`/`visit_sites`/`hotels`. L’importatore valorizza il catalogo condiviso, mentre la posizione legge `places`: per questo la visita puntuale normalmente non ha coordinate.
7. **P1 - denaro non immutabile.** `NUMERIC(18,2)` non rispetta i minor unit ISO (UZS 0, altre valute 3) e le spese non persistono il cambio applicato/base amount. I totali storici non devono dipendere da un tasso live.
8. **P1 - integrità tra partenza e giorno.** Diverse fact table contengono contemporaneamente `departure_id` e `trip_day_id`, ma la FK non garantisce che il giorno appartenga alla versione usata dalla partenza.
9. **P1 - chatty read.** Il caricamento viaggiatore effettua 18 query parallele. HTTP è corretto, ma una transazione batch o 3-4 payload aggregati riducono round trip e offrono snapshot coerente.
10. **P1 - side effect R2 non transazionali.** Una cascata DB può lasciare oggetti orfani o, viceversa, fallire dopo aver cancellato il blob. Serve transactional outbox.
11. **P2 - retry mobile.** Spese, cambi, note e feedback non hanno ancora una chiave operazione fornita dal client; un retry può duplicare dati.
12. **P2 - migrazioni non immutabili.** La sola `version` non rileva file modificati. Servono checksum, advisory lock e una migrazione per file.

## 3. Modello target

Il DDL completo è in [`database/schema-v2.sql`](../../database/schema-v2.sql). Le decisioni critiche sono:

### Tenant e identità

- UUID per entità distribuite e create da più runtime.
- BIGINT identity per `audit_events` e `integration_outbox`, append-only e ad alto volume.
- `platform_users.id` resta `TEXT`: è un subject esterno Neon Auth, non un identificatore domain-generated.
- ogni tabella tenant ha `agency_id`; tutte le FK interne usano `(agency_id, id)`.
- RLS basata su `app.agency_id`, applicata solo dopo che il DAL imposta il contesto nella stessa transazione HTTP.
- il ruolo runtime non deve essere owner né avere `BYPASSRLS`; il ruolo migrazione usa la URL diretta.

### Template, versioni e partenze

- un template non contiene date assolute.
- una versione pubblicata è immutabile; correzioni generano una nuova versione.
- `departures` associa template, versione, intervallo date e fuso.
- `departure_days` materializza la data effettiva e garantisce che tutte le scritture della famiglia puntino al giorno corretto.
- attività ordinarie: solo `sort_order`; orari opzionali.
- trasporti/prenotazioni: `scheduled_start_at`/`scheduled_end_at` in `TIMESTAMPTZ`.

### Geodati

- catalogo globale: `countries`, `cities`, `visit_sites`, `hotels`.
- coordinate esatte come `GEOGRAPHY(POINT,4326)` con indice GiST.
- non usare mai le coordinate della città per simulare quelle di un sito.
- `places` e `accommodations` diventano legacy dopo il backfill.

### Valute

- importo canonico in minor unit interi (`BIGINT`), non float.
- tabella `currencies.minor_unit` per EUR=2, UZS=0 e valute a 3 decimali.
- ogni spesa conserva valuta originale, tasso applicato e importo base EUR.
- il tasso è `NUMERIC(24,12)` e immutabile dopo la registrazione.
- nessun ricalcolo storico da API cambio live.

### JSONB

JSONB resta appropriato per:

- payload AI tipologicamente variabili;
- metadata provider R2/Bedrock;
- override di partenza;
- configurazioni white-label.

JSONB non deve contenere chiavi usate per join/claim frequenti. `importId` diventa `platform_jobs.import_job_id` tipizzato. Ogni JSONB ha un `CHECK jsonb_typeof(...)`.

### Cancellazioni

- cascata per dati strettamente posseduti dal tenant.
- `RESTRICT` per cataloghi condivisi.
- soft delete per asset e agenzie prima della cancellazione definitiva.
- outbox transazionale per eliminare R2/S3 in modo ritentabile e idempotente.

## 4. Query tuning e indici

| Pattern reale | Problema | Strategia |
|---|---|---|
| viaggio per `profile.user_id` + membership attiva | indice corrente parte da `agency_id` | partial `(user_id, agency_id)` e `(traveler_id, party_id, agency_id) WHERE active` |
| viaggi agenzia per stato/date | indice non include stato | `(agency_id, status, starts_on, ends_on, id)` |
| programma approvato per versione | indice corrente parte da `trip_day_id` | partial `(agency_id, template_version_id, trip_day_id, sort_order) WHERE approved` |
| coda import per `payload->>'importId'` | scansione JSONB | colonna `import_job_id`; indice expression solo transitorio |
| cash/memorie recenti della famiglia | indice con `trip_day_id` nel mezzo non ordina l’intera famiglia | `(party_id, created_at DESC, id)` |
| registry agenzie | join template × traveler moltiplicativo | pre-aggregazioni separate; già corretto nel repository |

Non aggiungere un GIN generico su ogni JSONB: aumenta storage/WAL e rallenta le scritture senza aiutare query specifiche. Gli indici trigram sono limitati alla deduplicazione/search dei nomi di siti e hotel. Gli indici GiST hanno costo maggiore dei B-tree e sono giustificati solo per prossimità reale.

## 5. Neon e serverless

### Driver

- **Runtime Next.js/Vercel:** mantenere `neon()` HTTP. È la scelta migliore per query singole e transazioni non interattive.
- **Batch coerenti:** usare `sql.transaction([...])` HTTP, non aprire WebSocket.
- **WebSocket/Pool:** solo se saranno introdotte transazioni interattive o librerie compatibili `pg`; creare e chiudere il pool dentro la singola request serverless.
- **Migrazioni/manutenzione:** endpoint diretto con `DATABASE_DIRECT_URL`.

La distinzione HTTP/WebSocket è documentata da [Neon Serverless Driver](https://neon.com/docs/serverless/serverless-driver). Neon usa PgBouncer in transaction mode e il pooled endpoint contiene `-pooler`; dettagli in [Connection pooling](https://neon.com/docs/connect/connection-pooling).

### Variabili

| Variabile | Uso |
|---|---|
| `DATABASE_URL` | pooled URL, ruolo `smf_app`, runtime Production |
| `DATABASE_DIRECT_URL` | direct URL, ruolo migrazione, solo CI protetta/manutenzione |
| Preview `DATABASE_URL` | branch Neon per singolo preview, mai production |

Non usare `neondb_owner` nel runtime. Neon evidenzia che il ruolo owner bypassa RLS.

### Compute e autosuspend

- Demo/pre-vendita: scale to zero attivo, autosuspend 5 minuti, compute minimo.
- Produzione pilota: autoscaling con minimo capace di contenere il working set; scale to zero accettabile se il primo hit di alcune centinaia di millisecondi è tollerato.
- Agenzia con SLA: disabilitare scale to zero solo dopo misure reali, non preventivamente.
- monitorare cache hit, working set, p95 query e connessioni; Neon spiega il rapporto tra compute, LFC e `max_connections` in [Manage computes](https://neon.com/docs/manage/endpoints/).

### Regione

- Neon/AWS: `eu-central-1`.
- Vercel: `fra1`, ora dichiarato in `vercel.json`.
- evitare multi-region active per funzioni con scritture sul singolo primary: aumenta costo e non riduce la distanza dal DB.
- le indicazioni Vercel consigliano esplicitamente funzioni vicine alla sorgente dati: [Configuring regions](https://vercel.com/docs/functions/configuring-functions/region).

### Branching, CI/CD e restore

1. `main`: produzione, nessuna migrazione manuale non versionata.
2. `preview/pr-<numero>-<slug>`: branch Neon automatico per ogni preview Vercel.
3. build preview: crea branch, esegue migrazioni con direct URL, seed minimo, smoke test, deploy.
4. merge: applica expand migration su main, verifica, deploy app compatibile con vecchio+nuovo schema.
5. cleanup automatico dei branch preview.
6. prima di contract migration: snapshot/restore point e test restore trimestrale.

Neon usa copy-on-write per i branch e supporta un branch per preview; riferimenti: [Branching workflow](https://neon.com/docs/get-started-with-neon/workflow-primer) e [Vercel preview branches](https://neon.com/blog/neon-vercel-native-integration).

## 6. Migrazione zero-downtime

### Fase A - osservabilità e preflight

- eseguire `scripts/audit-neon-architecture.mjs` con accesso read-only;
- acquisire `EXPLAIN (ANALYZE, BUFFERS, WAL)` delle 5 query principali su branch;
- verificare FK orfane, duplicati email, righe legacy e valute;
- abilitare `pg_stat_statements` se disponibile e monitorare almeno 7 giorni.

### Fase B - expand

- eseguire [`012_neon_architecture_hardening.sql`](../../database/migrations/012_neon_architecture_hardening.sql) su branch;
- creare indici `CONCURRENTLY`;
- aggiungere colonne nullable/idempotency/FX/geodati;
- deploy applicazione dual-write per le nuove colonne;
- non abilitare ancora RLS.

### Fase C - migrate

- backfill minor unit e tasso storico disponibile;
- creare `departure_days` e ricondurre ogni fact al giorno corretto;
- migrare coordinate da città/siti/hotel verificate;
- materializzare `platform_jobs.import_job_id`;
- confrontare conteggi e checksum.

### Fase D - contract

- fermare scritture legacy;
- rendere `NOT NULL` i nuovi campi con `CHECK NOT VALID` + `VALIDATE`;
- rimuovere runtime DDL;
- introdurre ruolo `smf_app`, transaction context e RLS;
- dopo una finestra di sicurezza, eliminare `places`, `accommodations`, date dal template e tabelle legacy `trip_*`.

## 7. Criteri di accettazione

- nessuna query runtime usa il ruolo owner;
- nessun DDL viene eseguito durante una request;
- tutte le preview usano un branch DB isolato;
- p95 del caricamento programma misurato da `fra1` e ridotto rispetto a baseline;
- retry della stessa operazione mobile non crea duplicati;
- nessuna fact può riferire un giorno di un’altra partenza/versione;
- cancellazione agenzia non lascia oggetti R2 orfani;
- restore testato entro RTO/RPO concordati;
- zero FK senza indice iniziale giustificato;
- `schema-v2.sql` riproducibile su un database vuoto.
