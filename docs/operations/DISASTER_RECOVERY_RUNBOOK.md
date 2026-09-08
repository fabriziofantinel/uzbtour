# SMF Travel - Disaster recovery runbook

## Obiettivi operativi

| Ambito | RPO target | RTO target |
| --- | ---: | ---: |
| Neon Postgres | 15 minuti | 4 ore |
| Cloudflare R2 | 24 ore per metadati; nessuna sovrascrittura degli oggetti | 8 ore |
| AWS SQS/Lambda/Bedrock | nessuna perdita dei job registrati in Neon | 2 ore |

Gli obiettivi sono target tecnici per il go-live B2B. Devono essere riportati nei
contratti soltanto dopo due restore drill consecutivi conclusi entro tali soglie.

## Protezioni permanenti

- Neon è l'autorità per metadati, stato dei job e riferimenti agli oggetti.
- Le chiavi R2 contengono UUID e non vengono riutilizzate.
- La configurazione target richiede `If-None-Match: *` su ogni `PutObject`; va
  attivata soltanto dopo uno smoke test CORS con le credenziali R2 di produzione.
- La cancellazione funzionale è registrata in Neon prima della cancellazione
  fisica; la cancellazione dell'agenzia resta un job asincrono a tappe.
- SQS conserva i messaggi falliti in DLQ per quattordici giorni.

## Restore drill Neon mensile

Il percorso preferito è il workflow GitHub Actions manuale
`.github/workflows/manual-recovery-drill.yml`. Non ha trigger pianificati e non
consuma risorse finché il proprietario non lo avvia esplicitamente. L'input
`restore_offset_minutes` indica il punto da verificare; il workflow crea un
branch Neon isolato con scadenza a 24 ore, acquisisce soltanto evidenze
sanitizzate, esegue `npm run db:validate:v3` e cancella sempre il branch.

1. Registrare UTC iniziale, branch di origine, numero di tabelle e checksum delle
   principali cardinalità (`iam.agencies`, `travel.departures`,
   `ops.platform_jobs`, `ops.media_assets`).
2. Dalla console Neon creare un branch temporaneo da un punto nel periodo di
   retention precedente all'UTC registrato. Non ripristinare direttamente
   `production` durante il test.
3. Collegarsi al branch temporaneo con un ruolo di sola verifica.
4. Eseguire `npm run db:validate:v3` e i test negativi RLS.
5. Confrontare schema, foreign key, funzioni `SECURITY DEFINER` e cardinalità.
6. Eliminare il branch temporaneo solo dopo aver salvato l'evidenza del test.
7. Registrare durata, RPO osservato, RTO osservato ed eventuali anomalie.

Le prime due esecuzioni consecutive conformi sono registrate in
`docs/operations/RECOVERY_DRILL_2026-09-08.md`. I tempi osservati sono molto
inferiori ai target, ma non costituiscono da soli un impegno contrattuale.

In un incidente reale si crea prima un branch di sicurezza dello stato corrente,
si individua il punto corretto con Time Travel Assist e si esegue il restore della
branch di produzione. Il cambio connessione applicativa è ammesso solo se il
restore in-place non è disponibile o non supera i controlli di integrità.

## Retention R2

Configurazione target:

- regola Bucket Lock `smf-travel-retention-30d` sul prefisso `agencies/` per 30
  giorni;
- chiavi immutabili e scritture condizionali;
- purge fisico esclusivamente tramite worker differito dopo il termine della
  retention e l'assenza di legal hold;
- nessuna cancellazione sincrona massiva per un'agenzia.

Il Bucket Lock va applicato mediante Cloudflare API o Wrangler con un token che
disponga esclusivamente del permesso di modifica configurazione R2. Le credenziali
S3 di lettura/scrittura oggetti non possono modificare questa regola.

## Test di perdita e recupero job

1. Accodare un job di collaudo idempotente.
2. Indurre un errore controllato prima della mutazione finale.
3. Verificare quattro tentativi, spostamento in DLQ e notifica SNS.
4. Correggere la causa, creare un nuovo job con nuova chiave idempotente e
   verificarne il completamento.
5. Documentare la causa e solo allora rimuovere il messaggio obsoleto dalla DLQ.

## Evidenze minime

Ogni drill conserva: data UTC, operatore, branch/punto di ripristino, comandi di
verifica, conteggi pre/post, durata, esito, finding e approvazione. Non inserire
URL di connessione, token, contenuti personali o credenziali nelle evidenze.

## Limite operativo R2

Il recupero campione R2 deve essere eseguito con un'identità temporanea e a
privilegio minimo. Non leggere o stampare il parametro cifrato
`/smf-travel/production/r2-credentials` nella shell o nei log. Il test deve
scaricare un oggetto campione in una destinazione nuova, confrontarne dimensione
e checksum e lasciare invariato l'oggetto originale. Il risultato va registrato
senza nome oggetto, contenuto, URL firmato o credenziali.
