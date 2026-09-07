# Test del ruolo SUPERUSER - istruzioni per il tester

Questo documento accompagna il foglio `Test_Superuser_SMF_Travel.csv`, che contiene
un caso di test per ogni funzione del superuser. Il superuser (o superadmin) e chi
governa l'intera piattaforma: crea le agenzie e i loro responsabili, gestisce
branding, sospensioni e cancellazioni, e puo entrare come un altro utente per
assistenza.

## 1. Come aprire il foglio

Il file e un CSV con separatore **punto e virgola** (;). Per aprirlo in Excel:

1. Apri Excel, vai su Dati > Da testo/CSV, seleziona il file.
2. Se le colonne finiscono tutte in una cella, imposta il separatore su "Punto e
   virgola".
3. In alternativa, importalo in Google Fogli con File > Importa e separatore
   automatico.

Salva poi il tuo lavoro come file Excel (.xlsx) o Foglio Google, cosi mantieni la
formattazione mentre compili.

## 2. Come compilare, colonna per colonna

Le prime sette colonne sono gia compilate e **non vanno modificate**: descrivono il
test. Tu compili le colonne dalla ottava in poi.

- **ID, Area, Titolo, Precondizioni, Passi, Risultato atteso, Priorita**: gia
  scritte. Leggile e basta.
- **Esito**: scrivi una di queste quattro parole:
  - `OK` = il test e andato come nel risultato atteso.
  - `KO` = il comportamento e diverso da quello atteso (c'e un problema).
  - `Bloccato` = non hai potuto completare il test perche qualcosa a monte non
    funzionava.
  - `Non testabile` = la funzione non esiste, non e raggiungibile o mancano i dati.
- **Gravita problema**: compila solo se l'esito e KO o Bloccato. Usa la scala del
  punto 4.
- **Descrizione problema**: cosa e successo davvero, in modo che chi legge possa
  capire e riprodurre. Sii concreto: non "non funziona" ma "dopo aver premuto Salva
  la pagina resta ferma e non compare nessun messaggio".
- **Riproducibile**: `Sempre`, `A volte` o `No` (successo una volta sola).
- **Dispositivo e browser**: es. "Windows, Chrome" oppure "iPhone, Safari".
- **Data test** e **Tester**: quando e chi.
- **Note**: qualsiasi osservazione utile, anche se il test e OK (es. "funziona ma e
  molto lento", "il testo del pulsante e poco chiaro").

## 3. Come eseguire i test

- Esegui i test **nell'ordine del foglio**: sono raggruppati per area e alcuni
  preparano i dati dei successivi. In particolare, crea prima le agenzie (area
  Agenzie), perche molti test dopo si appoggiano ad esse.
- Per i test di isolamento e cancellazione servono **due agenzie diverse**, A e B.
  Creale all'inizio e tienile entrambe per tutto il collaudo.
- I test di **cancellazione** (area SU-DEL) vanno fatti **per ultimi** e **solo su
  un'agenzia di prova creata apposta**, mai su dati che vuoi conservare.
- Se un test fallisce (KO), continua comunque con i successivi, salvo quando il
  fallimento impedisce fisicamente di proseguire: in quel caso segna `Bloccato` sui
  test dipendenti.

## 4. Scala di gravita

- **Bloccante**: non si puo proseguire, si perdono dati, oppure un utente vede dati
  che non dovrebbe (es. i dati di un'altra agenzia). Avvisa subito, senza aspettare
  la fine.
- **Grave**: la funzione non fa quello che deve, ma esiste un modo per aggirarla.
- **Media**: fastidio evidente, testo sbagliato, layout rotto, lentezza anomala.
- **Lieve**: rifinitura, refuso, dettaglio estetico.

## 5. Prove: allega sempre uno screenshot

Per ogni KO, fai uno screenshot (o un breve video) e salvalo con lo stesso ID del
test, ad esempio `SU-DEL-04.png`. Se compare un messaggio d'errore o un codice tipo
"errore ABC123", fotografalo e riportalo nella descrizione: serve a ritrovare
l'errore preciso. Annota anche data e ora, aiutano a rintracciare il problema.

## 6. Cosa e piu importante

Se hai poco tempo, dai priorita a queste aree, perche un problema qui e grave:

1. **Isolamento (SU-ISO)**: il superuser non deve mai far vedere o toccare i dati di
   un'agenzia a un'altra.
2. **Cancellazione agenzia (SU-DEL)**: deve completarsi, non lasciare dati a meta e
   non toccare le altre agenzie.
3. **Branding e contrasto (SU-BRD-03)**: un colore scelto male non deve rendere
   illeggibile l'app del viaggiatore.
4. **Impersonazione (SU-IMP)**: entrare come un altro utente deve essere sempre
   evidente, reversibile e tracciato, e non deve permettere di superare i confini
   dei permessi.

## 7. Riepilogo aree del foglio

| Prefisso | Area | Numero test |
| --- | --- | --- |
| SU-ACC | Accesso e permessi | 6 |
| SU-DASH | Cruscotto e riepilogo | 3 |
| SU-AGY | Creazione e modifica agenzie | 10 |
| SU-BRD | Branding (logo e colore) | 5 |
| SU-SUS | Sospensione e riattivazione | 3 |
| SU-OWN | Sostituzione responsabile | 4 |
| SU-IMP | Login come utente (impersonazione) | 8 |
| SU-ISO | Isolamento tra agenzie | 2 |
| SU-DEL | Cancellazione agenzia | 5 |
| SU-ROB | Robustezza e sicurezza | 3 |
| SU-ACX | Accessibilita | 3 |

Totale: 52 casi di test per il solo superuser.

## 8. Nota sui prossimi documenti

Questo foglio copre solo il **superuser**. Con la stessa struttura verranno prodotti
i fogli per **agenzia (responsabile e agente)**, **accompagnatore**, **guida** e
**viaggiatore**. Mantenere la stessa struttura permette di unire tutti gli esiti in
un unico riepilogo finale.
