"use client";

import { AlertTriangle, Check } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

type ConfirmationOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: "default" | "danger";
};

type PendingConfirmation = ConfirmationOptions & {
  resolve: (confirmed: boolean) => void;
};

export function useAppConfirm() {
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const close = useCallback((confirmed: boolean) => {
    setPending((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }, []);

  const confirm = useCallback(
    (options: ConfirmationOptions) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...options, resolve });
      }),
    [],
  );

  useEffect(() => {
    if (!pending) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const getFocusableElements = () => {
      const root = dialogRef.current;
      if (!root) return [] as HTMLElement[];
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close(false);
        return;
      }
      if (event.key !== "Tab") return;

      const list = getFocusableElements();
      if (!list.length) return;
      const active = document.activeElement;
      const activeIndex = list.indexOf(active instanceof HTMLElement ? active : list[0]);
      if (event.shiftKey && (active === list[0] || activeIndex === -1)) {
        event.preventDefault();
        list[list.length - 1].focus();
        return;
      }
      if (!event.shiftKey && (active === list[list.length - 1] || activeIndex === -1)) {
        event.preventDefault();
        list[0].focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    const focusables = getFocusableElements();
    (focusables[0] || confirmButtonRef.current)?.focus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [close, pending]);

  const dialog =
    pending && typeof document !== "undefined"
      ? createPortal(
          <div className="appDecisionOverlay" onMouseDown={() => close(false)}>
            <section
              className="appDecisionDialog"
              ref={dialogRef}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
              tabIndex={-1}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <span className={`appDecisionIcon ${pending.tone === "danger" ? "danger" : ""}`} aria-hidden="true">
                {pending.tone === "danger" ? <AlertTriangle /> : <Check />}
              </span>
              <h2 id={titleId}>{pending.title}</h2>
              <p id={descriptionId}>{pending.message}</p>
              <div className="appDecisionActions">
                <button type="button" className="secondary" onClick={() => close(false)}>
                  Annulla
                </button>
                <button
                  ref={confirmButtonRef}
                  type="button"
                  className={pending.tone === "danger" ? "danger" : ""}
                  onClick={() => close(true)}
                >
                  {pending.confirmLabel || "Conferma"}
                </button>
              </div>
            </section>
          </div>,
          document.body,
        )
      : null;

  return { confirm, dialog };
}
