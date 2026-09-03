# SMF Travel - Guida al collaudo manuale

Versione 1.0 - Documento per il tester incaricato del collaudo funzionale reale.

Questo documento ti permette di usare l'applicazione come la userebbero un'agenzia
di viaggio e i suoi viaggiatori, di provare tutti i flussi in condizioni normali e
anomale, e di censire ogni problema in modo che sia riproducibile e risolvibile.

Non serve alcuna conoscenza tecnica. Serve pazienza, curiosita e l'abitudine ad
annotare esattamente cosa hai fatto.

---

## 1. Che cos'e SMF Travel e come e fatto

SMF Travel trasforma il preventivo di viaggio gia accettato dal cliente in
un'applicazione che l'agenzia gestisce e il viaggiatore usa sullo smartphone
prima, durante e dopo la vacanza.

Ci sono tre tipi di utente, con tre esperienze diverse:

- **Superadmin (o superuser)**: gestisce la piattaforma, crea le agenzie e i loro
  responsabili, puo entrare come un altro utente per assistenza.
- **Agenzia**: il responsabile e gli agenti. Creano il viaggio caricando il
  preventivo, controllano il programma interpretato dall'intelligenza artificiale,
  lo pubblicano, invitano i viaggiatori, gestiscono documenti, comunicazioni e
  accompagnatori. Lavorano soprattutto da computer o tablet.
- **Viaggiatore**: chi parte. Usa lo smartphone per consultare il programma, la
  mappa, i documenti, registrare le spese di gruppo, partecipare a quiz, giochi e
  contest fotografici, salvare ricordi. Deve funzionare anche con rete debole.
- **Accompagnatore / Tour Leader**: chi guida il gruppo in destinazione. Aggiorna
  il programma, fa l'appello, comunica con i partecipanti.

L'intelligenza artificiale prepara sempre una bozza, ma un agente deve
**confermare** prima che qualcosa diventi visibile ai viaggiatori. Nessun
contenuto viene pubblicato automaticamente.

---

## 2. Come impostare il collaudo

### 2.1 Cosa ti serve

- L'indirizzo web dell'applicazione (URL di produzione o di prova).
- Le credenziali di un account **superadmin**, per poter creare le agenzie.
- Almeno **due smartphone reali**, uno Android e un iPhone, oltre a un computer.
  Molti problemi si vedono solo sul telefono vero, non sul simulatore.
- Un preventivo di viaggio vero in PDF (o Word), possibilmente di un viaggio con
  piu giorni, piu citta e almeno un hotel. Se puoi, procurane due o tre diversi.
- Una connessione che puoi spegnere e riaccendere (modalita aereo del telefono).

### 2.2 Regola d'oro: crea due mondi separati

Molti dei problemi piu gravi in un'app come questa riguardano la **separazione dei
dati**: un'agenzia non deve mai vedere i dati di un'altra, e un gruppo di
viaggiatori non deve mai vedere le spese o le foto di un altro gruppo.

Per poterlo verificare, crea fin dall'inizio **due agenzie diverse**, ognuna con il
proprio viaggio, i propri gruppi e i propri viaggiatori. Durante tutto il collaudo
tieni aperte sessioni di entrambe e controlla continuamente che i confini reggano.

### 2.3 Account da preparare (annota username e password di ciascuno)

Suggerimento: lo **username** e l'identificatore di accesso, l'**email** e solo un
recapito. La stessa email puo essere usata da piu familiari; lo username no, deve
essere unico in tutta l'applicazione.

| Ruolo | Quanti | Note |
| --- | --- | --- |
| Superadmin | 1 | ti viene fornito |
| Responsabile agenzia A | 1 | lo crea il superadmin |
| Responsabile agenzia B | 1 | lo crea il superadmin |
| Agente agenzia A | 1 | lo crea il responsabile A |
| Viaggiatori agenzia A, gruppo 1 | 3 adulti + 1 minore | almeno uno con la tua email |
| Viaggiatori agenzia A, gruppo 2 | 2 adulti | serve per i test di separazione |
| Viaggiatori agenzia B | 2 adulti | serve per i test cross-agenzia |
| Accompagnatore / Tour Leader agenzia A | 1 | assegnato al viaggio A |

---

## 3. Come segnalare i problemi

Ogni problema che trovi va registrato in una riga del foglio di censimento (vedi
modello sotto). La qualita della tua segnalazione decide se il problema potra
essere risolto. **Una segnalazione senza i passi per riprodurla e quasi inutile.**

### 3.1 Modello di segnalazione (copia questa struttura per ogni problema)

- **ID**: un numero progressivo (BUG-001, BUG-002, ...).
- **Titolo**: una frase breve che dice cosa non va.
- **Ruolo e dispositivo**: es. "Viaggiatore, iPhone Safari" oppure "Agenzia, Chrome desktop".
- **Dove**: la pagina o la sezione. Se possibile incolla l'indirizzo della pagina.
- **Cosa ho fatto**: i passi numerati, uno per riga, cosi come li hai eseguiti.
- **Cosa mi aspettavo**: il comportamento che ritenevi corretto.
- **Cosa e successo**: il comportamento reale.
- **Gravita**: vedi tabella sotto.
- **Frequenza**: sempre / a volte / una volta sola.
- **Prova**: screenshot o breve video. Per gli errori, fotografa anche eventuali
  messaggi. Annota data e ora esatta, servono a ritrovare l'errore nei log.
- **Codice errore**: se compare un identificativo tipo "errore ABC123" o un header
  `x-smf-error-id`, copialo: permette di ritrovare l'errore preciso.

### 3.2 Scala di gravita

- **Bloccante**: non si puo proseguire, si perdono dati, oppure un utente vede
  dati di un altro. Da segnalare subito, anche a voce.
- **Grave**: la funzione non fa quello che deve, ma esiste un modo per aggirarla.
- **Media**: fastidio evidente, testo sbagliato, layout rotto, lentezza anomala.
- **Lieve**: rifinitura, refuso, dettaglio estetico.

### 3.3 Cosa merita sempre una segnalazione, anche se "funziona"

- Qualcosa che ti ha confuso o che hai dovuto rileggere due volte.
- Un testo poco chiaro, un pulsante che non capivi cosa facesse.
- Un'attesa lunga senza che l'app dicesse che stava lavorando.
- Un colore o un testo poco leggibile alla luce del sole sul telefono.

---

## 4. Concetti e regole che devi conoscere prima di iniziare

Queste sono le regole con cui l'app dovrebbe comportarsi. Servono a te per capire
se cio che vedi e giusto o e un difetto.

- **Username unico, email condivisibile.** Due familiari possono avere la stessa
  email ma username diversi. Ogni invito e personale e vale per un solo utente.
- **Password**: deve avere almeno 10 caratteri e contenere una lettera minuscola,
  una maiuscola e un numero. Password piu deboli devono essere rifiutate.
- **Invito**: il link di attivazione scade dopo 14 giorni ed e monouso. Un link
  gia usato o scaduto non deve funzionare.
- **Preventivo da caricare**: PDF, DOC o DOCX fino a 20 MB.
- **L'AI non pubblica da sola**: prepara una bozza, l'agente la corregge e conferma.
- **Orari**: l'app non deve inventare orari. Se il preventivo non indica un orario,
  l'app non deve mostrarne uno. Gli orari compaiono solo dove esistono davvero
  (voli, treni, trasferimenti).
- **Fuso orario**: sblocchi e chiusure seguono l'ora della **destinazione**, non
  quella dell'Italia. L'app mostra due orologi, Italia e destinazione.
- **Quiz e missioni** del giorno si sbloccano alle **20:00 locali**. Prima non
  devono essere accessibili.
- **Contest fotografico**: massimo 2 foto per viaggiatore, modificabili fino alla
  conferma; dopo la conferma sono bloccate. Il contest si chiude alle **06:00
  locali del giorno successivo**.
- **Foto delle sfide**: massimo 2 tentativi per missione o casella. Dopo
  l'approvazione o il secondo rifiuto non si possono caricare altre foto.
- **Minori**: le foto di un minore richiedono un consenso esplicito, che puo essere
  concesso, negato o revocato. Senza consenso, le funzioni foto del minore sono
  bloccate. Un minore non puo essere capogruppo.
- **Isolamento**: nessun utente deve mai vedere dati di un'altra agenzia; nessun
  gruppo deve vedere spese, chat, foto o classifiche di un altro gruppo.
- **Offline**: la consultazione del programma e dei documenti gia visti deve
  funzionare senza rete; spese e ricordi inseriti offline devono essere inviati
  quando la rete torna, senza duplicati.

---

## 5. Metodo di lavoro consigliato

Esegui il collaudo in quest'ordine, perche ogni fase prepara i dati della
successiva:

1. **Configurazione** (superadmin crea le agenzie).
2. **Creazione del viaggio** (agenzia carica e pubblica il preventivo).
3. **Partecipanti** (agenzia crea gruppi e invita viaggiatori).
4. **Esperienza viaggiatore** (dal telefono, come un vero partecipante).
5. **Operativita in viaggio** (accompagnatore, comunicazioni, presenze).
6. **Prove trasversali** (offline, fusi orari, separazione dati, accessibilita).
7. **Cancellazioni** (le operazioni distruttive, per ultime).

Per ogni scheda dei capitoli seguenti: esegui prima il "caso normale", poi le
"varianti da provare". Le varianti sono dove si nascondono i problemi.

Le schede usano un codice (es. TEST-IAM-01) che puoi riportare nel foglio di
censimento per collegare il problema al flusso.

---

## 6. Schede di collaudo

### 6.1 Accessi, inviti e password

**TEST-IAM-01 - Attivazione account da invito**
Caso normale: ricevi l'email di invito, apri il link, scegli una password valida,
accedi. Devi arrivare nell'area giusta per il tuo ruolo.
Varianti da provare:
- Apri lo stesso link una seconda volta: non deve permettere una seconda attivazione.
- Prova una password troppo corta (meno di 10) o senza numero/maiuscola: deve essere rifiutata con un messaggio chiaro.
- Aspetta o fatti dare un invito scaduto (oltre 14 giorni): il link non deve funzionare.
- Modifica a mano qualche carattere del link: deve essere rifiutato.
- Due familiari con la **stessa email**: entrambi devono ricevere un invito
  indipendente; attivando il primo, il secondo deve restare valido.

**TEST-IAM-02 - Accesso e uscita**
Caso normale: accedi con username e password, naviga, esci.
Varianti:
- Username inesistente, password sbagliata: messaggio d'errore, non deve rivelare se lo username esiste.
- Chiudi l'app e riaprila dopo un po': deve chiederti di riaccedere o mantenerti connesso in modo coerente.
- Accedi sullo stesso account da due dispositivi contemporaneamente.

**TEST-IAM-03 - Recupero password**
Caso normale: chiedi il recupero indicando lo username, ricevi il codice/link,
imposti una nuova password.
Varianti:
- Username inesistente: la risposta deve essere generica, non deve dire "non esiste".
- Codice sbagliato, scaduto o gia usato.
- Stessa email su due username: il recupero deve riguardare un solo account.

**TEST-IAM-04 - Controllo username in fase di creazione**
Mentre crei un utente, prova uno username gia esistente (anche con maiuscole
diverse o spazi): deve essere segnalato come non disponibile e il salvataggio deve
essere bloccato.

### 6.2 Superadmin

**TEST-ADM-01 - Cruscotto**
Verifica che i conteggi di agenzie, viaggi e utenti siano coerenti. Prova con
zero dati e con molti dati.

**TEST-ADM-02 - Creazione agenzia e primo responsabile**
Caso normale: crea l'agenzia con tutti i dati e il responsabile; il responsabile
riceve l'invito.
Varianti:
- Campi obbligatori mancanti o formati errati (partita IVA, email).
- Username del responsabile gia usato.
- Doppio invio del modulo: non deve creare due agenzie.

**TEST-ADM-03 - Modifica dati agenzia**
Modifica ragione sociale, indirizzo, contatti. Prova valori molto lunghi e
caratteri speciali. Verifica che username, nome e cognome del responsabile non
siano modificabili da qui.

**TEST-ADM-04 - Branding (logo e colore)**
Carica un logo (PNG, JPG o WebP, massimo 2 MB) e scegli un colore.
Varianti importanti:
- Scegli un colore molto chiaro (es. giallo quasi bianco): i testi e i pulsanti
  devono restare leggibili. L'app deve correggere automaticamente il contrasto.
  Segnala se un testo diventa illeggibile.
- Carica un file troppo grande o di formato sbagliato.
- Rimuovi il logo: deve tornare un logo di riserva.
- Dopo aver cambiato il branding, apri l'esperienza di un viaggiatore di
  quell'agenzia e verifica che logo e colore siano applicati.

**TEST-ADM-05 - Sospensione e riattivazione agenzia**
Sospendi l'agenzia A. Un utente dell'agenzia A che era gia connesso deve essere
bloccato alla richiesta successiva. Riattiva e verifica che torni operativa.

**TEST-ADM-06 - Sostituzione del responsabile**
Sostituisci il responsabile dell'agenzia A. Il nuovo riceve l'invito, il vecchio
perde l'accesso. Non devono esistere due responsabili attivi insieme.

**TEST-ADM-07 - Entrare come un altro utente (impersonazione)**
Da superadmin, entra nell'esperienza di un viaggiatore per assistenza. Deve
comparire un avviso chiaro che sei in modalita impersonazione, e devi poter
tornare al tuo profilo. Verifica che non si possa entrare in un utente di
un'agenzia sospesa in modo incoerente.

### 6.3 Creazione del viaggio e interpretazione AI

**TEST-TRP-01 - Caricamento del preventivo**
Caso normale: come agenzia crea un viaggio, carica il preventivo PDF, avvia
l'interpretazione. Deve comparire uno stato "in elaborazione".
Varianti da provare (importanti):
- File di formato diverso (DOC, DOCX) e PDF sia digitale sia scansionato.
- File vuoto, file non di viaggio, file corrotto.
- File vicino al limite di 20 MB e file oltre il limite.
- Interrompi il caricamento a meta (spegni la rete durante l'upload).
- Doppio invio: non deve creare due viaggi.

**TEST-TRP-02 - Attesa dell'elaborazione**
Dopo il caricamento, l'elaborazione avviene in background. Verifica:
- Che lo stato si aggiorni (in elaborazione, poi da revisionare oppure errore).
- Che un errore sia comprensibile e che il viaggio si possa riprovare.
- Che caricando piu preventivi insieme (anche da agenzie diverse) l'elaborazione
  proceda senza bloccarsi.

**TEST-TRP-03 - Revisione della bozza**
Caso normale: apri la bozza interpretata e controlla giornata per giornata.
Verifica in modo critico la qualita dell'interpretazione, perche e il cuore del
prodotto:
- Le giornate, le citta, le visite e gli hotel corrispondono al preventivo?
- Ci sono orari inventati dove il preventivo non li aveva? (Non ci devono essere.)
- Un pasto non incluso e stato aggiunto per errore?
- Un giorno con due citta o due hotel e gestito correttamente?
- Modifica descrizioni e attivita, riordina le voci, correggi cio che l'AI ha
  sbagliato. Salva piu volte.
- Prova a lasciare campi obbligatori vuoti: la pubblicazione deve restare bloccata.

**TEST-TRP-04 - Salvataggio e ripresa della revisione**
Salva la revisione, esci, rientra: devi ritrovare il lavoro salvato. Prova a
perdere la rete durante il salvataggio e verifica che non si perda l'ultima
versione valida.

**TEST-TRP-05 - Pubblicazione**
Pubblica il viaggio solo dopo aver confermato. Dopo la pubblicazione il viaggio
diventa operativo e i contenuti (informazioni utili, quiz, giochi) iniziano a
generarsi. Prova il doppio clic sul pulsante di pubblicazione: non deve pubblicare
due volte.

**TEST-TRP-06 - Profilo esperienza (essenziale / standard / completo)**
Prima o durante la pubblicazione, scegli il profilo. Per il collaudo enterprise usa
**completo**. Verifica poi che con il profilo "essenziale" non vengano generati
quiz e giochi, e che il viaggio si pubblichi comunque.

**TEST-TRP-07 - Contenuti Paese e informazioni utili**
Dopo la pubblicazione, controlla le informazioni utili generate: fuso orario
rispetto all'Italia, valuta e cambio, emergenze, ambasciata, salute, documenti.
Verifica che riguardino il Paese giusto e non un altro. Se il viaggio tocca piu
Paesi, controlla che non ci sia contaminazione.

**TEST-TRP-08 - Frasario**
Controlla che le frasi siano nella lingua della destinazione, con traduzione
italiana e pronuncia. Verifica i caratteri speciali (alfabeti non latini).

**TEST-TRP-09 - Download preventivo originale e normalizzato**
Scarica il preventivo originale e il documento normalizzato ricostruito. Il
normalizzato deve contenere programma e dati commerciali, non solo l'itinerario.

**TEST-TRP-10 - Modifica del programma pubblicato**
Modifica una giornata gia pubblicata (descrizione, attivita, hotel), salva.
Verifica che la modifica sia visibile ai viaggiatori. Prova a riordinare e a
cancellare attivita. Verifica che ogni modifica generi una comunicazione ai
viaggiatori (vedi TEST-COM).

### 6.4 Gruppi, viaggiatori e privacy

**TEST-GRP-01 - Creazione ed eliminazione gruppi**
Crea due gruppi sullo stesso viaggio. Prova a eliminare un gruppo con membri
(non deve essere possibile) e un gruppo vuoto (deve funzionare). Prova nomi
duplicati o vuoti.

**TEST-GRP-02 - Invito viaggiatore**
Inserisci un viaggiatore con nome, username, email, telefono e data di nascita.
Varianti:
- Una data di nascita che rende il viaggiatore minorenne: deve essere trattato
  come minore dipendente.
- Stessa email per due familiari.
- Username duplicato.

**TEST-GRP-03 - Rimozione viaggiatore**
Rimuovi un viaggiatore da un viaggio. Verifica che la sua identita non venga
cancellata se e usata in altri viaggi. Verifica cosa succede se rimuovi il
capogruppo.

**TEST-GRP-04 - Capogruppo**
Assegna un adulto come capogruppo. Prova a rendere capogruppo un minore (non deve
essere possibile). Fai cedere il ruolo a un altro adulto. Deve esserci sempre un
solo capogruppo attivo per gruppo.

**TEST-GRP-05 - Consenso immagini per i minori**
Per il minore del gruppo 1, prova i tre stati: consenso concesso, negato, revocato.
Con consenso negato o revocato, i flussi foto del minore devono essere bloccati.
Prova a caricare una foto del minore senza consenso: deve essere impedito.

### 6.5 Documenti e biglietti

**TEST-DOC-01 - Documento per giornata e gruppo**
Come agenzia, allega un documento a una giornata e a un gruppo specifico. I membri
di quel gruppo devono vederlo; i membri di un altro gruppo **no**.

**TEST-DOC-02 - Download da parte del viaggiatore**
Dal telefono, come viaggiatore, apri e scarica il documento. Verifica che un
viaggiatore di un altro gruppo o di un'altra agenzia non possa accedervi (prova a
copiare un eventuale link in un'altra sessione).

**TEST-DOC-03 - Cancellazione documento**
Cancella un documento dall'agenzia: non deve piu essere visibile o scaricabile dai
viaggiatori.

**TEST-DOC-04 - Biglietti collegati alle attivita**
Allega un biglietto a una singola attivita del programma. Il viaggiatore deve
ritrovarlo nel contesto di quell'attivita.

**TEST-INS-01 - Assicurazione della partenza**
Come agenzia, inserisci i dati della polizza (compagnia, numero, telefono della
centrale, validita) e allega il documento. Dal telefono, come viaggiatore,
verifica che il numero della centrale sia chiamabile con un tocco e che il
documento sia scaricabile. Prova una partenza senza polizza: deve mostrare uno
stato vuoto chiaro, non un errore.

### 6.6 Esperienza del viaggiatore (dal telefono)

Esegui questa sezione su smartphone reale, sia Android sia iPhone. E la parte piu
importante del collaudo, perche e cio che vede il cliente finale.

**TEST-EXP-01 - Home e navigazione**
Accedi come viaggiatore. Verifica che compaiano logo e colore dell'agenzia e che
le voci principali (Mappa, Programma, Documenti, Spese, Sfide e il menu Altro con
Ricordi, Informazioni, Frasario, SOS, Chat) siano raggiungibili con il pollice.
Varianti:
- Schermo piccolo, testo del telefono ingrandito, orientamento orizzontale.
- Verifica in particolare quanto e facile raggiungere **SOS** e **Chat** in
  un'emergenza: annota se sono troppo nascosti.

**TEST-EXP-02 - Programma giornaliero**
Scorri i giorni, leggi la scaletta. Verifica che le attivita siano in ordine e che
gli orari compaiano solo dove esistono. Prova un giorno con piu citta o piu hotel,
una descrizione lunga, e lo scorrimento tra i giorni.

**TEST-EXP-03 - Mappa del giorno**
Apri la mappa. Verifica che i punti siano quelli del tuo viaggio. Prova a negare il
permesso di posizione: la scaletta deve continuare a funzionare. Verifica i punti
con coordinate mancanti.

**TEST-EXP-04 - Informazioni utili e orologi**
Controlla i due orologi (Italia e destinazione) e il cambio valuta. Verifica che il
Paese e la valuta siano quelli del viaggio, non di un altro.

**TEST-EXP-05 - Frasario**
Consulta le frasi, prova la ricerca. Verifica i caratteri speciali.

**TEST-EXP-06 - Meteo**
Se presente, controlla il meteo del giorno. Se il servizio non risponde, non deve
bloccare il resto del programma.

**TEST-EXP-07 - SOS**
Apri SOS. Verifica il numero di emergenza chiamabile e l'accesso alla chat
dell'agenzia. La tua posizione non deve essere condivisa o memorizzata.

### 6.7 Spese, cassa e pareggio

**TEST-FIN-01 - Registrazione spesa di gruppo**
Registra una spesa indicando importo, valuta, giorno e partecipanti. Prova in euro
e in valuta locale. Verifica che le quote siano ripartite. Prova importo zero o
negativo (devono essere rifiutati) e il doppio invio (non deve duplicare).

**TEST-FIN-02 - Totali**
Verifica il totale in euro e i totali per valuta. Esempio da controllare: una spesa
di 1 euro piu l'equivalente di 1 euro in valuta locale deve dare 2 euro totali.

**TEST-FIN-03 - Prelievi e cambi**
Registra un prelievo e un cambio valuta. Verifica il tasso applicato. I movimenti
di cassa non devono diventare automaticamente spese.

**TEST-FIN-04 - Eliminazione movimenti**
Elimina una spesa e un movimento: i totali si devono ricalcolare. Prova a eliminare
un movimento di un altro gruppo (non deve essere possibile).

**TEST-FIN-05 - Pareggio del gruppo**
Verifica il saldo di ogni viaggiatore (chi deve ricevere e chi deve versare). La
somma finale deve essere prossima a zero. Controlla il caso di un solo membro e di
piu valute.

### 6.8 Sfide, quiz, giochi e contest

**TEST-GAM-01 - Missioni giornaliere**
Scegli una missione, carica una foto pertinente: deve essere approvata e dare
punti. Carica una foto **non** pertinente: deve essere rifiutata. Verifica il
limite di **2 tentativi**: dopo due rifiuti o dopo l'approvazione non deve
permettere altre foto.

**TEST-GAM-02 - Bingo**
Verifica la cartella (3 righe x 9 colonne, 15 caselle). Fotografa gli elementi.
Controlla i punteggi delle combinazioni (ambo, terno, quaterna, cinquina, tombola).

**TEST-GAM-03 - Quiz**
Verifica che i quiz del giorno si sblocchino solo alle **20:00 dell'ora locale
della destinazione**. Prima non devono essere accessibili. Rispondi, verifica il
punteggio. Prova a cambiare l'orario del telefono per anticipare lo sblocco: il
sistema non deve farsi ingannare.

**TEST-GAM-04 - Giochi**
Prova i tre giochi (es. puzzle fotografico, memory, trova l'intruso). Verifica che
i contenuti siano coerenti con la destinazione.

**TEST-GAM-05 - Contest fotografico**
Carica fino a **2 foto**, sostituiscile o eliminale, poi **conferma**. Dopo la
conferma non devono piu essere modificabili. Prova a caricare una terza foto (non
deve essere permesso). Verifica il punteggio e la scelta della foto migliore.
Verifica cosa succede a un contest scaduto (chiusura alle 06:00 locali del giorno
dopo).

**TEST-GAM-06 - Classifiche e profilo Sfide**
Controlla il tuo punteggio totale, per categoria, di gruppo e di viaggio. Prova
l'opzione per concorrere anche contro gli altri gruppi (opt-in) e verifica che un
viaggiatore che non ha aderito non compaia nella classifica di viaggio.

### 6.9 Ricordi, album e feedback

**TEST-MEM-01 - Ricordi e diario**
Aggiungi note e foto a una giornata. Verifica che siano privati e isolati per
gruppo. Prova foto molto grandi (fino a 25 MB) e annota i tempi di caricamento.

**TEST-MEM-02 - Album finale PDF**
Genera l'album PDF del diario. Provalo con pochi contenuti e con molti. Verifica i
caratteri internazionali e le foto grandi. Su iPhone prova la condivisione nativa.

**TEST-MEM-03 - Feedback**
Dai una valutazione a una giornata o attivita. Prova online e offline. Prova valori
limite e il doppio invio.

### 6.10 Operativita in viaggio e accompagnatore

**TEST-TLD-01 - Assegnazione dell'accompagnatore**
Come responsabile, assegna un Tour Leader al viaggio (anche una persona esterna,
non un agente). Deve ricevere un invito personale e vedere **solo** quel viaggio.
Verifica la finestra temporale: fuori dal periodo di validita non deve avere
accesso. Revoca l'assegnazione e verifica che l'accesso cessi.

**TEST-TLD-02 - Cosa puo e non puo fare l'accompagnatore**
Accedi come Tour Leader e verifica i confini:
- Puo leggere e modificare il programma, comunicare, fare l'appello, caricare documenti.
- **Non** deve vedere le spese, la cassa, i ricordi privati e le foto personali dei gruppi.
- **Non** deve vedere altri viaggi o i dati dell'agenzia.
- Prova ad accedere a un altro viaggio o a un'altra agenzia: deve essere negato.

**TEST-TLD-03 - Appello e presenze**
Dal giorno del viaggio, segna presenti e assenti, aggiungi una nota. Prova
l'operazione **offline** e verifica che si sincronizzi al ritorno della rete.

**TEST-COM-01 - Comunicazione di partenza**
Come agenzia o accompagnatore, componi una comunicazione a tutta la partenza o a un
gruppo, con richiesta di conferma di lettura entro una scadenza. I viaggiatori
destinatari devono riceverla; gli altri no.

**TEST-COM-02 - Controllo dei non letti**
Verifica di poter vedere chi ha letto, chi non ha letto e chi non e raggiungibile.
Invia un sollecito. Verifica l'indicatore di scadenza superata. Chiudi il caso con
una nota.

**TEST-CHAT-01 - Chat ai tre livelli**
Prova la chat di viaggio (tutti), di gruppo (solo il gruppo) e individuale (un
singolo viaggiatore). Verifica che i messaggi non escano dal loro ambito: un membro
del gruppo 2 non deve leggere la chat del gruppo 1.

### 6.11 PWA, offline e notifiche

**TEST-PWA-01 - Installazione**
Su Android/desktop deve comparire la proposta di installare l'app. Su iPhone Safari
segui "Condividi > Aggiungi alla schermata Home". Verifica che parta a schermo
intero con la sua icona.

**TEST-PWA-02 - Consultazione offline**
Apri il programma e alcuni documenti con la rete attiva. Poi attiva la modalita
aereo e verifica che programma, documenti gia visti e informazioni restino
consultabili. Prova ad aprire qualcosa mai visto offline: deve comparire un
messaggio chiaro, non un errore.

**TEST-PWA-03 - Spese e ricordi offline**
In modalita aereo, registra una spesa e un ricordo. Riattiva la rete: devono essere
inviati automaticamente, senza duplicati. Prova anche a chiudere e riaprire l'app
prima che la rete torni.

**TEST-PWA-04 - Aggiornamento dell'app**
Se compare un avviso di aggiornamento, ricarica e verifica che le operazioni
offline in coda non vadano perse.

**TEST-PWA-05 - Notifiche push**
Attiva le notifiche. Verifica di ricevere un avviso (es. sblocco quiz o comunicazione
urgente) e che, toccandolo, si apra la sezione giusta. Prova a negare il permesso e
a revocarlo.

### 6.12 Accessibilita

Da provare su tutte le pagine principali, sia agenzia sia viaggiatore:
- Navigazione da **tastiera** sul desktop: si arriva a tutti i comandi, il punto di
  focus e sempre visibile, i dialoghi si chiudono con Esc.
- **Zoom** del browser al 200%: niente deve sparire o sovrapporsi.
- **Contrasto e luce esterna**: leggi lo schermo del telefono all'aperto.
- **Solo colore**: verifica che stati come "completato", "errore", "offline" abbiano
  anche un testo o un'icona, non solo un colore.
- **Target tattili**: i pulsanti si toccano facilmente con il dito senza sbagliare.
- Se usi un lettore di schermo (VoiceOver su iPhone, TalkBack su Android), prova le
  pagine principali.

### 6.13 Cancellazioni (da fare per ultime)

Attenzione: queste operazioni cancellano dati. Falle solo su viaggi e agenzie di
prova, mai su dati che vuoi conservare.

**TEST-DEL-01 - Eliminazione viaggio**
Elimina un viaggio di prova con gruppi, documenti e foto. Verifica che spariscano i
contenuti collegati e che un altro viaggio della stessa agenzia resti intatto.
Ripeti l'eliminazione dello stesso viaggio: deve rispondere in modo pulito, non con
un errore.

**TEST-DEL-02 - Eliminazione agenzia**
Su un'agenzia di prova appositamente creata, avvia la cancellazione. E un processo
che avviene a tappe: verifica che proceda fino al completamento. Durante il
processo, controlla che l'altra agenzia sia completamente intatta (conta i suoi
viaggi e utenti prima e dopo).

---

## 7. Prove trasversali da ripetere su piu funzioni

Queste dimensioni vanno incrociate con le funzioni gia elencate. Non serve provarle
tutte ovunque, ma almeno sulle funzioni piu importanti (import, spese, foto, quiz,
documenti, comunicazioni).

**Connettivita**: rete stabile; rete lenta; offline prima di un'azione; caduta della
rete durante un caricamento; ritorno online.

**Dispositivo**: computer dell'agenzia; tablet; Android; iPhone; schermo piccolo con
testo ingrandito.

**Identita e permessi**: ruolo corretto; ruolo insufficiente; utente rimosso mentre e
connesso; agenzia sospesa; sessione in impersonazione.

**Dati**: campo vuoto; valore minimo; valore massimo; testo lunghissimo; caratteri
speciali e alfabeti non latini; duplicato; riferimento a qualcosa che non esiste;
dato che appartiene a un'altra agenzia o a un altro gruppo.

**Concorrenza**: doppio clic; due operatori che modificano la stessa cosa; ripetizione
di un'operazione dopo un'attesa; invio ripetuto.

**Tempo**: prima, esattamente all'orario e dopo uno sblocco o una chiusura; fuso orario
della destinazione diverso da quello italiano; azioni a cavallo della mezzanotte.

**Contenuti AI**: risposta corretta; risposta non pertinente; contenuto incompleto;
attesa lunga; verifica che l'AI non inventi orari, hotel o numeri assenti dal
documento.

**Media**: formato valido e non valido; file grande; caricamento interrotto; consenso
negato o revocato per i minori.

---

## 8. Le cose piu importanti da verificare (priorita alta)

Se il tempo e limitato, concentrati prima su queste, perche un problema qui e grave:

1. **Separazione tra agenzie**: nessun utente dell'agenzia A deve mai vedere o
   toccare dati dell'agenzia B. Provalo su viaggi, documenti, spese, chat, foto.
2. **Separazione tra gruppi**: spese, cassa, ricordi, chat, foto e classifiche di un
   gruppo non devono essere visibili a un altro gruppo dello stesso viaggio.
3. **Qualita dell'interpretazione del preventivo**: e il cuore del prodotto. Verifica
   che il programma estratto corrisponda al documento e che non vengano inventati
   orari o dettagli assenti.
4. **Consenso e privacy dei minori**: senza consenso, le foto del minore devono essere
   bloccate ovunque.
5. **Permessi dell'accompagnatore**: non deve vedere denaro e contenuti privati dei
   gruppi, ne altri viaggi.
6. **Offline e sincronizzazione**: nessuna spesa o ricordo deve andare perso o
   duplicato quando la rete va e viene.
7. **Sblocchi a orario nel fuso della destinazione**: quiz alle 20:00 locali, contest
   chiusi alle 06:00 locali. Prova a manomettere l'ora del telefono.
8. **Documenti privati**: un link o un identificativo copiato non deve dare accesso a
   chi non ne ha diritto.

---

## 9. Foglio di censimento dei problemi (struttura consigliata)

Tieni un unico foglio (Excel o Google Fogli) con una riga per problema e queste
colonne:

| Colonna | Contenuto |
| --- | --- |
| ID | BUG-001, BUG-002, ... |
| Data e ora | quando l'hai riscontrato |
| Titolo | frase breve |
| Scheda | il codice TEST-... collegato |
| Ruolo | chi eri (superadmin, agenzia, viaggiatore, accompagnatore) |
| Dispositivo | es. iPhone Safari, Chrome desktop |
| Pagina/URL | dove eri |
| Passi | i passi numerati per riprodurre |
| Atteso | cosa ti aspettavi |
| Ottenuto | cosa e successo |
| Gravita | bloccante / grave / media / lieve |
| Frequenza | sempre / a volte / una volta |
| Prova | link a screenshot o video |
| Codice errore | eventuale identificativo mostrato |
| Note | qualsiasi osservazione utile |

Suggerimenti finali:
- Registra il problema subito, mentre e fresco: descrivere a memoria a fine giornata
  fa perdere i dettagli che servono a riprodurlo.
- Se un problema e bloccante o riguarda dati di un altro utente, segnalalo
  immediatamente, senza aspettare la fine della sessione.
- Distingui sempre "l'app fa una cosa sbagliata" da "l'app non mi e chiara": sono
  entrambe utili, ma vanno trattate diversamente.
- Alla fine di ogni giornata, scrivi due righe di riepilogo: cosa hai provato, cosa
  ti ha convinto e cosa no.
