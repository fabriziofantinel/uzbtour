# SMF Travel - Stato consolidamento architetturale

Data di riferimento: 2026-09-03. Revisione allineata al modello V3 e alle migrazioni 001-167.

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
11. Sessioni impersonate, download privati, registrazione media e operazioni del viaggiatore usano l'identità IAM UUID nativa.
12. Ambito dei viaggi, gamification, catalogo, feedback e modifiche al programma non risolvono più l'attore tramite la mappa legacy.
13. Avvio, elenco e chiusura del Login come superuser usano contratti UUID nativi. La baseline dei bridge runtime legacy, inizialmente pari a 31 riferimenti, è ora pari a zero.
14. Anche elenco e avvio del Login come viaggiatore dell'agenzia usano UUID nativi; le precedenti firme testuali non sono più eseguibili dal ruolo applicativo. Un audit ripetibile censisce separatamente firme SQL storiche e privilegi runtime.
15. La panoramica principale dell'agenzia autorizza direttamente l'UUID IAM; la firma testuale è revocata al runtime e il debito delle firme SQL è sceso a 83.
16. Import recenti, contenuti di riferimento e stato enrichment della dashboard agenzia usano l'UUID IAM; le tre firme testuali sono revocate e il debito SQL è sceso a 80.
17. L'elenco degli agenti autorizza direttamente l'UUID IAM; la firma testuale non è più eseguibile dal ruolo applicativo e il debito SQL è sceso a 79.
18. Invito e rimozione degli agenti, inclusa la verifica del responsabile, autorizzano l'UUID IAM; le tre firme testuali sono revocate e il debito SQL è sceso a 76.
19. Il branding dell'agenzia è letto tramite identità UUID nativa in dashboard, importazioni, programma, documenti e gestione gruppi; la firma testuale è revocata e il debito SQL è sceso a 75.
20. Modifica di branding, stato, anagrafica e contatti del responsabile autorizzano direttamente il superuser UUID; le quattro firme testuali sono revocate e il debito SQL è sceso a 71.
21. Riepilogo superuser, registro agenzie e verifica username usano l'UUID IAM; è inoltre revocata la vecchia lettura impersonazioni e il debito SQL statico è sceso a 68.
22. Creazione atomica agenzia-responsabile e sostituzione del responsabile usano l'UUID IAM; uno smoke test transazionale verifica entrambi i flussi senza persistere dati.
23. Richiesta di cancellazione agenzia, risoluzione del viaggio, censimento degli asset e cancellazione transazionale del viaggio usano l'UUID IAM; i contratti legacy non sono più eseguibili da `smf_app` e il debito SQL è sceso a 61.
24. Registrazione del preventivo sorgente, salvataggio della revisione e cancellazione della bozza importata usano l'UUID IAM; i tre overload testuali sono revocati e il debito SQL è sceso a 58.
25. Accodamento dei workload e registrazione dei fallimenti di dispatch usano l'UUID IAM per agenzia e viaggiatore; le firme testuali sono revocate e il debito SQL è sceso a 56.
26. Creazione del viaggio e creazione di una nuova partenza da programma pubblicato usano l'UUID IAM; le firme testuali sono revocate e il debito SQL è sceso a 54.
27. `CURRENT_SCHEMA_VERSION` segue l'ultima migrazione applicativa; `quality:guard` confronta automaticamente costante, ultimo file e marker, impedendo nuovi disallineamenti in CI e su Vercel.
28. Il drill distruttivo manuale ha verificato cancellazione R2 reale, interruzione e ripresa con un secondo worker e assenza di effetti sul tenant sentinella. La migrazione 164 corregge l'ambiguità rilevata nella richiesta UUID di cancellazione.
29. L'inventario live ha distinto 90 overload testuali reali dalla precedente baseline statica di 54 nomi funzione. Le migrazioni 165-166 hanno eliminato senza `CASCADE` 37 firme già revocate o già sostituite da chiamate UUID; rimangono 53 firme eseguibili da convertire per dominio.
30. La migrazione 167 ha rimosso i tre contratti di impersonificazione storici dopo aver verificato i sostituti UUID e l'assenza di chiamanti runtime; il residuo live era di 50 firme.
31. Le migrazioni 198-199 hanno creato i contratti UUID mancanti, spostato i chiamanti applicativi sull'identità IAM nativa e rimosso senza `CASCADE` tutte le 51 firme testuali rilevate dal censimento live. Il residuo verificato in produzione è zero; restano 195 firme applicative con primo parametro UUID.
32. La migrazione 200 introduce rooming list tenant-isolated sotto i pernottamenti, con vincoli su capienza, unicità dell'assegnazione e minore accompagnato, più valutazioni post-viaggio idempotenti e relativa notifica schedulata. Nessun flusso richiede servizi AI.

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
| Dizionario e documenti architetturali | Chiuso | Architettura v1.3 e modelli logico/fisico v1.5; lo schema operativo validato contiene 89 tabelle |
| Dati per biglietteria | Fuori perimetro deciso | Non vengono archiviati passaporti o documenti sanitari; le sole segnalazioni operative essenziali hanno consenso e scadenza |
| WAF perimetrale | Bloccato esternamente | Richiede un dominio personalizzato e una zona DNS; il dominio condiviso Vercel non è configurabile nella WAF Cloudflare |
| Staging applicativo | Predisposto, non attivo | Branch Neon effimero e test sono pronti; manca un deployment Vercel staging isolato con configurazione e dati sintetici |
| Playwright autenticato | Predisposto, non attivo | I percorsi read-only agenzia/viaggiatore esistono; il job resta sospeso finché non sono configurati URL e account E2E dedicati |
| Test AI live manuale | Predisposto e disattivato | Replay deterministico gratuito in CI; ogni esecuzione Bedrock reale richiede avvio del proprietario e `AI_LIVE_TEST_CONFIRM=1`. Nessuna pianificazione automatica finché l'app non sarà commercializzata |
| Cancellazione distruttiva R2 | Chiuso | Drill manuale con due tenant sintetici: oggetto target eliminato, ripresa al secondo worker, tenant sentinella invariato e fixture ripulite |

## Gate di rilascio

- `npm run quality:release` esegue il build, che richiama il guard non aggirabile: baseline, migrazioni, confini runtime, sicurezza API, nomenclatura, debito identità, baseline test, formato, lint, TypeScript e unit test.
- Playwright verifica i percorsi pubblici a ogni push. I test autenticati read-only sono eseguiti su `main` quando `E2E_BASE_URL` e le credenziali dedicate sono configurati.
- Il job Neon crea un branch effimero, esegue smoke test sulla copia isolata, ricostruisce lo schema da vuoto e verifica RLS, rate limit, timezone e budget tenant.
- La validazione del 2026-09-03 ha verificato 89 tabelle, 68 tabelle RLS, zero vincoli non validati, zero indici invalidi e zero tabelle tenant prive di indice leading.
- Le migrazioni applicate restano immutabili; ogni evoluzione usa una nuova migrazione. Il deploy Vercel non sostituisce il deploy SAM.

## Residui necessari prima della chiusura operativa

1. Completato: tutte le firme SQL eseguibili con attore testuale sono state sostituite e rimosse; il censimento live rileva zero firme legacy residue.
2. In sospeso per decisione del proprietario: staging Vercel isolato e account Cognito E2E dedicati.
3. In sospeso fino alla commercializzazione: test AI live periodici; restano manuali e disattivati per impostazione predefinita.
4. In sospeso: dominio personalizzato e WAF Cloudflare. Non bloccano il consolidamento software corrente.
