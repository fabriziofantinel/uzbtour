"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowRightLeft, Banknote, LoaderCircle, X } from "lucide-react";

type CashMovementKind = "withdrawal" | "exchange";

type CashMovementDialogProps = {
  kind: CashMovementKind | null;
  dayLabel: string;
  localCurrency: string;
  saving: boolean;
  onClose: () => void;
  onSave: (movement: { localAmount: string; euroAmount: string }) => Promise<boolean>;
};

const wholeNumber = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });

function parsedAmount(value: string) {
  const parsed = Number(value.trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export default function CashMovementDialog({
  kind,
  dayLabel,
  localCurrency,
  saving,
  onClose,
  onSave,
}: CashMovementDialogProps) {
  const [localAmount, setLocalAmount] = useState("");
  const [euroAmount, setEuroAmount] = useState("");
  const [submitError, setSubmitError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const savingRef = useRef(saving);
  const localValue = parsedAmount(localAmount);
  const euroValue = parsedAmount(euroAmount);
  const rate = localValue && euroValue ? localValue / euroValue : null;

  useEffect(() => {
    onCloseRef.current = onClose;
    savingRef.current = saving;
  }, [onClose, saving]);

  useEffect(() => {
    if (!kind) return;
    setLocalAmount("");
    setEuroAmount("");
    setSubmitError("");
  }, [kind]);

  useEffect(() => {
    if (!kind) return;
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
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
  }, [kind]);

  if (!kind) return null;
  const isWithdrawal = kind === "withdrawal";
  const title = isWithdrawal ? "Aggiungi prelievo" : "Aggiungi cambio";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError("");
    if (!localValue || !euroValue) {
      setSubmitError("Inserisci entrambi gli importi con un valore maggiore di zero.");
      return;
    }
    if (await onSave({ localAmount, euroAmount })) onClose();
    else setSubmitError("Il movimento non è stato salvato. I valori inseriti sono rimasti disponibili: riprova.");
  }

  return <div className="expenseDialogBackdrop" role="presentation" onMouseDown={() => { if (!saving) onClose(); }}>
    <section
      className="expenseDialog cashMovementDialog"
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cash-dialog-title"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <header>
        <span>{isWithdrawal ? <Banknote/> : <ArrowRightLeft/>}</span>
        <div><small>GIORNO {dayLabel}</small><h2 id="cash-dialog-title">{title}</h2></div>
        <button type="button" onClick={onClose} disabled={saving} aria-label={`Chiudi ${title.toLocaleLowerCase("it")}`}><X/></button>
      </header>
      <form onSubmit={submit} noValidate>
        <p className="cashDialogIntro">{isWithdrawal
          ? "Indica quanto hai ricevuto dal bancomat e quanto è stato addebitato sul conto."
          : "Indica quanti contanti locali hai ricevuto e quanti euro hai consegnato."
        }</p>
        <label className="expenseField" htmlFor="cash-local-amount">
          <span>{isWithdrawal ? "Importo prelevato" : "Importo ricevuto"}</span>
          <div className="expenseAmount"><b>{localCurrency}</b><input id="cash-local-amount" autoFocus inputMode="decimal" autoComplete="off" value={localAmount} onChange={(event) => setLocalAmount(event.target.value)} placeholder="0" aria-describedby="cash-rate-preview" required/></div>
        </label>
        <label className="expenseField" htmlFor="cash-euro-amount">
          <span>{isWithdrawal ? "Importo addebitato" : "Euro cambiati"}</span>
          <div className="expenseAmount"><b>€</b><input id="cash-euro-amount" inputMode="decimal" autoComplete="off" value={euroAmount} onChange={(event) => setEuroAmount(event.target.value)} placeholder="0,00" aria-describedby="cash-rate-preview" required/></div>
        </label>
        <div id="cash-rate-preview" className={`cashRatePreview${rate ? " ready" : ""}`} aria-live="polite">
          <ArrowRightLeft/>
          <span><small>CAMBIO APPLICATO</small><strong>{rate ? `1 € = ${wholeNumber.format(rate)} ${localCurrency}` : "Inserisci i due importi"}</strong></span>
        </div>
        {submitError && <p className="cashDialogError" role="alert">{submitError}</p>}
        <button className="expenseSubmit" type="submit" disabled={saving || !localValue || !euroValue}>{saving ? <><LoaderCircle className="spin"/> Salvataggio…</> : `Salva ${isWithdrawal ? "prelievo" : "cambio"}`}</button>
      </form>
    </section>
  </div>;
}
