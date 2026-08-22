# AWS SQS, Lambda e Bedrock

Questa configurazione crea l'elaborazione asincrona di produzione di SMF Travel:

1. Vercel registra il job su Neon e invia a SQS solo `jobId`, `agencyId` e `importId`.
2. SQS attiva una Lambda ARM64 con concorrenza massima pari a 2.
3. Lambda legge il PDF dal bucket R2 privato.
4. Amazon Bedrock genera una bozza strutturata con Amazon Nova Lite.
5. Lambda valida la risposta e salva risultato, consumi e stato su Neon.
6. Dopo quattro errori SQS sposta il messaggio nella dead-letter queue.
7. CloudWatch controlla errori, throttling, durata, coda arretrata e DLQ.

Non vengono creati NAT Gateway, VPC, API Gateway, capacità Lambda sempre attiva o
Bedrock Provisioned Throughput.

## Prerequisiti locali

- AWS CLI configurata con un utente amministrativo usato soltanto per il deploy;
- AWS SAM CLI;
- Node.js e dipendenze del progetto installate;
- account AWS con MFA e avviso di budget configurati.

La regione iniziale è `eu-central-1` (Francoforte), come il database Neon. Prima del
deploy verificare nel catalogo Bedrock che il modello scelto sia disponibile tramite
un inference profile europeo.

## Risorse create

Il template [`infra/aws/template.yaml`](../infra/aws/template.yaml) crea:

- `smf-travel-import`;
- `smf-travel-import-dead-letter`;
- `smf-travel-import-worker`;
- ruolo di esecuzione Lambda con accesso limitato a SQS, log e invocazione Bedrock;
- provider OIDC Vercel e ruolo con il solo permesso `sqs:SendMessage`.
- log group con retention di 14 giorni e tracciamento X-Ray attivo;
- cinque allarmi CloudWatch e, se configurata, una notifica email tramite SNS;
- policy SQS che rifiuta ogni richiesta senza TLS.

## Validazione e deploy

Eseguire dalla radice del repository:

```bash
npm run aws:validate
npm run aws:build
npm run aws:deploy
```

Durante `sam deploy --guided` indicare:

- stack: `smf-travel-worker`;
- regione: `eu-central-1`;
- `DatabaseParameterName`: nome del parametro Standard SecureString contenente
  la connessione Neon;
- `R2ParameterName`: nome del parametro Standard SecureString contenente il JSON
  con `R2_ACCESS_KEY_ID` e `R2_SECRET_ACCESS_KEY`, limitati al solo bucket;
- bucket R2 già configurato;
- modello Bedrock scelto.
- `BedrockFoundationModelId`: modello base raggiunto dal profilo europeo;
- `AlarmEmail`: indirizzo operativo facoltativo che deve confermare la
  sottoscrizione SNS ricevuta via email.

Non salvare valori segreti in `samconfig.toml`. `DATABASE_URL`,
`R2_ACCESS_KEY_ID` e `R2_SECRET_ACCESS_KEY` risiedono in Parameter Store come
parametri Standard SecureString cifrati con `alias/aws/ssm`. Vengono caricati e
mantenuti in cache dalla Lambda a runtime. La configurazione Lambda contiene
soltanto i nomi; il ruolo può leggere e decifrare esclusivamente quei parametri.
I valori non devono transitare in comandi, log, issue o chat.

## Collegamento Vercel → SQS senza chiavi permanenti

Il template crea in IAM il provider OpenID Connect del team `smf6` e un ruolo
autorizzato esclusivamente a `sqs:SendMessage` sull'ARN della coda prodotta dal
deploy. Se il progetto viene spostato su un altro team, aggiornare team e subject
nel template prima del deploy.

La relazione di trust deve limitare esattamente:

- audience: `https://vercel.com/<TEAM_SLUG>`;
- subject: `owner:<TEAM_SLUG>:project:smf-travel:environment:production`.

Configurare quindi su Vercel:

```text
PLATFORM_JOB_QUEUE_PROVIDER=sqs
PLATFORM_AI_PROVIDER=bedrock
AWS_REGION=eu-central-1
AWS_ROLE_ARN=<output VercelQueuePublisherRoleArn>
AWS_SQS_IMPORT_QUEUE_URL=<output ImportQueueUrl>
AWS_BEDROCK_TEXT_MODEL=<modello scelto>
```

`VERCEL_OIDC_TOKEN` è fornito automaticamente da Vercel. Non creare access key AWS
per l'applicazione web.

## Limiti di costo iniziali

- concorrenza massima del consumer SQS: 2;
- batch SQS: 1;
- retry SQS: 4;
- PDF inviabile direttamente a Bedrock: 4,5 MB, modificabile con
  `AWS_BEDROCK_MAX_DOCUMENT_BYTES` dopo aver verificato i limiti del modello;
- risposta Bedrock limitata a 9.000 token, sotto il limite di Nova Lite;
- nessuna risorsa con tariffazione oraria fissa.

Il progetto demo usa il budget `SMF-Travel-Zero-Spend` con limite mensile di 1 USD.
La retention del log group `/aws/lambda/<stack>-import-worker` è impostata a 14
giorni per evitare accumulo indefinito di log.

## Allarmi e procedura operativa

Gli allarmi creati dal template sono:

- `import-worker-error-rate`: errori oltre il 5% per due minuti su tre;
- `import-worker-throttles`: almeno un throttling in due minuti;
- `import-worker-duration-p99`: durata p99 oltre 240 secondi;
- `import-queue-age`: messaggio in attesa da oltre 15 minuti;
- `import-dlq-not-empty`: almeno un messaggio nella DLQ.

Quando un allarme scatta:

1. controllare i log JSON del worker usando `jobId`, `agencyId`, `importId` e
   `messageId` come chiavi di correlazione;
2. verificare stato e contatori delle due code;
3. correggere la causa a valle prima di ripetere il lavoro;
4. rieseguire l'importazione tramite l'interfaccia agenzia. Non cancellare un
   messaggio dalla DLQ prima di avere registrato job e causa.

## Vincoli architetturali

- Il visibility timeout SQS deve restare almeno sei volte il timeout Lambda.
- La concorrenza dell'event source mapping resta limitata a due per proteggere
  Neon e la spesa Bedrock; non si usa provisioned concurrency.
- Il ruolo Vercel accetta solo il subject OIDC del progetto production e può
  esclusivamente inviare messaggi alla coda import di questo stack.
- Le code sono cifrate con SSE-SQS e rifiutano traffico non TLS.
- I nomi fisici derivano dallo stack per permettere ambienti separati.
- Il deploy operativo non deve essere eseguito con credenziali root.

## Criteri di accettazione produzione

L'architettura è dichiarabile definitiva soltanto quando risultano verificati:

1. deploy CloudFormation completo e senza drift;
2. identità di deploy dedicata con credenziali temporanee e MFA;
3. parametri SecureString letti da Parameter Store e assenti dalla configurazione Lambda;
4. import PDF end-to-end fino a revisione e pubblicazione;
5. retry idempotente e passaggio controllato in DLQ;
6. ricezione della notifica di allarme;
7. isolamento tra due agenzie e tra due famiglie provato con test negativi;
8. build, test API e verifica browser smartphone superati.
