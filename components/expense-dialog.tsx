"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { LoaderCircle, ReceiptText, X } from "lucide-react";

type ExpenseCurrency = "EUR" | string;

type ExpenseDialogProps = {
  open: boolean;
  dayLabel?: string;
  saving: boolean;
  localCurrency: string;
  travelers: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSave: (expense: {
    label: string;
    amount: string;
    currency: ExpenseCurrency;
    shareTravelerIds: string[];
  }) => Promise<boolean>;
};

export default function ExpenseDialog({
  open,
  dayLabel,
  saving,
  localCurrency,
  travelers,
  onClose,
  onSave
}: ExpenseDialogProps) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<ExpenseCurrency>("EUR");
  const [submitError, setSubmitError] = useState("");
  const [shareTravelerIds, setShareTravelerIds] = useState<string[]>([]);
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const savingRef = useRef(saving);

  useEffect(() => {
    onCloseRef.current = onClose;
    savingRef.current = saving;
  }, [onClose, saving]);

  useEffect(() => {
    if (!open) return;
    setLabel("");
    setAmount("");
    setCurrency("EUR");
    setSubmitError("");
    setShareTravelerIds(travelers.map((traveler) => traveler.id));
  }, [open, travelers]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !savingRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError("");
    if (shareTravelerIds.length === 0) { setSubmitError("Seleziona almeno un viaggiatore."); return; }
    if (await onSave({ label: label.trim(), amount, currency, shareTravelerIds })) onClose();
    else setSubmitError("La spesa non è stata salvata. I valori inseriti sono rimasti disponibili: riprova.");
  }

  return (
    <div
      className="expenseDialogBackdrop"
      role="presentation"
      onMouseDown={() => {
        if (!saving) onClose();
      }}
    >
      <section
        className="expenseDialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="expense-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span><ReceiptText size={20}/></span>
          <div>
            <small>{dayLabel ? `SPESA DELLA TAPPA · ${dayLabel}` : "NUOVA SPESA"}</small>
            <h2 id="expense-dialog-title">Aggiungi spesa</h2>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Chiudi">
            <X size={20}/>
          </button>
        </header>

        <form onSubmit={submit}>
          <label className="expenseField" htmlFor="expense-description">
            <span>Descrizione</span>
            <input
              id="expense-description"
              autoFocus
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={200}
              placeholder="Es. cena, taxi, souvenir"
              autoComplete="off"
              required
            />
          </label>

          <fieldset className="expenseShareChoice">
            <legend>Dividi la spesa tra</legend>
            <p>L’importo viene ripartito in parti uguali. Puoi escludere chi non ha partecipato.</p>
            <div>{travelers.map((traveler) => <label key={traveler.id}>
              <input type="checkbox" checked={shareTravelerIds.includes(traveler.id)} onChange={(event) => setShareTravelerIds((current) => event.target.checked ? [...current, traveler.id] : current.filter((id) => id !== traveler.id))}/>
              <span>{traveler.name}</span>
            </label>)}</div>
          </fieldset>

          <fieldset className="currencyChoice">
            <legend>Valuta</legend>
            <label className={currency === "EUR" ? "selected" : ""}>
              <input
                type="radio"
                name="expense-currency"
                value="EUR"
                checked={currency === "EUR"}
                onChange={() => setCurrency("EUR")}
              />
              <span aria-hidden="true"/>
              <b>Euro</b>
              <small>EUR · €</small>
            </label>
            <label className={currency === localCurrency ? "selected" : ""}>
              <input
                type="radio"
                name="expense-currency"
                value={localCurrency}
                checked={currency === localCurrency}
                onChange={() => setCurrency(localCurrency)}
              />
              <span aria-hidden="true"/>
              <b>Valuta locale</b>
              <small>{localCurrency}</small>
            </label>
          </fieldset>

          <label className="expenseField" htmlFor="expense-amount">
            <span>Importo in {currency === "EUR" ? "euro" : localCurrency}</span>
            <div className="expenseAmount">
              <b>{currency === "EUR" ? "€" : localCurrency}</b>
              <input
                id="expense-amount"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder={currency === "EUR" ? "0,00" : "0"}
                required
              />
            </div>
          </label>

          {submitError && <p className="cashDialogError" role="alert">{submitError}</p>}
          <button className="expenseSubmit" type="submit" disabled={saving || !label.trim() || !amount.trim() || shareTravelerIds.length === 0}>
            {saving
              ? <><LoaderCircle className="spin" size={18}/> Salvataggio…</>
              : "Salva spesa"
            }
          </button>
          <span className="srStatus" role="status" aria-live="polite">
            {saving ? "Salvataggio della spesa in corso" : ""}
          </span>
        </form>
      </section>
    </div>
  );
}
