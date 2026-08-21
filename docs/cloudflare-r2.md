# Configurazione Cloudflare R2

## 1. Bucket privato

Creare un bucket R2, ad esempio `smf-travel-private`, e lasciare disabilitato
l’accesso pubblico. Documenti e foto vengono letti solo dal server o tramite URL
firmati con scadenza breve.

## 2. Token API

Creare un token R2 limitato al solo bucket con permessi `Object Read & Write`.
Salvare Account ID, Access Key ID e Secret Access Key come variabili sensibili su
Vercel. La Secret Access Key viene mostrata una sola volta.

## 3. CORS del bucket

Nelle impostazioni CORS del bucket inserire:

```json
[
  {
    "AllowedOrigins": [
      "https://smf-travel.vercel.app",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Per provare un deployment Preview, aggiungere temporaneamente il suo URL esatto a
`AllowedOrigins`. Non rendere pubblico il bucket per aggirare CORS.

## 4. Variabili Vercel

Configurare per Production e Preview:

```text
PLATFORM_OBJECT_STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=smf-travel-private
```

Dopo la modifica eseguire un nuovo deployment. Gli URL firmati scadono dopo dieci
minuti e autorizzano un singolo percorso generato dal server.

È consigliata una regola lifecycle che elimini dopo 24 ore gli upload incompleti o
mai registrati. Gli oggetti associati a un viaggio non vanno invece rimossi per età.
