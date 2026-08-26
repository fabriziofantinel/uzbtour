# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Gli agenti di viaggio lavorano soprattutto da desktop o tablet. Trasformano un preventivo accettato in un viaggio digitale, revisionano l'interpretazione del programma, configurano partenze, famiglie e viaggiatori e aggiornano il programma pubblicato.
- I viaggiatori usano soprattutto lo smartphone durante la vacanza, anche con una connessione debole. Consultano itinerario e documenti, registrano spese e ricordi, lasciano feedback e partecipano a quiz, giochi, missioni e contest.
- I superadmin amministrano agenzie e utenti, controllano lo stato complessivo della piattaforma e possono impersonare gli utenti per assistenza e verifica.

Agente e viaggiatore hanno pari priorità di prodotto, ma richiedono interfacce coordinate e ottimizzate per contesti differenti.

## Product Purpose

SMF Travel trasforma il preventivo di viaggio già accettato dal cliente in un'applicazione completa per la gestione e l'esperienza della vacanza. L'agenzia importa il documento, controlla il programma interpretato e pubblica un viaggio che i partecipanti possono usare prima, durante e dopo la partenza.

Il prodotto ha successo quando l'agente riesce a creare e mantenere un viaggio con poco lavoro manuale e il viaggiatore trova rapidamente ciò che gli serve dallo smartphone senza dipendere da documenti e messaggi dispersi.

## Positioning

Il meccanismo distintivo è la trasformazione assistita dall'AI del preventivo accettato in un'esperienza di viaggio strutturata e modificabile, arricchita con contenuti riutilizzabili per paese, località e sito. All'interno della stessa partenza, le famiglie condividono l'itinerario ma mantengono separati spese, ricordi, risultati, classifiche e contest fotografici.

## Operating Context

1. L'agenzia prepara e fa accettare il preventivo fuori dalla piattaforma.
2. L'agente importa il preventivo PDF o Word.
3. La piattaforma normalizza il documento, estrae viaggio, giornate, località, visite, hotel, pasti e trasferimenti e genera i contenuti mancanti.
4. L'agente revisiona gli elementi incerti, corregge il programma e pubblica il viaggio.
5. L'agente configura partenze, famiglie e viaggiatori e allega gli eventuali documenti di viaggio.
6. I viaggiatori consultano il viaggio e inseriscono dati privati della propria famiglia durante la vacanza.
7. Il superadmin gestisce le agenzie e può verificare l'esperienza impersonando un utente.

## Capabilities and Constraints

- Applicazione web multitenant basata su Next.js e React, pubblicata su Vercel.
- Neon Postgres conserva dati di piattaforma, cataloghi, viaggi, famiglie, attività e interazioni.
- Cloudflare R2 conserva documenti e fotografie private.
- AWS SQS e Lambda gestiscono le elaborazioni asincrone; Amazon Bedrock interpreta e arricchisce i programmi.
- Ogni agenzia possiede viaggi, agenti e configurazione del proprio marchio.
- Il programma appartiene al viaggio e può essere condiviso da più partenze; i dati personali e ludici sono isolati per famiglia.
- Il back-office deve privilegiare efficienza, confronto tra molti record e operazioni affidabili da desktop e tablet.
- L'esperienza viaggiatore deve essere progettata prima di tutto per smartphone, funzionare con rete debole e rendere immediatamente accessibili programma, documenti e azioni del giorno.
- Il prodotto usa contenuti reali importati e generati; non deve inventare orari, inclusioni o dettagli operativi assenti dal preventivo.

## Brand Commitments

- SMF Travel è il marchio della piattaforma e resta visibile nelle superfici amministrative centrali.
- L'esperienza dell'agenzia e del viaggiatore deve supportare il white-label: logo, colori e identità visiva dipendono dall'agenzia proprietaria del viaggio.
- Il marchio dell'agenzia non deve compromettere leggibilità, accessibilità o coerenza funzionale della piattaforma.
- La voce deve essere chiara, rassicurante e concreta; nel back-office è operativa, nell'esperienza di viaggio è più calda e coinvolgente.

## Evidence on Hand

- Il repository contiene flussi funzionanti per superadmin, agenzia e viaggiatore.
- È presente un viaggio Uzbekistan completo usato come caso reale e riferimento funzionale.
- Sono disponibili modelli di preventivo in `docs/templates/` e `public/templates/`.
- L'icona attuale è `public/app-icon.svg`.
- Non sono ancora disponibili loghi reali, manuali di identità o palette delle agenzie; il redesign deve prevedere configurazioni e fallback senza inventare marchi cliente.

## Product Principles

1. Un'unica fonte di verità: il programma pubblicato dall'agenzia deve essere chiaro e affidabile per tutti.
2. Due contesti, una piattaforma: back-office e companion mobile condividono logica e qualità, senza forzare lo stesso layout.
3. AI sotto controllo umano: automazione veloce, incertezze visibili e revisione semplice prima della pubblicazione.
4. Il viaggio al centro: oggi, prossima attività, documenti e azioni importanti devono essere raggiungibili senza cercare.
5. Privacy per famiglia: contenuti condivisi e dati privati devono essere sempre distinguibili e correttamente isolati.

## Accessibility & Inclusion

- Obiettivo minimo WCAG 2.2 AA.
- Target tattili adatti all'uso in movimento, testi leggibili alla luce esterna e navigazione completa da tastiera nel back-office.
- I colori configurati dall'agenzia devono essere corretti automaticamente quando non garantiscono contrasto sufficiente.
- Stati, errori e avanzamento delle elaborazioni non devono dipendere soltanto dal colore.
- L'esperienza viaggiatore deve tollerare ingrandimento del testo, schermi piccoli e connessione intermittente.
