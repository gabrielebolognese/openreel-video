/**
 * Preview canvas — manages WebGPU renderer lifecycle and renders each frame.
 */
import React, { useEffect, useRef, useState } from "react";
import { FlashFXEngine } from "@openreel/mograph";
import type { TextureResolver } from "@openreel/mograph";
import { useProjectStore } from "../../stores/project-store";

// A no-op resolver for static assets (extend with real media loading)
const nullResolver: TextureResolver = async (_key, source) => {
  if (source.kind === "text-atlas") {
    // Rasterize text to canvas
    const canvas = new OffscreenCanvas(source.width, source.height);
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, source.width, source.height);
    ctx.font = `${source.fontWeight} ${source.fontSize}px "${source.fontFamily}", sans-serif`;
    ctx.fillStyle = source.color;
    ctx.textBaseline = "middle";
    ctx.fillText(source.text, 8, source.height / 2);
    return createImageBitmap(canvas);
  }
  if (source.kind === "shape-raster") {
    const canvas = new OffscreenCanvas(source.width, source.height);
    const ctx = canvas.getContext("2d")!;
    if (source.fillColor) ctx.fillStyle = source.fillColor;
    if (source.shapeType === "rectangle") {
      const r = source.cornerRadius ?? 0;
      ctx.beginPath();
      ctx.roundRect(2, 2, source.width - 4, source.height - 4, r);
      ctx.fill();
    } else if (source.shapeType === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(source.width / 2, source.height / 2, source.width / 2 - 2, source.height / 2 - 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    return createImageBitmap(canvas);
  }
  // Return a 1×1 transparent bitmap for unresolvable sources
  const placeholder = new OffscreenCanvas(1, 1);
  return createImageBitmap(placeholder);
};

export function PreviewCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<FlashFXEngine | null>(null);
  const [gpuError, setGpuError] = useState<string | null>(null);
  const { project, currentTimeUs } = useProjectStore();

  // Initialize engine
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    FlashFXEngine.create({ canvas, textureResolver: nullResolver })
      .then((engine) => {
        if (cancelled) { engine.destroy(); return; }
        engineRef.current = engine;
      })
      .catch((err: unknown) => {
        if (!cancelled) setGpuError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, []);

  // Render on time or project change
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.renderPreviewFrame(project, currentTimeUs).catch(() => { /* silently skip dropped frames */ });
  }, [project, currentTimeUs]);

  // Resize canvas when container resizes
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (canvasRef.current) {
        canvasRef.current.width = Math.round(width);
        canvasRef.current.height = Math.round(height);
      }
      engineRef.current?.resize(Math.round(width), Math.round(height));
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  if (gpuError) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-xs rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-center">
          <p className="mb-1 text-sm font-medium text-red-400">WebGPU unavailable</p>
          <p className="text-xs text-fg-3">{gpuError}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        style={{ imageRendering: "pixelated" }}
      />
    </div>
  );
}
