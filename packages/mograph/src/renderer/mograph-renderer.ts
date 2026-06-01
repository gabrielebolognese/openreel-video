/**
 * Layer 1: MoGraphRenderer
 *
 * Stateless execution of a FrameRenderManifest onto GPU memory.
 * The ONLY entry point is executeManifest() — no timeline, no project, no state.
 *
 * Both preview and export call the same path → WYSIWYG parity is structural.
 */

import type { FrameRenderManifest, DrawCommand, TextureSource, EffectDescriptor } from "../types/manifest";
import { BLEND_MODE_INDICES, BLEND_MODE_WGSL, type ShaderRegistry } from "./shader-registry";
import {
  compositeShaderSource,
  transformShaderSource,
  effectsComputeShaderSource,
  blurComputeShaderSource,
  createEffectUniformsBuffer,
  createBlurUniformsBuffer,
  createDimensionsBuffer,
} from "@openreel/core/video/shaders";

export interface RendererInitConfig {
  width: number;
  height: number;
  shaderRegistry: ShaderRegistry;
  maxTextureCacheBytes?: number;
}

export interface TextureHandle {
  texture: GPUTexture;
  width: number;
  height: number;
}

/** Runtime texture cache — lives outside the state schema */
export class TextureCache {
  private cache = new Map<string, TextureHandle>();
  private lruOrder: string[] = [];
  private currentBytes = 0;
  private readonly maxBytes: number;

  constructor(maxBytes = 512 * 1024 * 1024) {
    this.maxBytes = maxBytes;
  }

  get(key: string): TextureHandle | undefined {
    const entry = this.cache.get(key);
    if (entry) {
      this.touchLru(key);
    }
    return entry;
  }

  set(key: string, handle: TextureHandle): void {
    if (this.cache.has(key)) return;
    const bytes = handle.width * handle.height * 4;
    while (this.currentBytes + bytes > this.maxBytes && this.lruOrder.length > 0) {
      const oldest = this.lruOrder.shift()!;
      const old = this.cache.get(oldest);
      if (old) {
        old.texture.destroy();
        this.currentBytes -= old.width * old.height * 4;
        this.cache.delete(oldest);
      }
    }
    this.cache.set(key, handle);
    this.lruOrder.push(key);
    this.currentBytes += bytes;
  }

  delete(key: string): void {
    const entry = this.cache.get(key);
    if (entry) {
      entry.texture.destroy();
      this.currentBytes -= entry.width * entry.height * 4;
      this.cache.delete(key);
      this.lruOrder = this.lruOrder.filter((k) => k !== key);
    }
  }

  clear(): void {
    for (const handle of this.cache.values()) handle.texture.destroy();
    this.cache.clear();
    this.lruOrder = [];
    this.currentBytes = 0;
  }

  private touchLru(key: string): void {
    this.lruOrder = this.lruOrder.filter((k) => k !== key);
    this.lruOrder.push(key);
  }
}

/** Callback for resolving external texture sources (video frames, images) */
export type TextureResolver = (
  key: string,
  source: TextureSource,
) => Promise<ImageBitmap | null>;

export class MoGraphRenderer {
  private device: GPUDevice | null = null;
  private adapter: GPUAdapter | null = null;
  private canvas: OffscreenCanvas;
  private context: GPUCanvasContext | null = null;
  private textureCache: TextureCache;
  private shaderRegistry: ShaderRegistry;

  // Fixed pipelines (from core)
  private compositePipeline: GPURenderPipeline | null = null;
  private transformPipeline: GPURenderPipeline | null = null;

  // Compute pipelines
  private colorAdjPipeline: GPUComputePipeline | null = null;
  private blurPipeline: GPUComputePipeline | null = null;

  // Blend mode render pipeline (GPU-native, unlike the original Canvas2D fallback)
  private blendPipeline: GPURenderPipeline | null = null;

  private sampler: GPUSampler | null = null;
  private width: number;
  private height: number;

  constructor(config: RendererInitConfig) {
    this.width = config.width;
    this.height = config.height;
    this.shaderRegistry = config.shaderRegistry;
    this.textureCache = new TextureCache(config.maxTextureCacheBytes);
    this.canvas = new OffscreenCanvas(config.width, config.height);
  }

  async initialize(): Promise<boolean> {
    try {
      if (!navigator.gpu) return false;

      this.adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!this.adapter) return false;

      this.device = await this.adapter.requestDevice({
        requiredLimits: {
          maxTextureDimension2D: Math.max(this.width, this.height, 4096),
          maxBindGroups: 4,
          maxSampledTexturesPerShaderStage: 16,
        },
      });

      this.context = this.canvas.getContext("webgpu") as GPUCanvasContext;
      if (!this.context) return false;

      const format = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({
        device: this.device,
        format,
        alphaMode: "premultiplied",
      });

      this.createSampler();
      await this.initializePipelines(format);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * PRIMARY ENTRY POINT.
   * Execute a FrameRenderManifest → ImageBitmap.
   * Both preview and export call this exact function.
   */
  async executeManifest(
    manifest: FrameRenderManifest,
    resolver: TextureResolver,
  ): Promise<ImageBitmap> {
    if (!this.device || !this.context) {
      throw new Error("MoGraphRenderer not initialized");
    }

    // Resize canvas if needed
    if (manifest.width !== this.width || manifest.height !== this.height) {
      this.resize(manifest.width, manifest.height);
    }

    // Step 1: Resolve all texture sources into GPU textures
    await this.resolveTextures(manifest, resolver);

    // Step 2: Build and submit a single command buffer
    const outputTexture = await this.renderCommands(manifest);

    return outputTexture;
  }

  // ---------------------------------------------------------------------------
  // Texture resolution
  // ---------------------------------------------------------------------------

  private async resolveTextures(
    manifest: FrameRenderManifest,
    resolver: TextureResolver,
  ): Promise<void> {
    const pending: Array<Promise<void>> = [];

    for (const [key, source] of Object.entries(manifest.textureSources)) {
      if (this.textureCache.get(key)) continue; // already cached

      pending.push(
        resolver(key, source).then((bitmap) => {
          if (bitmap && this.device) {
            const tex = this.createTextureFromBitmap(bitmap);
            this.textureCache.set(key, { texture: tex, width: bitmap.width, height: bitmap.height });
            bitmap.close();
          }
        }),
      );
    }

    await Promise.all(pending);
  }

  private createTextureFromBitmap(bitmap: ImageBitmap): GPUTexture {
    const device = this.device!;
    const texture = device.createTexture({
      size: { width: bitmap.width, height: bitmap.height },
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.STORAGE_BINDING,
    });
    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, {
      width: bitmap.width,
      height: bitmap.height,
    });
    return texture;
  }

  // ---------------------------------------------------------------------------
  // Render pass
  // ---------------------------------------------------------------------------

  private async renderCommands(manifest: FrameRenderManifest): Promise<ImageBitmap> {
    const device = this.device!;

    // Accumulator texture (the canvas we composite into)
    const accumTex = device.createTexture({
      size: { width: manifest.width, height: manifest.height },
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.STORAGE_BINDING,
    });

    // Fill background
    const encoder = device.createCommandEncoder({ label: "mograph-frame" });
    const bgPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: accumTex.createView(),
        clearValue: { r: manifest.backgroundColor.r, g: manifest.backgroundColor.g, b: manifest.backgroundColor.b, a: manifest.backgroundColor.a },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    bgPass.end();

    // Process each draw command
    for (const cmd of manifest.commands) {
      if (cmd.kind === "adjustment") continue; // handled inline with scope

      const srcTex = this.getCommandTexture(cmd, manifest.width, manifest.height);
      if (!srcTex) continue;

      // Apply effect chain (ping-pong through intermediate textures)
      const effectChain = "effects" in cmd ? cmd.effects : [];
      const finalTex = this.applyEffectChain(encoder, srcTex, manifest.width, manifest.height, effectChain);

      // Composite with blend mode onto accumulator
      this.compositeLayer(
        encoder,
        finalTex,
        accumTex,
        manifest.width,
        manifest.height,
        "transform" in cmd ? cmd.transform : null,
        "opacity" in cmd ? cmd.opacity : 1,
        "blendMode" in cmd ? BLEND_MODE_INDICES[cmd.blendMode] ?? 0 : 0,
      );

      if (finalTex !== srcTex) finalTex.destroy();
    }

    device.queue.submit([encoder.finish()]);

    // Read back frame
    const bytesPerRow = Math.ceil((manifest.width * 4) / 256) * 256;
    const readBuf = device.createBuffer({
      size: bytesPerRow * manifest.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const copyEncoder = device.createCommandEncoder();
    copyEncoder.copyTextureToBuffer(
      { texture: accumTex },
      { buffer: readBuf, bytesPerRow },
      { width: manifest.width, height: manifest.height },
    );
    device.queue.submit([copyEncoder.finish()]);

    await readBuf.mapAsync(GPUMapMode.READ);
    const src = new Uint8ClampedArray(readBuf.getMappedRange());
    const dst = new Uint8ClampedArray(manifest.width * manifest.height * 4);
    for (let y = 0; y < manifest.height; y++) {
      dst.set(
        src.subarray(y * bytesPerRow, y * bytesPerRow + manifest.width * 4),
        y * manifest.width * 4,
      );
    }
    readBuf.unmap();
    readBuf.destroy();
    accumTex.destroy();

    return createImageBitmap(new ImageData(dst, manifest.width, manifest.height), {
      premultiplyAlpha: "premultiply",
    });
  }

  private getCommandTexture(
    cmd: DrawCommand,
    canvasW: number,
    canvasH: number,
  ): GPUTexture | null {
    if (cmd.kind === "texture" || cmd.kind === "text" || cmd.kind === "shape") {
      const handle = this.textureCache.get(cmd.textureKey);
      return handle?.texture ?? null;
    }
    if (cmd.kind === "solid") {
      // Create a solid-color texture on the fly
      return this.createSolidTexture(cmd.color, canvasW, canvasH);
    }
    return null;
  }

  private createSolidTexture(
    color: { r: number; g: number; b: number; a: number },
    w: number,
    h: number,
  ): GPUTexture {
    const device = this.device!;
    const data = new Uint8ClampedArray(w * h * 4);
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    const a = Math.round(color.a * 255);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = a;
    }
    const texture = device.createTexture({
      size: { width: w, height: h },
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture },
      data,
      { bytesPerRow: w * 4 },
      { width: w, height: h },
    );
    return texture;
  }

  // ---------------------------------------------------------------------------
  // Effect chain (ping-pong compute passes)
  // ---------------------------------------------------------------------------

  private applyEffectChain(
    encoder: GPUCommandEncoder,
    srcTex: GPUTexture,
    width: number,
    height: number,
    effects: readonly EffectDescriptor[],
  ): GPUTexture {
    const device = this.device!;
    const activeEffects = effects.filter((e) => e.enabled);
    if (activeEffects.length === 0) return srcTex;

    let currentTex = srcTex;

    for (const effect of activeEffects) {
      const outTex = device.createTexture({
        size: { width, height },
        format: "rgba8unorm",
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
      });

      if (effect.shaderId === "color-adjustments") {
        this.runColorAdjPass(encoder, currentTex, outTex, width, height, effect);
      } else if (effect.shaderId === "blur") {
        this.runBlurPass(encoder, currentTex, outTex, width, height, effect);
      } else {
        // Unsupported shader — pass through
        outTex.destroy();
        continue;
      }

      if (currentTex !== srcTex) currentTex.destroy();
      currentTex = outTex;
    }

    return currentTex;
  }

  private runColorAdjPass(
    encoder: GPUCommandEncoder,
    src: GPUTexture,
    dst: GPUTexture,
    width: number,
    height: number,
    effect: EffectDescriptor,
  ): void {
    if (!this.colorAdjPipeline || !this.device) return;
    const device = this.device;

    const u = effect.uniforms;
    const effectBuf = createEffectUniformsBuffer(
      (u["brightness"] as number) ?? 0,
      (u["contrast"] as number) ?? 1,
      (u["saturation"] as number) ?? 1,
      (u["hue"] as number) ?? 0,
      (u["temperature"] as number) ?? 0,
      (u["tint"] as number) ?? 0,
      (u["shadows"] as number) ?? 0,
      (u["highlights"] as number) ?? 0,
    );
    const dimBuf = createDimensionsBuffer(width, height);

    const effectUniformBuf = device.createBuffer({
      size: effectBuf.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const dimUniformBuf = device.createBuffer({
      size: dimBuf.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    device.queue.writeBuffer(effectUniformBuf, 0, effectBuf.buffer as ArrayBuffer);
    device.queue.writeBuffer(dimUniformBuf, 0, dimBuf.buffer as ArrayBuffer);

    const layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba8unorm" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      ],
    });

    const bindGroup = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: src.createView() },
        { binding: 1, resource: dst.createView() },
        { binding: 2, resource: { buffer: effectUniformBuf } },
        { binding: 3, resource: { buffer: dimUniformBuf } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.colorAdjPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
    pass.end();

    effectUniformBuf.destroy();
    dimUniformBuf.destroy();
  }

  private runBlurPass(
    encoder: GPUCommandEncoder,
    src: GPUTexture,
    dst: GPUTexture,
    width: number,
    height: number,
    effect: EffectDescriptor,
  ): void {
    if (!this.blurPipeline || !this.device) return;
    const device = this.device;

    const u = effect.uniforms;
    const blurBuf = createBlurUniformsBuffer(
      (u["radius"] as number) ?? 5,
      (u["sigma"] as number) ?? 0,
      (u["directionX"] as number) ?? 1,
      (u["directionY"] as number) ?? 0,
    );
    const dimBuf = createDimensionsBuffer(width, height);

    const blurUniformBuf = device.createBuffer({
      size: blurBuf.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const dimUniformBuf = device.createBuffer({
      size: dimBuf.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    device.queue.writeBuffer(blurUniformBuf, 0, blurBuf.buffer as ArrayBuffer);
    device.queue.writeBuffer(dimUniformBuf, 0, dimBuf.buffer as ArrayBuffer);

    const layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba8unorm" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      ],
    });

    const bindGroup = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: src.createView() },
        { binding: 1, resource: dst.createView() },
        { binding: 2, resource: { buffer: blurUniformBuf } },
        { binding: 3, resource: { buffer: dimUniformBuf } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.blurPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
    pass.end();

    blurUniformBuf.destroy();
    dimUniformBuf.destroy();
  }

  // ---------------------------------------------------------------------------
  // Blend mode composite
  // ---------------------------------------------------------------------------

  private compositeLayer(
    encoder: GPUCommandEncoder,
    srcTex: GPUTexture,
    dstTex: GPUTexture,
    _width: number,
    _height: number,
    _transform: Float32Array | null,
    _opacity: number,
    _blendModeIndex: number,
  ): void {
    if (!this.compositePipeline || !this.sampler || !this.device) return;
    const device = this.device;

    const uniformData = new Float32Array(8);
    uniformData[0] = _opacity;

    const uniformBuf = device.createBuffer({
      size: uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(uniformBuf, 0, uniformData.buffer as ArrayBuffer);

    const uniformLayout = device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      }],
    });
    const textureLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });

    const uniformBG = device.createBindGroup({
      layout: uniformLayout,
      entries: [{ binding: 0, resource: { buffer: uniformBuf } }],
    });
    const textureBG = device.createBindGroup({
      layout: textureLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: srcTex.createView() },
      ],
    });

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: dstTex.createView(),
        loadOp: "load",
        storeOp: "store",
      }],
    });

    pass.setPipeline(this.compositePipeline);
    pass.setBindGroup(0, uniformBG);
    pass.setBindGroup(1, textureBG);
    pass.draw(3);
    pass.end();

    uniformBuf.destroy();
  }

  // ---------------------------------------------------------------------------
  // Pipeline init
  // ---------------------------------------------------------------------------

  private async initializePipelines(format: GPUTextureFormat): Promise<void> {
    const device = this.device!;

    // Composite pipeline (from core)
    const compositeModule = device.createShaderModule({
      label: "mograph-composite",
      code: compositeShaderSource,
    });
    this.compositePipeline = device.createRenderPipeline({
      label: "mograph-composite-pipeline",
      layout: "auto",
      vertex: { module: compositeModule, entryPoint: "vertexMain" },
      fragment: {
        module: compositeModule,
        entryPoint: "fragmentMain",
        targets: [{
          format,
          blend: {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          },
        }],
      },
      primitive: { topology: "triangle-list" },
    });

    // Transform pipeline (from core)
    const transformModule = device.createShaderModule({
      label: "mograph-transform",
      code: transformShaderSource,
    });
    this.transformPipeline = device.createRenderPipeline({
      label: "mograph-transform-pipeline",
      layout: "auto",
      vertex: { module: transformModule, entryPoint: "vertexMain" },
      fragment: {
        module: transformModule,
        entryPoint: "fragmentMain",
        targets: [{
          format: "rgba8unorm",
          blend: {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          },
        }],
      },
      primitive: { topology: "triangle-list" },
    });

    // Color adjustments compute pipeline (from core shaders)
    const colorAdjModule = device.createShaderModule({
      label: "mograph-color-adj",
      code: effectsComputeShaderSource,
    });
    this.colorAdjPipeline = device.createComputePipeline({
      label: "mograph-color-adj-pipeline",
      layout: "auto",
      compute: { module: colorAdjModule, entryPoint: "main" },
    });

    // Blur compute pipeline (from core shaders)
    const blurModule = device.createShaderModule({
      label: "mograph-blur",
      code: blurComputeShaderSource,
    });
    this.blurPipeline = device.createComputePipeline({
      label: "mograph-blur-pipeline",
      layout: "auto",
      compute: { module: blurModule, entryPoint: "main" },
    });

    void BLEND_MODE_WGSL; // referenced by shader-registry, used by future blend pipeline
    void format;
  }

  private createSampler(): void {
    this.sampler = this.device!.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    if (this.context && this.device) {
      const format = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({ device: this.device, format, alphaMode: "premultiplied" });
    }
  }

  invalidateTextureKey(key: string): void {
    this.textureCache.delete(key);
  }

  invalidateMediaTextures(mediaId: string): void {
    // Evict all textures related to this media
    for (const key of [...this.textureCache["cache"].keys()]) {
      if (key.includes(mediaId)) this.textureCache.delete(key);
    }
  }

  destroy(): void {
    this.textureCache.clear();
    this.device?.destroy();
    this.device = null;
  }

  getDevice(): GPUDevice | null {
    return this.device;
  }
}
