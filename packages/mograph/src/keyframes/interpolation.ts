/**
 * Keyframe interpolation with "hold" easing support.
 * Extends the existing AnimationEngine from @openreel/core with hold semantics.
 */

import type { MoKeyframe, MoEasingType, MoKeyframeValue, TimeMicros } from "../types/schema";
import { AnimationEngine } from "@openreel/core/video/animation-engine";
import type { EasingType } from "@openreel/core/types/timeline";

export class MoInterpolator {
  private animEngine = new AnimationEngine();

  /**
   * Evaluate the value of a set of keyframes (all for the same property) at timeUs.
   * Handles "hold" easing: snaps to keyframeA value until keyframeB, then snaps.
   */
  evaluate(keyframes: readonly MoKeyframe[], timeUs: TimeMicros): MoKeyframeValue {
    if (keyframes.length === 0) return 0;

    const sorted = [...keyframes].sort((a, b) => a.timeUs - b.timeUs);

    // Before first keyframe: hold first value
    if (timeUs <= sorted[0].timeUs) return sorted[0].value;

    // After last keyframe: hold last value
    if (timeUs >= sorted[sorted.length - 1].timeUs) return sorted[sorted.length - 1].value;

    // Find surrounding keyframes
    let kfA: MoKeyframe | null = null;
    let kfB: MoKeyframe | null = null;

    for (let i = 0; i < sorted.length - 1; i++) {
      if (timeUs >= sorted[i].timeUs && timeUs < sorted[i + 1].timeUs) {
        kfA = sorted[i];
        kfB = sorted[i + 1];
        break;
      }
    }

    if (!kfA || !kfB) return sorted[sorted.length - 1].value;

    // Hold easing: return kfA value for the entire interval (snap on keyframe)
    if (kfA.easing === "hold") return kfA.value;

    const duration = kfB.timeUs - kfA.timeUs;
    const elapsed = timeUs - kfA.timeUs;
    const linearT = duration > 0 ? elapsed / duration : 0;

    const easedT = this.applyEasing(linearT, kfA.easing, kfA.bezier);

    return this.interpolateValues(kfA.value, kfB.value, easedT);
  }

  private applyEasing(
    t: number,
    easing: MoEasingType,
    bezier?: MoKeyframe["bezier"],
  ): number {
    if (easing === "hold") return 0;
    if (easing === "bezier" && bezier) {
      return this.animEngine.cubicBezier(t, bezier.inX, bezier.inY, bezier.outX, bezier.outY);
    }
    // Map MoEasingType to core EasingType (same string values)
    return this.animEngine.applyEasing(t, easing as EasingType);
  }

  private interpolateValues(a: MoKeyframeValue, b: MoKeyframeValue, t: number): MoKeyframeValue {
    if (typeof a === "number" && typeof b === "number") {
      return a + (b - a) * t;
    }
    if (
      typeof a === "object" &&
      typeof b === "object" &&
      a !== null &&
      b !== null &&
      !Array.isArray(a) &&
      !Array.isArray(b)
    ) {
      const result: Record<string, MoKeyframeValue> = {};
      for (const key of Object.keys(a)) {
        if (key in b) {
          result[key] = this.interpolateValues(
            (a as Record<string, MoKeyframeValue>)[key],
            (b as Record<string, MoKeyframeValue>)[key],
            t,
          );
        } else {
          result[key] = (a as Record<string, MoKeyframeValue>)[key];
        }
      }
      return result;
    }
    return t < 0.5 ? a : b;
  }
}
