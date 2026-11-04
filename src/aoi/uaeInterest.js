/**
 * The editable UAE AOI configuration, bound once for browser and Node.
 * Edit config/aoi/uae-interest.json — this module only re-exports it and
 * memoises the derived membership index.
 */
import aoiConfig from '../../config/aoi/uae-interest.json' with { type: 'json' };
import { createAoiIndex } from './membership.js';

export { aoiConfig };

let index = null;
/** Process-wide AOI index over the full config (all groups). */
export function getUaeAoiIndex() {
  if (!index) index = createAoiIndex(aoiConfig);
  return index;
}
