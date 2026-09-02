# SMF Travel - Stato consolidamento architetturale

Data di riferimento: 2026-09-02.

## Componenti e connessioni as-built

1. Browser e PWA invocano Next.js 16 su Vercel esclusivamente via HTTPS.
2. Cognito Lite autentica username/password; l'e-mail è recapito per inviti e reset.
   Il codice applicativo passa dall'adapter `lib/auth/auth-provider.ts`.
3. Le route server Next.js invocano le stored API PostgreSQL sul collegamento Neon
   pooled; migrazioni e drill usano solo la connessione diretta owner.
4. PostgreSQL applica `ENABLE FORCE RLS`, contesto tenant, foreign key composte,
   indici `agency_id` leading e procedure `SECURITY DEFINER` con `search_path` fisso.
5. Il client carica file privati in Cloudflare R2 mediante URL presigned; Neon conserva
   metadati, scope, soft delete e chiavi oggetto immutabili.
6. Vercel assume via OIDC un ruolo AWS STS e instrada i job verso code SQS separate per
   importazione, arricchimento, valutazione foto e cancellazione. Non sono presenti access
   key AWS statiche su Vercel.
7. Worker Lambda ARM64 dedicati applicano limiti di concorrenza indipendenti. I job sono
   idempotenti e soggetti a quote per agenzia; la chiusura contest usa una Lambda pianificata
   separata dai flussi di importazione.
8. Bedrock Converse usa Nova 2 Lite, Tool Use forzato e validazione Zod. La pubblicazione
   richiede la conferma dell'agente e i contenuti Paese sensibili la revisione del responsabile.
9. Un `traceId` correla richiesta Vercel, payload Neon, messaggio SQS e log Lambda senza
   utilizzare identificativi personali come dimensioni CloudWatch.
10. CloudWatch controlla errori, backlog e DLQ con dashboard multi-workload e allarmi SNS.

## Finding del Solution Architect

| Finding | Stato | Evidenza / condizione |
| --- | --- | --- |
| DLQ e allarmi | Chiuso | DLQ bonificata, 5 allarmi in stato OK e sottoscrizione e-mail SNS confermata |
| Modello Bedrock | Chiuso | IaC e runtime usano `eu.amazon.nova-2-lite-v1:0` |
| Fair sharing SQS | Chiuso | Standard Queue con `MessageGroupId=agency_id` |
| Astrazione autenticazione | Chiuso nel software | Adapter unico davanti a Cognito |
| Documenti oltre 4,5 MB | Implementato | split PDF, compattazione DOCX e fallback Textract asincrono con ripresa idempotente |
| DR Neon | Drill PR superato | Il run GitHub Actions `33319384017` ha creato il branch effimero, riconciliato e validato lo schema, eseguito gli smoke RLS e rimosso il branch |
| Immutabilità R2 | Chiuso | Bucket Lock `smf-travel-retention-30d` attivo sul prefisso `agencies/`; chiavi immutabili e soft delete applicativi |
| WAF/rate limiting | Bloccato dal dominio | L'account Cloudflare non contiene ancora una zona DNS; il dominio Vercel condiviso non è configurabile nella WAF Cloudflare |
| Neon branch su PR | Chiuso | PR `#2`: gate `neon-tenant-isolation` superato in 49 secondi e `immutable-contracts` superato |
| Isolamento workload asincroni | Chiuso | Stack `smf-travel-worker` aggiornato con quattro code operative, DLQ dedicate, worker separati e chiusura contest autonoma |
| Quote per tenant | Chiuso | `app.enqueue_platform_job_v3` rifiuta il superamento del limite di job attivi per agenzia e tipo di workload |
| Tracciamento end-to-end | Chiuso | `traceId` propagato da browser/Vercel a Neon, SQS e Lambda; dashboard CloudWatch disponibile |
| Governance Paese | Chiuso | criticità per campo, baseline attestata centralmente e approvazione del responsabile prima dell'uso applicativo |

## Gate di rilascio

- `npm run quality:gate` verifica baseline, sicurezza migrazioni, confini runtime,
  TypeScript e build Next.js.
- I pull request con credenziali Neon CI creano un branch effimero, eseguono la
  validazione V3 e i test RLS cross-tenant, quindi eliminano sempre il branch.
- La validazione del 2026-09-02 ha verificato 79 tabelle, 62 tabelle RLS, zero vincoli non
  validati, zero indici invalidi e zero tabelle tenant prive di indice leading.
- Le migrazioni applicate restano immutabili; ogni evoluzione usa una nuova migrazione.
- Il deploy applicativo non sostituisce il deploy SAM dell'infrastruttura AWS.

## Dipendenze operative esterne

Il WAF e il rate limiting richiedono un dominio applicativo personalizzato gestito
da una zona Cloudflare. L'account non contiene ancora domini e queste protezioni non
possono essere applicate direttamente al dominio Vercel condiviso
`smf-travel.vercel.app`.
