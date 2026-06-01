/**
 * Layer 1 / Layer 2 boundary: FrameRenderManifest
 *
 * This is the ONLY interface between the Temporal Composition Engine (Layer 2)
 * and the WebGPU Render Pipeline (Layer 1). It is:
 * - Completely stateless (no project references, no asset fetching)
 * - Fully deterministic: the same manifest always produces the same pixels
 * - Flat: nested compositions are already resolved into a flat draw list
 *
 * To guarantee WYSIWYG export parity, both preview and export rendering
 * must call: TemporalCompositionEngine.buildManifest(project, timeUs) → manifest
 * then:       MoGraphRenderer.executeManifest(manifest) → ImageBitmap
 */

import type { MoBlendMode } from "./schema";

// ---------------------------------------------------------------------------
// Draw command types
// ---------------------------------------------------------------------------

export type RenderCommandType =
  | "texture"       // rasterized image / video frame / precomp result
  | "solid"         // fill rect with color
  | "text"          // text glyph atlas (pre-rasterized)
  | "shape"         // vector shape (rendered to offscreen canvas → texture)
  | "adjustment";   // applies effects to all commands below it in scope

/** 4×4 column-major transform matrix (WebGPU convention) */
export type Mat4 = Float32Array;

/** Normalized RGBA color */
export interface RgbaColor {
  readonly r: number;  // 0-1
  readonly g: number;  // 0-1
  readonly b: number;  // 0-1
  readonly a: number;  // 0-1
}

// ---------------------------------------------------------------------------
// Effect descriptor — maps directly to a ShaderRegistry entry
// ---------------------------------------------------------------------------

export interface EffectDescriptor {
  readonly shaderId: string;
  readonly enabled: boolean;
  /** Uniform values — all must be number | number[] for GPU upload */
  readonly uniforms: Readonly<Record<string, number | number[]>>;
}

// ---------------------------------------------------------------------------
// Mask descriptor
// ---------------------------------------------------------------------------

export type MaskType = "rectangle" | "ellipse" | "path" | "alpha-matte";

export interface MaskDescriptor {
  readonly type: MaskType;
  readonly inverted: boolean;
  readonly feather: number;
  readonly opacity: number;
  readonly transform: Mat4;
  readonly pathData?: string;
  /** For alpha-matte: index into the draw list of the matte source command */
  readonly matteCommandIndex?: number;
}

// ---------------------------------------------------------------------------
// Individual draw commands
// ---------------------------------------------------------------------------

export interface TextureCommand {
  readonly kind: "texture";
  /** Resolved image source — renderer looks this up in its texture cache */
  readonly textureKey: string;
  readonly transform: Mat4;
  readonly opacity: number;
  readonly blendMode: MoBlendMode;
  readonly effects: readonly EffectDescriptor[];
  readonly masks: readonly MaskDescriptor[];
  readonly crop?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly borderRadius?: number;
}

export interface SolidCommand {
  readonly kind: "solid";
  readonly color: RgbaColor;
  readonly transform: Mat4;
  readonly opacity: number;
  readonly blendMode: MoBlendMode;
  readonly effects: readonly EffectDescriptor[];
  readonly masks: readonly MaskDescriptor[];
  readonly borderRadius?: number;
}

export interface TextCommand {
  readonly kind: "text";
  /** Pre-rasterized text glyph atlas texture key */
  readonly textureKey: string;
  readonly transform: Mat4;
  readonly opacity: number;
  readonly blendMode: MoBlendMode;
  readonly effects: readonly EffectDescriptor[];
  readonly masks: readonly MaskDescriptor[];
}

export interface ShapeCommand {
  readonly kind: "shape";
  /** Pre-rasterized shape texture key */
  readonly textureKey: string;
  readonly transform: Mat4;
  readonly opacity: number;
  readonly blendMode: MoBlendMode;
  readonly effects: readonly EffectDescriptor[];
  readonly masks: readonly MaskDescriptor[];
}

/** Marks a range of commands to apply adjustment effects to */
export interface AdjustmentCommand {
  readonly kind: "adjustment";
  readonly effects: readonly EffectDescriptor[];
  /** Number of draw commands below this one that fall in scope */
  readonly scopeDepth: number;
}

export type DrawCommand =
  | TextureCommand
  | SolidCommand
  | TextCommand
  | ShapeCommand
  | AdjustmentCommand;

// ---------------------------------------------------------------------------
// Texture source descriptors
// ---------------------------------------------------------------------------

/** Describes a video frame that needs to be decoded at a specific time */
export interface VideoFrameSource {
  readonly kind: "video";
  readonly mediaId: string;
  readonly timeUs: number;             // position within the source file
}

/** A static image asset */
export interface ImageSource {
  readonly kind: "image";
  readonly mediaId: string;
}

/** A pre-rasterized text atlas */
export interface TextAtlasSource {
  readonly kind: "text-atlas";
  readonly text: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly color: string;
  readonly strokeColor?: string;
  readonly strokeWidth?: number;
  readonly width: number;
  readonly height: number;
}

/** A pre-rasterized vector shape */
export interface ShapeRasterSource {
  readonly kind: "shape-raster";
  readonly shapeType: string;
  readonly fillColor?: string;
  readonly strokeColor?: string;
  readonly strokeWidth?: number;
  readonly pathData?: string;
  readonly width: number;
  readonly height: number;
  readonly cornerRadius?: number;
}

export type TextureSource =
  | VideoFrameSource
  | ImageSource
  | TextAtlasSource
  | ShapeRasterSource;

// ---------------------------------------------------------------------------
// The Frame Render Manifest
// ---------------------------------------------------------------------------

export interface FrameRenderManifest {
  /** Canonical description of this frame — same value always = same pixels */
  readonly frameId: string;

  /** Composition dimensions */
  readonly width: number;
  readonly height: number;

  /** Frame rate (for display, not rendering logic) */
  readonly frameRate: number;

  /** Exact time this manifest represents */
  readonly timeUs: number;

  /** Background color */
  readonly backgroundColor: RgbaColor;

  /**
   * Ordered draw list — bottom to top (index 0 is rendered first/bottom).
   * AdjustmentCommands apply effects to commands below them within scopeDepth.
   */
  readonly commands: readonly DrawCommand[];

  /**
   * Texture sources the renderer must resolve before executing commands.
   * Keyed by the textureKey used in commands above.
   */
  readonly textureSources: Readonly<Record<string, TextureSource>>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function createIdentityMat4(): Mat4 {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

export function mat4FromTransformParams(
  tx: number,
  ty: number,
  scaleX: number,
  scaleY: number,
  rotationDeg: number,
  anchorX: number,
  anchorY: number,
  canvasWidth: number,
  canvasHeight: number,
): Mat4 {
  const matrix = new Float32Array(16);
  const radians = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  // Normalize to clip space
  const normalizedX = (tx / canvasWidth) * 2;
  const normalizedY = (ty / canvasHeight) * 2;
  const anchorOffsetX = (anchorX - 0.5) * 2;
  const anchorOffsetY = (anchorY - 0.5) * 2;

  // Column 0
  matrix[0] = scaleX * cos;
  matrix[1] = scaleX * sin;
  matrix[2] = 0;
  matrix[3] = 0;
  // Column 1
  matrix[4] = -scaleY * sin;
  matrix[5] = scaleY * cos;
  matrix[6] = 0;
  matrix[7] = 0;
  // Column 2
  matrix[8] = 0;
  matrix[9] = 0;
  matrix[10] = 1;
  matrix[11] = 0;
  // Column 3 (translation with anchor correction)
  matrix[12] =
    normalizedX +
    anchorOffsetX * (1 - scaleX * cos) +
    anchorOffsetY * scaleY * sin;
  matrix[13] =
    normalizedY +
    anchorOffsetY * (1 - scaleY * cos) -
    anchorOffsetX * scaleX * sin;
  matrix[14] = 0;
  matrix[15] = 1;

  return matrix;
}

export function hexToRgba(hex: string, alpha = 1): RgbaColor {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean, 16);
  return {
    r: ((bigint >> 16) & 255) / 255,
    g: ((bigint >> 8) & 255) / 255,
    b: (bigint & 255) / 255,
    a: alpha,
  };
}
