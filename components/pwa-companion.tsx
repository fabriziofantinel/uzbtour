"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Bell, Download, RefreshCw, Share, X } from "lucide-react";
import { flushOfflineQueue } from "@/lib/pwa/offline-queue";

type InstallPromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type SyncState = "idle" | "pending" | "complete" | "failed";

function isIos() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }
function isAndroid() { return /android/i.test(navigator.userAgent); }
function isStandalone() { return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true; }
function decodeVapidKey(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

export default function PwaCompanion() {
  const pathname = usePathname();
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [showAndroidGuide, setShowAndroidGuide] = useState(false);
  const [updateReady, setUpdateReady] = useState<ServiceWorker | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [pushAvailable, setPushAvailable] = useState(false);

  useEffect(() => {
    if (!pathname.startsWith("/viaggio")) return;
    const onPrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    const onSync = (event: Event) => setSyncState(((event as CustomEvent).detail?.state || "idle") as SyncState);
    const onOnline = () => void flushOfflineQueue();
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("smf:sync-state", onSync);
    window.addEventListener("online", onOnline);
    const standalone = isStandalone();
    setShowIos(isIos() && !standalone && sessionStorage.getItem("smf-install-dismissed") !== "1");
    const guideTimer = window.setTimeout(() => {
      if (isAndroid() && !standalone) setShowAndroidGuide(true);
    }, 1800);
    setPushAvailable("Notification" in window && "PushManager" in window && Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY));
    void flushOfflineQueue();
    navigator.serviceWorker?.ready.then((registration) => {
      if (registration.waiting) setUpdateReady(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => { if (worker.state === "installed" && navigator.serviceWorker.controller) setUpdateReady(worker); });
      });
    });
    const onController = () => window.location.reload();
    navigator.serviceWorker?.addEventListener("controllerchange", onController);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("smf:sync-state", onSync);
      window.removeEventListener("online", onOnline);
      navigator.serviceWorker?.removeEventListener("controllerchange", onController);
      window.clearTimeout(guideTimer);
    };
  }, [pathname]);

  if (!pathname.startsWith("/viaggio")) return null;
  const showInstallBanner = Boolean(installPrompt || showIos || showAndroidGuide);

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstallPrompt(null);
  }

  async function enablePush() {
    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!key || Notification.permission === "denied") return;
    if (await Notification.requestPermission() !== "granted") return;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(key) });
    await fetch("/api/traveler/push-subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription.toJSON()) });
    setPushAvailable(false);
  }

  return <>
    {showInstallBanner && <aside className="pwaInstallBanner" aria-label="Installa l’app del viaggio">
      <Download aria-hidden="true"/><div><strong>Porta il viaggio sempre con te</strong><span>{showIos ? <>Tocca <Share aria-label="Condividi"/> e poi “Aggiungi alla schermata Home”.</> : showAndroidGuide && !installPrompt ? <>In Chrome apri il menu <b>⋮</b> e scegli “Installa app” o “Aggiungi a schermata Home”.</> : "Installa l’app per usare programma e documenti anche offline."}</span></div>
      {installPrompt && <button type="button" onClick={() => void install()}>Installa</button>}
      <button type="button" className="pwaDismiss" aria-label="Chiudi suggerimento" onClick={() => { setShowIos(false); setShowAndroidGuide(false); setInstallPrompt(null); sessionStorage.setItem("smf-install-dismissed", "1"); }}><X/></button>
    </aside>}
    {updateReady && <aside className="pwaUpdateToast" role="status"><RefreshCw/><span><strong>Aggiornamento disponibile</strong><small>Ricarica per applicare la nuova versione.</small></span><button type="button" onClick={() => updateReady.postMessage({ type: "SKIP_WAITING" })}>Ricarica</button></aside>}
    {syncState !== "idle" && !(showInstallBanner && syncState === "complete") && <div className={`pwaSyncToast ${syncState}`} role="status">{syncState === "pending" ? "Modifiche salvate: sincronizzazione in attesa" : syncState === "complete" ? "Sincronizzazione completata" : "Alcune modifiche richiedono un nuovo tentativo"}</div>}
    {pushAvailable && <button className="pwaPushButton" type="button" onClick={() => void enablePush()}><Bell/> Attiva avvisi di viaggio</button>}
  </>;
}
