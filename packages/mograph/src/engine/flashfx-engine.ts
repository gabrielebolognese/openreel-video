/**
 * FlashFXEngine — top-level orchestrator wiring all four Pyramid layers.
 *
 * Layer 4 (UI) only ever calls this class. It never touches the renderer,
 * the temporal engine, or the schema directly.
 *
 * WYSIWYG parity is structural: both preview and export follow the same path:
 *   MoProject + timeUs
 *     → TemporalCompositionEngine.buildManifest()   [Layer 2]
 *     → FrameRenderManifest
 *     → MoGraphRenderer.executeManifest()           [Layer 1]
 *     → ImageBitmap
 */

import type { MoProject, TimeMicros } from "../types/schema";
import { frameToMicros } from "../types/schema";
import { TemporalCompositionEngine } from "./temporal-composition-engine";
import {
  MoGraphRenderer,
  type RendererInitConfig,
  type TextureResolver,
} from "../renderer/mograph-renderer";
import { createDefaultShaderRegistry } from "../renderer/shader-registry";
import type { FrameRenderManifest } from "../types/manifest";

export interface FlashFXEngineConfig {
  /**
   * Optional canvas to draw preview frames into via 2D blit.
   * If provided, each rendered ImageBitmap is drawn to this canvas automatically.
   */
  canvas?: HTMLCanvasElement | OffscreenCanvas;
  width?: number;
  height?: number;
  /** Maximum GPU texture cache in bytes (default 512 MB) */
  maxTextureCacheBytes?: number;
  /**
   * Resolver converts a textureKey + TextureSource descriptor into a decoded
   * ImageBitmap. The engine itself is asset-agnostic; the caller provides the
   * media / file access layer.
   */
  textureResolver: TextureResolver;
}

export interface EngineStats {
  readonly lastFrameMs: number;
  readonly gpuMemoryBytes: number;
  readonly textureCacheSize: number;
}

export class FlashFXEngine {
  private renderer: MoGraphRenderer;
  private temporalEngine = new TemporalCompositionEngine();
  private textureResolver: TextureResolver;
  private displayCanvas: HTMLCanvasElement | OffscreenCanvas | undefined;
  private lastFrameMs = 0;

  private constructor(renderer: MoGraphRenderer, textureResolver: TextureResolver, displayCanvas?: HTMLCanvasElement | OffscreenCanvas) {
    this.renderer = renderer;
    this.textureResolver = textureResolver;
    this.displayCanvas = displayCanvas;
  }

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------

  static async create(config: FlashFXEngineConfig): Promise<FlashFXEngine> {
    const registry = createDefaultShaderRegistry();

    const width = config.width ?? (config.canvas instanceof HTMLCanvasElement ? config.canvas.width : (config.canvas as OffscreenCanvas | undefined)?.width) ?? 1920;
    const height = config.height ?? (config.canvas instanceof HTMLCanvasElement ? config.canvas.height : (config.canvas as OffscreenCanvas | undefined)?.height) ?? 1080;

    const rendererConfig: RendererInitConfig = {
      width: width || 1920,
      height: height || 1080,
      shaderRegistry: registry,
      maxTextureCacheBytes: config.maxTextureCacheBytes,
    };

    const renderer = new MoGraphRenderer(rendererConfig);
    const ok = await renderer.initialize();
    if (!ok) {
      throw new Error(
        "WebGPU is not available in this environment. " +
          "Please use a browser that supports WebGPU (Chrome 113+, Edge 113+).",
      );
    }

    return new FlashFXEngine(renderer, config.textureResolver, config.canvas);
  }

  // ---------------------------------------------------------------------------
  // Preview rendering (interactive, called on scrub / playback tick)
  // ---------------------------------------------------------------------------

  /** Render a single preview frame at the given microsecond timestamp. */
  async renderPreviewFrame(project: MoProject, timeUs: TimeMicros): Promise<ImageBitmap> {
    const t0 = performance.now();
    const manifest = this.temporalEngine.buildManifest(project, timeUs);
    const bitmap = await this.renderer.executeManifest(manifest, this.textureResolver);
    this.lastFrameMs = performance.now() - t0;

    // Blit to display canvas if one was provided
    if (this.displayCanvas) {
      const ctx = (this.displayCanvas as HTMLCanvasElement).getContext("2d") as CanvasRenderingContext2D | null;
      if (ctx) {
        ctx.clearRect(0, 0, this.displayCanvas.width, this.displayCanvas.height);
        ctx.drawImage(bitmap, 0, 0, this.displayCanvas.width, this.displayCanvas.height);
      }
    }

    return bitmap;
  }

  // ---------------------------------------------------------------------------
  // Export rendering (deterministic, frame-exact)
  // ---------------------------------------------------------------------------

  /** Render a single export frame by frame index (0-based). */
  async renderExportFrame(project: MoProject, frameIndex: number): Promise<ImageBitmap> {
    const mainComp = project.compositions[project.settings.mainCompositionId];
    if (!mainComp) throw new Error("Main composition not found");

    const timeUs = frameToMicros(frameIndex, mainComp.frameRate);
    return this.renderPreviewFrame(project, timeUs);
  }

  /**
   * Export every frame of the project, yielding each `ImageBitmap` in order.
   * The caller is responsible for encoding / muxing.
   *
   * @param onProgress optional callback (0–1) after each frame
   */
  async *exportFrames(
    project: MoProject,
    onProgress?: (progress: number) => void,
  ): AsyncGenerator<{ frameIndex: number; timeUs: TimeMicros; bitmap: ImageBitmap }> {
    const mainComp = project.compositions[project.settings.mainCompositionId];
    if (!mainComp) throw new Error("Main composition not found");

    const totalFrames = Math.ceil(
      (mainComp.durationUs / 1_000_000) * mainComp.frameRate,
    );

    for (let i = 0; i < totalFrames; i++) {
      const timeUs = frameToMicros(i, mainComp.frameRate);
      const bitmap = await this.renderPreviewFrame(project, timeUs);
      onProgress?.((i + 1) / totalFrames);
      yield { frameIndex: i, timeUs, bitmap };
    }
  }

  // ---------------------------------------------------------------------------
  // Manifest inspection (for testing / debugging)
  // ---------------------------------------------------------------------------

  /** Build a manifest without rendering — useful for tests. */
  buildManifest(project: MoProject, timeUs: TimeMicros): FrameRenderManifest {
    return this.temporalEngine.buildManifest(project, timeUs);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  resize(width: number, height: number): void {
    this.renderer.resize(width, height);
  }

  invalidateMedia(mediaId: string): void {
    this.renderer.invalidateMediaTextures(mediaId);
  }

  destroy(): void {
    this.renderer.destroy();
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  get stats(): EngineStats {
    return {
      lastFrameMs: this.lastFrameMs,
      gpuMemoryBytes: 0,   // populated by renderer internals if needed
      textureCacheSize: 0,
    };
  }
}
