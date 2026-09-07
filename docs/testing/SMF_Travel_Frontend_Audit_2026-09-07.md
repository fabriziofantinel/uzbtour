# SMF Travel - Audit tecnico frontend

Data: 7 settembre 2026  
Perimetro: frontend Next.js, superfici agenzia, superuser, personale operativo e viaggiatore.  
Metodo: gate qualità, build di produzione, test Playwright pubblici, detector Impeccable 4.2.2 e ispezione statica dei fogli di stile. Il collaudo autenticato su dispositivi reali resta separato.

## Esito sintetico

| Dimensione | Punteggio | Evidenza principale |
| --- | ---: | --- |
| Accessibilità | 3/4 | Safe area, focus e riduzione movimento presenti; manca una scansione browser autenticata WCAG/axe completa. |
| Prestazioni | 3/4 | Build di produzione e flussi PWA superati; i fogli CSS principali restano molto estesi e richiedono monitoraggio su dispositivi reali. |
| Responsive | 3/4 | Viewport mobile, safe area, overscroll e Playwright pubblico verificati; iOS Safari, Android Fold chiuso e zoom 200% richiedono UAT. |
| Theming | 2/4 | Branding agenzia e regola del testo scuro sono implementati, ma rimangono numerosi colori e misure letterali fuori dai token documentati. |
| Integrità implementativa | 3/4 | Sistema visivo specifico e coerente; il detector segnala un solo anti-pattern effettivo. |
| **Totale** | **14/20** | **Buono: rifinire i punti deboli prima del go-live.** |

Nessuna anomalia P0 è stata rilevata. Stato rilievi: 2 P1, 3 P2 e 1 P3.

## Verdetto di integrità

Superato con riserva. Il frontend esprime un sistema riconoscibile e specifico per SMF Travel: companion mobile white-label, navigazione operativa separata e stati offline espliciti. Il detector Impeccable trova un solo anti-pattern conteggiato. La riserva riguarda la dispersione di valori CSS letterali, che rende più difficile garantire nel tempo contrasto e coerenza per colori agenzia arbitrari.

## Rilievi prioritari

### P1 - Collaudo autenticato multi-dispositivo non ancora registrato

- Categoria: Responsive e accessibilità.
- Localizzazione: superfici protette di responsabile, agente, accompagnatore, guida e viaggiatore.
- Impatto: overflow, perdita del contesto di navigazione o target tattili insufficienti possono emergere solo con dati reali e menu completi.
- Standard: WCAG 2.2 AA, reflow 1.4.10, target size 2.5.8.
- Raccomandazione: eseguire la guida UAT su desktop, Android Chrome/Fold chiuso, iOS Safari e zoom 200%, registrando screenshot ed esito per ruolo.
- Comando suggerito: `$impeccable adapt`.

### P1 - Token di colore e tipografia applicati in modo non uniforme

- Categoria: Theming e accessibilità.
- Localizzazione: in particolare `app/smf-2026.css`, `app/tour.css`, `app/admin/*.css` e `app/accessibilita/accessibilita.css`.
- Impatto: un colore agenzia chiaro può ridurre la leggibilità; modifiche locali possono reintrodurre testo o icone non conformi alla regola del testo scuro.
- Standard: WCAG 2.2 AA, contrasto 1.4.3 e uso del colore 1.4.1.
- Raccomandazione: ricondurre progressivamente i valori ricorrenti ai token approvati, mantenendo separati colori semantici e branding.
- Comando suggerito: `$impeccable colorize`.

### P2 - Nessuna scansione WCAG browser autenticata ripetibile

- Categoria: Accessibilità.
- Localizzazione: suite E2E.
- Impatto: label accessibili, gerarchia titoli, dialoghi e focus nelle pagine protette non hanno una prova automatica completa.
- Raccomandazione: predisporre una suite axe disattivata per impostazione predefinita e avviabile manualmente con account E2E dedicati.
- Comando suggerito: `$impeccable audit`.

### P2 - Fogli di stile centrali molto estesi

- Categoria: Prestazioni e integrità implementativa.
- Localizzazione: `app/smf-2026.css`, `app/tour.css`, `app/challenges.css`.
- Impatto: aumenta il rischio di collisioni tra superfici, regressioni responsive e regole duplicate.
- Raccomandazione: estrarre per superficie i blocchi stabilizzati e condividere soltanto token e primitive verificati.
- Comando suggerito: `$impeccable extract`.

### P2 - Evidenza reale iOS e Fold mancante

- Categoria: Responsive.
- Localizzazione: PWA standalone, navigazione inferiore, modali foto, menu e liste.
- Impatto: viewport dinamico, tastiera, safe area e cambio geometria Fold non sono dimostrati dal solo test desktop emulato.
- Raccomandazione: eseguire un passaggio completo installato e browser sui due dispositivi, incluso offline e ripristino della pagina corrente.
- Comando suggerito: `$impeccable adapt`.

### P3 - Bordo laterale decorativo non conforme al sistema

- Categoria: Integrità implementativa.
- Localizzazione: `app/agenzia/viaggi/[id]/comunicazioni/communications.css`, regola attorno alla linea 193.
- Impatto: lieve incoerenza visiva rispetto ai contenitori neutri dell'applicazione.
- Evidenza: detector Impeccable `[side-tab] border-left: 6px solid #789`.
- Raccomandazione: sostituire il bordo spesso con un bordo uniforme o un accento più sottile basato sui token nel prossimo changeset frontend autorizzato, aggiornando contestualmente la baseline.
- Comando suggerito: `$impeccable polish`.

## Aspetti positivi da preservare

- `viewport-fit=cover`, safe area iOS e padding della barra inferiore sono presenti.
- La modalità riduzione movimento ha regole dedicate.
- Il tap usa `touch-action: manipulation` e l'overscroll è controllato.
- Installabilità PWA, cache offline e sincronizzazione finanziaria idempotente hanno test verdi.
- La regola di prodotto evita testo bianco sui colori configurabili dell'agenzia.
- Il detector non rileva pattern sistemici bloccanti: un solo finding effettivo su app e componenti.

## Sequenza raccomandata

1. **P1 - `$impeccable adapt`**: UAT autenticata su iOS, Android Fold, desktop e zoom 200%.
2. **P1 - `$impeccable colorize`**: consolidamento dei token white-label e del contrasto.
3. **P2 - `$impeccable audit`**: scansione WCAG manualmente attivabile sulle pagine protette.
4. **P2 - `$impeccable extract`**: riduzione del drift nei fogli CSS principali.
5. **P3 - `$impeccable polish`**: chiusura delle incoerenze isolate.

Rieseguire `$impeccable audit` dopo le correzioni per misurare il miglioramento del punteggio.
