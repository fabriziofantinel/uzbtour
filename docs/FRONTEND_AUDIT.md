# Audit frontend SMF Travel

Il gate assegna 20 punti, quattro per ciascuna area: design system, accessibilità, responsive, prestazioni e qualità d’implementazione.

Esecuzione:

```powershell
node scripts/audit-frontend.mjs
npm run build
```

Il punteggio è valido solo se entrambe le operazioni terminano senza errori e la verifica browser conferma, a 1440, 390 e 320 pixel, assenza di overflow orizzontale, target tattili da almeno 44 pixel, dialoghi utilizzabili da tastiera e assenza di errori in console.

Il gate controlla anche che colori e tipografia passino dai token, che le sezioni pesanti siano caricate su richiesta, che le liste lunghe usino rendering progressivo e che le immagini non provochino salti di layout.
