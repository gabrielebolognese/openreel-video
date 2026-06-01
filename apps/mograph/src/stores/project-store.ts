/**
 * Project store — single source of truth for the open MoProject.
 * All mutations go through immer-style actions here; the engine is
 * called from component hooks, not from this store.
 */
import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type {
  MoProject,
  MoComposition,
  MoLayer,
  TimeMicros,
} from "@openreel/mograph";
import { defaultTransform, secondsToMicros } from "@openreel/mograph";

export interface ProjectState {
  project: MoProject;
  selectedLayerIds: string[];
  currentTimeUs: TimeMicros;

  // Actions
  setProject: (project: MoProject) => void;
  selectLayer: (id: string, multi?: boolean) => void;
  clearSelection: () => void;
  setCurrentTime: (timeUs: TimeMicros | ((prev: TimeMicros) => TimeMicros)) => void;

  addComposition: (name: string, width: number, height: number, frameRate: number, durationSec: number) => string;
  addLayer: (compositionId: string, layer: MoLayer) => void;
  removeLayer: (compositionId: string, layerId: string) => void;
  updateLayer: (compositionId: string, layerId: string, patch: Partial<MoLayer>) => void;
  moveLayer: (compositionId: string, layerId: string, newZIndex: number) => void;
}

function makeDefaultProject(): MoProject {
  const compId = uuid();
  const now = Date.now();
  const durationUs = secondsToMicros(10);
  const comp: MoComposition = {
    id: compId,
    name: "Comp 1",
    width: 1920,
    height: 1080,
    frameRate: 30,
    durationUs,
    backgroundColor: "#000000",
    layers: [],
    markers: [],
  };
  return {
    id: uuid(),
    name: "Untitled",
    version: 1,
    createdAt: now,
    modifiedAt: now,
    settings: {
      mainCompositionId: compId,
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    compositions: { [compId]: comp },
    assets: {},
  };
}

export const useProjectStore = create<ProjectState>((set) => ({
  project: makeDefaultProject(),
  selectedLayerIds: [],
  currentTimeUs: 0,

  setProject: (project) => set({ project }),

  selectLayer: (id, multi = false) =>
    set((s) => ({
      selectedLayerIds: multi
        ? s.selectedLayerIds.includes(id)
          ? s.selectedLayerIds.filter((x) => x !== id)
          : [...s.selectedLayerIds, id]
        : [id],
    })),

  clearSelection: () => set({ selectedLayerIds: [] }),

  setCurrentTime: (timeUs) =>
    set((s) => ({
      currentTimeUs: typeof timeUs === "function" ? timeUs(s.currentTimeUs) : timeUs,
    })),

  addComposition: (name, width, height, frameRate, durationSec) => {
    const compId = uuid();
    const comp: MoComposition = {
      id: compId,
      name,
      width,
      height,
      frameRate,
      durationUs: secondsToMicros(durationSec),
      backgroundColor: "#000000",
      layers: [],
      markers: [],
    };
    set((s) => ({
      project: {
        ...s.project,
        compositions: { ...s.project.compositions, [compId]: comp },
        modifiedAt: Date.now(),
      },
    }));
    return compId;
  },

  addLayer: (compositionId, layer) =>
    set((s) => {
      const comp = s.project.compositions[compositionId];
      if (!comp) return s;
      return {
        project: {
          ...s.project,
          compositions: {
            ...s.project.compositions,
            [compositionId]: { ...comp, layers: [...comp.layers, layer] },
          },
          modifiedAt: Date.now(),
        },
      };
    }),

  removeLayer: (compositionId, layerId) =>
    set((s) => {
      const comp = s.project.compositions[compositionId];
      if (!comp) return s;
      return {
        project: {
          ...s.project,
          compositions: {
            ...s.project.compositions,
            [compositionId]: {
              ...comp,
              layers: comp.layers.filter((l) => l.id !== layerId),
            },
          },
          modifiedAt: Date.now(),
        },
        selectedLayerIds: s.selectedLayerIds.filter((id) => id !== layerId),
      };
    }),

  updateLayer: (compositionId, layerId, patch) =>
    set((s) => {
      const comp = s.project.compositions[compositionId];
      if (!comp) return s;
      return {
        project: {
          ...s.project,
          compositions: {
            ...s.project.compositions,
            [compositionId]: {
              ...comp,
              layers: comp.layers.map((l) =>
                l.id === layerId ? ({ ...l, ...patch } as MoLayer) : l,
              ),
            },
          },
          modifiedAt: Date.now(),
        },
      };
    }),

  moveLayer: (compositionId, layerId, newZIndex) =>
    set((s) => {
      const comp = s.project.compositions[compositionId];
      if (!comp) return s;
      return {
        project: {
          ...s.project,
          compositions: {
            ...s.project.compositions,
            [compositionId]: {
              ...comp,
              layers: comp.layers.map((l) =>
                l.id === layerId ? ({ ...l, zIndex: newZIndex } as MoLayer) : l,
              ),
            },
          },
          modifiedAt: Date.now(),
        },
      };
    }),
}));

// Selector helpers
export const useMainComposition = () => {
  return useProjectStore((s) => {
    const mainId = s.project.settings.mainCompositionId;
    return s.project.compositions[mainId];
  });
};

export const useSelectedLayers = () => {
  return useProjectStore((s) => {
    const comp = s.project.compositions[s.project.settings.mainCompositionId];
    if (!comp) return [] as MoLayer[];
    return comp.layers.filter((l) => s.selectedLayerIds.includes(l.id));
  });
};

// Re-export defaultTransform for use in layer creation helpers
export { defaultTransform };
