/**
 * @openreel/mograph — FlashFX v2 Motion Graphics Engine
 *
 * Public API surface. Import from "@openreel/mograph".
 *
 * Layer usage:
 *   - Layer 4 (UI): use FlashFXEngine + schema types only
 *   - Layer 3 (Schema): MoProject and related types
 *   - Layer 2 (Temporal): TemporalCompositionEngine (advanced use / testing)
 *   - Layer 1 (Renderer): MoGraphRenderer (advanced use / testing)
 */

// Schema types (Layer 3)
export type {
  MoProject,
  MoComposition,
  MoLayer,
  MoVideoLayer,
  MoImageLayer,
  MoTextLayer,
  MoShapeLayer,
  MoSolidLayer,
  MoAudioLayer,
  MoPrecompLayer,
  MoAdjustmentLayer,
  MoNullLayer,
  MoTransform,
  MoKeyframe,
  MoKeyframeValue,
  MoEasingType,
  MoBezierHandles,
  MoEffect,
  MoEffectParams,
  MoMask,
  MoMaskType,
  MoBlendMode,
  MoMarker,
  MoAssetRef,
  MoProjectSettings,
  TimeMicros,
} from "./types/schema";

export {
  microsToSeconds,
  secondsToMicros,
  frameToMicros,
  microsToFrame,
  defaultTransform,
  isVideoLayer,
  isAudioLayer,
  isTextLayer,
  isShapeLayer,
  isPrecompLayer,
  isAdjustmentLayer,
  hasMediaSource,
} from "./types/schema";

// Manifest types (Layer 1/2 boundary)
export type {
  FrameRenderManifest,
  DrawCommand,
  TextureCommand,
  SolidCommand,
  TextCommand,
  ShapeCommand,
  AdjustmentCommand,
  TextureSource,
  VideoFrameSource,
  ImageSource,
  TextAtlasSource,
  ShapeRasterSource,
  EffectDescriptor,
  MaskDescriptor,
  MaskType,
  RgbaColor,
  Mat4,
} from "./types/manifest";

export {
  createIdentityMat4,
  mat4FromTransformParams,
  hexToRgba,
} from "./types/manifest";

// Engine facade (primary API for Layer 4)
export { FlashFXEngine } from "./engine/flashfx-engine";
export type { FlashFXEngineConfig, EngineStats } from "./engine/flashfx-engine";

// Temporal engine (Layer 2 — for testing / advanced use)
export { TemporalCompositionEngine, microsToCue, secToUs } from "./engine/temporal-composition-engine";
export type { CompositionContext } from "./engine/temporal-composition-engine";

// Renderer (Layer 1 — for advanced / testing use)
export { MoGraphRenderer, TextureCache } from "./renderer/mograph-renderer";
export type { RendererInitConfig, TextureHandle, TextureResolver } from "./renderer/mograph-renderer";

// Shader registry (Layer 1)
export {
  ShaderRegistry,
  createDefaultShaderRegistry,
  BLEND_MODE_WGSL,
  BLEND_MODE_INDICES,
  BUILTIN_SHADERS,
} from "./renderer/shader-registry";
export type { ShaderDescriptor, UniformDef } from "./renderer/shader-registry";

// Keyframe interpolation
export { MoInterpolator } from "./keyframes/interpolation";
