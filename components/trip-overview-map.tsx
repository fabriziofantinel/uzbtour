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
  onSelect: (index: number) => void;
};

const markerAnchors: Record<number, [number, number]> = {
  1: [42, 18],
  3: [42, 18],
  4: [-6, 18],
  5: [54, 18],
  6: [18, 18],
  8: [-18, 18],
  11: [-6, 18]
};

export default function TripOverviewMap({ days, onSelect }: TripOverviewMapProps) {
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
        doubleClickZoom: true
      });
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "© OpenStreetMap"
      }).addTo(map);

      const route = days.map((day) => [day.lat, day.lon] as [number, number]);
      L.polyline(route, {
        color: "#0b6462",
        opacity: 0.85,
        weight: 4,
        dashArray: "8 7"
      }).addTo(map);

      days.forEach((day) => {
        const icon = L.divIcon({
          className: "tripMapMarker",
          html: `<span style="--marker-color:${day.color}"><b>${day.n}</b></span>`,
          iconAnchor: markerAnchors[day.n] ?? [18, 18],
          iconSize: [36, 36]
        });
        const marker = L.marker([day.lat, day.lon], {
          icon,
          keyboard: true,
          title: `Giorno ${day.n}: ${day.city}`
        }).addTo(map);
        marker.bindTooltip(
          `<strong>Giorno ${day.n} · ${day.date}</strong><br>${day.city}`,
          { direction: "top", offset: [0, -17] }
        );
        marker.on("click", () => onSelectRef.current(day.index));
      });

      map.fitBounds(L.latLngBounds([[37.0, 55.5], [46.3, 73.6]]), {
        padding: [22, 22]
      });
    });

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [days]);

  function showWholeRoute() {
    mapRef.current?.fitBounds([[37.0, 55.5], [46.3, 73.6]], {
      padding: [22, 22]
    });
  }

  return (
    <div className="tripMapShell">
      <div className="tripMapCanvas" ref={containerRef} aria-label="Mappa interattiva dell’itinerario in Uzbekistan"/>
      <div className="tripMapZoom" role="group" aria-label="Controlli zoom della mappa">
        <button type="button" onClick={() => mapRef.current?.zoomIn()} aria-label="Ingrandisci la mappa">
          <Plus size={21}/>
        </button>
        <button type="button" onClick={() => mapRef.current?.zoomOut()} aria-label="Riduci la mappa">
          <Minus size={21}/>
        </button>
        <button type="button" className="routeReset" onClick={showWholeRoute} aria-label="Mostra tutta la rotta">
          <Scan size={17}/><span>Tutta la rotta</span>
        </button>
      </div>
    </div>
  );
}
