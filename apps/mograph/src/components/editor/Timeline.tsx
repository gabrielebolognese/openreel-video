/**
 * Timeline panel — displays tracks for the main composition and handles
 * scrubbing, clip selection, and playhead positioning.
 */
import React, { useCallback, useRef, useState } from "react";
import { useMainComposition, useProjectStore } from "../../stores/project-store";
import type { MoLayer } from "@openreel/mograph";
import { microsToSeconds, secondsToMicros } from "@openreel/mograph";

const TRACK_H = 36;
const RULER_H = 24;
const LABEL_W = 160;

const LAYER_COLORS: Record<string, string> = {
  video:      "#2563eb",
  image:      "#0891b2",
  text:       "#7c3aed",
  shape:      "#16a34a",
  solid:      "#ca8a04",
  audio:      "#dc2626",
  precomp:    "#9333ea",
  adjustment: "#475569",
  "null":     "#374151",
};

interface TimelineProps {
  pxPerSec: number;
  onPxPerSecChange: (v: number) => void;
}

export function Timeline({ pxPerSec, onPxPerSecChange }: TimelineProps) {
  const comp = useMainComposition();
  const { currentTimeUs, setCurrentTime, selectedLayerIds, selectLayer } = useProjectStore();
  const rulerRef = useRef<HTMLDivElement>(null);

  const durationSec = comp ? microsToSeconds(comp.durationUs) : 10;
  const totalWidth = durationSec * pxPerSec;
  const playheadX = microsToSeconds(currentTimeUs) * pxPerSec;

  const scrubFromX = useCallback((clientX: number) => {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = clientX - rect.left;
    const timeSec = Math.max(0, Math.min(durationSec, x / pxPerSec));
    setCurrentTime(secondsToMicros(timeSec));
  }, [pxPerSec, durationSec, setCurrentTime]);

  const handleRulerMouseDown = (e: React.MouseEvent) => {
    scrubFromX(e.clientX);
    const onMove = (ev: MouseEvent) => scrubFromX(ev.clientX);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Zoom with wheel
  const handleWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    onPxPerSecChange(Math.max(20, Math.min(1000, pxPerSec * delta)));
  };

  function formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const f = Math.floor((sec % 1) * (comp?.frameRate ?? 30));
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
  }

  // Build ruler ticks
  const tickStep = pxPerSec >= 200 ? 1 : pxPerSec >= 60 ? 5 : pxPerSec >= 20 ? 10 : 30;
  const ticks: number[] = [];
  for (let t = 0; t <= durationSec; t += tickStep) ticks.push(t);

  const layers = comp?.layers ? [...comp.layers].sort((a, b) => b.zIndex - a.zIndex) : [];

  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-[var(--tl-bg)] select-none"
      onWheel={handleWheel}
    >
      {/* Top ruler */}
      <div className="flex flex-shrink-0 border-b border-[var(--border)]" style={{ height: RULER_H }}>
        {/* Label column spacer */}
        <div className="flex-shrink-0 border-r border-[var(--border)]" style={{ width: LABEL_W }} />
        {/* Ruler */}
        <div
          ref={rulerRef}
          className="relative flex-1 cursor-col-resize overflow-hidden"
          onMouseDown={handleRulerMouseDown}
        >
          <div className="absolute inset-0" style={{ width: totalWidth }}>
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute top-0 flex flex-col items-start"
                style={{ left: t * pxPerSec }}
              >
                <div className="h-2 w-px bg-[var(--border-strong)]" />
                <span className="pl-0.5 text-[10px] text-[var(--fg-muted)]">{formatTime(t)}</span>
              </div>
            ))}
            {/* Playhead on ruler */}
            <div
              className="absolute top-0 h-full w-px bg-[var(--accent)]"
              style={{ left: playheadX, pointerEvents: "none" }}
            />
          </div>
        </div>
      </div>

      {/* Track lanes */}
      <div className="relative flex flex-1 overflow-auto">
        {/* Layer labels */}
        <div
          className="absolute left-0 top-0 z-10 flex-shrink-0 border-r border-[var(--border)] bg-[var(--tl-bg)]"
          style={{ width: LABEL_W }}
        >
          {layers.length === 0 && (
            <div className="flex h-9 items-center justify-center text-xs text-[var(--fg-muted)]">
              No layers
            </div>
          )}
          {layers.map((layer) => (
            <LayerLabel
              key={layer.id}
              layer={layer}
              selected={selectedLayerIds.includes(layer.id)}
              onSelect={(id, multi) => selectLayer(id, multi)}
            />
          ))}
        </div>

        {/* Clip tracks */}
        <div
          className="ml-[160px] flex-1 overflow-x-auto overflow-y-hidden"
          style={{ minWidth: totalWidth + 32 }}
        >
          <div className="relative" style={{ width: totalWidth }}>
            {/* Playhead line across all tracks */}
            <div
              className="absolute top-0 h-full w-px bg-[var(--accent)] opacity-60"
              style={{ left: playheadX, pointerEvents: "none" }}
            />
            {layers.length === 0 && (
              <div className="flex h-9 items-center justify-center text-xs text-[var(--fg-muted)]">
                Drop media here to start
              </div>
            )}
            {layers.map((layer) => (
              <ClipBar
                key={layer.id}
                layer={layer}
                durationSec={durationSec}
                pxPerSec={pxPerSec}
                selected={selectedLayerIds.includes(layer.id)}
                onSelect={(id, multi) => selectLayer(id, multi)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LayerLabel({
  layer,
  selected,
  onSelect,
}: {
  layer: MoLayer;
  selected: boolean;
  onSelect: (id: string, multi: boolean) => void;
}) {
  const color = LAYER_COLORS[layer.type] ?? "#475569";
  return (
    <div
      className={`flex h-9 cursor-pointer items-center gap-2 border-b border-[var(--border)] px-3 text-xs transition-colors ${
        selected ? "bg-[var(--selected)] text-[var(--fg)]" : "hover:bg-[var(--hover)] text-[var(--fg-2)]"
      }`}
      onClick={(e) => onSelect(layer.id, e.metaKey || e.ctrlKey)}
    >
      <span
        className="h-2 w-2 flex-shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="truncate">{layer.name}</span>
      <span className="ml-auto flex-shrink-0 text-[10px] text-[var(--fg-muted)] uppercase">{layer.type}</span>
    </div>
  );
}

function ClipBar({
  layer,
  durationSec,
  pxPerSec,
  selected,
  onSelect,
}: {
  layer: MoLayer;
  durationSec: number;
  pxPerSec: number;
  selected: boolean;
  onSelect: (id: string, multi: boolean) => void;
}) {
  const color = LAYER_COLORS[layer.type] ?? "#475569";
  const leftPx = microsToSeconds(layer.startTimeUs) * pxPerSec;
  const widthPx = Math.max(4, microsToSeconds(layer.durationUs) * pxPerSec);

  return (
    <div
      className="relative flex h-9 items-center border-b border-[var(--border)]"
    >
      <div
        className={`absolute flex h-6 cursor-pointer items-center overflow-hidden rounded px-2 text-[11px] font-medium text-white transition-all ${
          selected ? "ring-1 ring-white/60" : "hover:brightness-110"
        }`}
        style={{
          left: leftPx,
          width: widthPx,
          backgroundColor: color,
          opacity: selected ? 1 : 0.85,
        }}
        onClick={(e) => onSelect(layer.id, e.metaKey || e.ctrlKey)}
      >
        <span className="truncate">{layer.name}</span>
      </div>
    </div>
  );
}
