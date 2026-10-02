import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Minus, Plus, LocateFixed } from "lucide-react";

interface MapPoint {
  lat: number;
  lng: number;
}

export const DEFAULT_MAP_CENTER: MapPoint = { lat: 12.9716, lng: 77.5946 };
const MIN_ZOOM = 3;
const MAX_ZOOM = 19;

const lngFrac = (lng: number) => (lng + 180) / 360;
const mercFrac = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
};

/** Reverse-geocode coordinates via the Convex HTTP proxy of Nominatim. */
export function useOsmAddress(convexHttpUrl: string) {
  const cache = useRef<Map<string, string | null>>(new Map());

  const lookup = useCallback(
    async (lat: number, lng: number): Promise<string | null> => {
      const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
      if (cache.current.has(key)) return cache.current.get(key)!;
      try {
        const res = await fetch(
          `${convexHttpUrl}/reverseGeocode?lat=${lat}&lng=${lng}`,
        );
        const data = (await res.json()) as { address?: string | null };
        const addr = data.address ?? null;
        cache.current.set(key, addr);
        return addr;
      } catch {
        return null;
      }
    },
    [convexHttpUrl],
  );

  return lookup;
}

/**
 * Interactive OpenStreetMap map for the vintage archive theme.
 * • Tap / click → place the pin exactly where you touched (no re-center jump)
 * • Drag → pan the map (mouse + touch via pointer events)
 * • +/− buttons and mouse wheel → zoom, anchored at the cursor
 * • Tiles get a sepia wash so they sit inside the aged-paper palette.
 * No external map library — just tiles and absolutely-positioned markers.
 */
export function MapPicker({
  center,
  pin,
  pins,
  onPick,
  className,
  interactive = true,
  zoom: initialZoom = 16,
  /** Change this value to snap the view back onto `center` (e.g. after a GPS fix). */
  recenterSignal,
  /** Optional extra control rendered above the zoom buttons (e.g. a GPS button). */
  overlay,
}: {
  center: MapPoint;
  pin: MapPoint | null;
  /** Extra pins for map visualizations (e.g. the authority city map). */
  pins?: Array<MapPoint & { color?: string; label?: string }>;
  onPick?: (p: MapPoint) => void;
  className?: string;
  interactive?: boolean;
  zoom?: number;
  recenterSignal?: unknown;
  overlay?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 640, h: 360 });
  const [zoom, setZoom] = useState(
    Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, initialZoom)),
  );

  // Pan offset (px) of the view anchor `center`. Kept in a ref so dragging is
  // smooth; a render tick flushes frames via requestAnimationFrame.
  const panRef = useRef({ x: 0, y: 0 });
  const [, setRenderTick] = useState(0);
  const rafRef = useRef<number | null>(null);
  const dragRef = useRef<{
    id: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const firstCenter = useRef(true);
  const firstSignal = useRef(true);

  const flush = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setRenderTick((t) => t + 1);
    });
  }, []);
  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const clampPan = useCallback(
    (scale = Math.pow(2, zoom)) => {
      const max = 128 * scale;
      panRef.current.x = Math.max(-max, Math.min(max, panRef.current.x));
      panRef.current.y = Math.max(-max, Math.min(max, panRef.current.y));
    },
    [zoom],
  );

  // When the anchor point changes (pin moved), freeze the map visually: adjust
  // the pan so every tile stays exactly where it was. The new pin then renders
  // precisely where the user tapped, without a jarring re-center jump.
  const centerKey = `${center.lat.toFixed(5)},${center.lng.toFixed(5)}`;
  useEffect(() => {
    if (firstCenter.current) {
      firstCenter.current = false;
      return;
    }
    const prev = prevCenter.current;
    if (prev) {
      const scale = Math.pow(2, zoom);
      panRef.current.x -= (lngFrac(center.lng) - lngFrac(prev.lng)) * scale * 256;
      panRef.current.y += (mercFrac(center.lat) - mercFrac(prev.lat)) * scale * 256;
      clampPan();
      flush();
    }
    prevCenter.current = { lat: center.lat, lng: center.lng };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerKey]);

  const prevCenter = useRef<MapPoint>({ ...center });

  // Explicit recenter request (e.g. GPS fix) snaps the anchor to mid-view.
  useEffect(() => {
    if (recenterSignal == null) return;
    if (firstSignal.current) {
      firstSignal.current = false;
      return;
    }
    panRef.current = { x: 0, y: 0 };
    flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterSignal]);

  const { w, h } = size;

  const view = useMemo(() => {
    const scale = Math.pow(2, zoom);
    const cx = lngFrac(center.lng) * scale + panRef.current.x / 256;
    const cy = mercFrac(center.lat) * scale - panRef.current.y / 256;
    return { scale, cx, cy };
    // panRef is intentionally read here; flush() bumps the render tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center, zoom, w, h, panRef.current.x, panRef.current.y]);

  const toPixels = useCallback(
    (lat: number, lng: number) => {
      const x = (lngFrac(lng) * view.scale - view.cx) * 256 + w / 2;
      const y = (mercFrac(lat) * view.scale - view.cy) * 256 + h / 2;
      return { x, y };
    },
    [view, w, h],
  );

  const fromPixels = useCallback(
    (px: number, py: number): MapPoint => {
      const worldX = (px - w / 2) / 256 + view.cx;
      const worldY = (py - h / 2) / 256 + view.cy;
      const lng = (worldX / view.scale) * 360 - 180;
      const n = Math.PI - 2 * Math.PI * (worldY / view.scale);
      const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
      return { lat, lng };
    },
    [view, w, h],
  );

  const zoomAt = useCallback(
    (next: number, px?: number, py?: number) => {
      const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next)));
      if (clamped === zoom) return;
      const fx = px ?? w / 2;
      const fy = py ?? h / 2;
      const scale = Math.pow(2, clamped);
      // Geographic point currently under the focal pixel — keep it there.
      const g = fromPixels(fx, fy);
      panRef.current.x =
        (lngFrac(g.lng) - lngFrac(center.lng)) * scale * 256 + (w / 2 - fx);
      panRef.current.y =
        fy - h / 2 - (mercFrac(g.lat) - mercFrac(center.lat)) * scale * 256;
      clampPan(scale);
      setZoom(clamped);
      flush();
    },
    [zoom, w, h, fromPixels, center, clampPan, flush],
  );

  // Mouse wheel zoom
  useEffect(() => {
    const el = ref.current;
    if (!el || !interactive) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(
        zoom + (e.deltaY < 0 ? 1 : -1),
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [interactive, zoom, zoomAt]);

  const eventPoint = (e: { clientX: number; clientY: number }) => {
    const rect = ref.current?.getBoundingClientRect();
    return {
      x: e.clientX - (rect?.left ?? 0),
      y: e.clientY - (rect?.top ?? 0),
    };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!interactive) return;
    const { x, y } = eventPoint(e);
    dragRef.current = {
      id: e.pointerId,
      startX: x,
      startY: y,
      originX: panRef.current.x,
      originY: panRef.current.y,
      moved: false,
    };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* pointer capture unavailable — drag still works via move events */
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== e.pointerId) return;
    const { x, y } = eventPoint(e);
    const dx = x - drag.startX;
    const dy = y - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) <= 6) return;
    drag.moved = true;
    panRef.current.x = drag.originX - dx;
    panRef.current.y = drag.originY - dy;
    clampPan();
    flush();
  };

  const endDrag = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== e.pointerId) return;
    dragRef.current = null;
    if (drag.moved || !interactive || !onPick) return;
    // A still pointer = tap → place the pin exactly where the user touched.
    const { x, y } = eventPoint(e);
    onPick(fromPixels(x, y));
  };

  const pinPos = pin ? toPixels(pin.lat, pin.lng) : null;
  const extraPins = (pins ?? []).map((p) => ({ ...p, pos: toPixels(p.lat, p.lng) }));

  const tiles = useMemo(() => {
    const cols = Math.ceil(w / 256) + 1;
    const rows = Math.ceil(h / 256) + 1;
    const baseX = Math.floor(view.cx - w / 2 / 256);
    const baseY = Math.floor(view.cy - h / 2 / 256);
    const out: Array<{ key: string; x: number; y: number; url: string }> = [];
    for (let i = 0; i <= cols; i++) {
      for (let j = 0; j <= rows; j++) {
        const tx = baseX + i;
        const ty = baseY + j;
        const n = view.scale;
        if (ty < 0 || ty >= n) continue;
        const wrappedX = ((tx % n) + n) % n;
        out.push({
          key: `${tx}-${ty}`,
          x: tx * 256,
          y: ty * 256,
          url: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${ty}.png`,
        });
      }
    }
    return out;
  }, [view, w, h, zoom]);

  return (
    <div
      ref={ref}
      className={`relative overflow-hidden select-none ${
        interactive ? "cursor-crosshair touch-none" : ""
      } ${className ?? ""}`}
      style={{ background: "oklch(0.93 0.02 90)" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
    >
      {/* Sepia-washed tiles */}
      <div
        className="absolute inset-0"
        style={{
          transform: `translate(${-(view.cx * 256 - w / 2)}px, ${-(view.cy * 256 - h / 2)}px)`,
          filter: "sepia(0.45) saturate(0.75) contrast(0.92) brightness(1.03)",
        }}
      >
        {tiles.map((t) => (
          <img
            key={t.key}
            src={t.url}
            alt=""
            draggable={false}
            loading="lazy"
            className="pointer-events-none absolute size-[256px] select-none"
            style={{ left: t.x, top: t.y }}
          />
        ))}
      </div>

      {/* Crosshair pulse + hint while a pin can still be dropped.
          Gated on `onPick` so a read-only but pannable map (e.g. the authority
          city map) does not show a "tap to drop the pin" hint it cannot honour. */}
      {interactive && onPick && !pin && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="absolute left-1/2 top-1/2 size-9 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full bg-primary/25" />
          <span className="absolute left-1/2 top-1/2 size-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary/60" />
          <span className="type-label absolute bottom-3 rounded bg-card/90 px-3 py-1.5 text-[11px] text-foreground shadow">
            Tap the map to drop the pin — drag to move around
          </span>
        </div>
      )}

      {/* Extra pins (severity-coloured on the authority map) */}
      {extraPins.map((p, i) => (
        <div
          key={i}
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full"
          style={{ left: p.pos.x, top: p.pos.y }}
          title={p.label}
        >
          <svg width="20" height="27" viewBox="0 0 28 38" className="drop-shadow">
            <path
              d="M14 0C6.3 0 0 6.3 0 14c0 9.5 11.2 21.2 13 23.1.5.6 1.4.6 2 0C16.8 35.2 28 23.5 28 14 28 6.3 21.7 0 14 0z"
              fill={p.color ?? "oklch(0.42 0.07 50)"}
              stroke="oklch(0.955 0.022 86)"
              strokeWidth="2"
            />
          </svg>
        </div>
      ))}

      {/* The main pin */}
      {pinPos && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full"
          style={{ left: pinPos.x, top: pinPos.y }}
        >
          <svg width="28" height="38" viewBox="0 0 28 38" className="drop-shadow-md">
            <path
              d="M14 0C6.3 0 0 6.3 0 14c0 9.5 11.2 21.2 13 23.1.5.6 1.4.6 2 0C16.8 35.2 28 23.5 28 14 28 6.3 21.7 0 14 0z"
              fill="oklch(0.42 0.07 50)"
              stroke="oklch(0.955 0.022 86)"
              strokeWidth="1.5"
            />
            <circle cx="14" cy="14" r="4.5" fill="oklch(0.955 0.022 86)" />
          </svg>
        </div>
      )}

      {/* Controls */}
      {interactive && (
        <div className="absolute bottom-3 right-3 z-20 flex flex-col items-end gap-1.5">
          {overlay}
          <div className="overflow-hidden rounded-md border border-border bg-card/95 shadow">
            <button
              type="button"
              aria-label="Zoom in"
              className="flex size-8 items-center justify-center border-b border-border text-foreground hover:bg-accent"
              onClick={(e) => {
                e.stopPropagation();
                zoomAt(zoom + 1);
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Plus className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              className="flex size-8 items-center justify-center text-foreground hover:bg-accent"
              onClick={(e) => {
                e.stopPropagation();
                zoomAt(zoom - 1);
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Minus className="size-4" />
            </button>
          </div>
        </div>
      )}

      {/* Attribution */}
      <div className="pointer-events-none absolute right-1 top-1 z-20 rounded bg-card/80 px-1.5 py-0.5">
        <span className="type-label text-[8px] text-muted-foreground">
          © OpenStreetMap contributors
        </span>
      </div>
    </div>
  );
}

/** Small floating button used inside MapPicker overlays (e.g. recenter on GPS). */
export function MapOverlayButton({
  onClick,
  children,
  label,
}: {
  onClick: () => void;
  children: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="type-label flex items-center gap-1.5 rounded-md border border-border bg-card/95 px-2.5 py-1.5 text-[10px] text-foreground shadow hover:bg-accent"
      aria-label={label}
    >
      <LocateFixed className="size-3.5 text-primary" />
      {children}
    </button>
  );
}
