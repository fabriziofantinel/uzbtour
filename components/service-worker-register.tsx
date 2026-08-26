"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // L'app resta pienamente utilizzabile online anche se il browser rifiuta il service worker.
    });
  }, []);

  return null;
}
