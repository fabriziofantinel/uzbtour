"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import { Minus, Plus, Scan } from "lucide-react";

export type TripMapDay = {
  index: number;
  n: number;
  date: string;
  city: string;
  title: string;
  lat: number;
  lon: number;
  color: string;
};

type TripOverviewMapProps = {
  days: TripMapDay[];
  routeColor: string;
  onSelect: (index: number) => void;
};

function markerOffsets(days: TripMapDay[]) {
  const groups = new Map<string, TripMapDay[]>();
  for (const day of days) {
    const key = `${day.lat.toFixed(5)}:${day.lon.toFixed(5)}`;
    groups.set(key, [...(groups.get(key) || []), day]);
  }
  const offsets = new Map<number, [number, number]>();
  for (const group of groups.values()) {
    if (group.length === 1) {
      offsets.set(group[0].index, [0, 0]);
      continue;
    }
    group.forEach((day, index) => {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / group.length;
      const radius = group.length > 5 ? 38 : 30;
      offsets.set(day.index, [Math.round(Math.cos(angle) * radius), Math.round(Math.sin(angle) * radius)]);
    });
  }
  return offsets;
}

export default function TripOverviewMap({ days, routeColor, onSelect }: TripOverviewMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let disposed = false;

    void import("leaflet").then((leafletModule) => {
      if (disposed || !containerRef.current) return;
      const L = leafletModule.default;
      const map = L.map(containerRef.current, {
        attributionControl: true,
        scrollWheelZoom: false,
        zoomControl: false,
        touchZoom: true,
        doubleClickZoom: true,
      });
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        crossOrigin: true,
        attribution: "© OpenStreetMap",
      }).addTo(map);

      const route = days.map((day) => [day.lat, day.lon] as [number, number]);
      L.polyline(route, {
        color: routeColor,
        opacity: 0.85,
        weight: 4,
        dashArray: "8 7",
      }).addTo(map);

      const offsets = markerOffsets(days);
      days.forEach((day) => {
        const [offsetX, offsetY] = offsets.get(day.index) ?? [0, 0];
        const icon = L.divIcon({
          className: "tripMapMarker",
          html: `<span style="--marker-color:${day.color}"><b>${day.n}</b></span>`,
          iconAnchor: [18 - offsetX, 36 - offsetY],
          iconSize: [36, 36],
        });
        const marker = L.marker([day.lat, day.lon], {
          icon,
          keyboard: true,
          title: `Giorno ${day.n}: ${day.city}`,
        }).addTo(map);
        marker.bindTooltip(`<strong>Giorno ${day.n} · ${day.date}</strong><br>${day.city}`, {
          direction: "top",
          offset: [0, -17],
        });
        marker.on("click", () => onSelectRef.current(day.index));
      });

      if (route.length === 1) map.setView(route[0], 9);
      else if (route.length > 1) map.fitBounds(L.latLngBounds(route), { padding: [45, 45], maxZoom: 8 });

      const resizeObserver = new ResizeObserver(() => map.invalidateSize({ pan: false }));
      resizeObserver.observe(containerRef.current);
      const animationFrame = window.requestAnimationFrame(() => map.invalidateSize({ pan: false }));
      const resizeTimer = window.setTimeout(() => map.invalidateSize({ pan: false }), 250);
      map.once("unload", () => {
        resizeObserver.disconnect();
        window.cancelAnimationFrame(animationFrame);
        window.clearTimeout(resizeTimer);
      });
    });

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [days, routeColor]);

  function showWholeRoute() {
    if (!mapRef.current || days.length === 0) return;
    const route = days.map((day) => [day.lat, day.lon] as [number, number]);
    if (route.length === 1) mapRef.current.setView(route[0], 9);
    else mapRef.current.fitBounds(route, { padding: [45, 45], maxZoom: 8 });
  }

  return (
    <div className="tripMapShell">
      <div className="tripMapCanvas" ref={containerRef} role="region" aria-label="Mappa interattiva dell’itinerario" />
      <div className="tripMapZoom" role="group" aria-label="Controlli zoom della mappa">
        <button type="button" onClick={() => mapRef.current?.zoomIn()} aria-label="Ingrandisci la mappa">
          <Plus size={21} />
        </button>
        <button type="button" onClick={() => mapRef.current?.zoomOut()} aria-label="Riduci la mappa">
          <Minus size={21} />
        </button>
        <button type="button" className="routeReset" onClick={showWholeRoute} aria-label="Mostra tutta la rotta">
          <Scan size={17} />
          <span>Tutta la rotta</span>
        </button>
      </div>
    </div>
  );
}
