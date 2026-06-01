/**
 * Top bar — project name, playback controls, and export button.
 */
import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Download,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useProjectStore, useMainComposition } from "../../stores/project-store";
import { secondsToMicros } from "@openreel/mograph";
import { microsToCue } from "@openreel/mograph";

interface TopBarProps {
  pxPerSec: number;
  onPxPerSecChange: (v: number) => void;
}

export function TopBar({ pxPerSec, onPxPerSecChange }: TopBarProps) {
  const { project, currentTimeUs, setCurrentTime } = useProjectStore();
  const comp = useMainComposition();
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  const durationUs = comp?.durationUs ?? secondsToMicros(10);
  const fps = comp?.frameRate ?? 30;

  const timecode = microsToCue(currentTimeUs, fps);

  // Playback loop
  const tick = useCallback((ts: number) => {
    if (lastTsRef.current !== null) {
      const deltaSec = (ts - lastTsRef.current) / 1000;
      setCurrentTime((prev) => {
        const next = prev + secondsToMicros(deltaSec);
        if (next >= durationUs) {
          setPlaying(false);
          return durationUs;
        }
        return next;
      });
    }
    lastTsRef.current = ts;
    rafRef.current = requestAnimationFrame(tick);
  }, [durationUs, setCurrentTime]);

  useEffect(() => {
    if (playing) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      lastTsRef.current = null;
    }
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, tick]);

  function goToStart() { setCurrentTime(0); setPlaying(false); }
  function goToEnd() { setCurrentTime(durationUs); setPlaying(false); }

  return (
    <div className="flex h-10 flex-shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-1)] px-4">
      {/* Project name */}
      <span className="text-sm font-semibold text-[var(--fg)]">{project.name}</span>

      <div className="mx-2 h-4 w-px bg-[var(--border)]" />

      {/* Playback controls */}
      <div className="flex items-center gap-1">
        <IconBtn title="Go to start" onClick={goToStart}><SkipBack size={14} /></IconBtn>
        <button
          title={playing ? "Pause (Space)" : "Play (Space)"}
          className="flex h-7 w-7 items-center justify-center rounded bg-[var(--accent)] text-white transition-all hover:bg-[var(--accent-strong)]"
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <IconBtn title="Go to end" onClick={goToEnd}><SkipForward size={14} /></IconBtn>
      </div>

      {/* Timecode */}
      <span className="font-mono text-xs tabular-nums text-[var(--fg-2)]">{timecode}</span>

      <div className="flex-1" />

      {/* Zoom */}
      <div className="flex items-center gap-1">
        <IconBtn title="Zoom out" onClick={() => onPxPerSecChange(Math.max(20, pxPerSec / 1.3))}>
          <ZoomOut size={14} />
        </IconBtn>
        <span className="w-10 text-center text-xs text-[var(--fg-3)]">
          {Math.round(pxPerSec)}px
        </span>
        <IconBtn title="Zoom in" onClick={() => onPxPerSecChange(Math.min(1000, pxPerSec * 1.3))}>
          <ZoomIn size={14} />
        </IconBtn>
      </div>

      <div className="mx-2 h-4 w-px bg-[var(--border)]" />

      {/* Export placeholder */}
      <button
        title="Export"
        className="flex h-7 items-center gap-1.5 rounded bg-[var(--bg-3)] px-3 text-xs text-[var(--fg-2)] transition-colors hover:bg-[var(--bg-elev)] hover:text-[var(--fg)]"
      >
        <Download size={13} />
        Export
      </button>
    </div>
  );
}

function IconBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded text-[var(--fg-3)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)]"
    >
      {children}
    </button>
  );
}
