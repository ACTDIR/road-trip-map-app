"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

type Destination = {
  id: string;
  name: string;
  address: string;
  lng: number;
  lat: number;
  imageUrl: string;
  notes: string;
  roadNotes: string;
};

type Step = {
  instruction: string;
  distance: number;
  duration: number;
};

type RoadNote = {
  id: string;
  lng: number;
  lat: number;
  note: string;
  createdAt: string;
};

type Trip = {
  id: string;
  name: string;
  color: string;
  traveledPath: [number, number][];
  createdAt: string;
};

type RouteInfo = {
  distanceMiles: number;
  durationMinutes: number;
  nextInstruction: string;
  steps: Step[];
  geometry: GeoJSON.LineString | null;
};

const storageKey = "road-trip-map-v2";
const defaultCenter: [number, number] = [-98.5795, 39.8283];

function miles(meters: number) {
  return meters / 1609.344;
}

function minutes(seconds: number) {
  return seconds / 60;
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function geocode(address: string, token: string) {
  const q = encodeURIComponent(address);

  const res = await fetch(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json?limit=1&country=US&access_token=${token}`
  );

  const data = await res.json();
  const first = data?.features?.[0];

  if (!first) {
    throw new Error("Address not found.");
  }

  return {
    lng: first.center[0] as number,
    lat: first.center[1] as number,
    label: first.place_name as string,
  };
}

async function getRoute(
  points: [number, number][],
  token: string
): Promise<RouteInfo | null> {
  if (points.length < 2) return null;

  const coords = points.map((p) => p.join(",")).join(";");

  const res = await fetch(
    `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&steps=true&overview=full&access_token=${token}`
  );

  const data = await res.json();
  const route = data?.routes?.[0];

  if (!route) return null;

  const steps: Step[] =
    route.legs?.flatMap((leg: any) =>
      leg.steps?.map((s: any) => ({
        instruction: s.maneuver?.instruction || "Continue",
        distance: s.distance || 0,
        duration: s.duration || 0,
      }))
    ) || [];

  return {
    distanceMiles: miles(route.distance),
    durationMinutes: minutes(route.duration),
    nextInstruction: steps[0]?.instruction || "Continue to next destination",
    steps,
    geometry: route.geometry || null,
  };
}

export default function Page() {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mapNode = useRef<HTMLDivElement | null>(null);
  const destinationMarkerRefs = useRef<mapboxgl.Marker[]>([]);
  const roadNoteMarkerRefs = useRef<mapboxgl.Marker[]>([]);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);

  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [activeId, setActiveId] = useState("");

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [roadNotes, setRoadNotes] = useState("");

  const [userLocation, setUserLocation] = useState<[number, number] | null>(
    null
  );
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);

  const [roadNotesList, setRoadNotesList] = useState<RoadNote[]>([]);

  const [trips, setTrips] = useState<Trip[]>([]);
  const [activeTripId, setActiveTripId] = useState("");
  const [tripName, setTripName] = useState("");
  const [tripColor, setTripColor] = useState("#971F27");

  const [message, setMessage] = useState("");

  const active = useMemo(
    () => destinations.find((d) => d.id === activeId) || null,
    [activeId, destinations]
  );

  const nextDestination = destinations[0] || null;

  const activeTrip = useMemo(
    () => trips.find((trip) => trip.id === activeTripId) || null,
    [trips, activeTripId]
  );

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);

    if (!saved) return;

    try {
      const parsed = JSON.parse(saved);

      setDestinations(parsed.destinations || []);
      setTrips(parsed.trips || []);
      setActiveTripId(parsed.activeTripId || "");
      setRoadNotesList(parsed.roadNotesList || []);
    } catch {
      setMessage("Saved trip data could not be loaded.");
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        destinations,
        trips,
        activeTripId,
        roadNotesList,
      })
    );
  }, [destinations, trips, activeTripId, roadNotesList]);

  useEffect(() => {
    if (!token || !mapNode.current || mapRef.current) return;

    mapboxgl.accessToken = token;

    mapRef.current = new mapboxgl.Map({
      container: mapNode.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: defaultCenter,
      zoom: 3.2,
    });

    mapRef.current.addControl(new mapboxgl.NavigationControl(), "top-right");
  }, [token]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setMessage("Geolocation is not supported by this browser.");
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const loc: [number, number] = [
          pos.coords.longitude,
          pos.coords.latitude,
        ];

        setUserLocation(loc);

        if (activeTripId) {
          setTrips((prev) =>
            prev.map((trip) => {
              if (trip.id !== activeTripId) return trip;

              const last = trip.traveledPath[trip.traveledPath.length - 1];

              if (
                last &&
                Math.abs(last[0] - loc[0]) < 0.00002 &&
                Math.abs(last[1] - loc[1]) < 0.00002
              ) {
                return trip;
              }

              return {
                ...trip,
                traveledPath: [...trip.traveledPath, loc],
              };
            })
          );
        }

        if (mapRef.current) {
  if (!userMarkerRef.current) {
    const el = document.createElement("div");

    el.style.width = "18px";
    el.style.height = "18px";
    el.style.borderRadius = "50%";
    el.style.background = "#2A793C";
    el.style.border = "3px solid white";
    el.style.boxShadow = "0 0 0 4px rgba(42, 121, 60, 0.25)";

    const popupText = nextDestination
      ? `<strong>Your Location</strong><br/>Next: ${
          nextDestination.name
        }<br/>${
          routeInfo
            ? `${routeInfo.distanceMiles.toFixed(1)} miles • ${Math.round(
                routeInfo.durationMinutes
              )} minutes`
            : "Calculating route..."
        }`
      : `<strong>Your Location</strong><br/>No next destination selected`;

    userMarkerRef.current = new mapboxgl.Marker(el)
      .setLngLat(loc)
      .setPopup(
        new mapboxgl.Popup({ offset: 18 }).setHTML(popupText)
      )
      .addTo(mapRef.current);
  } else {
  const popupText = nextDestination
    ? `<strong>Your Location</strong><br/>Next: ${nextDestination.name}<br/>${routeInfo ? `${routeInfo.distanceMiles.toFixed(1)} miles • ${Math.round(routeInfo.durationMinutes)} minutes` : "Calculating route..."}`
    : `<strong>Your Location</strong><br/>No next destination selected`;

  userMarkerRef.current
    .setLngLat(loc)
    .setPopup(new mapboxgl.Popup({ offset: 18 }).setHTML(popupText));
}
        }
      },
      () => {
        setMessage(
          "Location permission is off. Allow location access to track your position."
        );
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000,
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [activeTripId]);

  useEffect(() => {
    if (!mapRef.current) return;

    const map = mapRef.current;

    destinationMarkerRefs.current.forEach((m) => m.remove());
    destinationMarkerRefs.current = [];

    destinations.forEach((d, i) => {
      const el = document.createElement("div");
      const img = document.createElement("img");

      img.className = "pinImg";
      img.src = d.imageUrl || `https://placehold.co/80x80?text=${i + 1}`;
      img.alt = d.name;

      el.appendChild(img);
      el.onclick = () => setActiveId(d.id);

      const marker = new mapboxgl.Marker(el)
        .setLngLat([d.lng, d.lat])
        .setPopup(
          new mapboxgl.Popup().setHTML(
            `<strong>${d.name}</strong><br/>${d.address}`
          )
        )
        .addTo(map);

      destinationMarkerRefs.current.push(marker);
    });

    if (destinations.length) {
      const bounds = new mapboxgl.LngLatBounds();

      destinations.forEach((d) => bounds.extend([d.lng, d.lat]));

      if (userLocation) {
        bounds.extend(userLocation);
      }

      map.fitBounds(bounds, {
        padding: 80,
        maxZoom: 10,
      });
    }
  }, [destinations, userLocation]);

  useEffect(() => {
    if (!mapRef.current) return;

const map = mapRef.current;

if (!map.isStyleLoaded()) {
  map.once("load", () => {
    setTrips((prev) => [...prev]);
  });
  return;
};

    trips.forEach((trip) => {
      const sourceId = `trip-path-source-${trip.id}`;
      const layerId = `trip-path-layer-${trip.id}`;

      if (map.getLayer(layerId)) {
        map.removeLayer(layerId);
      }

      if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }

      if (trip.traveledPath.length >= 2) {
        map.addSource(sourceId, {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: trip.traveledPath,
            },
          },
        });

        map.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-width": 5,
            "line-color": trip.color,
            "line-opacity": 0.85,
          },
        });
      }
    });
  }, [trips]);

  useEffect(() => {
    if (!mapRef.current) return;

    roadNoteMarkerRefs.current.forEach((m) => m.remove());
    roadNoteMarkerRefs.current = [];

    roadNotesList.forEach((roadNote) => {
      const el = document.createElement("div");

      el.style.width = "14px";
      el.style.height = "14px";
      el.style.borderRadius = "50%";
      el.style.background = "#facc15";
      el.style.border = "2px solid #111827";
      el.style.boxShadow = "0 2px 8px rgba(0,0,0,0.35)";

      const marker = new mapboxgl.Marker(el)
        .setLngLat([roadNote.lng, roadNote.lat])
        .setPopup(
          new mapboxgl.Popup().setHTML(
            `<strong>Road Note</strong><br/>${roadNote.note}`
          )
        )
        .addTo(mapRef.current!);

      roadNoteMarkerRefs.current.push(marker);
    });
  }, [roadNotesList]);

  useEffect(() => {
    async function refreshRoute() {
      if (!token || !mapRef.current) return;

      const origin =
        userLocation ||
        (destinations[0]
          ? ([destinations[0].lng, destinations[0].lat] as [number, number])
          : null);

      const routeStops = destinations.map(
        (d) => [d.lng, d.lat] as [number, number]
      );

      const points = origin ? [origin, ...routeStops] : routeStops;
      const info = await getRoute(points, token);

      setRouteInfo(info);

      const map = mapRef.current;
      const sourceId = "route-source";
      const layerId = "route-layer";

      if (map.getLayer(layerId)) {
        map.removeLayer(layerId);
      }

      if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }

      if (info?.geometry) {
        map.addSource(sourceId, {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: info.geometry,
          },
        });

        map.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-width": 6,
            "line-color": "#36559B",
          },
        });

        if (map.getLayer(layerId)) {
  map.off("click", layerId, () => {});
  map.off("mouseenter", layerId, () => {});
  map.off("mouseleave", layerId, () => {});
}

        map.on("click", layerId, (e) => {
          const note = window.prompt("Road note for this section:");

          if (!note?.trim()) return;

          setRoadNotesList((prev) => [
            ...prev,
            {
              id: uid(),
              lng: e.lngLat.lng,
              lat: e.lngLat.lat,
              note: note.trim(),
              createdAt: new Date().toISOString(),
            },
          ]);
        });

        map.on("mouseenter", layerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });

        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
        });
      }
    }

    refreshRoute().catch(() => {
      setMessage("Route could not be calculated.");
    });
  }, [destinations, userLocation, token]);

  async function addDestination() {
    try {
      if (!token) throw new Error("Missing Mapbox token.");
      if (!name.trim() || !address.trim()) {
        throw new Error("Name and address are required.");
      }

      let geo;

const coordMatch = address.match(
  /^\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)\s*$/
);

if (coordMatch) {
  geo = {
    lat: parseFloat(coordMatch[1]),
    lng: parseFloat(coordMatch[3]),
    label: `${coordMatch[1]}, ${coordMatch[3]}`,
  };
} else {
  geo = await geocode(address, token);
}

      setDestinations((prev) => [
        ...prev,
        {
          id: uid(),
          name,
          address: geo.label,
          lng: geo.lng,
          lat: geo.lat,
          imageUrl,
          notes,
          roadNotes,
        },
      ]);

      setName("");
      setAddress("");
      setImageUrl("");
      setNotes("");
      setRoadNotes("");
      setMessage("Destination added.");
    } catch (e: any) {
      setMessage(e.message || "Could not add destination.");
    }
  }

  function createTrip() {
    if (!tripName.trim()) {
      setMessage("Trip name is required.");
      return;
    }

    const trip: Trip = {
      id: uid(),
      name: tripName.trim(),
      color: tripColor,
      traveledPath: [],
      createdAt: new Date().toISOString(),
    };

    setTrips((prev) => [...prev, trip]);
    setActiveTripId(trip.id);
    setTripName("");
    setMessage("Trip created.");
  }

  function removeDestination(id: string) {
    setDestinations((prev) => prev.filter((d) => d.id !== id));

    if (activeId === id) {
      setActiveId("");
    }
  }

  function move(id: string, dir: -1 | 1) {
    setDestinations((prev) => {
      const index = prev.findIndex((d) => d.id === id);
      const next = index + dir;

      if (index < 0 || next < 0 || next >= prev.length) return prev;

      const copy = [...prev];

      [copy[index], copy[next]] = [copy[next], copy[index]];

      return copy;
    });
  }

  function goToMyLocation() {
    if (!userLocation || !mapRef.current) {
      setMessage("Current location is not available yet.");
      return;
    }

    mapRef.current.flyTo({
      center: userLocation,
      zoom: 14,
      essential: true,
    });
  }

  async function optimizeRoute() {
    if (!token || destinations.length < 3) {
      setMessage("Add at least 3 destinations to optimize.");
      return;
    }

    const origin = userLocation || [destinations[0].lng, destinations[0].lat];
    const remaining = [...destinations];
    const ordered: Destination[] = [];
    let current = origin as [number, number];

    while (remaining.length) {
      remaining.sort(
        (a, b) =>
          Math.hypot(a.lng - current[0], a.lat - current[1]) -
          Math.hypot(b.lng - current[0], b.lat - current[1])
      );

      const next = remaining.shift()!;

      ordered.push(next);
      current = [next.lng, next.lat];
    }

    setDestinations(ordered);
    setMessage("Route reordered using nearest-stop optimization.");
  }

  if (!token) {
    return (
      <div style={{ padding: 24 }}>
        Add NEXT_PUBLIC_MAPBOX_TOKEN to .env.local, then restart the dev server.
      </div>
    );
  }

  return (
    <main className="shell">
      <section className="panel">
        <h1>Road Trip Map</h1>

        <p className="muted">
          Photo pins, live GPS, trip-colored traveled roads, road notes, route
          line, miles/time, and silent visual directions.
        </p>

        <div className="card">
          <h3>Trips</h3>

          <input
            className="field"
            value={tripName}
            onChange={(e) => setTripName(e.target.value)}
            placeholder="Trip name"
          />

          <input
            className="field"
            type="color"
            value={tripColor}
            onChange={(e) => setTripColor(e.target.value)}
          />

          <button className="btn secondary" onClick={createTrip}>
            Create Trip
          </button>

          <select
            className="field"
            value={activeTripId}
            onChange={(e) => setActiveTripId(e.target.value)}
          >
            <option value="">No active trip</option>
            {trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.name}
              </option>
            ))}
          </select>

          <p className="muted">
            Active trip: <strong>{activeTrip?.name || "None"}</strong>
          </p>
        </div>

        <div className="card">
          <h3>Add Destination</h3>

          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Destination name"
          />

          <input
            className="field"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Address, city, landmark, or park"
          />

          <input
            className="field"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="Small image URL for pin"
          />

          <textarea
            className="field"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Destination notes"
            rows={3}
          />

          <textarea
            className="field"
            value={roadNotes}
            onChange={(e) => setRoadNotes(e.target.value)}
            placeholder="Highway, byway, or road notes"
            rows={3}
          />

          <div className="row">
            <button className="btn secondary" onClick={addDestination}>
              Add Stop
            </button>

            <button className="btn" onClick={optimizeRoute}>
              Optimize Route
            </button>

            <button className="btn" onClick={goToMyLocation}>
              My Location
            </button>
          </div>

          {message && <p className="muted">{message}</p>}
        </div>

        <div className="card">
          <h3>Trip Status</h3>

          <div>
            Next stop: <strong>{nextDestination?.name || "None"}</strong>
          </div>

          <div className="routeLine">
            Miles/time remaining:{" "}
            <strong>
              {routeInfo
                ? `${routeInfo.distanceMiles.toFixed(1)} mi / ${Math.round(
                    routeInfo.durationMinutes
                  )} min`
                : "—"}
            </strong>
          </div>

          <div className="routeLine">
            Silent direction:{" "}
            <strong>{routeInfo?.nextInstruction || "—"}</strong>
          </div>
        </div>

        <h3>Stops</h3>

        {destinations.map((d, i) => (
          <div key={d.id} className="card">
            <button className="listBtn" onClick={() => setActiveId(d.id)}>
              <strong>
                {i + 1}. {d.name}
              </strong>
              <br />
              <span className="muted">{d.address}</span>
            </button>

            <div className="row">
              <button className="btn" onClick={() => move(d.id, -1)}>
                Up
              </button>

              <button className="btn" onClick={() => move(d.id, 1)}>
                Down
              </button>

              <button
                className="btn danger"
                onClick={() => removeDestination(d.id)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}

        {active && (
          <div className="card">
            <h3>{active.name}</h3>

            <p className="muted">Destination Notes</p>
            <p>{active.notes || "—"}</p>

            <p className="muted">Road Notes</p>
            <p>{active.roadNotes || "—"}</p>
          </div>
        )}

        <h3>Road Notes</h3>

        {roadNotesList.length === 0 && (
          <p className="muted">Click the blue route line to add a road note.</p>
        )}

        {roadNotesList.map((roadNote) => (
          <div key={roadNote.id} className="card">
            <p>{roadNote.note}</p>
            <p className="muted">
              {roadNote.lat.toFixed(5)}, {roadNote.lng.toFixed(5)}
            </p>
          </div>
        ))}
      </section>

      <section className="mapWrap">
        <div ref={mapNode} className="map" />

        <div className="status">
          <div>
            <strong>
              {nextDestination
                ? `Next: ${nextDestination.name}`
                : "Add your first destination"}
            </strong>
          </div>

          <div className="muted">
            {routeInfo
              ? `${routeInfo.distanceMiles.toFixed(1)} miles • ${Math.round(
                  routeInfo.durationMinutes
                )} minutes`
              : "Route will appear after stops are added."}
          </div>

          <div className="small">
            Silent directions: {routeInfo?.nextInstruction || "No active instruction"}
          </div>

          <button className="btn secondary" onClick={goToMyLocation}>
            Go To My Location
          </button>
        </div>
      </section>
    </main>
  );
}