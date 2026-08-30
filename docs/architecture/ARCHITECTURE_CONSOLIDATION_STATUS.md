# SMF Travel - Stato consolidamento architetturale

Data di riferimento: 2026-08-30.

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
6. Vercel assume via OIDC un ruolo AWS STS e pubblica job su SQS Standard con
   `MessageGroupId=agency_id`. Non sono presenti access key AWS statiche su Vercel.
7. Lambda ARM64 acquisisce job idempotenti, legge R2 e usa Bedrock Converse con Nova 2
   Lite, Tool Use forzato e validazione Zod. L'agente deve confermare prima del publish.
8. CloudWatch controlla errori, backlog e DLQ; gli allarmi sono collegati al topic SNS.

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

## Gate di rilascio

- `npm run quality:gate` verifica baseline, sicurezza migrazioni, confini runtime,
  TypeScript e build Next.js.
- I pull request con credenziali Neon CI creano un branch effimero, eseguono la
  validazione V3 e i test RLS cross-tenant, quindi eliminano sempre il branch.
- Il drill del 2026-08-30 ha validato 67 tabelle, 54 tabelle RLS, zero vincoli non
  validati, zero indici invalidi e zero tabelle tenant prive di indice leading.
- Le migrazioni applicate restano immutabili; ogni evoluzione usa una nuova migrazione.
- Il deploy applicativo non sostituisce il deploy SAM dell'infrastruttura AWS.

## Dipendenze operative esterne

Il WAF e il rate limiting richiedono un dominio applicativo personalizzato gestito
da una zona Cloudflare. L'account non contiene ancora domini e queste protezioni non
possono essere applicate direttamente al dominio Vercel condiviso
`smf-travel.vercel.app`.
