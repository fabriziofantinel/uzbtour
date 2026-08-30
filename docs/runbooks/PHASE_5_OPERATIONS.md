# SMF Travel - Runbook operativo PWA, sync, push e chat

## Obiettivo e livelli di servizio iniziali

- RPO database: massimo 24 ore fino all'attivazione di una retention PITR superiore su Neon.
- RTO applicativo: 4 ore; 8 ore per un ripristino coordinato dei media R2.
- Le mutazioni offline sono idempotenti tramite `client_operation_id`: una riconsegna non crea duplicati.
- Chat, documenti, spese e notifiche sono limitati alla coppia partenza/gruppo e al tenant agenzia.

## Controlli prima di ogni rilascio

1. Eseguire `npm run phase5:verify` con la connessione diretta Neon owner in `.env.local`.
2. Eseguire `npm run build`; non pubblicare se TypeScript, build o baseline falliscono.
3. Verificare su iPhone e Android: login, programma, documenti, chat, spesa offline e riallineamento online.
4. Verificare installazione PWA su Chrome Android e Aggiungi a Home su Safari iOS.
5. Inviare una push di prova a un dispositivo reale e verificare l'apertura della destinazione corretta.

## Monitoraggio giornaliero

- Vercel: errori delle API `/api/traveler/*`, `/api/chat` e `/api/internal/push/*`, durata p95 e risposte 5xx.
- Neon: connessioni, query lente, storage, errori RLS e crescita delle tabelle operative.
- Push: controllare `ops.push_delivery_runs`, destinatari, fallimenti e subscription scadute.
- Import: controllare job in errore o in attesa anomala, tentativi e DLQ AWS.
- Chat: verificare errori di invio e tempi di risposta senza leggere il contenuto dei messaggi.

## Isolamento tenant e gruppo

- Un viaggiatore non legge chat, documenti, spese o programma di un'altra partenza o gruppo.
- Un agente accede soltanto alle partenze dell'agenzia attiva.
- Lo smoke transazionale della chat deve confermare idempotenza e scope viaggiatore.
- Tutte le tabelle tenant devono avere RLS forzata e un indice tenant-leading valido.

## Incident response

1. Classificare: P0 perdita/esposizione dati, P1 indisponibilità o import bloccati, P2 degrado parziale.
2. Per P0 disabilitare il percorso coinvolto, preservare log e audit trail e revocare le credenziali interessate.
3. Per import in DLQ correggere la causa e rieseguire con la stessa chiave idempotente.
4. Per push degradate mantenere l'informazione consultabile in-app: la push non è la fonte autorevole.
5. Documentare causa, impatto, timeline, correzione e controllo preventivo.

## Backup e ripristino

- Neon: ogni mese ripristinare un branch isolato, eseguire `db:validate:v3` e registrare durata ed esito.
- R2: usare chiavi immutabili, soft-delete e Bucket Lock; testare trimestralmente un recupero campione.
- Non cancellare un'agenzia con una singola DELETE sincrona: applicare il processo batch di BR-019.
- Dopo il restore verificare coerenza tra record media, oggetti R2, partenze, gruppi e viaggiatori.

## Matrice dispositivi minima

| Piattaforma | Browser | Online | Offline | Installazione | Push |
| --- | --- | --- | --- | --- | --- |
| iOS corrente e precedente | Safari | obbligatorio | obbligatorio | obbligatorio | obbligatorio |
| Android corrente e precedente | Chrome | obbligatorio | obbligatorio | obbligatorio | obbligatorio |
| Desktop | Chrome/Edge | obbligatorio | smoke | facoltativo | smoke |

Gli esiti manuali vanno allegati alla release con data, dispositivo, versione OS/browser e screenshot delle anomalie.
