# SMF Travel - runbook convergenza modello v3

## Stato attuale

- `public`: modello operativo e unica fonte autorevole dell'applicazione.
- `iam`, `ref`, `travel`, `content`, `ops`, `journey`, `privacy`: fondazione v3 installata.
- Il ruolo runtime `smf_app` ha accesso minimo e sottoposto a RLS ai domini
  spese, diario, feedback, media/ricordi, gamification e contest fotografici.
- Nessun cutover è autorizzato prima del superamento di tutti i gate seguenti.

## Fase 1 - backfill shadow core

Il backfill copia identità, agenzie, anagrafiche, prodotti di viaggio, partenze,
famiglie e viaggiatori. Conserva gli UUID già presenti. Gli identificatori utente
testuali vengono convertiti una sola volta tramite `ops.legacy_id_map`.

Comandi controllati:

```powershell
npm run db:backfill:v3:dry-run
npm run db:backfill:v3
npm run db:validate:v3
```

`DATABASE_MIGRATION_URL` deve essere disponibile solo durante la finestra di
migrazione e deve appartenere a un ruolo owner, mai a `smf_app`.

## Gate obbligatori

1. Il dry-run termina con `dry_run_passed` e non persiste alcun dato.
2. Tutti i conteggi sorgente/target hanno `reconciled: true`.
3. Nessun vincolo non validato e nessun indice invalido.
4. Le 49 tabelle protette hanno RLS attiva dopo l'installazione della mappa e
   della relazione multi-Paese del viaggio.
5. Il marker `3.2.1-shadow-core` ha checksum uguale al file applicato.
6. L'applicazione pubblica continua a usare esclusivamente `public`.

## Fasi successive

1. Backfill di contenuti, media, documenti e dati di esperienza (`content`, `ops`,
   `journey`, `privacy`).
2. Estensione progressiva dei privilegi minimi al ruolo runtime, sempre con
   contesto tenant impostato nella medesima transazione.
3. Dual-read a campione con confronto asincrono e metriche, senza modificare la
   risposta inviata agli utenti.
4. Dual-write idempotente con outbox e riconciliazione continua.
5. Cutover delle letture per singolo dominio tramite feature flag.
6. Periodo di osservazione e successiva dismissione del modello `public`.

## Rollback

Prima del cutover il rollback consiste semplicemente nel mantenere
`PLATFORM_DATA_MODEL=public`: il backfill non modifica né elimina righe sorgenti.
Durante il dual-write, il modello `public` resta autorevole finché ogni dominio non
ha superato il proprio gate di riconciliazione.

## Domini runtime consolidati

| Dominio | Migrazione | Shadow read | Dual-write | Fonte autorevole |
| --- | --- | --- | --- | --- |
| Spese | `019_v3_expense_runtime_access` | `V3_EXPENSE_SHADOW_READ` | `V3_EXPENSE_DUAL_WRITE` | `public` |
| Prelievi e cambi, note, locali | `020_v3_journey_journal_runtime_access` | `V3_JOURNEY_JOURNAL_SHADOW_READ` | `V3_JOURNEY_JOURNAL_DUAL_WRITE` | `public` |
| Feedback su tappe e hotel | `022_v3_programme_feedback_runtime_access` | `V3_PROGRAMME_FEEDBACK_SHADOW_READ` | `V3_PROGRAMME_FEEDBACK_DUAL_WRITE` | `public` |
| Media e ricordi | `023_v3_traveler_experience_runtime` | `V3_TRAVELER_EXPERIENCE_SHADOW_READ` | trigger transazionale `sync_v3_media_asset` / `sync_v3_memory` | `public` |
| Quiz, giochi, missioni e bingo | `023_v3_traveler_experience_runtime` | `V3_TRAVELER_EXPERIENCE_SHADOW_READ` | trigger transazionale `sync_v3_activity_result` | `public` |
| Contest fotografici | `023_v3_traveler_experience_runtime` | `V3_TRAVELER_EXPERIENCE_SHADOW_READ` | trigger transazionale `sync_v3_contest_entry` | `public` |
| Identità, agenzie e agenti | `024_v3_iam_agency_runtime` | gate di riconciliazione DB | trigger transazionali `sync_v3_platform_user`, `sync_v3_agency`, `sync_v3_agency_membership` | `public` |
| Paesi, città, siti, hotel e contenuti condivisi | `025_v3_reference_catalog_runtime` | gate di riconciliazione DB | cinque trigger transazionali del catalogo `ref` | `public` |
| Template, versioni, partenze e programma materializzato | `026_v3_travel_catalog_runtime` | gate di riconciliazione DB | nove trigger coordinati da `sync_v3_travel_row` | `public` |
| Famiglie, viaggiatori, membership, inviti e privacy | `027_v3_party_privacy_runtime` | gate di riconciliazione DB | quattro trigger transazionali con consenso minori `default-deny` | `public` |
| Documenti, biglietti, importazioni, job e audit | `028_v3_documents_import_runtime` | gate di riconciliazione DB | cinque trigger transazionali nel dominio `ops` | `public` |
| Informazioni utili, frasi e contenuti generati | `029_v3_content_localization_runtime` | gate di riconciliazione DB | tre trigger transazionali con archivio dei contenuti rimossi | `public` |

Le feature flag devono essere abilitate prima in Preview e poi in Production.
Il cutover delle letture non è implicito nell'abilitazione del dual-write.

Le identità testuali legacy vengono risolte esclusivamente tramite
`app.resolve_legacy_user_id(text, uuid)` (`021_v3_runtime_identity_resolver`).
Il ruolo `smf_app` non deve avere `SELECT` diretto su `ops.legacy_id_map`.
La stessa regola vale per `ops.legacy_generated_content_map`: le corrispondenze
legacy sono utilizzate solo dentro funzioni `SECURITY DEFINER` proprietarie.

La migrazione `023` è stata verificata con un test sintetico interamente in
transazione: una foto temporanea ha alimentato `ops.media_assets`,
`journey.memories`, `journey.activity_attempts`, `journey.activity_evidence` e
`journey.photo_contest_entries`; il gate ha restituito `1/1/1` e il successivo
`ROLLBACK` non ha lasciato dati di prova.

Le migrazioni `027`-`029` si eseguono insieme con:

```powershell
npm run db:migrate:v3:final:dry-run
npm run db:migrate:v3:final
```

Il runner usa un advisory lock, timeout espliciti, checksum immutabili e una
transazione unica. I gate verificano tutti i dodici trigger e impediscono al
ruolo runtime di leggere le mappe tecniche delle identità e dei contenuti.

## Cutover letture - prima ondata

Le letture v3 dei domini operativi sono attivabili in modo indipendente:

| Dominio | Variabile | Valore v3 | Rollback |
| --- | --- | --- | --- |
| Spese | `V3_EXPENSE_READ_SOURCE` | `v3` | rimuovere la variabile o impostare `legacy` |
| Note, locali, prelievi e cambi | `V3_JOURNEY_JOURNAL_READ_SOURCE` | `v3` | rimuovere la variabile o impostare `legacy` |
| Feedback | `V3_PROGRAMME_FEEDBACK_READ_SOURCE` | `v3` | rimuovere la variabile o impostare `legacy` |

Ogni lettura v3 imposta `app.agency_id` nella stessa transazione read-only e
mantiene invariato il contratto restituito al frontend. L'attivazione avviene
prima in Preview; Production viene abilitata solo dopo lo smoke test autenticato.

Il gate runtime si esegue con la connessione applicativa, non con il ruolo owner:

```powershell
npm run smoke:v3:operational-read
```

Il test confronta i cinque domini della prima ondata e verifica che, cambiando
`app.agency_id` con un tenant inesistente, nessuna riga v3 risulti visibile.

## Cutover letture - seconda ondata

Programma, città, siti, hotel, viaggiatori, informazioni utili, frasi e biglietti
sono attivabili insieme con `V3_TRAVEL_CATALOG_READ_SOURCE=v3`. Il rollback non
richiede migrazioni: rimuovere la variabile o impostarla a `legacy`.

Il lettore usa una transazione read-only con `app.agency_id`, conserva gli UUID
legacy esposti al frontend e legge le coordinate geografiche PostGIS dal catalogo
`ref`. Prima dell'attivazione eseguire con il ruolo applicativo:

```powershell
npm run smoke:v3:travel-catalog-read
```

Il gate riconcilia nove domini e verifica l'isolamento RLS con un tenant casuale.
Quiz, giochi, missioni, bingo, media e classifiche non fanno parte di questa
ondata: restano su `public` finché le soluzioni delle attività non saranno
separate dal payload inviato al browser.
