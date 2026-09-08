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
| SES | Parziale | invio abilitato e mittente verificato, ma account ancora in sandbox |
| Cloudflare R2 | Da completare | configurazione individuata; recupero campione e CORS non eseguiti per non esporre il parametro cifrato |

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

Il bucket temporaneo OCR usa cifratura AES-256, blocco accesso pubblico completo
e lifecycle. La coda di completamento OCR usa la chiave gestita AWS per SQS e
non usa long polling; la differenza è coerente con il suo ingresso da SNS e non
ha prodotto backlog.

## Azioni residue

1. Richiedere l'uscita di SES dalla sandbox prima di invitare utenti reali non
   preventivamente verificati.
2. Eseguire il recupero di un campione R2 e lo smoke CORS con una procedura che
   risolva il segreto solo a runtime e non lo inserisca nei log o nel contesto.
3. Decidere in sede di sicurezza se rendere obbligatoria MFA per i ruoli
   amministrativi; lo stato attuale è `MFA OFF`.

Nessuna chiamata Bedrock e nessun test AI live sono stati eseguiti durante queste
verifiche.
