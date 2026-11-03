# Asset-source research (performed inside this task; upstream research step had failed)

Searched/probed from the H100 host (UTC 2026-11-03 08:47–08:55). Only license-clear sources were used.

| Source | How verified | Used for |
|---|---|---|
| **Kenney.nl** (CC0 1.0 — `License.txt` inside every zip) | `/download-link/<hex(assets/<slug>)>` JSON hop → signed zip; packs: car-kit 3.1, city-kit-roads, watercraft-kit, mini-characters, blocky-characters, survival-kit | police_patrol_car, ambulance_medical_point, traffic_cone_cluster, crowd_control_barrier, road_closed_barricade, event_command_post (tent), start_finish_gate, foot_patrol_officer, spectator_crowd_cluster, marine_patrol_boat |
| **Poly Haven** (CC0 1.0 — api.polyhaven.com) | `/assets?t=models` keyword scan, `/files/<id>` → 1k glTF + textures; `/assets?t=hdris` | cctv_camera (security_camera_01), checkpoint_cordon_node (concrete_road_barrier), HDRIs kiara_9_dusk / dikhololo_night / clarens_midday (2k) |
| **OpenGameArt** (per-page `license-name` = CC0) | advanced search type=3D; pages /content/3d-bus (ajanhallinta), /content/fancy-motorcycle (tehbucket) | city_bus (OBJ, 5,669 faces), police_escort_motorcycle (OBJ) |
| Quaternius | pack page links only to Google Drive folders (no direct URL) | not used |
| Sketchfab CC / Polycam | require account/API token for downloads | not used |
| kenney mini-characters-1 slug | `{"error":"not found"}` → used `mini-characters` | — |

Conversion: Blender 4.2 headless (`render_service`'s `convert_assets.py` equivalent on the host) → `.glb` (glTF 2.0) +
`.usdc` (USD) per key; polycount and bbox measured at export; manifest at `assets/manifest.json` (14/14 keys `ok`, 0 missing).
Caveat: Kenney/OpenGameArt assets are stylised low-poly, not photoscans — "hyper-real" is carried by the HDRI lighting,
path tracing and the satellite ground/roof texture, not by the prop models. Source files + converted assets live on the
host under /localstorage/mk.thomas/gev/assets (≈ 25 MB polyhaven + 40 MB kenney/oga), not in git.
