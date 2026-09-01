# Casi d'uso - Conversione AI del preventivo

## UC-AI-IMP-01 - Estrazione completa con fonti

Caricare un preventivo testuale con testata, date, cliente, quotazione, inclusioni, condizioni, giornate, visite e hotel. La revisione deve mostrare tutti i dati, almeno una citazione per i campi principali e l'affidabilità della citazione. Nessun valore assente dal documento può essere inventato.

## UC-AI-IMP-02 - Sezioni commerciali esterne all'itinerario

Caricare un preventivo in cui prezzi, valuta, servizi e condizioni si trovano dopo il programma. Verificare che il passaggio specializzato li estragga senza eliminare valori validi già individuati dal passaggio principale.

## UC-AI-IMP-03 - Hotel in tabella separata e più pernottamenti

Caricare un preventivo con sistemazioni in una tabella separata, incluse due sistemazioni nella stessa giornata. Verificare associazione per data e città, conservazione dei pernottamenti multipli e segnalazione delle associazioni dubbie.

## UC-AI-IMP-04 - Controlli deterministici

Usare un documento con date invertite, numerazione giorni errata, attività duplicate, hotel senza città, totale partecipanti incoerente e prezzi senza valuta. Tutte le anomalie previste devono essere visibili; quelle bloccanti impediscono la pubblicazione.

## UC-AI-IMP-05 - Risoluzione assistita delle anomalie

Correggere un dato segnalato, marcare l'anomalia come risolta e salvare. Dopo la riapertura, la risoluzione deve essere conservata. La pubblicazione diventa disponibile solo quando non restano anomalie bloccanti e anagrafiche da validare.

## UC-AI-IMP-06 - Confronto con la fonte

Aprire “Mostra le fonti estratte dal preventivo”. Verificare percorso del campo, pagina quando disponibile, testo sorgente e percentuale di affidabilità. Testi lunghi devono andare a capo senza causare scorrimento orizzontale su mobile.

## UC-AI-IMP-07 - Correzione selettiva senza perdita dati

Modificare manualmente un campo commerciale e una giornata, salvare e riaprire. I dati non modificati e le evidenze devono restare invariati; la correzione non deve rilanciare l'intera conversione.

## UC-AI-IMP-08 - Regressione multi-formato e multi-paese

Eseguire lo stesso controllo su PDF nativo, DOCX, immagine/OCR e testo per almeno Belgio, Norvegia, Cile e un itinerario multi-paese. Misurare completezza dei campi attesi, valori inventati, anomalie corrette e token consumati dai singoli passaggi.
