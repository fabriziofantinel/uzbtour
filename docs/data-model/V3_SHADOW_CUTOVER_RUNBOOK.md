# SMF Travel - runbook convergenza modello v3

## Stato attuale

- `public`: modello operativo e unica fonte autorevole dell'applicazione.
- `iam`, `ref`, `travel`, `content`, `ops`, `journey`, `privacy`: fondazione v3 installata.
- Il ruolo runtime `smf_app` ha accesso minimo e sottoposto a RLS a
  `journey.expenses`, `journey.cash_movements`, `journey.day_notes` e
  `journey.restaurant_visits`; gli altri domini v3 restano non accessibili.
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

Le feature flag devono essere abilitate prima in Preview e poi in Production.
Il cutover delle letture non è implicito nell'abilitazione del dual-write.

Le identità testuali legacy vengono risolte esclusivamente tramite
`app.resolve_legacy_user_id(text, uuid)` (`021_v3_runtime_identity_resolver`).
Il ruolo `smf_app` non deve avere `SELECT` diretto su `ops.legacy_id_map`.
