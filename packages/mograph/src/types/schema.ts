/**
 * Layer 3: FlashFX v2 Project State Schema
 *
 * Rules:
 * - No functions, methods, or class instances inside this state
 * - 100% JSON-serializable (no FileSystemFileHandle, no Blob)
 * - Every feature that isn't serializable here doesn't exist
 * - Media assets are referenced by ID only; runtime blobs live in AssetStore (outside state)
 */

// ---------------------------------------------------------------------------
// Temporal precision
// ---------------------------------------------------------------------------

/** Time in microseconds as an integer — avoids float accumulation across long timelines */
export type TimeMicros = number;

/** Frames as integer count — use alongside project frameRate for frame-accurate ops */
export type FrameIndex = number;

export function microsToSeconds(t: TimeMicros): number {
  return t / 1_000_000;
}

export function secondsToMicros(s: number): TimeMicros {
  return Math.round(s * 1_000_000);
}

export function frameToMicros(frame: FrameIndex, fps: number): TimeMicros {
  return Math.round((frame / fps) * 1_000_000);
}

export function microsToFrame(t: TimeMicros, fps: number): FrameIndex {
  return Math.round((t / 1_000_000) * fps);
}

// ---------------------------------------------------------------------------
// Easing — extended with "hold" (After Effects-style step)
// ---------------------------------------------------------------------------

export type MoEasingType =
  | "linear"
  | "hold"          // snaps to keyframeA value until keyframeB, then snaps to keyframeB
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "bezier"
  | "easeInQuad"
  | "easeOutQuad"
  | "easeInOutQuad"
  | "easeInCubic"
  | "easeOutCubic"
  | "easeInOutCubic"
  | "easeInQuart"
  | "easeOutQuart"
  | "easeInOutQuart"
  | "easeInExpo"
  | "easeOutExpo"
  | "easeInOutExpo"
  | "easeInBack"
  | "easeOutBack"
  | "easeInOutBack"
  | "easeInElastic"
  | "easeOutElastic"
  | "easeInOutElastic"
  | "easeInBounce"
  | "easeOutBounce"
  | "easeInOutBounce";

export interface MoBezierHandles {
  readonly inX: number;
  readonly inY: number;
  readonly outX: number;
  readonly outY: number;
}

export interface MoKeyframe {
  readonly id: string;
  readonly timeUs: TimeMicros;          // precision: microseconds
  readonly property: string;            // dot-path: "transform.position.x"
  readonly value: MoKeyframeValue;
  readonly easing: MoEasingType;
  readonly bezier?: MoBezierHandles;    // only when easing === "bezier"
}

export type MoKeyframeValue =
  | number
  | string
  | boolean
  | { readonly [key: string]: MoKeyframeValue };

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

export interface MoVec2 {
  readonly x: number;
  readonly y: number;
}

export interface MoVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface MoTransform {
  readonly position: MoVec2;
  readonly scale: MoVec2;
  readonly rotation: number;            // degrees, CCW positive
  readonly anchor: MoVec2;             // normalized 0-1 relative to layer bounds
  readonly opacity: number;             // 0-1
  readonly skewX?: number;
  readonly skewY?: number;
  /** 3D perspective transform */
  readonly rotationX?: number;
  readonly rotationY?: number;
  readonly rotationZ?: number;
  readonly perspective?: number;
  /** Crop in normalized UV space (0-1) */
  readonly crop?: MoCrop;
  readonly borderRadius?: number;
}

export interface MoCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function defaultTransform(): MoTransform {
  return {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    anchor: { x: 0.5, y: 0.5 },
    opacity: 1,
  };
}

// ---------------------------------------------------------------------------
// Blend modes — all 16 Porter-Duff + photoshop blend modes
// ---------------------------------------------------------------------------

export type MoBlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity"
  | "add"
  | "subtract";

// ---------------------------------------------------------------------------
// Effects — open-ended, shader-driven
// ---------------------------------------------------------------------------

export interface MoEffect {
  readonly id: string;
  readonly type: string;                // maps to a ShaderRegistry entry key
  readonly enabled: boolean;
  readonly params: MoEffectParams;
}

/** Shader uniform values — must all be serializable primitives */
export type MoEffectParams = {
  readonly [key: string]: number | string | boolean | number[];
};

// ---------------------------------------------------------------------------
// Mask
// ---------------------------------------------------------------------------

export type MoMaskType = "rectangle" | "ellipse" | "path" | "layer";

export interface MoMask {
  readonly id: string;
  readonly type: MoMaskType;
  readonly inverted: boolean;
  readonly feather: number;
  readonly opacity: number;
  /** For type "path": SVG path data string */
  readonly pathData?: string;
  /** For type "layer": the layer ID to use as a luma/alpha matte */
  readonly matteLayerId?: string;
  readonly transform: MoTransform;
}

// ---------------------------------------------------------------------------
// Layers — the building block of a Composition
// ---------------------------------------------------------------------------

export type MoLayerType =
  | "video"
  | "image"
  | "audio"
  | "text"
  | "shape"
  | "solid"
  | "precomp"     // nested composition reference
  | "adjustment"  // applies effects to all layers below
  | "null";       // invisible, used as a parent for parenting

export interface MoLayerBase {
  readonly id: string;
  readonly type: MoLayerType;
  readonly name: string;

  /** Timeline placement in microseconds */
  readonly startTimeUs: TimeMicros;
  readonly durationUs: TimeMicros;

  /** Source trim points (for video/audio/precomp) in microseconds within source */
  readonly inPointUs: TimeMicros;
  readonly outPointUs: TimeMicros;

  readonly transform: MoTransform;
  readonly effects: readonly MoEffect[];
  readonly masks: readonly MoMask[];
  readonly blendMode: MoBlendMode;
  readonly keyframes: readonly MoKeyframe[];

  readonly visible: boolean;
  readonly locked: boolean;
  readonly solo: boolean;

  /** Parent layer ID for parenting / null object hierarchies */
  readonly parentId?: string;

  /** Layer index in composition (higher = on top) */
  readonly zIndex: number;
}

export interface MoVideoLayer extends MoLayerBase {
  readonly type: "video";
  readonly mediaId: string;            // ref to MoAssetRef.id (no blob/FileHandle here)
  readonly speed: number;
  readonly reversed: boolean;
  readonly volume: number;
  readonly audioEffects: readonly MoEffect[];
}

export interface MoImageLayer extends MoLayerBase {
  readonly type: "image";
  readonly mediaId: string;
}

export interface MoAudioLayer extends MoLayerBase {
  readonly type: "audio";
  readonly mediaId: string;
  readonly volume: number;
  readonly audioEffects: readonly MoEffect[];
  readonly fade?: { readonly fadeIn: number; readonly fadeOut: number };
}

export interface MoTextLayer extends MoLayerBase {
  readonly type: "text";
  readonly text: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly color: string;
  readonly strokeColor?: string;
  readonly strokeWidth?: number;
  readonly textAlign: "left" | "center" | "right";
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  readonly textAnimation?: MoTextAnimation;
}

export interface MoTextAnimation {
  readonly type: string;
  readonly duration: number;
  readonly delay: number;
  readonly stagger: number;
  readonly unit: "character" | "word" | "line";
}

export interface MoShapeLayer extends MoLayerBase {
  readonly type: "shape";
  readonly shapeType: "rectangle" | "ellipse" | "polygon" | "star" | "path" | "line";
  readonly fillColor?: string;
  readonly strokeColor?: string;
  readonly strokeWidth?: number;
  readonly pathData?: string;           // SVG path data for custom shapes
  readonly cornerRadius?: number;
  readonly sides?: number;              // for polygon
  readonly points?: number;             // for star
  readonly innerRadius?: number;        // for star
}

export interface MoSolidLayer extends MoLayerBase {
  readonly type: "solid";
  readonly color: string;              // CSS hex or rgba
  readonly width: number;
  readonly height: number;
}

export interface MoPrecompLayer extends MoLayerBase {
  readonly type: "precomp";
  readonly compositionId: string;      // ref to another MoComposition in the project
  readonly timeOffset: number;         // microseconds: offset into the precomp's timeline
}

export interface MoAdjustmentLayer extends MoLayerBase {
  readonly type: "adjustment";
  // effects array (inherited from base) applies to all layers below
}

export interface MoNullLayer extends MoLayerBase {
  readonly type: "null";
}

export type MoLayer =
  | MoVideoLayer
  | MoImageLayer
  | MoAudioLayer
  | MoTextLayer
  | MoShapeLayer
  | MoSolidLayer
  | MoPrecompLayer
  | MoAdjustmentLayer
  | MoNullLayer;

// ---------------------------------------------------------------------------
// Composition — the core container (equivalent to AE Composition)
// ---------------------------------------------------------------------------

export interface MoComposition {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly durationUs: TimeMicros;
  readonly backgroundColor: string;    // CSS hex
  readonly layers: readonly MoLayer[];
  readonly markers: readonly MoMarker[];
}

export interface MoMarker {
  readonly id: string;
  readonly timeUs: TimeMicros;
  readonly label: string;
  readonly color: string;
  readonly durationUs?: TimeMicros;
  readonly comment?: string;
}

// ---------------------------------------------------------------------------
// Asset references — serializable, no runtime objects
// ---------------------------------------------------------------------------

/** Describes a media asset by its stable identity — no FileHandle, no Blob */
export interface MoAssetRef {
  readonly id: string;
  readonly name: string;
  readonly type: "video" | "audio" | "image" | "font" | "lut";
  readonly mimeType: string;
  /** File fingerprint for cross-session asset matching */
  readonly fileHint: {
    readonly name: string;
    readonly size: number;
    readonly lastModified: number;
  };
  readonly metadata: MoAssetMetadata;
  readonly thumbnailDataUrl?: string;  // small base64 thumbnail (safe to serialize)
}

export interface MoAssetMetadata {
  readonly duration?: number;          // seconds, for video/audio
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: number;
  readonly codec?: string;
  readonly sampleRate?: number;
  readonly channels?: number;
  readonly fileSize: number;
}

// ---------------------------------------------------------------------------
// Project settings
// ---------------------------------------------------------------------------

export interface MoProjectSettings {
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly sampleRate: number;
  readonly channels: number;
  /** Main composition ID (entry point) */
  readonly mainCompositionId: string;
}

// ---------------------------------------------------------------------------
// The Project — root of the entire state tree
// ---------------------------------------------------------------------------

export interface MoProject {
  readonly id: string;
  readonly name: string;
  readonly version: number;            // schema version for migrations
  readonly createdAt: number;          // Unix ms
  readonly modifiedAt: number;
  readonly settings: MoProjectSettings;
  /** All compositions including precomps */
  readonly compositions: Readonly<Record<string, MoComposition>>;
  /** Asset catalog — blobs/file handles live in AssetStore, not here */
  readonly assets: Readonly<Record<string, MoAssetRef>>;
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isVideoLayer(l: MoLayer): l is MoVideoLayer {
  return l.type === "video";
}

export function isAudioLayer(l: MoLayer): l is MoAudioLayer {
  return l.type === "audio";
}

export function isTextLayer(l: MoLayer): l is MoTextLayer {
  return l.type === "text";
}

export function isShapeLayer(l: MoLayer): l is MoShapeLayer {
  return l.type === "shape";
}

export function isPrecompLayer(l: MoLayer): l is MoPrecompLayer {
  return l.type === "precomp";
}

export function isAdjustmentLayer(l: MoLayer): l is MoAdjustmentLayer {
  return l.type === "adjustment";
}

export function hasMediaSource(l: MoLayer): l is MoVideoLayer | MoImageLayer | MoAudioLayer {
  return l.type === "video" || l.type === "image" || l.type === "audio";
}
