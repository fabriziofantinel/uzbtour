"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Download, Share2, Smartphone, Wifi, WifiOff } from "lucide-react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches
    || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

export default function PwaInstaller() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [online, setOnline] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());
    setOnline(navigator.onLine);
    setIsIos(/iPad|iPhone|iPod/.test(navigator.userAgent));

    const handlePrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener("beforeinstallprompt", handlePrompt);
    window.addEventListener("appinstalled", handleInstalled);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js")
        .then(() => navigator.serviceWorker.ready)
        .then(() => setOfflineReady(true))
        .catch(() => setOfflineReady(false));
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handlePrompt);
      window.removeEventListener("appinstalled", handleInstalled);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  async function install() {
    if (!promptEvent) {
      setShowHelp(true);
      return;
    }
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setPromptEvent(null);
  }

  return (
    <section className="pwaCard" aria-label="Installa l'app del viaggio">
      <div className="pwaCardIcon">{installed ? <CheckCircle2 size={23}/> : <Smartphone size={23}/>}</div>
      <div className="pwaCardCopy">
        <small>APP DEL VIAGGIO</small>
        <h3>{installed ? "UZB Tour è installata" : "Porta UZB Tour sul telefono"}</h3>
        <p>{installed ? "Si apre come un’app e conserva un promemoria offline con programma e contatti." : "Installala sulla schermata Home per aprirla a tutto schermo e avere le informazioni essenziali anche offline."}</p>
        <div className="pwaStatus">
          <span className={online ? "ready" : "offline"}>{online ? <Wifi size={13}/> : <WifiOff size={13}/>} {online ? "Online" : "Offline"}</span>
          {offlineReady && <span className="ready"><CheckCircle2 size={13}/> Promemoria offline pronto</span>}
        </div>
        {showHelp && !installed && (
          <p className="pwaHelp">
            {isIos
              ? <><Share2 size={14}/> In Safari tocca Condividi e poi “Aggiungi alla schermata Home”.</>
              : <>Apri il menu del browser e scegli “Installa app” oppure “Aggiungi a schermata Home”.</>
            }
          </p>
        )}
      </div>
      {!installed && <button type="button" onClick={() => void install()}><Download size={17}/> Installa app</button>}
    </section>
  );
}
