/**
 * EditorLayout — full-screen four-panel layout:
 *   [Toolbar] [Preview] [Inspector]
 *              [Timeline]
 *
 * Panel sizes are resizable via drag handles.
 */
import React, { useState, useCallback, useRef } from "react";
import { TopBar } from "./TopBar";
import { Toolbar } from "./Toolbar";
import { PreviewCanvas } from "./PreviewCanvas";
import { Timeline } from "./Timeline";
import { Inspector } from "./Inspector";

type Tool = "select" | "text" | "rect" | "ellipse" | "solid";

export function EditorLayout() {
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [pxPerSec, setPxPerSec] = useState(100);
  const [inspectorW, setInspectorW] = useState(260);
  const [timelineH, setTimelineH] = useState(220);

  // Drag state for inspector resize
  const inspDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const handleInspResizeStart = (e: React.MouseEvent) => {
    inspDragRef.current = { startX: e.clientX, startW: inspectorW };
    const onMove = (ev: MouseEvent) => {
      if (!inspDragRef.current) return;
      const delta = inspDragRef.current.startX - ev.clientX;
      setInspectorW(Math.max(180, Math.min(480, inspDragRef.current.startW + delta)));
    };
    const onUp = () => {
      inspDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Drag state for timeline resize
  const tlDragRef = useRef<{ startY: number; startH: number } | null>(null);
  const handleTlResizeStart = (e: React.MouseEvent) => {
    tlDragRef.current = { startY: e.clientY, startH: timelineH };
    const onMove = (ev: MouseEvent) => {
      if (!tlDragRef.current) return;
      const delta = tlDragRef.current.startY - ev.clientY;
      setTimelineH(Math.max(100, Math.min(500, tlDragRef.current.startH + delta)));
    };
    const onUp = () => {
      tlDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar pxPerSec={pxPerSec} onPxPerSecChange={setPxPerSec} />

      <div className="flex flex-1 overflow-hidden">
        {/* Left toolbar */}
        <Toolbar activeTool={activeTool} onToolChange={setActiveTool} />

        {/* Center: preview + timeline */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Preview area */}
          <div className="flex flex-1 items-center justify-center overflow-hidden bg-[#080809]">
            <div
              className="relative overflow-hidden rounded shadow-lg"
              style={{ aspectRatio: "16/9", maxWidth: "calc(100% - 32px)", maxHeight: "calc(100% - 32px)" }}
            >
              <PreviewCanvas />
            </div>
          </div>

          {/* Timeline resize handle */}
          <div
            className="h-1 flex-shrink-0 cursor-row-resize bg-transparent transition-colors hover:bg-[var(--accent)] active:bg-[var(--accent)]"
            onMouseDown={handleTlResizeStart}
          />

          {/* Timeline */}
          <div style={{ height: timelineH, flexShrink: 0 }}>
            <Timeline pxPerSec={pxPerSec} onPxPerSecChange={setPxPerSec} />
          </div>
        </div>

        {/* Inspector resize handle */}
        <div
          className="resize-handle"
          onMouseDown={handleInspResizeStart}
        />

        {/* Inspector */}
        <div
          className="flex-shrink-0 overflow-hidden border-l border-[var(--border)] bg-[var(--bg-1)]"
          style={{ width: inspectorW }}
        >
          <Inspector />
        </div>
      </div>
    </div>
  );
}
