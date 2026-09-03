# SMF Travel - Stato consolidamento architetturale

Data di riferimento: 2026-09-03. Revisione allineata al modello V3 e alle migrazioni 001-147.

## Componenti e connessioni as-built

1. Browser e PWA invocano Next.js 16 su Vercel esclusivamente via HTTPS.
2. Cognito Lite autentica per username e password; l'e-mail resta recapito per inviti e reset. Il runtime usa l'adapter `lib/auth/auth-provider.ts`.
3. Le route Next.js usano le stored API PostgreSQL sul collegamento Neon pooled; migrazioni e drill usano la connessione diretta owner.
4. PostgreSQL applica RLS forzata, contesto tenant, chiavi composte, indici tenant-leading e procedure `SECURITY DEFINER` con `search_path` fisso.
5. I file privati sono caricati su Cloudflare R2 con URL presigned; Neon conserva metadati, ambito, soft delete e chiavi immutabili. Le quote storage sono configurabili per agenzia.
6. Vercel assume via OIDC un ruolo AWS STS e instrada i job su code SQS separate. Non sono presenti access key AWS statiche su Vercel.
7. Worker Lambda ARM64 dedicati applicano idempotenza, concorrenza, budget giornalieri e mensili configurabili per agenzia e workload.
8. Bedrock Converse usa Nova 2 Lite, Tool Use forzato, validazione Zod, grounding con fonti ammesse e telemetria in `ops.generation_runs` con prezzi versionati.
9. `traceId` correla browser, Vercel, Neon, SQS e Lambda; `errorId` correla gli errori web senza esporre dati personali.
10. CloudWatch controlla errori, durata, backlog e DLQ. Il Tour Leader è un'identità autonoma limitata alla partenza, con finestra temporale e revoca.
11. La risoluzione delle sessioni impersonate e dei download privati di ricordi e documenti usa l'identità IAM UUID nativa; la baseline dei bridge runtime legacy è scesa da 31 a 28.

## Finding del Solution Architect

| Finding | Stato | Evidenza / condizione |
| --- | --- | --- |
| Punto 7 funzionale | Chiuso | Tour Leader freelance e temporale, comunicazioni e conferme, presenze, emergenze, documenti, assicurazione, profilo esperienza e chat separate sono implementati |
| DLQ e allarmi | Chiuso | Code operative isolate, DLQ dedicate, allarmi CloudWatch e sottoscrizione SNS confermata |
| Grounding Bedrock | Chiuso | Invocazione live verificata, citazioni filtrate su fonti attendibili e prezzi Nova 2 Lite versionati |
| Contabilità AI | Chiuso | Import, OCR asincrono, enrichment e valutazioni fotografiche registrano usage e costo in `ops.generation_runs` |
| Tour Leader | Chiuso | Invito autonomo senza membership globale, identità UUID nativa, validità temporale e revoca per partenza |
| Quote workload e storage | Chiuso | Limiti configurabili per tenant, indice sul percorso caldo e controlli prima del dispatch/upload |
| Error correlation web | Chiuso | `instrumentation.ts`, `onRequestError`, risposta con `errorId` e header `x-smf-error-id` |
| Nomenclatura gruppi | Chiuso | URL, payload e consumer usano `groups`; il gate impedisce la reintroduzione di `families` |
| DR e isolamento Neon | Chiuso | Ogni gate crea un branch effimero, verifica letture/RLS, ricostruisce lo schema da vuoto e rimuove il branch |
| Dizionario e documenti architetturali | Chiuso | Architettura v1.3 e modelli logico/fisico v1.5 aggiornati alle 88 tabelle correnti |
| Dati per biglietteria | Fuori perimetro deciso | Non vengono archiviati passaporti o documenti sanitari; le sole segnalazioni operative essenziali hanno consenso e scadenza |
| WAF perimetrale | Bloccato esternamente | Richiede un dominio personalizzato e una zona DNS; il dominio condiviso Vercel non è configurabile nella WAF Cloudflare |
| Staging applicativo | Predisposto, non attivo | Branch Neon effimero e test sono pronti; manca un deployment Vercel staging isolato con configurazione e dati sintetici |
| Playwright autenticato | Predisposto, non attivo | I percorsi read-only agenzia/viaggiatore esistono; il job resta sospeso finché non sono configurati URL e account E2E dedicati |
| Test AI live manuale | Predisposto e disattivato | Replay deterministico gratuito in CI; ogni esecuzione Bedrock reale richiede avvio del proprietario e `AI_LIVE_TEST_CONFIRM=1`. Nessuna pianificazione automatica finché l'app non sarà commercializzata |

## Gate di rilascio

- `npm run quality:release` esegue il build, che richiama il guard non aggirabile: baseline, migrazioni, confini runtime, sicurezza API, nomenclatura, debito identità, baseline test, formato, lint, TypeScript e unit test.
- Playwright verifica i percorsi pubblici a ogni push. I test autenticati read-only sono eseguiti su `main` quando `E2E_BASE_URL` e le credenziali dedicate sono configurati.
- Il job Neon crea un branch effimero, esegue smoke test sulla copia isolata, ricostruisce lo schema da vuoto e verifica RLS, rate limit, timezone e budget tenant.
- La validazione del 2026-09-03 ha verificato 89 tabelle, 68 tabelle RLS, zero vincoli non validati, zero indici invalidi e zero tabelle tenant prive di indice leading.
- Le migrazioni applicate restano immutabili; ogni evoluzione usa una nuova migrazione. Il deploy Vercel non sostituisce il deploy SAM.

## Residui necessari prima della chiusura operativa

1. Creare un deployment Vercel staging isolato e collegarlo a dati sintetici, senza riusare credenziali o dati di produzione.
2. Creare account Cognito E2E dedicati e configurare `E2E_BASE_URL`, `E2E_AGENCY_USERNAME`, `E2E_AGENCY_PASSWORD`, `E2E_TRAVELER_USERNAME` ed `E2E_TRAVELER_PASSWORD` nei secret GitHub.
3. Dopo la commercializzazione, valutare se attivare test AI live periodici con OIDC AWS, budget massimo e notifica su errore. Fino ad allora restano esclusivamente manuali e disattivati per impostazione predefinita.
4. Collegare un dominio personalizzato prima di attivare la WAF Cloudflare. Questo punto non blocca il consolidamento software corrente.
