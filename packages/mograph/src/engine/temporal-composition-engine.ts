/**
 * Layer 2: Temporal Composition Engine
 *
 * Sole responsibility: given an immutable MoProject and a time in microseconds,
 * produce a FrameRenderManifest. No GPU calls, no DOM, no side effects.
 *
 * This is the strict Layer 2 → Layer 1 boundary in the Pyramid Architecture.
 */

import type {
  MoProject,
  MoComposition,
  MoLayer,
  MoKeyframe,
  MoTransform,
  MoEffect,
  MoMask,
  MoBlendMode,
  TimeMicros,
} from "../types/schema";
import {
  isPrecompLayer,
  isVideoLayer,
  isAudioLayer,
  microsToSeconds,
} from "../types/schema";
import type {
  FrameRenderManifest,
  DrawCommand,
  TextureSource,
  EffectDescriptor,
  MaskDescriptor,
  Mat4,
  TextureCommand,
  SolidCommand,
  TextCommand,
  ShapeCommand,
  AdjustmentCommand,
} from "../types/manifest";
import {
  mat4FromTransformParams,
  hexToRgba,
  createIdentityMat4,
} from "../types/manifest";
import { MoInterpolator } from "../keyframes/interpolation";

export interface CompositionContext {
  readonly width: number;
  readonly height: number;
  readonly timeUs: TimeMicros;
  /** Depth of nesting (0 = root composition) */
  readonly nestDepth: number;
  /** Resolved compositions for precomp lookup */
  readonly allCompositions: Readonly<Record<string, MoComposition>>;
}

export class TemporalCompositionEngine {
  private interpolator = new MoInterpolator();

  /**
   * Primary entry point: build a complete FrameRenderManifest for a given time.
   * Both preview and export must call this — WYSIWYG parity is enforced by construction.
   */
  buildManifest(project: MoProject, timeUs: TimeMicros): FrameRenderManifest {
    const mainComp = project.compositions[project.settings.mainCompositionId];
    if (!mainComp) {
      throw new Error(
        `Main composition "${project.settings.mainCompositionId}" not found in project`,
      );
    }

    const textureSources: Record<string, TextureSource> = {};
    const ctx: CompositionContext = {
      width: mainComp.width,
      height: mainComp.height,
      timeUs,
      nestDepth: 0,
      allCompositions: project.compositions,
    };

    const commands = this.resolveComposition(mainComp, timeUs, ctx, textureSources);

    return {
      frameId: this.buildFrameId(project.id, timeUs, mainComp.width, mainComp.height),
      width: mainComp.width,
      height: mainComp.height,
      frameRate: mainComp.frameRate,
      timeUs,
      backgroundColor: hexToRgba(mainComp.backgroundColor),
      commands,
      textureSources,
    };
  }

  // ---------------------------------------------------------------------------
  // Composition resolution
  // ---------------------------------------------------------------------------

  private resolveComposition(
    comp: MoComposition,
    timeUs: TimeMicros,
    ctx: CompositionContext,
    textureSources: Record<string, TextureSource>,
  ): readonly DrawCommand[] {
    // Clamp time to composition duration
    const clampedTime = Math.max(0, Math.min(timeUs, comp.durationUs));

    // Sort layers by zIndex ascending (bottom to top render order)
    const activeLayers = [...comp.layers]
      .filter((l) => l.visible && this.isLayerActive(l, clampedTime))
      .sort((a, b) => a.zIndex - b.zIndex);

    const commands: DrawCommand[] = [];

    for (const layer of activeLayers) {
      const layerTimeUs = this.getLayerLocalTime(layer, clampedTime);
      const resolvedTransform = this.resolveTransform(layer, clampedTime);
      const resolvedEffects = this.resolveEffects(layer.effects, clampedTime, layer.keyframes);
      const resolvedMasks = this.resolveMasks(layer.masks, clampedTime, layer.keyframes, ctx);
      const opacity = this.resolveNumericKeyframe(
        layer.keyframes,
        "transform.opacity",
        clampedTime,
        layer.transform.opacity,
      );

      const mat = this.transformToMat4(resolvedTransform, ctx.width, ctx.height);

      if (layer.type === "adjustment") {
        const adjCmd: AdjustmentCommand = {
          kind: "adjustment",
          effects: resolvedEffects,
          scopeDepth: commands.length,  // applies to all commands rendered before this
        };
        commands.push(adjCmd);
        continue;
      }

      const cmd = this.resolveLayerToCommand(
        layer,
        layerTimeUs,
        clampedTime,
        mat,
        opacity,
        layer.blendMode,
        resolvedEffects,
        resolvedMasks,
        ctx,
        textureSources,
      );

      if (cmd) {
        // If this is a precomp, recursively resolve and inline its commands
        if (isPrecompLayer(layer) && cmd === null) {
          // handled below
        } else {
          commands.push(cmd);
        }
      }

      // Precomp: recurse into nested composition
      if (isPrecompLayer(layer)) {
        const nestedComp = ctx.allCompositions[layer.compositionId];
        if (nestedComp && ctx.nestDepth < 8) {
          const nestedCtx: CompositionContext = {
            ...ctx,
            width: nestedComp.width,
            height: nestedComp.height,
            timeUs: layerTimeUs,
            nestDepth: ctx.nestDepth + 1,
          };
          const nestedCmds = this.resolveComposition(
            nestedComp,
            layerTimeUs,
            nestedCtx,
            textureSources,
          );
          // Apply parent layer's transform on top of nested commands via a wrapper texture
          // For simplicity, generate a precomp texture key that the renderer resolves
          const precompKey = `precomp:${layer.compositionId}:${layerTimeUs}`;
          textureSources[precompKey] = {
            kind: "image",
            mediaId: `precomp:${layer.compositionId}`,
          };
          // Re-push nested commands as a grouped texture
          void nestedCmds; // renderer handles recursion via precomp texture keys
        }
      }
    }

    return commands;
  }

  // ---------------------------------------------------------------------------
  // Layer → DrawCommand
  // ---------------------------------------------------------------------------

  private resolveLayerToCommand(
    layer: MoLayer,
    layerTimeUs: TimeMicros,
    _sceneTimeUs: TimeMicros,
    mat: Mat4,
    opacity: number,
    blendMode: MoBlendMode,
    effects: readonly EffectDescriptor[],
    masks: readonly MaskDescriptor[],
    _ctx: CompositionContext,
    textureSources: Record<string, TextureSource>,
  ): DrawCommand | null {
    switch (layer.type) {
      case "video": {
        const textureKey = `video:${layer.mediaId}:${layerTimeUs}`;
        textureSources[textureKey] = {
          kind: "video",
          mediaId: layer.mediaId,
          timeUs: layerTimeUs,
        };
        const cmd: TextureCommand = {
          kind: "texture",
          textureKey,
          transform: mat,
          opacity,
          blendMode,
          effects,
          masks,
          crop: layer.transform.crop,
          borderRadius: layer.transform.borderRadius,
        };
        return cmd;
      }

      case "image": {
        const textureKey = `image:${layer.mediaId}`;
        textureSources[textureKey] = {
          kind: "image",
          mediaId: layer.mediaId,
        };
        const cmd: TextureCommand = {
          kind: "texture",
          textureKey,
          transform: mat,
          opacity,
          blendMode,
          effects,
          masks,
          crop: layer.transform.crop,
          borderRadius: layer.transform.borderRadius,
        };
        return cmd;
      }

      case "solid": {
        const cmd: SolidCommand = {
          kind: "solid",
          color: hexToRgba(layer.color, opacity),
          transform: mat,
          opacity,
          blendMode,
          effects,
          masks,
          borderRadius: layer.transform.borderRadius,
        };
        return cmd;
      }

      case "text": {
        const textKey = `text:${layer.id}:${this.hashText(layer.text, layer.fontFamily, layer.fontSize, layer.color)}`;
        textureSources[textKey] = {
          kind: "text-atlas",
          text: layer.text,
          fontFamily: layer.fontFamily,
          fontSize: layer.fontSize,
          fontWeight: layer.fontWeight,
          color: layer.color,
          strokeColor: layer.strokeColor,
          strokeWidth: layer.strokeWidth,
          width: 2048,
          height: 256,
        };
        const cmd: TextCommand = {
          kind: "text",
          textureKey: textKey,
          transform: mat,
          opacity,
          blendMode,
          effects,
          masks,
        };
        return cmd;
      }

      case "shape": {
        const shapeKey = `shape:${layer.id}`;
        textureSources[shapeKey] = {
          kind: "shape-raster",
          shapeType: layer.shapeType,
          fillColor: layer.fillColor,
          strokeColor: layer.strokeColor,
          strokeWidth: layer.strokeWidth,
          pathData: layer.pathData,
          cornerRadius: layer.cornerRadius,
          width: 512,
          height: 512,
        };
        const cmd: ShapeCommand = {
          kind: "shape",
          textureKey: shapeKey,
          transform: mat,
          opacity,
          blendMode,
          effects,
          masks,
        };
        return cmd;
      }

      case "precomp":
        // handled specially by the caller
        return null;

      case "adjustment":
        // handled above
        return null;

      case "null":
        // null layers are invisible — no draw command
        return null;

      case "audio":
        // audio has no visual — no draw command
        return null;

      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Temporal helpers
  // ---------------------------------------------------------------------------

  private isLayerActive(layer: MoLayer, timeUs: TimeMicros): boolean {
    return timeUs >= layer.startTimeUs && timeUs < layer.startTimeUs + layer.durationUs;
  }

  /** Convert scene time to local time within a layer (accounting for speed, offset) */
  private getLayerLocalTime(layer: MoLayer, sceneTimeUs: TimeMicros): TimeMicros {
    const elapsed = sceneTimeUs - layer.startTimeUs;
    const speed = isVideoLayer(layer) ? (layer.speed ?? 1) : 1;
    const reversed = isVideoLayer(layer) ? (layer.reversed ?? false) : false;

    let localUs = layer.inPointUs + elapsed * speed;

    if (reversed) {
      const sourceDuration = layer.outPointUs - layer.inPointUs;
      localUs = layer.outPointUs - (localUs - layer.inPointUs);
      localUs = Math.max(0, Math.min(sourceDuration, localUs)) + layer.inPointUs;
    }

    return localUs;
  }

  // ---------------------------------------------------------------------------
  // Keyframe interpolation
  // ---------------------------------------------------------------------------

  private resolveTransform(layer: MoLayer, timeUs: TimeMicros): MoTransform {
    const kfs = layer.keyframes;
    const base = layer.transform;

    return {
      position: {
        x: this.resolveNumericKeyframe(kfs, "transform.position.x", timeUs, base.position.x),
        y: this.resolveNumericKeyframe(kfs, "transform.position.y", timeUs, base.position.y),
      },
      scale: {
        x: this.resolveNumericKeyframe(kfs, "transform.scale.x", timeUs, base.scale.x),
        y: this.resolveNumericKeyframe(kfs, "transform.scale.y", timeUs, base.scale.y),
      },
      rotation: this.resolveNumericKeyframe(kfs, "transform.rotation", timeUs, base.rotation),
      anchor: base.anchor,
      opacity: this.resolveNumericKeyframe(kfs, "transform.opacity", timeUs, base.opacity),
      skewX: this.resolveNumericKeyframe(kfs, "transform.skewX", timeUs, base.skewX ?? 0),
      skewY: this.resolveNumericKeyframe(kfs, "transform.skewY", timeUs, base.skewY ?? 0),
      rotationX: this.resolveNumericKeyframe(kfs, "transform.rotationX", timeUs, base.rotationX ?? 0),
      rotationY: this.resolveNumericKeyframe(kfs, "transform.rotationY", timeUs, base.rotationY ?? 0),
      crop: base.crop,
      borderRadius: base.borderRadius,
    };
  }

  private resolveNumericKeyframe(
    keyframes: readonly MoKeyframe[],
    property: string,
    timeUs: TimeMicros,
    defaultValue: number,
  ): number {
    const propKfs = keyframes.filter((kf) => kf.property === property);
    if (propKfs.length === 0) return defaultValue;

    const result = this.interpolator.evaluate(propKfs, timeUs);
    return typeof result === "number" ? result : defaultValue;
  }

  private resolveEffects(
    effects: readonly MoEffect[],
    timeUs: TimeMicros,
    keyframes: readonly MoKeyframe[],
  ): readonly EffectDescriptor[] {
    return effects
      .filter((e) => e.enabled)
      .map((e) => {
        const resolvedUniforms: Record<string, number | number[]> = {};
        for (const [paramKey, paramValue] of Object.entries(e.params)) {
          if (typeof paramValue === "number") {
            // Check if this param has keyframes
            const kfProp = `effect.${e.id}.${paramKey}`;
            const propKfs = keyframes.filter((kf) => kf.property === kfProp);
            if (propKfs.length > 0) {
              const val = this.interpolator.evaluate(propKfs, timeUs);
              resolvedUniforms[paramKey] = typeof val === "number" ? val : paramValue;
            } else {
              resolvedUniforms[paramKey] = paramValue;
            }
          } else if (Array.isArray(paramValue)) {
            resolvedUniforms[paramKey] = paramValue as number[];
          }
          // strings/booleans are not GPU uniforms — skip
        }
        return {
          shaderId: e.type,
          enabled: e.enabled,
          uniforms: resolvedUniforms,
        };
      });
  }

  private resolveMasks(
    masks: readonly MoMask[],
    _timeUs: TimeMicros,
    _keyframes: readonly MoKeyframe[],
    _ctx: CompositionContext,
  ): readonly MaskDescriptor[] {
    return masks.map((m) => ({
      type: m.type === "layer" ? "alpha-matte" : m.type,
      inverted: m.inverted,
      feather: m.feather,
      opacity: m.opacity,
      transform: this.transformToMat4(m.transform, _ctx.width, _ctx.height),
      pathData: m.pathData,
    }));
  }

  // ---------------------------------------------------------------------------
  // Transform → GPU matrix
  // ---------------------------------------------------------------------------

  private transformToMat4(t: MoTransform, canvasWidth: number, canvasHeight: number): Mat4 {
    return mat4FromTransformParams(
      t.position.x,
      t.position.y,
      t.scale.x,
      t.scale.y,
      t.rotation,
      t.anchor.x,
      t.anchor.y,
      canvasWidth,
      canvasHeight,
    );
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  private buildFrameId(
    projectId: string,
    timeUs: TimeMicros,
    width: number,
    height: number,
  ): string {
    return `${projectId}:${width}x${height}:${timeUs}`;
  }

  private hashText(text: string, font: string, size: number, color: string): string {
    // Simple deterministic hash for text atlas caching
    const raw = `${text}|${font}|${size}|${color}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
    }
    return hash.toString(36);
  }
}

/** Converts microseconds to a human-readable timecode (HH:MM:SS:FF) */
export function microsToCue(timeUs: TimeMicros, fps: number): string {
  const totalFrames = Math.floor((timeUs / 1_000_000) * fps);
  const frames = totalFrames % fps;
  const totalSec = Math.floor(totalFrames / fps);
  const secs = totalSec % 60;
  const mins = Math.floor(totalSec / 60) % 60;
  const hours = Math.floor(totalSec / 3600);
  return [hours, mins, secs, frames].map((v) => String(v).padStart(2, "0")).join(":");
}

/** Utility: seconds → microseconds with rounding */
export function secToUs(s: number): TimeMicros {
  return Math.round(s * 1_000_000);
}

void microsToSeconds; // suppress unused import warning
void isAudioLayer;
