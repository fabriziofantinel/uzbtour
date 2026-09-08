# SMF Travel - Evidenze infrastruttura e recovery drill

Data verifica: 8 settembre 2026. Ambiente: produzione. Le evidenze riportate
sono sanitizzate e non contengono credenziali, URL di connessione o dati
personali.

## Esito sintetico

| Ambito | Esito | Evidenza |
| --- | --- | --- |
| Neon capacità e integrità | Superato | 99 tabelle applicative, 73 tabelle RLS, 0 vincoli non validati, 0 indici invalidi, circa 44,5 MiB e 3/901 connessioni osservate |
| Neon restore drill 1 | Superato | Punto a -5 minuti, verifica operativa 15 secondi, branch eliminato |
| Neon restore drill 2 | Superato | Punto a -10 minuti, verifica operativa 14 secondi, branch eliminato |
| SQS e DLQ | Superato | 10 code/DLQ senza messaggi visibili, in volo o ritardati |
| Lambda | Superato | 7 funzioni attive, ultimo aggiornamento riuscito, tracing attivo |
| Event source mapping | Superato | 5 mapping abilitati, batch size 1 |
| CloudWatch | Superato | dashboard presente e 9 allarmi attivi in stato `OK` |
| Cognito | Superato con nota | user pool protetto dalla cancellazione, 15 utenti stimati, MFA non obbligatoria |
| SES | Blocco esterno AWS | invio abilitato e mittente verificato; `ReviewStatus: DENIED`, caso Support ancora aperto dopo i chiarimenti |
| Cloudflare R2 | Superato | bucket privato EU, CORS produzione verificato e campione DOCX recuperato senza modificare l'originale |
| Vercel rollback | Superato | rollback alla release precedente e ripristino della corrente, entrambi con HTTP 200 |
| SQS DLQ recovery | Superato | redrive controllato 1/1 e worker import corretto; nessuna invocazione Bedrock |

## Restore drill Neon

Entrambe le prove sono state avviate esclusivamente a mano tramite il workflow
`Manual recovery drill`, sul commit `e52c39738feb8df65e17afef971be9bca6810492`.
Il workflow non ha schedulazioni automatiche.

### Prova 1

- esecuzione GitHub: [34204679457](https://github.com/aifabriziofantinel-it/smftravel/actions/runs/34204679457);
- intervallo complessivo del job: 8 settembre 2026, 08:28:25-08:29:20 UTC;
- punto di ripristino: 5 minuti prima dell'avvio;
- durata operativa misurata dalla creazione branch alla validazione: 15 secondi;
- risultato: schema valido, branch temporaneo eliminato, artefatti sanitizzati conservati per 30 giorni.

### Prova 2

- esecuzione GitHub: [34204813921](https://github.com/aifabriziofantinel-it/smftravel/actions/runs/34204813921);
- intervallo complessivo del job: 8 settembre 2026, 08:29:56-08:30:42 UTC;
- punto di ripristino: 10 minuti prima dell'avvio;
- durata operativa misurata dalla creazione branch alla validazione: 14 secondi;
- risultato: schema valido, branch temporaneo eliminato, artefatti sanitizzati conservati per 30 giorni.

Le due prove hanno restituito le stesse cardinalità di controllo: 5 agenzie, 3
partenze, 31 job di piattaforma e 30 media asset. Il checksum sanitizzato delle
cardinalità coincide in entrambe le esecuzioni. Il risultato dimostra la
creazione e la verificabilità di un punto precedente; non misura ancora i tempi
umani di decisione e promozione in un incidente reale.

## Verifica AWS

- stack `smf-travel-worker` in stato `UPDATE_COMPLETE`;
- 7 funzioni Lambda in stato `Active` e `LastUpdateStatus=Successful`;
- nelle ultime 24 ore le funzioni attive hanno registrato zero errori e zero
  throttling; i worker senza lavoro non hanno prodotto datapoint;
- 10 code complessive, incluse le DLQ, senza backlog al momento del controllo;
- retention DLQ di 14 giorni e redrive configurato sulle code applicative;
- dashboard `smf-travel-worker-workloads` presente;
- 9 allarmi CloudWatch in stato `OK`, azioni abilitate e sottoscrizione SNS
  confermata;
- user pool Cognito `eu-central-1_IeX5LXZ6Q` con protezione cancellazione attiva;
- SES in stato operativo `HEALTHY`, invio abilitato, quota 200 messaggi/giorno e
  1 messaggio/secondo, ma `ProductionAccessEnabled=false`.

La richiesta di accesso SES production è stata inviata l'8 settembre 2026 con
tipo `TRANSACTIONAL`, sito pubblico SMF Travel e descrizione dei soli flussi di
invito, recupero password e comunicazione operativa. AWS ha registrato la
richiesta e successivamente l'API SES ha riportato `ReviewStatus: DENIED`;
l'approvazione è un'attività esterna e non può essere dichiarata completata
finché `ProductionAccessEnabled` non diventa `true`.

Il dettaglio richiesto da AWS è stato inviato nello stesso giorno tramite il
Support Center: frequenza prevista, origine dei destinatari, esempi dei messaggi,
gestione di bounce e complaint, suppression list e assenza di campagne
marketing. Il caso Support resta aperto senza una nuova risposta successiva ai
chiarimenti; occorre attendere l'esito del team AWS o fornire gli eventuali
ulteriori elementi che verranno richiesti.

Il bucket temporaneo OCR usa cifratura AES-256, blocco accesso pubblico completo
e lifecycle. La coda di completamento OCR usa la chiave gestita AWS per SQS e
non usa long polling; la differenza è coerente con il suo ingresso da SNS e non
ha prodotto backlog.

## Recupero campione Cloudflare R2

La verifica è stata eseguita dalla console Cloudflare autenticata, senza leggere
o esportare le credenziali S3 conservate in AWS Parameter Store.

- bucket `smf-travel-private`, giurisdizione UE, accesso pubblico disabilitato;
- 32 oggetti per 8,07 MB al momento dell'osservazione;
- CORS configurato per `PUT` da `https://smf-travel.vercel.app` e
  `http://localhost:3000`, con header consentito `Content-Type`;
- Public Development URL e custom domain disabilitati;
- regola Bucket Lock `smf-travel-retention-30d` attiva sul prefisso `agencies/`
  per 30 giorni;
- campione DOCX scaricato in una nuova copia locale, lasciando invariato
  l'oggetto sorgente;
- dimensione osservata e recuperata: 25.947 byte;
- archivio Open XML valido: 26 entry e `word/document.xml` presente;
- SHA-256 della copia recuperata:
  `2E55772B32762B85FDCB1FFA87436E7A3AA046E823A398C9FE5EFC7D2C6A26FB`.

Il download applicativo ha prodotto correttamente un URL R2 firmato e
temporaneo. Il browser di automazione ha impedito l'apertura diretta dell'origine
privata; il recupero è stato quindi completato dalla console Cloudflare, che non
richiede l'esposizione del token S3. I download applicativi sono navigazioni
firmate e non richiedono `GET` nella policy CORS; l'upload browser è coperto dalla
regola `PUT` sull'origine di produzione.

## Azioni residue

1. Attendere la risposta del team AWS nel caso Support SES e, se richiesto,
   integrare la pratica prima di invitare utenti reali non verificati.

La configurazione `MFA OFF` è registrata come decisione di lancio non bloccante
per mantenere semplice l'onboarding con Cognito Lite; dovrà essere rivalutata
prima di ampliare il perimetro commerciale o introdurre dati più sensibili.

## Rollback Vercel

Il rollback controllato è stato eseguito l'8 settembre 2026:

- release corrente iniziale: `dpl_Ee36v8rcdbuReDxegRW1HdU5HHbN`, commit
  `b08db9efb34f97a454dc4720e936cedb2841726f`;
- release di rollback: `dpl_8mvCgFtW1HixG8d87U9sV8ugsW9E`, commit
  `17bf77cbae42d2b6f250bd11f50d793f7fac9e28`;
- risposta di `https://smf-travel.vercel.app/login` dopo rollback: HTTP 200;
- promozione immediata della release corrente completata;
- risposta dello stesso endpoint dopo il ripristino: HTTP 200.

Il confronto Git fra le due release contiene esclusivamente il filtro degli
artefatti Vercel (`.vercelignore` e `scripts/vercel-ignore-build-step.mjs`):
schema, route e logica applicativa sono identici. Il test dimostra quindi sia il
meccanismo di rollback sia il ritorno controllato alla release corrente senza
richiedere migrazioni inverse.

## Recupero job dalla DLQ

È stato inserito nella DLQ import un solo messaggio sintetico con identificativi
casuali e riferimenti inesistenti, così da rendere impossibile qualunque
mutazione applicativa o chiamata Bedrock. Prima della prova entrambe le code
erano vuote.

Il task SQS di redrive ha concluso con stato `COMPLETED`, spostando 1 messaggio
su 1 verso la coda import. La prima elaborazione ha rilevato un difetto di
configurazione: al worker import mancava la variabile `WORKLOAD=import`, benché
fosse presente negli altri worker isolati. La variabile è stata aggiunta al
template SAM e distribuita allo stack `smf-travel-worker` tramite un change set
CloudFormation che ha modificato esclusivamente `ImportWorker`, senza sostituire
la funzione o ripubblicarne il codice.

Dopo il fix, un secondo messaggio sintetico è stato riconosciuto dal worker come
job obsoleto e confermato in 122 ms. Alla successiva scadenza di visibilità anche
il messaggio effettivamente recuperato dalla DLQ è stato riconosciuto e
confermato in 129 ms. Coda sorgente e DLQ risultano entrambe vuote e nei log non
compare alcuna generazione AI. La configurazione effettiva della Lambda riporta
`WORKLOAD=import`, stato `Active` e aggiornamento `Successful`.

Nessuna chiamata Bedrock e nessun test AI live sono stati eseguiti durante queste
verifiche.
