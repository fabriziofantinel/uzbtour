# AWS SQS, Lambda e Bedrock

Questa configurazione crea l'elaborazione asincrona definitiva di SMF Travel:

1. Vercel registra il job su Neon e invia a SQS solo `jobId`, `agencyId` e `importId`.
2. SQS attiva una Lambda ARM64 con concorrenza massima pari a 2.
3. Lambda legge il PDF dal bucket R2 privato.
4. Amazon Bedrock genera una bozza strutturata con Amazon Nova Lite.
5. Lambda valida la risposta e salva risultato, consumi e stato su Neon.
6. Dopo quattro errori SQS sposta il messaggio nella dead-letter queue.

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
- `DatabaseUrl`: stringa di connessione Neon;
- credenziali R2 limitate al solo bucket;
- bucket R2 già configurato;
- modello Bedrock scelto.

Non salvare i valori segreti in `samconfig.toml`. I parametri marcati `NoEcho` non
appaiono nelle schermate CloudFormation, ma chi dispone di ampi permessi Lambda può
comunque leggere la configurazione della funzione. In produzione si potrà spostare
la rotazione di questi segreti in AWS Secrets Manager.

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
- nessuna risorsa con tariffazione oraria fissa.

Configurare in AWS Budgets un avviso a 5 USD e uno a 10 USD prima di abilitare il
servizio in produzione.
