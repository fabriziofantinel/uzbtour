# SMF Travel - Rapporto di esecuzione del piano di test

**Data:** 30 agosto 2026

**Piano sorgente:** `pianotestnew 15.txt`

**Ambiente applicativo:** produzione Vercel e repository locale
**Scopo:** eseguire i casi previsti, correggere le anomalie riproducibili e rieseguire i controlli.

## 1. Criteri di classificazione

- **SUPERATO:** flusso eseguito con esito conforme, oppure test transazionale automatizzato completato e rollback verificato.
- **NON SUPERATO:** comportamento osservato diverso dal risultato atteso.
- **PARZIALE:** contratto, schema o interfaccia verificati, ma manca una prova end-to-end per assenza di una fixture dedicata.
- **BLOCCATO:** test non eseguibile nell'ambiente disponibile senza credenziali o dati di collaudo specifici.

## 2. Sintesi

| Esito | Casi |
|---|---:|
| Superati | 10 |
| Non superati | 0 |
| Parziali | 8 |
| Bloccati | 0 |
| **Totale** | **18** |

I controlli strutturali principali sono positivi: `quality:guard`, `db:validate:v3`, lo smoke test di accesso agenzia, lo smoke test della chat e i test transazionali di sostituzione responsabile e cancellazione asincrona dell'agenzia sono passati. Il database validato contiene 70 tabelle, 57 tabelle con RLS, nessun indice invalido, nessun vincolo non validato e nessuna tabella tenant priva di indice con `agency_id` iniziale.

## 3. Esiti per caso d'uso

| ID | Esito | Evidenza e risultato |
|---|---|---|
| UC-IAM-001 | **PARZIALE** | **Corretto e ritestato:** client e API rifiutano ora una e-mail nel campo Username con `Username non valido`; il test di regressione è passato. La variante positiva con due account sulla stessa e-mail resta non eseguibile senza le due utenze fixture. |
| UC-IAM-002 | **PARZIALE** | Il test transazionale crea un invito individuale, lo consuma una sola volta, rifiuta il riuso e non consente più di ispezionare il token usato. La pagina di recupero richiede username ed e-mail. Resta da verificare il recapito e l'apertura del collegamento su un account Cognito di collaudo reale. |
| UC-IAM-003 | **SUPERATO** | La suite transazionale sospende il tenant, verifica il blocco dei nuovi accessi e prova che una sessione di impersonificazione già emessa non è più risolvibile: lo stato dell'agenzia viene rivalidato a ogni uso. |
| UC-IAM-004 | **SUPERATO** | Impersonificazione con motivazione, target e scadenza verificata; audit persistente con attore e destinatario; accesso agente limitato ai viaggiatori dei propri viaggi; tentativo cross-tenant respinto. Tutta la prova viene annullata con rollback. |
| UC-ADM-001 | **SUPERATO** | Creazione atomica dell'agenzia e del responsabile, e-mail condivisa, invito pendente, username univoco ed esattamente un owner verificati dalla suite transazionale aggiornata. |
| UC-ADM-002 | **SUPERATO** | `acceptance:v3:agency-owner` passato: aggiornamento contatti, eliminazione del vecchio responsabile, invito del nuovo e unicità username verificati transazionalmente. |
| UC-ADM-003 | **SUPERATO** | `acceptance:v3:trip-reference-agency-deletion` passato: processo BR-019, finalizzazione identità e fase finale `completed`; transazione di test annullata correttamente. |
| UC-TRP-001 | **PARZIALE** | Il producer SQS Standard imposta `MessageGroupId = agencyId`, attivando il fair sharing, e il contratto R2/SQS è presente. Non è stato caricato un documento reale per non creare job e costi senza una fixture di test dedicata. |
| UC-TRP-002 | **PARZIALE** | Sono presenti output strutturato, validazione e gate umano prima della pubblicazione. Non è stato avviato un nuovo job Bedrock con pubblicazione completa e verifica dei record generati. |
| UC-TRP-003 | **SUPERATO** | L'editor espone l'annullamento con motivo obbligatorio; l'API invoca `app.record_itinerary_disruption`, conserva la tappa nello storico e invia la push soltanto per una vera disruption. Lo schema smoke ha inoltre provato blocco della modifica diretta, evento immutabile e stored procedure autorizzata. |
| UC-GRP-001 | **SUPERATO** | Fixture transazionale con ruolo `smf_app`: creazione gruppo, provisioning viaggiatore e invito V3 verificati con rollback. Lo schema smoke prova inoltre il vincolo che impedisce a un minore di diventare organizer. |
| UC-GRP-002 | **SUPERATO** | Lo schema smoke prova rifiuto del collegamento media senza consenso, accettazione dopo `minor_image_upload=granted` e immutabilità append-only della decisione. La route foto verifica il consenso corrente. |
| UC-FIN-001 | **SUPERATO** | Test runtime autosufficiente con ruolo `smf_app`: spesa da 130.000 UZS, due quote da 65.000, quadratura esatta dell'importo originale e del controvalore EUR, vincolo differibile e rollback. La migrazione 099 ha corretto i grant minimi mancanti su `journey.expense_shares`. |
| UC-FIN-002 | **PARZIALE** | La coda IndexedDB usa `client_operation_id` UUIDv7, retry e considera il conflitto idempotente già acquisito. Non è stato completato un ciclo browser autenticato offline-online con doppio invio reale. |
| UC-GAM-001 | **SUPERATO** | La pagina usa il catalogo V3 dinamico; il backend materializza il grant crittografico all'orario server-side, restituisce il payload soltanto con grant valido, limita a 10 domande e richiede 10 risposte. Lo schema smoke prova rifiuto anticipato, override autorizzato, payload senza `answer_spec` e rifiuto del tentativo senza grant. |
| UC-GAM-002 | **PARZIALE** | Modello e migrazioni prevedono due foto, validazione AI, selezione del miglior risultato e chiusura del contest. Manca una prova autenticata completa con due immagini, conferma, scoring Bedrock e chiusura schedulata delle 06:00. |
| UC-PWA-001 | **PARZIALE** | Manifest conforme: standalone, portrait, scope, start URL, icone maskable e shortcut. Il service worker implementa cache shell/dati/mappe/media, fallback offline, sync e push. Installazione reale su smartphone e consultazione autenticata in modalità aereo non sono state eseguite. |
| UC-PWA-002 | **PARZIALE** | La pagina accessibilità espone navigazione da tastiera, contrasto/zoom, tecnologie assistive e supporto mobile. `accessibleBrandColor` forza contrasto minimo 4,5:1 sul fondo. Manca il test UI con colore agenzia molto chiaro salvato da superuser fixture e scansione automatica WCAG completa. |

## 4. Anomalie applicative corrette e ritestate

### DEF-001 - Validazione username nel login

- **Caso:** UC-IAM-001
- **Priorità del piano:** P0
- **Stato:** chiusa nei test ripetibili.
- **Intervento:** stessa espressione di formato applicata nel form e nella route API; errore `INVALID_USERNAME` con testo `Username non valido`.

### DEF-002 - Quiz non conforme al modello dinamico

- **Caso:** UC-GAM-001
- **Priorità del piano:** P0
- **Stato:** chiusa nei test ripetibili; verifica end-to-end con fixture ancora richiesta.
- **Intervento:** il percorso V3 effettivamente usato calcola l'orario nel fuso della partenza, materializza il grant crittografico, restituisce il payload solo con grant valido, limita il giorno a 10 domande e impone esattamente 10 risposte alla consegna. Le specifiche delle risposte restano esclusivamente server-side.

### DEF-003 - Disruption non gestibile end-to-end

- **Caso:** UC-TRP-003
- **Priorità del piano:** P1
- **Stato:** chiusa nei test ripetibili; verifica end-to-end con fixture ancora richiesta.
- **Intervento:** aggiunta azione esplicita `Annulla tappa`, motivo obbligatorio, operazione idempotente identificata dal client, stored procedure append-only, audit e notifica mirata. Il normale salvataggio della giornata non genera più una falsa notifica disruption.

### DEF-004 - Grant runtime mancanti sulle quote spesa

- **Caso:** UC-FIN-001
- **Priorità del piano:** P1
- **Stato:** chiusa e validata nel database.
- **Intervento:** migrazione 099 con privilegi minimi `SELECT` e `INSERT` per `smf_app` su `journey.expense_shares`, mantenendo RLS e isolamento tenant/gruppo.

### DEF-005 - Audit e revoca dell'impersonificazione incompleti

- **Casi:** UC-IAM-003, UC-IAM-004
- **Priorità del piano:** P0
- **Stato:** chiusa e ritestata transazionalmente.
- **Intervento:** migrazione 100 per audit automatico delle sessioni; migrazione 101 per rivalidare agenzia e perimetro agente a ogni risoluzione, invalidando di fatto le sessioni quando il tenant viene sospeso.

## 5. Problemi del sistema di test, non classificati come difetti applicativi

### TST-ENV-001 - Connessione runtime locale assente

`.env.local` non contiene una `DATABASE_URL` separata del ruolo applicativo. Il blocco è stato rimosso per i test database: le suite creano una delega transazionale a `smf_app` e la eliminano con il rollback. Restano necessarie credenziali dedicate per i test browser/Cognito e per le integrazioni esterne.

### TST-AUT-002 - Test di avvicendamento responsabile riallineato

La suite `acceptance:v3:agency-access` è stata aggiornata al comportamento corrente: il vecchio owner viene eliminato, il nuovo resta l'unico responsabile e l'operazione viene verificata con rollback.

### TST-DAT-003 - Mancanza di fixture end-to-end controllate

Le fixture transazionali coprono ora e-mail condivisa, agenzia sospesa, invito monouso, impersonificazione, adulto/minore con consensi e gruppo con quote spesa. Restano necessari dati esterni controllati per Cognito/e-mail, R2/SQS/Bedrock, browser offline, installazione smartphone e contest AI schedulato.

## 6. Comandi eseguiti con esito positivo

```text
npm run quality:guard
npm run db:validate:v3
npm run smoke:v3:agency-access
npm run smoke:v3:chat
npm run acceptance:v3:agency-owner
npm run acceptance:v3:trip-reference-agency-deletion
npm run acceptance:v3:participant-provisioning
npm run acceptance:v3:agency-access
npm run smoke:v3:expenses
npm run test:plan-regressions
npm run build
```

## 7. Riesecuzione dopo le correzioni

La riesecuzione ha prodotto i seguenti risultati:

```text
test:plan-regressions                         PASS
quality:guard                                PASS
TypeScript                                   PASS
Next.js production build (41 pagine)         PASS
db:validate:v3                               PASS
smoke:v3:agency-access                       PASS
acceptance:v3:agency-owner                   PASS
acceptance:v3:trip-reference-agency-deletion PASS
acceptance:v3:participant-provisioning       PASS
acceptance:v3:agency-access                  PASS
smoke:v3:expenses                            PASS
```

Non restano casi classificati **NON SUPERATO** o **BLOCCATO**. Gli 8 casi **PARZIALI** richiedono prove su servizi esterni o dispositivi reali descritte in `TST-DAT-003`.

## 8. Nota di sicurezza e integrità dati

Sono state applicate esclusivamente le correzioni descritte nella sezione 4. Non sono stati creati job Bedrock, caricati file, sospese agenzie reali o cancellati dati di produzione. I test di accettazione che modificano dati hanno confermato il rollback transazionale.
