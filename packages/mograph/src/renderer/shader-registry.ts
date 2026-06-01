/**
 * Layer 1: Dynamic ShaderRegistry
 *
 * Replaces the three hardcoded pipelines in the original WebGPU renderer with a
 * data-driven system. Shaders are registered by ID, and the pipeline builder
 * assembles a GPU pipeline on demand for any combination of effects.
 */

export interface ShaderDescriptor {
  readonly id: string;
  readonly label: string;
  /** WGSL compute shader source for effect passes */
  readonly computeSource?: string;
  /** WGSL render shader source for composite passes */
  readonly renderSource?: string;
  /** Uniform layout definition (name → type) */
  readonly uniforms: readonly UniformDef[];
}

export interface UniformDef {
  readonly name: string;
  readonly type: "f32" | "vec2f" | "vec3f" | "vec4f" | "u32" | "mat4x4f";
  readonly default?: number | number[];
}

export class ShaderRegistry {
  private shaders: Map<string, ShaderDescriptor> = new Map();

  register(descriptor: ShaderDescriptor): void {
    this.shaders.set(descriptor.id, descriptor);
  }

  get(id: string): ShaderDescriptor | undefined {
    return this.shaders.get(id);
  }

  has(id: string): boolean {
    return this.shaders.has(id);
  }

  list(): string[] {
    return [...this.shaders.keys()];
  }
}

// ---------------------------------------------------------------------------
// GPU-native blend modes via WGSL fragment shaders
// The key innovation: these replace Canvas2D globalCompositeOperation
// ---------------------------------------------------------------------------

export const BLEND_MODE_WGSL = /* wgsl */ `
fn blendNormal(src: vec4<f32>, dst: vec4<f32>) -> vec4<f32> {
  let a = src.a + dst.a * (1.0 - src.a);
  if (a < 0.0001) { return vec4<f32>(0.0); }
  let rgb = (src.rgb * src.a + dst.rgb * dst.a * (1.0 - src.a)) / a;
  return vec4<f32>(rgb, a);
}

fn blendMultiply(src: vec4<f32>, dst: vec4<f32>) -> vec4<f32> {
  let blended = src.rgb * dst.rgb;
  return blendNormal(vec4<f32>(blended, src.a), dst);
}

fn blendScreen(src: vec4<f32>, dst: vec4<f32>) -> vec4<f32> {
  let blended = src.rgb + dst.rgb - src.rgb * dst.rgb;
  return blendNormal(vec4<f32>(blended, src.a), dst);
}

fn blendOverlay(src: vec4<f32>, dst: vec4<f32>) -> vec4<f32> {
  var blended: vec3<f32>;
  for (var i = 0; i < 3; i++) {
    if (dst.rgb[i] < 0.5) {
      blended[i] = 2.0 * src.rgb[i] * dst.rgb[i];
    } else {
      blended[i] = 1.0 - 2.0 * (1.0 - src.rgb[i]) * (1.0 - dst.rgb[i]);
    }
  }
  return blendNormal(vec4<f32>(blended, src.a), dst);
}

fn blendDarken(src: vec4<f32>, dst: vec4<f32>) -> vec4<f32> {
  return blendNormal(vec4<f32>(min(src.rgb, dst.rgb), src.a), dst);
}

fn blendLighten(src: vec4<f32>, dst: vec4<f32>) -> vec4<f32> {
  return blendNormal(vec4<f32>(max(src.rgb, dst.rgb), src.a), dst);
}

fn blendColorDodge(src: vec4<f32>, dst: vec4<f32>) -> vec4<f32> {
  let blended = clamp(dst.rgb / max(vec3<f32>(1.0) - src.rgb, vec3<f32>(0.0001)), vec3<f32>(0.0), vec3<f32>(1.0));
  return blendNormal(vec4<f32>(blended, src.a), dst);
}

fn blendColorBurn(src: vec4<f32>, dst: vec4<f32>) -> vec4<f32> {
  let blended = clamp(vec3<f32>(1.0) - (vec3<f32>(1.0) - dst.rgb) / max(src.rgb, vec3<f32>(0.0001)), vec3<f32>(0.0), vec3<f32>(1.0));
  return blendNormal(vec4<f32>(blended, src.a), dst);
}

fn blendHardLight(src: vec4<f32>, dst: vec4<f32>) -> vec4<f32> {
  // Hard light = overlay with src/dst swapped
  return blendOverlay(dst, src);
}

fn blendSoftLight(src: vec4<f32>, dst: vec4<f32>) -> vec4<f32> {
  var blended: vec3<f32>;
  for (var i = 0; i < 3; i++) {
    if (src.rgb[i] < 0.5) {
      blended[i] = dst.rgb[i] - (1.0 - 2.0 * src.rgb[i]) * dst.rgb[i] * (1.0 - dst.rgb[i]);
    } else {
      var d: f32;
      if (dst.rgb[i] < 0.25) {
        d = ((16.0 * dst.rgb[i] - 12.0) * dst.rgb[i] + 4.0) * dst.rgb[i];
      } else {
        d = sqrt(dst.rgb[i]);
      }
      blended[i] = dst.rgb[i] + (2.0 * src.rgb[i] - 1.0) * (d - dst.rgb[i]);
    }
  }
  return blendNormal(vec4<f32>(blended, src.a), dst);
}

fn blendDifference(src: vec4<f32>, dst: vec4<f32>) -> vec4<f32> {
  return blendNormal(vec4<f32>(abs(dst.rgb - src.rgb), src.a), dst);
}

fn blendExclusion(src: vec4<f32>, dst: vec4<f32>) -> vec4<f32> {
  let blended = src.rgb + dst.rgb - 2.0 * src.rgb * dst.rgb;
  return blendNormal(vec4<f32>(blended, src.a), dst);
}

fn rgb2hsl(rgb: vec3<f32>) -> vec3<f32> {
  let maxC = max(max(rgb.r, rgb.g), rgb.b);
  let minC = min(min(rgb.r, rgb.g), rgb.b);
  let l = (maxC + minC) * 0.5;
  if (maxC == minC) { return vec3<f32>(0.0, 0.0, l); }
  let d = maxC - minC;
  let s = select(d / (2.0 - maxC - minC), d / (maxC + minC), l > 0.5);
  var h: f32;
  if (maxC == rgb.r) { h = (rgb.g - rgb.b) / d + select(6.0, 0.0, rgb.g >= rgb.b); }
  else if (maxC == rgb.g) { h = (rgb.b - rgb.r) / d + 2.0; }
  else { h = (rgb.r - rgb.g) / d + 4.0; }
  return vec3<f32>(h / 6.0, s, l);
}

fn hue2rgb(p: f32, q: f32, t_in: f32) -> f32 {
  var t = t_in;
  if (t < 0.0) { t += 1.0; }
  if (t > 1.0) { t -= 1.0; }
  if (t < 1.0/6.0) { return p + (q - p) * 6.0 * t; }
  if (t < 1.0/2.0) { return q; }
  if (t < 2.0/3.0) { return p + (q - p) * (2.0/3.0 - t) * 6.0; }
  return p;
}

fn hsl2rgb(hsl: vec3<f32>) -> vec3<f32> {
  if (hsl.y == 0.0) { return vec3<f32>(hsl.z); }
  let q = select(hsl.z * (1.0 + hsl.y), hsl.z + hsl.y - hsl.z * hsl.y, hsl.z >= 0.5);
  let p = 2.0 * hsl.z - q;
  return vec3<f32>(hue2rgb(p, q, hsl.x + 1.0/3.0), hue2rgb(p, q, hsl.x), hue2rgb(p, q, hsl.x - 1.0/3.0));
}

fn lum(c: vec3<f32>) -> f32 { return dot(c, vec3<f32>(0.299, 0.587, 0.114)); }

fn blendHue(src: vec4<f32>, dst: vec4<f32>) -> vec4<f32> {
  let srcHSL = rgb2hsl(src.rgb);
  let dstHSL = rgb2hsl(dst.rgb);
  let blended = hsl2rgb(vec3<f32>(srcHSL.x, dstHSL.y, dstHSL.z));
  return blendNormal(vec4<f32>(blended, src.a), dst);
}

fn blendSaturation(src: vec4<f32>, dst: vec4<f32>) -> vec4<f32> {
  let srcHSL = rgb2hsl(src.rgb);
  let dstHSL = rgb2hsl(dst.rgb);
  let blended = hsl2rgb(vec3<f32>(dstHSL.x, srcHSL.y, dstHSL.z));
  return blendNormal(vec4<f32>(blended, src.a), dst);
}

fn blendColor(src: vec4<f32>, dst: vec4<f32>) -> vec4<f32> {
  let srcHSL = rgb2hsl(src.rgb);
  let dstHSL = rgb2hsl(dst.rgb);
  let blended = hsl2rgb(vec3<f32>(srcHSL.x, srcHSL.y, dstHSL.z));
  return blendNormal(vec4<f32>(blended, src.a), dst);
}

fn blendLuminosity(src: vec4<f32>, dst: vec4<f32>) -> vec4<f32> {
  let srcHSL = rgb2hsl(src.rgb);
  let dstHSL = rgb2hsl(dst.rgb);
  let blended = hsl2rgb(vec3<f32>(dstHSL.x, dstHSL.y, srcHSL.z));
  return blendNormal(vec4<f32>(blended, src.a), dst);
}

fn blendAdd(src: vec4<f32>, dst: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(clamp(src.rgb + dst.rgb, vec3<f32>(0.0), vec3<f32>(1.0)), min(src.a + dst.a, 1.0));
}

fn blendSubtract(src: vec4<f32>, dst: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(clamp(dst.rgb - src.rgb, vec3<f32>(0.0), vec3<f32>(1.0)), dst.a);
}

fn applyBlendMode(src: vec4<f32>, dst: vec4<f32>, mode: u32) -> vec4<f32> {
  switch (mode) {
    case  0u: { return blendNormal(src, dst); }
    case  1u: { return blendMultiply(src, dst); }
    case  2u: { return blendScreen(src, dst); }
    case  3u: { return blendOverlay(src, dst); }
    case  4u: { return blendDarken(src, dst); }
    case  5u: { return blendLighten(src, dst); }
    case  6u: { return blendColorDodge(src, dst); }
    case  7u: { return blendColorBurn(src, dst); }
    case  8u: { return blendHardLight(src, dst); }
    case  9u: { return blendSoftLight(src, dst); }
    case 10u: { return blendDifference(src, dst); }
    case 11u: { return blendExclusion(src, dst); }
    case 12u: { return blendHue(src, dst); }
    case 13u: { return blendSaturation(src, dst); }
    case 14u: { return blendColor(src, dst); }
    case 15u: { return blendLuminosity(src, dst); }
    case 16u: { return blendAdd(src, dst); }
    case 17u: { return blendSubtract(src, dst); }
    default:  { return blendNormal(src, dst); }
  }
}
`;

export const BLEND_MODE_INDICES: Record<string, number> = {
  "normal": 0,
  "multiply": 1,
  "screen": 2,
  "overlay": 3,
  "darken": 4,
  "lighten": 5,
  "color-dodge": 6,
  "color-burn": 7,
  "hard-light": 8,
  "soft-light": 9,
  "difference": 10,
  "exclusion": 11,
  "hue": 12,
  "saturation": 13,
  "color": 14,
  "luminosity": 15,
  "add": 16,
  "subtract": 17,
};

// ---------------------------------------------------------------------------
// Built-in effect shader descriptors
// ---------------------------------------------------------------------------

export const BUILTIN_SHADERS: ShaderDescriptor[] = [
  {
    id: "color-adjustments",
    label: "Color Adjustments",
    uniforms: [
      { name: "brightness", type: "f32", default: 0 },
      { name: "contrast",   type: "f32", default: 1 },
      { name: "saturation", type: "f32", default: 1 },
      { name: "hue",        type: "f32", default: 0 },
      { name: "temperature",type: "f32", default: 0 },
      { name: "tint",       type: "f32", default: 0 },
      { name: "shadows",    type: "f32", default: 0 },
      { name: "highlights", type: "f32", default: 0 },
      { name: "exposure",   type: "f32", default: 0 },
      { name: "vibrance",   type: "f32", default: 0 },
    ],
  },
  {
    id: "blur",
    label: "Gaussian Blur",
    uniforms: [
      { name: "radius",    type: "f32", default: 0 },
      { name: "sigma",     type: "f32", default: 0 },
      { name: "directionX",type: "f32", default: 1 },
      { name: "directionY",type: "f32", default: 0 },
    ],
  },
  {
    id: "glow",
    label: "Glow",
    uniforms: [
      { name: "radius",    type: "f32", default: 10 },
      { name: "intensity", type: "f32", default: 0.5 },
      { name: "threshold", type: "f32", default: 0.8 },
    ],
  },
  {
    id: "vignette",
    label: "Vignette",
    uniforms: [
      { name: "strength",  type: "f32", default: 0.5 },
      { name: "radius",    type: "f32", default: 0.7 },
      { name: "softness",  type: "f32", default: 0.5 },
    ],
  },
  {
    id: "chroma-key",
    label: "Chroma Key",
    uniforms: [
      { name: "keyColor",    type: "vec3f", default: [0, 1, 0] },
      { name: "similarity",  type: "f32",   default: 0.3 },
      { name: "smoothness",  type: "f32",   default: 0.1 },
      { name: "spillReduce", type: "f32",   default: 0.1 },
    ],
  },
  {
    id: "curves",
    label: "Curves",
    uniforms: [
      // 16-point LUT for each channel (r, g, b, master)
      { name: "masterLut", type: "f32", default: 0 },
      { name: "redLut",    type: "f32", default: 0 },
      { name: "greenLut",  type: "f32", default: 0 },
      { name: "blueLut",   type: "f32", default: 0 },
    ],
  },
  {
    id: "sharpen",
    label: "Sharpen",
    uniforms: [
      { name: "amount", type: "f32", default: 0.5 },
      { name: "radius", type: "f32", default: 1.0 },
    ],
  },
  {
    id: "noise",
    label: "Noise",
    uniforms: [
      { name: "amount",   type: "f32", default: 0.1 },
      { name: "monochrome", type: "f32", default: 0 },
    ],
  },
  {
    id: "pixelate",
    label: "Pixelate",
    uniforms: [
      { name: "pixelSize", type: "f32", default: 10 },
    ],
  },
];

/** Singleton registry pre-loaded with all built-in shaders */
export function createDefaultShaderRegistry(): ShaderRegistry {
  const registry = new ShaderRegistry();
  for (const shader of BUILTIN_SHADERS) {
    registry.register(shader);
  }
  return registry;
}
