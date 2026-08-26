---
name: SMF Travel
description: Un compagno di viaggio white-label costruito come un sentiero di tappe chiaro, affidabile e utilizzabile in movimento.
colors:
  agency-primary: "#247A6B"
  agency-primary-deep: "#142B35"
  agency-accent: "#EF7D4D"
  action: "#2F66F6"
  paper: "#FAF7F0"
  surface: "#FFFFFF"
  ink: "#142B35"
  text-muted: "#647370"
  line: "#DED8CC"
  success: "#247A6B"
  warning: "#A96516"
  danger: "#A63D32"
  focus: "#2F66F6"
typography:
  display:
    fontFamily: "Playfair Display, Georgia, serif"
    fontSize: "clamp(2rem, 8vw, 3.25rem)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Playfair Display, Georgia, serif"
    fontSize: "clamp(1.5rem, 5vw, 2rem)"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Manrope, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 750
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "Manrope, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 450
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Manrope, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 750
    lineHeight: 1.25
    letterSpacing: "0.04em"
rounded:
  control: "10px"
  panel: "14px"
  sheet: "18px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.surface}"
    typography: "{typography.title}"
    rounded: "{rounded.control}"
    padding: "12px 18px"
    height: "48px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.action}"
    typography: "{typography.title}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
    height: "48px"
  activity-sheet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "16px"
  proximity-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "12px 16px"
  bottom-navigation:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    height: "72px"
---

# Design System: SMF Travel

## Overview

**Creative North Star: "Sentiero delle tappe"**

SMF Travel interpreta la giornata come un percorso comprensibile, non come un'agenda rigida. La composizione approvata, **Pannello a due livelli**, separa ciò che può cambiare da ciò che deve rimanere affidabile: in alto un pannello breve può suggerire la visita vicina; sotto, un foglio di percorso mostra l'intera scaletta ordinata. L'ordine è il riferimento primario. Gli orari sono informazioni eccezionali e compaiono solo quando il programma li contiene davvero, per esempio per un volo, un treno, una prenotazione o un trasferimento.

Il mondo visivo deriva dai segnavia e dai fogli da campo: fondo caldo e leggibile, numerazione evidente, collegamenti precisi fra attività e relativi contenuti, pochi accenti saturi e controlli sufficientemente grandi da usare camminando. Il risultato deve sentirsi umano e memorabile senza diventare rustico, illustrativo o nostalgico. L'informazione reale del viaggio prevale sempre sulla decorazione.

L'identità dell'agenzia entra attraverso logo e colore primario, ma non può cambiare la grammatica del prodotto. Tipografia, spaziatura, struttura, stati, colori semantici e accessibilità restano sotto il controllo di SMF Travel.

**Key Characteristics:**

- Mobile-first, leggibile all'aperto e utilizzabile con una mano.
- Due livelli distinti: prossimità suggerita e programma ufficiale.
- Scaletta numerata senza orari obbligatori.
- Materialità leggera da foglio di viaggio, con bordi e ombre misurati.
- White-label controllato e accessibile.
- Stati di rete, privacy e conferma sempre espliciti.

## Colors

La palette unisce carta calda e inchiostro profondo a un accento di percorso; il blu d'azione resta stabile per evitare che il white-label modifichi il significato dei controlli.

### Primary

- **Verde segnavia:** colore primario configurabile dell'agenzia. Identifica marca, attività selezionata, percorso e navigazione attiva.
- **Inchiostro di percorso:** versione scura derivata dal primario, usata per titoli e aree di forte contrasto.

### Secondary

- **Arancio tappa:** accento SMF usato con parsimonia per numeri, piccoli segnali e avanzamento. Non è un colore generico per call to action.
- **Blu azione:** colore funzionale stabile per confermare, aprire, scaricare e concedere un'autorizzazione.

### Neutral

- **Carta da campo:** fondo principale caldo che riduce l'abbagliamento senza simulare una texture pesante.
- **Foglio bianco:** pannelli temporanei, modali e controlli sopra la carta.
- **Inchiostro:** testo ad alta enfasi e icone essenziali.
- **Testo attenuato:** note, metadati e contenuti secondari; non usare per informazioni indispensabili.
- **Linea di matita:** divisori e bordi che organizzano senza trasformare ogni elemento in una card.

### Named Rules

**The Controlled White-Label Rule.** Il colore dell'agenzia viene normalizzato in una rampa accessibile. Se non raggiunge il contrasto WCAG richiesto, il sistema usa automaticamente una variante più scura o più chiara; non altera mai i colori semantici di azione, successo, avviso ed errore.

**The One Route Rule.** In ogni schermata una sola voce cromatica descrive il percorso o la selezione. Il colore dell'agenzia non deve riempire indiscriminatamente card, sfondi e pulsanti.

**The Meaning Beyond Color Rule.** Stato corrente, completamento, errore, offline e selezione hanno sempre anche testo, icona o forma distintiva.

## Typography

**Display Font:** Playfair Display, con Georgia come fallback.

**Body Font:** Manrope, con Arial e sans-serif come fallback.

**Character:** Playfair dà alle destinazioni e ai luoghi una voce editoriale calda; Manrope mantiene azioni, note e dati operativi immediati. La coppia non deve imitare un dépliant di lusso: il serif orienta, il sans fa agire.

### Hierarchy

- **Display:** esclusivamente titolo del giorno, destinazione e testate viaggio; massimo due righe.
- **Headline:** nomi di giornate, luoghi e sezioni principali.
- **Title:** titolo di attività, pulsanti e informazioni che richiedono scansione rapida.
- **Body:** descrizioni e note operative; preferire righe brevi su smartphone e un massimo di circa 70 caratteri su desktop.
- **Label:** stati, categorie e metadati. Il maiuscolo è ammesso solo per etichette brevi, mai per frasi o istruzioni.

### Named Rules

**The Outdoor Reading Rule.** Il contenuto essenziale del companion non scende sotto 16px; metadati e label possono essere più piccoli solo se non contengono decisioni o istruzioni.

**The Place Has a Voice Rule.** Il serif nomina luoghi e giornate. Pulsanti, campi, valutazioni e messaggi di sistema restano sempre in sans-serif.

## Layout

Il companion del viaggiatore nasce per una larghezza di 320-430px e usa una singola colonna. La testata compatta ospita logo dell'agenzia, stato di sincronizzazione e accesso al profilo. Il titolo del giorno segue immediatamente. Il contenuto adotta il modello a due livelli:

1. **Pannello di prossimità:** breve, dismissibile e separato. Occupa spazio solo quando esiste un suggerimento credibile o quando l'utente chiede di localizzarsi.
2. **Foglio di percorso:** stabile, scorrevole e numerato. Contiene tutte le attività pubblicate nell'ordine definito dall'agente.

La scaletta non deriva dall'ora. Ogni attività conserva un indice, un tipo, un titolo, eventuali note, documenti, feedback e stato. Un orario compare come metadato solo se presente nella fonte o aggiunto esplicitamente dall'agente; la sua assenza non crea segnaposto, trattini o messaggi "da confermare".

La navigazione primaria del viaggiatore è una barra inferiore persistente con un massimo di cinque destinazioni di primo livello. Deve rispettare le safe area, mostrare etichetta e icona e mantenere il contenuto raggiungibile con il pollice. Le funzioni meno frequenti vivono nel profilo o dentro la sezione pertinente, non in una seconda barra concorrente.

Su tablet il foglio può crescere fino a 720px e rimanere centrato. Su desktop, le superfici viaggiatore mantengono una misura leggibile e possono affiancare un pannello contestuale, senza dilatare la scaletta a tutta larghezza. I breakpoint sono determinati dal contenuto: 600px per il passaggio da companion compatto a foglio ampio, 900px per eventuali due colonne contestuali.

**The Order Before Time Rule.** L'ordine pubblicato è sempre visibile; l'orario non è mai usato come struttura portante.

**The Thumb-First Rule.** Azioni frequenti e navigazione primaria devono essere raggiungibili nel terzo inferiore dello smartphone o avere un equivalente vicino al contenuto interessato.

## Elevation & Depth

Il sistema è piatto per impostazione predefinita. Il foglio di percorso è definito da fondo e ritmo, non da una pila di card. Un'ombra ambientale leggera è riservata al pannello temporaneo di prossimità, alla barra inferiore quando sovrapposta al contenuto e ai dialoghi. Hover e focus possono aumentare bordo o contrasto, non sollevare ogni riga.

**The Temporary Lift Rule.** Solo gli elementi che possono apparire, scomparire o sovrapporsi ricevono elevazione. Le attività permanenti restano sul foglio.

## Shapes

I contenitori usano curve moderate: 10px per controlli, 14px per pannelli e 18px per fogli principali. Pillole complete sono riservate a stati molto brevi e selezioni compatte. Le tappe usano cerchi numerati collegati da un tratto sottile; il collegamento non deve far percepire il programma come una timeline temporale.

Icone e illustrazioni sono lineari, riconoscibili a 20-24px e coerenti nello spessore. Il logo dell'agenzia conserva le proprie proporzioni in un'area dedicata e non viene ritagliato in un cerchio per convenzione.

**The Few Containers Rule.** Prima di aggiungere un bordo arrotondato, verificare che l'elemento abbia davvero uno stato, un'azione o una gerarchia indipendente. Un divisore è spesso sufficiente.

## Components

### Buttons

- **Shape:** controllo compatto ma tattile con angoli dolci e altezza minima di 48px nel companion.
- **Primary:** blu funzionale con testo bianco; una sola azione primaria per contesto.
- **Secondary:** superficie neutra con testo blu e bordo discreto; adatto a "Non ora", annulla e azioni alternative.
- **Hover / Focus:** il desktop usa un lieve cambiamento tonale; il focus visibile usa un anello continuo ad alto contrasto. Lo stato premuto riduce appena la luminosità senza animazioni di spostamento.
- **Disabled / Busy:** includere testo comprensibile e, durante operazioni di rete, conservare la larghezza del pulsante.

### Chips

- **Style:** solo per stato breve, categoria o filtro; testo sans-serif leggibile, bordo sottile e fondo neutro.
- **State:** selezione indicata da fondo, icona e testo, non dal solo colore. Evitare di usare chip come sostituti di pulsanti complessi.

### Cards / Containers

- **Foglio di percorso:** un'unica superficie continua. Le attività sono separate da spazio e linee leggere.
- **Pannello di prossimità:** superficie rialzata e breve con luogo suggerito, motivazione implicita di prossimità e azioni "Conferma" e "Non ora".
- **Contenuto contestuale:** documenti, note e feedback restano visivamente agganciati all'attività a cui appartengono.

### Inputs / Fields

- **Style:** fondo bianco, bordo visibile, label persistente sopra il controllo; placeholder solo come esempio.
- **Focus:** anello di almeno 3px con offset e contrasto AA.
- **Error:** messaggio vicino al campo, icona e istruzione per correggere; mai soltanto un bordo rosso.
- **Touch:** altezza minima di 48px, tastiera e tipo di input coerenti col dato.

### Navigation

- **Traveler:** barra inferiore con massimo cinque voci, icona e label sempre presenti. La voce attiva usa colore dell'agenzia, indicatore di forma e peso tipografico.
- **Agent / Superadmin:** navigazione laterale su desktop e drawer su tablet stretto. La posizione corrente e il tenant attivo rimangono sempre visibili.
- **Deep links:** il pulsante Indietro riporta al contesto precedente; non usare il logo come unico modo per uscire da una schermata.

### Activity Row

È il componente firma del companion. Mostra numero d'ordine, icona del tipo, titolo, eventuale descrizione breve e contenuti pertinenti. Stati ammessi: da fare, suggerita, confermata/in corso, completata e non disponibile. L'attività può espandersi o aprire un dettaglio, ma la scaletta deve conservare posizione e ordine al ritorno.

Il feedback a stelle appartiene alla stessa attività e viene mostrato in una riga compatta, con etichetta accessibile per ogni valore. Documenti di voli e treni sono azioni di download esplicite. Note operative come autista, targa o punto d'incontro hanno priorità sulla descrizione promozionale.

### Proximity Panel

La posizione è un aiuto, non una fonte autoritativa. Il pannello appare solo dopo consenso e quando il dispositivo si trova entro una soglia ragionevole da una tappa non completata. Il testo usa linguaggio probabilistico, per esempio "Potresti essere al Registan". La visita diventa corrente solo dopo conferma del viaggiatore; "Non ora" chiude il suggerimento senza modificare il programma.

La localizzazione viene richiesta all'apertura della giornata o tramite azione "Individua", non mantiene un tracciamento continuo e non espone coordinate ad altri viaggiatori. In assenza di permesso, GPS o rete, la scaletta funziona integralmente e consente la selezione manuale. Lo stato offline resta visibile ma non allarmistico; le azioni locali mostrano chiaramente se attendono sincronizzazione.

### Feedback and Sync States

- **Saved:** conferma discreta vicino all'azione appena completata.
- **Pending sync:** icona e testo "Da sincronizzare"; il dato resta modificabile.
- **Failed:** spiegazione concreta e pulsante Riprova senza perdere l'input.
- **Empty:** descrive cosa comparirà e, se autorizzato, offre una sola azione utile.
- **Loading:** mantiene la struttura della pagina e non sostituisce l'intero schermo con uno spinner.

## Do's and Don'ts

### Do:

- **Do** mantenere sempre distinguibili il pannello temporaneo di prossimità e il programma ufficiale.
- **Do** mostrare l'ordine delle attività anche quando nessuna tappa ha un orario.
- **Do** rendere note operative, biglietti e azioni essenziali disponibili vicino alla relativa attività.
- **Do** usare il logo e il primario dell'agenzia entro il white-label controllato.
- **Do** preservare input, posizione nella pagina e stato locale durante una connessione intermittente.
- **Do** usare target tattili di almeno 44x44px, preferibilmente 48px per le azioni principali.
- **Do** progettare testi e layout per zoom al 200%, tastiera e screen reader.
- **Do** usare nel back office tabelle, filtri persistenti, azioni per riga e densità moderata per confrontare molti viaggi.

### Don't:

- **Don't** inventare orari, durate, inclusioni o stati "da confermare" quando l'informazione non esiste.
- **Don't** trasformare il tratto fra le tappe in una scala temporale o attribuirgli distanze fittizie.
- **Don't** avviare geolocalizzazione continua, cambiare automaticamente la visita corrente o nascondere la scelta manuale.
- **Don't** usare il colore dell'agenzia se compromette il contrasto o altera il significato dei colori semantici.
- **Don't** racchiudere ogni attività, nota e azione in card indipendenti.
- **Don't** usare icone senza etichetta nella navigazione primaria o per azioni irreversibili.
- **Don't** applicare il layout mobile del viaggiatore al back office: agenti e superadmin richiedono scansione orizzontale, filtri, selezione multipla e operazioni affidabili da tastiera.
- **Don't** ridurre il back office a una serie di grandi schede quando una tabella rende più chiari confronto, stato e azioni.
