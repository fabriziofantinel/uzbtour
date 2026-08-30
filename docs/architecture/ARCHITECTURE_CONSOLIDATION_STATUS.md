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
| DLQ e allarmi | Chiuso lato AWS | DLQ bonificata, allarmi OK, topic SNS collegato |
| Modello Bedrock | Chiuso | IaC e runtime usano `eu.amazon.nova-2-lite-v1:0` |
| Fair sharing SQS | Chiuso | Standard Queue con `MessageGroupId=agency_id` |
| Astrazione autenticazione | Chiuso nel software | Adapter unico davanti a Cognito |
| Documenti oltre 4,5 MB | Parziale avanzato | limite upload 20 MB; split PDF e compattazione DOCX; OCR asincrono ancora da collegare |
| DR Neon | Procedura pronta | runbook e CI branch definiti; primo restore drill reale richiede credenziali Neon CI |
| Immutabilità R2 | Disegno pronto | chiavi immutabili e soft delete; Bucket Lock richiede token Cloudflare dedicato |
| WAF/rate limiting | Disegno pronto | applicazione sul dominio richiede zona e token Cloudflare |
| Neon branch su PR | Implementato in CI | si attiva con `NEON_API_KEY` e `NEON_PROJECT_ID` |

## Gate di rilascio

- `npm run quality:gate` verifica baseline, sicurezza migrazioni, confini runtime,
  TypeScript e build Next.js.
- I pull request con credenziali Neon CI creano un branch effimero, eseguono la
  validazione V3 e i test RLS cross-tenant, quindi eliminano sempre il branch.
- Le migrazioni applicate restano immutabili; ogni evoluzione usa una nuova migrazione.
- Il deploy applicativo non sostituisce il deploy SAM dell'infrastruttura AWS.

## Dipendenze operative esterne

Le attività seguenti non possono essere chiuse dal solo repository: conferma della
sottoscrizione e-mail SNS, token Neon per branch/drill, token Cloudflare limitato per
Bucket Lock e WAF, e scelta/provisioning del servizio OCR asincrono.
