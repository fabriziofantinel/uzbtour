# Drill cancellazione agenzia con R2 e ripresa

Data: 2026-09-03  
Esecuzione: manuale e autorizzata  
Run verificato: `3ed2b7a7-bd27-4414-bcb5-7885459ae49d`

## Perimetro

- due agenzie sintetiche con UUID univoci;
- un oggetto testuale R2 per ciascuna agenzia sotto un prefisso dedicato al run;
- nessun viaggio, utente o documento di produzione utilizzato;
- nessuna invocazione Bedrock.

## Esito

| Controllo | Esito |
| --- | --- |
| Cancellazione oggetto R2 del tenant target | Superato |
| Registrazione dell'interruzione in fase `delete_objects` | Superato |
| Ripresa idempotente con un secondo worker | Superato |
| Completamento al secondo tentativo | Superato |
| Rimozione del solo tenant target | Superato |
| Tenant e oggetto sentinella invariati durante il processo | Superato |
| Pulizia delle fixture | Superato e verificato su Neon e R2 |

## Anomalia rilevata e corretta

Il primo tentativo ha individuato un riferimento ambiguo a `status` nella funzione UUID
`app.request_agency_deletion_v3`. La migrazione 164 qualifica esplicitamente le colonne IAM e
impedisce l'errore PostgreSQL `42702`. Il dry-run e l'applicazione della migrazione sono passati;
il drill completo successivo è terminato con `status: passed`.

Il comando resta escluso dalla CI e richiede `DESTRUCTIVE_TEST_CONFIRM=1`.
