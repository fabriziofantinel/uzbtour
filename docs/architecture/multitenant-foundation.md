# Fondazione multi-agenzia

Questa fondazione descrive il modello SaaS consolidato di SMF Travel. Il modello V3
è la fonte operativa corrente e i guardrail impediscono il ritorno ai percorsi legacy.

## Modello di dominio

- `agencies`: tenant proprietario di viaggi, utenti e contenuti.
- `trip_templates` + `trip_template_versions`: viaggio riutilizzabile e revisioni
  pubblicabili dopo il controllo dell'agenzia.
- `trip_days`, `itinerary_items`, `places`, `accommodations`: programma estratto e
  modificabile.
- `departures`: una specifica edizione del viaggio con date reali.
- `travel_parties`: famiglia/gruppo privato all'interno della partenza.
- `traveler_profiles` + `party_memberships`: viaggiatori e appartenenza al gruppo.
- `media_assets` e `travel_documents`: soli metadati; i file restano nello storage a
  oggetti.
- `generated_content`: quiz, missioni, bingo, giochi e contest fotografici revisionabili.
- `import_jobs` + `platform_jobs`: importazione PDF o Word asincrona e rieseguibile.
- `audit_events`: traccia delle modifiche importanti con autore e tenant.

Ogni tabella di dominio contiene `agency_id`; le relazioni composte impediscono di
collegare per errore record di agenzie differenti. Neon applica `ENABLE FORCE RLS`;
il ruolo runtime `smf_app` imposta il contesto tramite stored API controllate. Gli
indici tenant-leading mantengono efficiente il filtro `agency_id`.

## Provider sostituibili

Il codice applicativo dipende da porte, non direttamente dai servizi esterni:

- coda: Amazon SQS Standard con dead-letter queue;
- worker: AWS Lambda ARM64 senza VPC o capacità riservata;
- file: Cloudflare R2 privato;
- AI: Amazon Bedrock Converse con Nova 2 Lite e Tool Use forzato;
- identità: Amazon Cognito Lite dietro `lib/auth/auth-provider.ts`.

Le variabili `PLATFORM_*_PROVIDER` selezionano l'implementazione. Questa separazione
evita una riscrittura quando l'agenzia passa al piano a pagamento.

## Stato di consolidamento

Modello V3, pannelli, Cognito, RLS, stored API, pubblicazione human-in-the-loop e
worker asincrono sono operativi. La CI protegge baseline, migrazioni e confini runtime;
sui pull request può creare un branch Neon effimero ed eseguire test cross-tenant.

## Importazione documenti asincrona

Il pannello agenzia carica il documento PDF, DOC o DOCX in R2 come oggetto privato e crea un job
`travel-programme.import` su Neon, poi pubblica su SQS un messaggio contenente soltanto
gli identificativi necessari. Non vengono inseriti documenti o credenziali nella coda.

Il worker Lambda acquisisce il job in modo atomico e prepara fino a cinque documenti
Bedrock. I PDF grandi sono segmentati per pagina; i DOCX sono ricompressi senza media
ed embedding e, se necessario, ridotti a testo. L'output Tool Use è validato con Zod. La bozza rimane
in `import_jobs.result` finché un amministratore non la corregge e pubblica. Solo la
pubblicazione trasferisce giorni, attività, alberghi e informazioni utili nelle tabelle
normalizzate, all'interno di un'unica transazione Neon.

In caso di errore il job e l'importazione passano a `failed` e possono essere ritentati.
SQS Standard usa `MessageGroupId=agency_id` per il fair sharing multi-tenant. La
dead-letter queue conserva i messaggi che falliscono quattro volte e CloudWatch
notifica il topic SNS operativo. I job rimasti
in elaborazione per oltre dieci minuti possono essere acquisiti nuovamente, evitando
che un arresto improvviso della Lambda blocchi definitivamente un'importazione.
