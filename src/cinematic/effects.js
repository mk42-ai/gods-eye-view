/**
 * Visual effects runtime for Cesium: particle systems (smoke/fire/dust),
 * emergency light toggling, fog/haze tweaks, lighting transitions, and highlight pulses.
 * Guarded for Node testing and graceful degradation.
 */
import * as Cesium from 'cesium';

/**
 * Creates visual effects manager.
 *
 * @param {object} options
 * @param {Cesium.Viewer} [options.viewer]
 * @param {object} [options.context] GeoSceneContext
 * @param {Function} [options.onEvent]
 */
export function createEffects({ viewer, context, onEvent } = {}) {
  /** @type {Map<string, {type:string, effect:object, cleanup:Function, tick?:Function}>} */
  const activeEffects = new Map();

  function emit(eventName, data) {
    if (typeof onEvent === 'function') {
      try {
        onEvent(eventName, data);
      } catch (err) {
        console.error('[effects] onEvent error:', err);
      }
    }
  }

  function getPosition(effect, entityPositionGetter) {
    if (effect.entityId && typeof entityPositionGetter === 'function') {
      const pos = entityPositionGetter(effect.entityId);
      if (pos) return pos;
    }
    if (effect.position && context?.localToCartesian) {
      return context.localToCartesian(effect.position);
    }
    if (context?.localToCartesian) {
      return context.localToCartesian({ eastM: 0, northM: 0, heightM: 0 });
    }
    return Cesium.Cartesian3.ZERO;
  }

  function add(effect, entityPositionGetter, entityGetter) {
    if (!effect || !effect.id || !effect.type) return null;
    if (activeEffects.has(effect.id)) {
      remove(effect.id);
    }

    emit('asset.loading', { effectId: effect.id, type: effect.type });

    const intensity = Math.max(0, Math.min(1, effect.intensity ?? 0.5));
    let cleanup = () => {};
    let tickFn = null;

    try {
      switch (effect.type) {
        case 'smoke':
        case 'fire':
        case 'dust': {
          const primitives = viewer?.scene?.primitives;
          const pos = getPosition(effect, entityPositionGetter);
          const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(pos);

          const isFire = effect.type === 'fire';
          const isSmoke = effect.type === 'smoke';

          const startColor = isFire
            ? new Cesium.Color(1.0, 0.4, 0.1, 0.8)
            : isSmoke
              ? new Cesium.Color(0.4, 0.4, 0.4, 0.6)
              : new Cesium.Color(0.65, 0.55, 0.4, 0.5);

          const endColor = isFire
            ? new Cesium.Color(0.8, 0.1, 0.0, 0.0)
            : isSmoke
              ? new Cesium.Color(0.2, 0.2, 0.2, 0.0)
              : new Cesium.Color(0.65, 0.55, 0.4, 0.0);

          const emissionRate = Math.min(
            40,
            Math.max(5, Math.round(intensity * 40)),
          );
          const lifetime = Math.min(6, Math.max(1, intensity * 4 + 1));

          const ps = new Cesium.ParticleSystem({
            image: '/scene-icons/png/effect_smoke_fire@2x.png',
            startColor,
            endColor,
            startScale: 1.0,
            endScale: 3.5,
            minimumParticleLife: lifetime * 0.5,
            maximumParticleLife: lifetime,
            minimumSpeed: 1.0,
            maximumSpeed: 4.0,
            imageSize: new Cesium.Cartesian2(24, 24),
            emissionRate,
            lifetime,
            modelMatrix,
          });

          if (primitives?.add) {
            primitives.add(ps);
            cleanup = () => {
              try {
                primitives.remove(ps);
              } catch {}
            };
          }

          tickFn = () => {
            // If attached to moving entity, update modelMatrix
            if (effect.entityId && typeof entityPositionGetter === 'function') {
              const currentPos = entityPositionGetter(effect.entityId);
              if (currentPos) {
                ps.modelMatrix =
                  Cesium.Transforms.eastNorthUpToFixedFrame(currentPos);
              }
            }
          };
          break;
        }

        case 'emergency_lights': {
          let origColor = null;
          let origOutlineColor = null;

          tickFn = (sec = 0) => {
            if (!effect.entityId || typeof entityGetter !== 'function') return;
            const ent = entityGetter(effect.entityId);
            if (!ent?.billboard) return;

            if (!origColor && ent.billboard.color) {
              origColor = ent.billboard.color.getValue
                ? ent.billboard.color.getValue(Cesium.JulianDate.now())
                : ent.billboard.color;
            }

            // Alternate every 0.25 seconds between red and blue
            const phase = Math.floor(sec * 4) % 2;
            const color =
              phase === 0
                ? Cesium.Color.RED.withAlpha(0.9)
                : Cesium.Color.BLUE.withAlpha(0.9);

            ent.billboard.color = color;
          };

          cleanup = () => {
            if (effect.entityId && typeof entityGetter === 'function') {
              const ent = entityGetter(effect.entityId);
              if (ent?.billboard && origColor) {
                ent.billboard.color = origColor;
              }
            }
          };
          break;
        }

        case 'haze':
        case 'weather_fog': {
          const fog = viewer?.scene?.fog;
          if (fog) {
            const origDensity = fog.density;
            const origEnabled = fog.enabled;
            fog.enabled = true;
            fog.density = Math.min(
              0.01,
              (origDensity || 0.0002) * (1 + intensity * 6),
            );

            cleanup = () => {
              fog.density = origDensity;
              fog.enabled = origEnabled;
            };
          }
          break;
        }

        case 'lighting_transition': {
          const light = viewer?.scene?.light;
          if (light) {
            const origIntensity = light.intensity ?? 1.0;
            light.intensity = intensity * 2.0;

            cleanup = () => {
              light.intensity = origIntensity;
            };
          }
          break;
        }

        case 'highlight_pulse': {
          let origScale = null;

          tickFn = (sec = 0) => {
            if (!effect.entityId || typeof entityGetter !== 'function') return;
            const ent = entityGetter(effect.entityId);
            if (!ent?.billboard) return;

            if (origScale == null && ent.billboard.scale) {
              origScale = ent.billboard.scale.getValue
                ? ent.billboard.scale.getValue(Cesium.JulianDate.now())
                : ent.billboard.scale;
            }

            const base = typeof origScale === 'number' ? origScale : 1.0;
            const pulse = base * (1.0 + 0.3 * Math.sin(sec * 5));
            ent.billboard.scale = pulse;
          };

          cleanup = () => {
            if (effect.entityId && typeof entityGetter === 'function') {
              const ent = entityGetter(effect.entityId);
              if (ent?.billboard && origScale != null) {
                ent.billboard.scale = origScale;
              }
            }
          };
          break;
        }

        default:
          break;
      }

      activeEffects.set(effect.id, {
        type: effect.type,
        effect,
        cleanup,
        tick: tickFn,
      });

      emit('asset.ready', {
        effectId: effect.id,
        type: effect.type,
        substituted: false,
      });
      return effect.id;
    } catch (err) {
      emit('asset.ready', {
        effectId: effect.id,
        type: effect.type,
        substituted: true,
        reason: err.message,
      });
      return null;
    }
  }

  function remove(id) {
    const item = activeEffects.get(id);
    if (!item) return false;
    try {
      item.cleanup();
    } catch (err) {
      console.error('[effects] cleanup error:', err);
    }
    activeEffects.delete(id);
    return true;
  }

  function clear() {
    for (const [id] of activeEffects) {
      remove(id);
    }
    activeEffects.clear();
  }

  function tick(sec = 0) {
    for (const item of activeEffects.values()) {
      if (typeof item.tick === 'function') {
        try {
          item.tick(sec);
        } catch {}
      }
    }
  }

  return {
    add,
    remove,
    clear,
    tick,
    get: (id) => activeEffects.get(id)?.effect || null,
    count: () => activeEffects.size,
  };
}
