"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "FLUSH_OFFLINE_QUEUE")
        void import("@/lib/pwa/offline-queue").then(({ flushOfflineQueue }) => flushOfflineQueue());
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {
        // L'app resta pienamente utilizzabile online anche se il browser rifiuta il service worker.
      });
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  return null;
}
