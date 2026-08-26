# Audit accessibilità AgID - frontend SMF Travel

Data verifica: 26 agosto 2026  
Ambito: login, pannello superadmin, pannello agenzia, esperienza viaggiatore e pagina pubblica di assistenza.

## Riferimenti ufficiali

- AgID, Linee guida sull'accessibilità degli strumenti informatici - soggetti privati (11 giugno 2024)
- AgID, Linee guida sull'accessibilità dei servizi, D.Lgs. 82/2022 - European Accessibility Act (11 marzo 2026)
- Designers Italia, Linee guida di design per i servizi digitali: accessibilità, privacy, semplicità, monitoraggio e interfacce coerenti
- EN 301 549 e criteri WCAG di livello A e AA richiamati dalle linee guida

## Applicabilità

SMF Travel è un prodotto privato B2B2C, non un sito della Pubblica Amministrazione. Alcune funzioni possono rientrare nel perimetro dei servizi digitali relativi al trasporto passeggeri o al commercio elettronico quando il prodotto viene usato per erogarli. Questo audit applica i requisiti tecnici pertinenti, ma non sostituisce la valutazione legale del servizio commercializzato né una dichiarazione formale di conformità.

## Matrice di intervento

| Area | Presidio implementato | Verifica |
| --- | --- | --- |
| Navigazione da tastiera | Skip link nei tre ambienti, focus visibile, modali con chiusura Escape, focus contenuto | Build e ispezione semantica |
| Struttura | Landmark, titoli gerarchici, navigazioni nominate, stato corrente non espresso solo dal colore | Ispezione DOM accessibile |
| Moduli | Label associate, errori con `role=alert`, `aria-invalid` e descrizione dell'errore nel login | Ispezione DOM accessibile |
| Contrasto | Palette AA, modalità `prefers-contrast: more`, supporto Windows Forced Colors | Verifica CSS e visiva |
| Ingrandimento e reflow | Layout fluido, wrapping, viewport mobile senza scorrimento orizzontale | 320 px e 390 px |
| Target tattili | Altezza minima di 44 px su dispositivi a puntatore grossolano | Verifica CSS |
| Movimento | Animazioni disattivate con `prefers-reduced-motion` | Verifica CSS |
| Assistenza | Pagina pubblica `/accessibilita`, raggiungibile da login, superadmin, agenzia e viaggiatore | Navigazione browser |
| Trasparenza | Stato dichiarato come verifica continua, senza affermare una certificazione non svolta | Revisione contenuti |

## Verifiche ancora necessarie prima di una dichiarazione formale

1. Test manuale completo con NVDA + Chrome/Firefox e VoiceOver + Safari.
2. Test automatizzato WCAG su tutte le pagine con dati reali e per ciascun ruolo.
3. Verifica contrasto dei colori configurabili da ogni agenzia e fallback automatico del testo.
4. Prova con zoom browser al 200% e 400% sui flussi completi, non solo sulle pagine campione.
5. Definizione del titolare del canale di feedback, recapito verificato e tempi di risposta.
6. Valutazione legale dell'applicabilità EAA e, se richiesta, redazione della dichiarazione prevista per il servizio.

Esito tecnico del refactoring: **allineamento sostanziale impostato; certificazione formale non dichiarata**.
