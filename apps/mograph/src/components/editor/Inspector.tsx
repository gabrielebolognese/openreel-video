/**
 * Inspector panel — shows properties of the selected layer.
 * Covers transform, effects, and layer-type-specific controls.
 */
import React from "react";
import { useSelectedLayers, useProjectStore, useMainComposition } from "../../stores/project-store";
import type { MoLayer, MoTextLayer, MoSolidLayer, MoShapeLayer } from "@openreel/mograph";

export function Inspector() {
  const selectedLayers = useSelectedLayers();
  const comp = useMainComposition();
  const { updateLayer, project } = useProjectStore();
  const mainId = project.settings.mainCompositionId;

  if (selectedLayers.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-[var(--fg-muted)]">No layer selected</p>
      </div>
    );
  }

  const layer = selectedLayers[0];
  const update = (patch: Partial<MoLayer>) => updateLayer(mainId, layer.id, patch);

  return (
    <div className="flex h-full flex-col overflow-y-auto text-xs">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <span className="font-medium text-[var(--fg)]">{layer.name}</span>
        <span className="ml-auto rounded bg-[var(--bg-3)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--fg-3)]">
          {layer.type}
        </span>
      </div>

      {/* Transform section */}
      <Section title="Transform">
        <Row label="X">
          <NumberInput
            value={layer.transform.position.x}
            onChange={(v) => update({ transform: { ...layer.transform, position: { ...layer.transform.position, x: v } } })}
          />
        </Row>
        <Row label="Y">
          <NumberInput
            value={layer.transform.position.y}
            onChange={(v) => update({ transform: { ...layer.transform, position: { ...layer.transform.position, y: v } } })}
          />
        </Row>
        <Row label="Scale X">
          <NumberInput
            value={Math.round(layer.transform.scale.x * 100)}
            step={1}
            onChange={(v) => update({ transform: { ...layer.transform, scale: { ...layer.transform.scale, x: v / 100 } } })}
            suffix="%"
          />
        </Row>
        <Row label="Scale Y">
          <NumberInput
            value={Math.round(layer.transform.scale.y * 100)}
            step={1}
            onChange={(v) => update({ transform: { ...layer.transform, scale: { ...layer.transform.scale, y: v / 100 } } })}
            suffix="%"
          />
        </Row>
        <Row label="Rotation">
          <NumberInput
            value={Math.round(layer.transform.rotation * 10) / 10}
            step={0.1}
            onChange={(v) => update({ transform: { ...layer.transform, rotation: v } })}
            suffix="°"
          />
        </Row>
        <Row label="Opacity">
          <NumberInput
            value={Math.round(layer.transform.opacity * 100)}
            step={1}
            min={0}
            max={100}
            onChange={(v) => update({ transform: { ...layer.transform, opacity: v / 100 } })}
            suffix="%"
          />
        </Row>
      </Section>

      {/* Layer-type specific properties */}
      {layer.type === "text" && <TextSection layer={layer} onUpdate={update} />}
      {layer.type === "solid" && <SolidSection layer={layer} onUpdate={update} />}
      {layer.type === "shape" && <ShapeSection layer={layer} onUpdate={update} />}

      {/* Blend mode */}
      <Section title="Blending">
        <Row label="Mode">
          <select
            className="w-full rounded bg-[var(--bg-3)] px-2 py-1 text-xs text-[var(--fg)] outline-none"
            value={layer.blendMode}
            onChange={(e) => update({ blendMode: e.target.value as MoLayer["blendMode"] })}
          >
            {BLEND_MODES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </Row>
      </Section>
    </div>
  );
}

function TextSection({ layer, onUpdate }: { layer: MoTextLayer; onUpdate: (p: Partial<MoLayer>) => void }) {
  return (
    <Section title="Text">
      <Row label="Content">
        <input
          className="w-full rounded bg-[var(--bg-3)] px-2 py-1 text-xs text-[var(--fg)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
          value={layer.text}
          onChange={(e) => onUpdate({ text: e.target.value } as Partial<MoTextLayer>)}
        />
      </Row>
      <Row label="Size">
        <NumberInput
          value={layer.fontSize}
          step={1}
          min={1}
          onChange={(v) => onUpdate({ fontSize: v } as Partial<MoTextLayer>)}
          suffix="px"
        />
      </Row>
      <Row label="Color">
        <input
          type="color"
          className="h-6 w-full cursor-pointer rounded"
          value={layer.color}
          onChange={(e) => onUpdate({ color: e.target.value } as Partial<MoTextLayer>)}
        />
      </Row>
    </Section>
  );
}

function SolidSection({ layer, onUpdate }: { layer: MoSolidLayer; onUpdate: (p: Partial<MoLayer>) => void }) {
  return (
    <Section title="Fill">
      <Row label="Color">
        <input
          type="color"
          className="h-6 w-full cursor-pointer rounded"
          value={layer.color}
          onChange={(e) => onUpdate({ color: e.target.value } as Partial<MoSolidLayer>)}
        />
      </Row>
    </Section>
  );
}

function ShapeSection({ layer, onUpdate }: { layer: MoShapeLayer; onUpdate: (p: Partial<MoLayer>) => void }) {
  return (
    <Section title="Shape">
      <Row label="Shape">
        <span className="text-[var(--fg-2)] capitalize">{layer.shapeType}</span>
      </Row>
      <Row label="Fill">
        {layer.fillColor ? (
          <input
            type="color"
            className="h-6 w-full cursor-pointer rounded"
            value={layer.fillColor}
            onChange={(e) => onUpdate({ fillColor: e.target.value } as Partial<MoShapeLayer>)}
          />
        ) : (
          <span className="text-[var(--fg-muted)]">none</span>
        )}
      </Row>
      <Row label="Stroke">
        {layer.strokeColor ? (
          <input
            type="color"
            className="h-6 w-full cursor-pointer rounded"
            value={layer.strokeColor}
            onChange={(e) => onUpdate({ strokeColor: e.target.value } as Partial<MoShapeLayer>)}
          />
        ) : (
          <span className="text-[var(--fg-muted)]">none</span>
        )}
      </Row>
    </Section>
  );
}

// ── Shared sub-components ──────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--border)]">
      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-muted)]">
        {title}
      </div>
      <div className="pb-2">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-0.5">
      <span className="w-16 flex-shrink-0 text-[var(--fg-3)]">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        className="w-full rounded bg-[var(--bg-3)] px-2 py-1 text-xs text-[var(--fg)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) onChange(v);
        }}
      />
      {suffix && <span className="flex-shrink-0 text-[var(--fg-muted)]">{suffix}</span>}
    </div>
  );
}

const BLEND_MODES = [
  "normal", "multiply", "screen", "overlay", "darken", "lighten",
  "color-dodge", "color-burn", "hard-light", "soft-light", "difference",
  "exclusion", "hue", "saturation", "color", "luminosity", "add", "subtract",
] as const;
