"use client";

import { FormEvent, useEffect, useState } from "react";
import { LoaderCircle, ReceiptText, X } from "lucide-react";

type ExpenseCurrency = "EUR" | "UZS";

type ExpenseDialogProps = {
  open: boolean;
  dayLabel?: string;
  saving: boolean;
  onClose: () => void;
  onSave: (expense: {
    label: string;
    amount: string;
    currency: ExpenseCurrency;
  }) => Promise<boolean>;
};

export default function ExpenseDialog({
  open,
  dayLabel,
  saving,
  onClose,
  onSave
}: ExpenseDialogProps) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<ExpenseCurrency>("EUR");

  useEffect(() => {
    if (!open) return;
    setLabel("");
    setAmount("");
    setCurrency("EUR");
  }, [open]);

  if (!open) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await onSave({ label, amount, currency })) onClose();
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
          <label className="expenseField">
            <span>Descrizione</span>
            <input
              autoFocus
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={200}
              placeholder="Es. cena, taxi, souvenir"
              required
            />
          </label>

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
            <label className={currency === "UZS" ? "selected" : ""}>
              <input
                type="radio"
                name="expense-currency"
                value="UZS"
                checked={currency === "UZS"}
                onChange={() => setCurrency("UZS")}
              />
              <span aria-hidden="true"/>
              <b>Som</b>
              <small>UZS</small>
            </label>
          </fieldset>

          <label className="expenseField">
            <span>Importo in {currency === "EUR" ? "euro" : "som"}</span>
            <div className="expenseAmount">
              <b>{currency === "EUR" ? "€" : "UZS"}</b>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder={currency === "EUR" ? "0,00" : "0"}
                required
              />
            </div>
          </label>

          <button className="expenseSubmit" type="submit" disabled={saving}>
            {saving
              ? <><LoaderCircle className="spin" size={18}/> Salvataggio…</>
              : "Salva spesa"
            }
          </button>
        </form>
      </section>
    </div>
  );
}
