# Test del ruolo AGENZIA - istruzioni per il tester

Questo documento accompagna il foglio `Test_Agenzia_SMF_Travel.csv`, che contiene un
caso di test per ogni funzione dell'agenzia. L'agenzia comprende due profili: il
**responsabile** (amministra l'agenzia e i suoi operatori) e l'**agente** (gestisce
i viaggi). E il ruolo piu ricco dell'applicazione: crea i viaggi caricando il
preventivo, controlla il programma interpretato dall'AI, lo pubblica, invita i
viaggiatori, gestisce documenti, comunicazioni, personale e assicurazione.

## 1. Come aprire il foglio

Il file e un CSV con separatore **punto e virgola** (;). In Excel: Dati >
Da testo/CSV, e imposta il separatore su "Punto e virgola". In Google Fogli: File >
Importa. Salva poi come .xlsx o Foglio Google mentre compili.

## 2. Come compilare

Le prime sette colonne descrivono il test e **non vanno modificate**. Tu compili
dalla ottava in poi:

- **Esito**: `OK` (come atteso) / `KO` (comportamento diverso) / `Bloccato` (non hai
  potuto completare) / `Non testabile` (funzione assente o dati mancanti).
- **Gravita problema**: solo se KO o Bloccato. Vedi punto 4.
- **Descrizione problema**: cosa e successo davvero, in modo riproducibile.
- **Riproducibile**: `Sempre` / `A volte` / `No`.
- **Dispositivo e browser**, **Data test**, **Tester**, **Note**.

## 3. Come eseguire i test - ordine consigliato

I test sono in ordine logico e ogni fase prepara i dati della successiva. Segui
questa sequenza:

1. **Accesso e cruscotto** (AG-ACC, AG-DSH).
2. **Import e revisione** (AG-TRP, AG-REV): crea il viaggio caricando un preventivo
   vero e controlla la qualita dell'interpretazione. E il cuore del prodotto.
3. **Pubblicazione e contenuti** (AG-PUB): pubblica in profilo Completo per provare
   tutto, e in profilo Essenziale per verificare che il viaggio si pubblichi anche
   senza quiz e giochi.
4. **Programma pubblicato** (AG-PRG).
5. **Gruppi, viaggiatori, capogruppo, minori** (AG-GRP): crea almeno due gruppi con
   piu viaggiatori, un minore e un capogruppo.
6. **Personale operativo** (AG-STF): crea accompagnatore e guida, assegnali al
   viaggio e alle giornate.
7. **Documenti, assicurazione, comunicazioni, chat** (AG-DOC, AG-INS, AG-COM, AG-CHT).
8. **Informazioni Paese e analytics** (AG-CTY, AG-ANL).
9. **Login come viaggiatore** (AG-IMP).
10. **Cancellazione viaggio** (AG-DEL): per ultima, solo su un viaggio di prova.

Per i test di isolamento (AG-ACC-03, AG-GRP-13, AG-ANL-03) servono **due agenzie A e
B** e **due gruppi** nello stesso viaggio: creali all'inizio e tienili.

## 4. Scala di gravita

- **Bloccante**: non si prosegue, si perdono dati, oppure si vedono dati che non si
  dovrebbero vedere (altra agenzia, altro gruppo). Avvisa subito.
- **Grave**: la funzione non fa quello che deve, ma esiste un modo per aggirarla.
- **Media**: fastidio evidente, testo sbagliato, layout rotto, lentezza anomala.
- **Lieve**: rifinitura, refuso, dettaglio estetico.

## 5. Prove

Per ogni KO, salva uno screenshot con lo stesso ID del test (es. `AG-REV-02.png`).
Se compare un messaggio d'errore o un codice, riportalo nella descrizione. Annota
data e ora.

## 6. Le verifiche piu importanti

1. **Qualita dell'interpretazione del preventivo (AG-REV)**: e cio che vende il
   prodotto. Verifica che il programma corrisponda al documento e che non vengano
   inventati orari o dettagli assenti.
2. **Isolamento tra agenzie e tra gruppi (AG-ACC-03, AG-GRP-13, AG-ANL-03)**.
3. **Privacy dei minori (AG-GRP-12)**: senza consenso, le foto del minore devono
   essere bloccate.
4. **Permessi del personale (AG-STF)**: finestra temporale, revoca, e nessun accesso
   ad altri viaggi. E l'area piu recente dell'app.
5. **Documenti privati (AG-DOC-04)**: un link copiato non deve dare accesso a chi non
   ne ha diritto.

## 7. Riepilogo aree del foglio

| Prefisso | Area | Numero test |
| --- | --- | --- |
| AG-ACC | Accesso e permessi | 5 |
| AG-DSH | Cruscotto ed elenco viaggi | 4 |
| AG-TRP | Creazione viaggio e import | 8 |
| AG-REV | Revisione della bozza AI | 7 |
| AG-PUB | Pubblicazione e contenuti generati | 6 |
| AG-PRG | Programma pubblicato | 4 |
| AG-GRP | Gruppi, viaggiatori, capogruppo, minori, isolamento | 13 |
| AG-STF | Personale operativo | 6 |
| AG-DOC | Documenti | 4 |
| AG-INS | Assicurazione | 2 |
| AG-COM | Comunicazioni | 4 |
| AG-CHT | Chat | 2 |
| AG-CTY | Informazioni Paese | 3 |
| AG-ANL | Analytics | 4 |
| AG-IMP | Login come viaggiatore | 2 |
| AG-DEL | Cancellazione viaggio | 2 |
| AG-ROB | Robustezza e sicurezza | 3 |
| AG-ACX | Accessibilita | 3 |

Totale: 83 casi di test per il ruolo agenzia.

## 8. Note

- Questo foglio copre **responsabile e agente** insieme. Dove un test dipende dal
  ruolo (es. gestione personale), provalo con entrambi e annota eventuali
  differenze nella colonna Note.
- La struttura e identica a quella del foglio superuser, cosi gli esiti di tutti i
  ruoli si possono unire in un unico riepilogo finale.
- Prossimi fogli previsti con la stessa struttura: accompagnatore, guida,
  viaggiatore.
