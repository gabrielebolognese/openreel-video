/**
 * Toolbar — left vertical strip with layer creation tools.
 */
import React from "react";
import {
  MousePointer2,
  Type,
  Square,
  Circle,
  Film,
  Image as ImageIcon,
  Layers,
  Sliders,
} from "lucide-react";
import { v4 as uuid } from "uuid";
import { useProjectStore, useMainComposition, defaultTransform } from "../../stores/project-store";
import type { MoTextLayer, MoSolidLayer, MoShapeLayer } from "@openreel/mograph";
import { secondsToMicros } from "@openreel/mograph";

type Tool = "select" | "text" | "rect" | "ellipse" | "solid";

interface ToolbarProps {
  activeTool: Tool;
  onToolChange: (t: Tool) => void;
}

export function Toolbar({ activeTool, onToolChange }: ToolbarProps) {
  const comp = useMainComposition();
  const { addLayer, project } = useProjectStore();
  const mainId = project.settings.mainCompositionId;

  function addText() {
    if (!comp) return;
    const layer: MoTextLayer = {
      id: uuid(),
      type: "text",
      name: "Text",
      visible: true,
      locked: false,
      solo: false,
      startTimeUs: 0,
      durationUs: comp.durationUs,
      inPointUs: 0,
      outPointUs: comp.durationUs,
      zIndex: (comp.layers.length + 1) * 10,
      blendMode: "normal",
      transform: { ...defaultTransform(), position: { x: comp.width / 2, y: comp.height / 2 } },
      effects: [],
      masks: [],
      keyframes: [],
      text: "Text",
      fontFamily: "Inter",
      fontSize: 72,
      fontWeight: 700,
      color: "#ffffff",
    };
    addLayer(mainId, layer);
    onToolChange("select");
  }

  function addRect() {
    if (!comp) return;
    const layer: MoShapeLayer = {
      id: uuid(),
      type: "shape",
      name: "Rectangle",
      visible: true,
      locked: false,
      solo: false,
      startTimeUs: 0,
      durationUs: comp.durationUs,
      inPointUs: 0,
      outPointUs: comp.durationUs,
      zIndex: (comp.layers.length + 1) * 10,
      blendMode: "normal",
      transform: { ...defaultTransform(), position: { x: comp.width / 2, y: comp.height / 2 }, scale: { x: 0.3, y: 0.2 } },
      effects: [],
      masks: [],
      keyframes: [],
      shapeType: "rectangle",
      fillColor: "#3b82f6",
    };
    addLayer(mainId, layer);
    onToolChange("select");
  }

  function addEllipse() {
    if (!comp) return;
    const layer: MoShapeLayer = {
      id: uuid(),
      type: "shape",
      name: "Ellipse",
      visible: true,
      locked: false,
      solo: false,
      startTimeUs: 0,
      durationUs: comp.durationUs,
      inPointUs: 0,
      outPointUs: comp.durationUs,
      zIndex: (comp.layers.length + 1) * 10,
      blendMode: "normal",
      transform: { ...defaultTransform(), position: { x: comp.width / 2, y: comp.height / 2 }, scale: { x: 0.25, y: 0.25 } },
      effects: [],
      masks: [],
      keyframes: [],
      shapeType: "ellipse",
      fillColor: "#10b981",
    };
    addLayer(mainId, layer);
    onToolChange("select");
  }

  function addSolid() {
    if (!comp) return;
    const layer: MoSolidLayer = {
      id: uuid(),
      type: "solid",
      name: "Solid",
      visible: true,
      locked: false,
      solo: false,
      startTimeUs: 0,
      durationUs: comp.durationUs,
      inPointUs: 0,
      outPointUs: comp.durationUs,
      zIndex: 0,
      blendMode: "normal",
      transform: defaultTransform(),
      effects: [],
      masks: [],
      keyframes: [],
      color: "#1c1c21",
    };
    addLayer(mainId, layer);
    onToolChange("select");
  }

  const tools: {
    id: Tool | "add-text" | "add-rect" | "add-ellipse" | "add-solid";
    icon: React.ElementType;
    label: string;
    action?: () => void;
    tool?: Tool;
  }[] = [
    { id: "select", icon: MousePointer2, label: "Select (V)", tool: "select" },
    { id: "add-text", icon: Type, label: "Add Text (T)", action: addText },
    { id: "add-rect", icon: Square, label: "Add Rectangle (R)", action: addRect },
    { id: "add-ellipse", icon: Circle, label: "Add Ellipse (E)", action: addEllipse },
    { id: "add-solid", icon: Layers, label: "Add Solid (S)", action: addSolid },
  ];

  return (
    <div className="flex w-12 flex-col items-center gap-1 border-r border-[var(--border)] bg-[var(--bg-1)] py-2">
      {tools.map(({ id, icon: Icon, label, action, tool }) => (
        <button
          key={id}
          title={label}
          className={`flex h-9 w-9 items-center justify-center rounded transition-colors ${
            tool && activeTool === tool
              ? "bg-[var(--accent)] text-white"
              : "text-[var(--fg-3)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
          }`}
          onClick={() => {
            if (tool) onToolChange(tool);
            action?.();
          }}
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  );
}
