/**
 * Gods-Eye scene engine — scenes module public API.
 * Runtime-neutral: browser ES module, no DOM, no Node builtins.
 */

export {
  createScene,
  createFootageItem,
  sceneLifecycle,
  SCENE_STATES,
  SOURCE_PLATFORMS,
  STAGES,
  newSceneId,
} from './models.js';

export {
  reduce,
  initialState,
  SceneStateError,
  isValidTransition,
  TRANSITIONS,
} from './reducer.js';

export { createSceneStore } from './store.js';

export { createPersistence } from './persistence.js';

export {
  encodeSceneShare,
  decodeSceneShare,
  sceneFromFallback,
} from './share.js';

export {
  loadRegister,
  findAoi,
  nearestAoi,
  addAoi,
  listAoi,
} from './aoiRegister.js';

export {
  parsePrompt,
  geocodePlace,
  deriveTRef,
  KNOWN_INCIDENTS,
} from './prompt.js';
