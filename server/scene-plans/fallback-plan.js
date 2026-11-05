/**
 * Deterministic template fallback plan generator.
 *
 * Guarantees that even if all LLM planning tiers (Cinematic Director and
 * legacy synchronous LLM) time out, fail, or return unparseable output, the
 * service still produces a fully valid SCENE_PLAN_SCHEMA legacy plan.
 */
import {
  validateScenePlan,
  SCENE_PLAN_VERSION,
} from '../../src/scenes/structuredPlan.js';
import {
  classifyPrompt,
  templateSpec,
} from '../../src/scenes/sceneTemplates.js';

function determineScenario(prompt, spec) {
  if (spec?.scenario) {
    if (spec.scenario === 'police_raid') return 'raid';
    if (spec.scenario === 'crowd_event') return 'route';
  }
  const text = String(prompt || '').toLowerCase();
  if (
    /\b(crash|car crash|collision|traffic accident|road accident|accident)\b/i.test(
      text,
    )
  ) {
    return 'crash';
  }
  if (/\b(smoke|fire|alarm|explosion|gas leak|hazmat|burning)\b/i.test(text)) {
    return 'smoke';
  }
  if (/\b(raid|raided|raiding|swat|bust|arrest)\b/i.test(text)) {
    return 'raid';
  }
  if (
    /\b(marathon|run|race|running route|5k|10k|half[- ]marathon|triathlon|cycle)\b/i.test(
      text,
    )
  ) {
    return 'route';
  }
  const classified = classifyPrompt(text);
  if (classified === 'police_raid') return 'raid';
  if (classified === 'crowd_event') return 'route';
  if (
    classified === 'perimeter_cordon' &&
    /\b(crash|collision|accident)\b/i.test(text)
  )
    return 'crash';
  return 'venue';
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Builds a deterministic, schema-valid legacy scene plan from the prompt scenario.
 *
 * @param {object} options
 * @param {string} options.prompt
 * @param {{name:string, lat:number, lon:number, sourceUrl?:string}} options.location
 * @param {object} [options.verification]
 * @param {Array<{url:string, title?:string, publishedAt?:string}>} [options.citations]
 * @param {object} [options.spec]
 * @param {object} [options.staging]
 * @param {number} [options.durationSec=60]
 * @returns {object} Validated SCENE_PLAN_SCHEMA object
 */
export function templateScenePlan({
  prompt,
  location,
  verification,
  citations = [],
  spec,
  staging,
  durationSec = 60,
}) {
  if (
    !location ||
    !Number.isFinite(location.lat) ||
    !Number.isFinite(location.lon)
  ) {
    throw new Error(
      'templateScenePlan requires a location with valid lat and lon coordinates',
    );
  }

  const duration = clamp(Math.round(durationSec || 60), 10, 180);
  const scenario = determineScenario(prompt, spec);
  const locName = String(location.name || 'Scene Location').slice(0, 120);

  let title;
  let entities = [];
  let relationships = [];
  let beats = [];

  switch (scenario) {
    case 'crash': {
      title = `${locName} — Illustrative Traffic Incident Response`;
      entities = [
        {
          id: 'sedan-lead-1',
          type: 'vehicle',
          label: 'Collision Vehicle 1 (Sedan)',
          quantity: 1,
          position: { eastM: -6, northM: 2 },
          heading: 75,
        },
        {
          id: 'sedan-impact-2',
          type: 'vehicle',
          label: 'Collision Vehicle 2 (Sedan)',
          quantity: 1,
          position: { eastM: 7, northM: -3 },
          heading: 250,
        },
        {
          id: 'ambulance-medical-1',
          type: 'vehicle',
          label: 'Emergency Medical Ambulance',
          quantity: 1,
          position: { eastM: -25, northM: -15 },
          heading: 30,
        },
        {
          id: 'police-traffic-1',
          type: 'police_vehicle',
          label: 'Traffic Patrol Car',
          quantity: 1,
          position: { eastM: 25, northM: 15 },
          heading: 210,
        },
        {
          id: 'traffic-cones-1',
          type: 'barrier',
          label: 'Safety Cones Array',
          quantity: 12,
          position: { eastM: -35, northM: 0 },
          heading: 90,
        },
        {
          id: 'cordon-barricade-1',
          type: 'barrier',
          label: 'Incident Scene Barricades',
          quantity: 6,
          position: { eastM: 0, northM: 25 },
          heading: 180,
        },
      ];
      relationships = [
        {
          from: 'ambulance-medical-1',
          to: 'sedan-lead-1',
          relation: 'rendering_aid',
        },
        {
          from: 'police-traffic-1',
          to: 'traffic-cones-1',
          relation: 'diverting_traffic',
        },
      ];
      beats = [
        {
          atSec: 0,
          title: 'Traffic incident overview',
          narration:
            'Illustrative staging: Two involved sedans come to a halt following a roadway collision.',
          entityIds: ['sedan-lead-1', 'sedan-impact-2'],
          camera: {
            distanceM: 400,
            heading: 70,
            pitch: -35,
            framing: 'wide',
          },
        },
        {
          atSec: Math.round(duration * 0.25),
          title: 'Emergency medical arrival',
          narration:
            'Illustrative overview: Ambulance medical unit arrives at the scene to triage occupants.',
          entityIds: ['ambulance-medical-1', 'sedan-lead-1'],
          camera: {
            distanceM: 250,
            heading: 45,
            pitch: -30,
            framing: 'medium',
          },
        },
        {
          atSec: Math.round(duration * 0.55),
          title: 'Traffic diversion and cordon',
          narration:
            'Illustrative staging: Patrol officers deploy safety cones and cordon barricades to reroute surrounding traffic.',
          entityIds: [
            'police-traffic-1',
            'traffic-cones-1',
            'cordon-barricade-1',
          ],
          camera: {
            distanceM: 180,
            heading: 120,
            pitch: -25,
            framing: 'close',
          },
        },
        {
          atSec: Math.round(duration * 0.85),
          title: 'Scene clearance operations',
          narration:
            'Illustrative overview: Responders secure the roadway and coordinate clearance of the incident zone.',
          entityIds: ['police-traffic-1', 'ambulance-medical-1'],
          camera: {
            distanceM: 450,
            heading: 60,
            pitch: -40,
            framing: 'wide',
          },
        },
      ];
      break;
    }

    case 'raid': {
      title = `${locName} — Illustrative Police Operation`;
      entities = [
        {
          id: 'police-command-1',
          type: 'police_vehicle',
          label: 'Command Patrol Vehicle',
          quantity: 1,
          position: { eastM: -30, northM: -20 },
          heading: 45,
        },
        {
          id: 'police-perimeter-1',
          type: 'police_vehicle',
          label: 'Perimeter Response Car',
          quantity: 2,
          position: { eastM: 40, northM: 30 },
          heading: 220,
        },
        {
          id: 'officers-entry-1',
          type: 'police',
          label: 'Tactical Entry Officers',
          quantity: 6,
          position: { eastM: 10, northM: 5 },
          heading: 90,
        },
        {
          id: 'officers-cordon-1',
          type: 'police',
          label: 'Outer Cordon Officers',
          quantity: 4,
          position: { eastM: -15, northM: 35 },
          heading: 180,
        },
        {
          id: 'barrier-outer-1',
          type: 'barrier',
          label: 'Perimeter Barricades',
          quantity: 8,
          position: { eastM: 0, northM: -45 },
          heading: 0,
        },
      ];
      relationships = [
        {
          from: 'officers-entry-1',
          to: 'police-command-1',
          relation: 'coordinated_with',
        },
        {
          from: 'officers-cordon-1',
          to: 'barrier-outer-1',
          relation: 'securing_perimeter',
        },
      ];
      beats = [
        {
          atSec: 0,
          title: 'Perimeter established',
          narration:
            'Illustrative staging: Police patrol units establish an outer security cordon around the location perimeter.',
          entityIds: ['police-perimeter-1', 'barrier-outer-1'],
          camera: {
            distanceM: 500,
            heading: 45,
            pitch: -35,
            framing: 'wide',
          },
        },
        {
          atSec: Math.round(duration * 0.25),
          title: 'Command vehicle in position',
          narration:
            'Illustrative overview: Primary command patrol vehicle positions at the designated staging access point.',
          entityIds: ['police-command-1'],
          camera: {
            distanceM: 300,
            heading: 60,
            pitch: -30,
            framing: 'medium',
          },
        },
        {
          atSec: Math.round(duration * 0.55),
          title: 'Tactical entry formation',
          narration:
            'Illustrative staging: Tactical entry officers advance toward the primary entrance in coordinated formation.',
          entityIds: ['officers-entry-1'],
          camera: {
            distanceM: 180,
            heading: 90,
            pitch: -25,
            framing: 'close',
          },
        },
        {
          atSec: Math.round(duration * 0.85),
          title: 'Perimeter containment secured',
          narration:
            'Illustrative overview: Outer cordon officers maintain area security as the illustrative scenario concludes.',
          entityIds: ['officers-cordon-1', 'police-perimeter-1'],
          camera: {
            distanceM: 550,
            heading: 30,
            pitch: -40,
            framing: 'wide',
          },
        },
      ];
      break;
    }

    case 'route': {
      title = `${locName} — Illustrative Running Route & Event Staging`;
      entities = [
        {
          id: 'start-gate-1',
          type: 'start_line',
          label: 'Event Start Line Gate',
          quantity: 1,
          position: { eastM: -100, northM: 0 },
          heading: 90,
        },
        {
          id: 'finish-gate-1',
          type: 'finish_line',
          label: 'Event Finish Line Gate',
          quantity: 1,
          position: { eastM: 200, northM: 0 },
          heading: 90,
        },
        {
          id: 'lead-runners-1',
          type: 'runner',
          label: 'Lead Runner Pack',
          quantity: 12,
          position: { eastM: -60, northM: 0 },
          heading: 90,
        },
        {
          id: 'chase-runners-1',
          type: 'runner',
          label: 'Main Runner Field',
          quantity: 24,
          position: { eastM: -90, northM: 0 },
          heading: 90,
        },
        {
          id: 'crowd-barriers-1',
          type: 'barrier',
          label: 'Spectator Crowd Barriers',
          quantity: 16,
          position: { eastM: 0, northM: 12 },
          heading: 90,
        },
        {
          id: 'marshals-organizers-1',
          type: 'organizer',
          label: 'Course Marshals & Officials',
          quantity: 6,
          position: { eastM: 50, northM: -10 },
          heading: 0,
        },
      ];
      relationships = [
        {
          from: 'lead-runners-1',
          to: 'start-gate-1',
          relation: 'departed_from',
        },
        {
          from: 'marshals-organizers-1',
          to: 'crowd-barriers-1',
          relation: 'monitoring_boundary',
        },
      ];
      beats = [
        {
          atSec: 0,
          title: 'Course starting assembly',
          narration:
            'Illustrative staging: Runners gather behind the start line gate with spectator crowd barriers lining the route.',
          entityIds: ['start-gate-1', 'chase-runners-1', 'crowd-barriers-1'],
          camera: {
            distanceM: 450,
            heading: 90,
            pitch: -35,
            framing: 'wide',
          },
        },
        {
          atSec: Math.round(duration * 0.25),
          title: 'Lead pack departure',
          narration:
            'Illustrative overview: The lead runner pack crosses the start gate and accelerates down the course corridor.',
          entityIds: ['lead-runners-1', 'start-gate-1'],
          camera: {
            distanceM: 280,
            heading: 80,
            pitch: -30,
            framing: 'medium',
          },
        },
        {
          atSec: Math.round(duration * 0.55),
          title: 'Mid-race progress',
          narration:
            'Illustrative staging: Course marshals monitor runners navigating the marked event route.',
          entityIds: ['lead-runners-1', 'marshals-organizers-1'],
          camera: {
            distanceM: 180,
            heading: 100,
            pitch: -25,
            framing: 'close',
          },
        },
        {
          atSec: Math.round(duration * 0.85),
          title: 'Finish line approach',
          narration:
            'Illustrative overview: Participants advance toward the finish line arch as the illustrative event concludes.',
          entityIds: ['finish-gate-1', 'lead-runners-1'],
          camera: {
            distanceM: 500,
            heading: 90,
            pitch: -40,
            framing: 'wide',
          },
        },
      ];
      break;
    }

    case 'smoke': {
      title = `${locName} — Illustrative Smoke Incident & Hazard Containment`;
      entities = [
        {
          id: 'incident-point-1',
          type: 'vehicle',
          label: 'Incident Location Vehicle',
          quantity: 1,
          position: { eastM: 0, northM: 0 },
          heading: 0,
        },
        {
          id: 'response-engine-1',
          type: 'vehicle',
          label: 'Emergency Response Units',
          quantity: 2,
          position: { eastM: -30, northM: -20 },
          heading: 45,
        },
        {
          id: 'evacuees-group-1',
          type: 'person',
          label: 'Evacuated Civilians',
          quantity: 16,
          position: { eastM: 60, northM: 40 },
          heading: 45,
        },
        {
          id: 'safety-cordon-1',
          type: 'barrier',
          label: 'Hazard Exclusion Barricades',
          quantity: 10,
          position: { eastM: 0, northM: 30 },
          heading: 180,
        },
        {
          id: 'safety-officers-1',
          type: 'police',
          label: 'Safety Marshals',
          quantity: 4,
          position: { eastM: 30, northM: 20 },
          heading: 220,
        },
      ];
      relationships = [
        {
          from: 'safety-officers-1',
          to: 'safety-cordon-1',
          relation: 'enforcing_cordon',
        },
      ];
      beats = [
        {
          atSec: 0,
          title: 'Smoke indicator reported',
          narration:
            'Illustrative staging: Emergency responders observe smoke plumes rising from the designated area.',
          entityIds: ['incident-point-1'],
          camera: {
            distanceM: 450,
            heading: 45,
            pitch: -35,
            framing: 'wide',
          },
        },
        {
          atSec: Math.round(duration * 0.25),
          title: 'Response vehicles arrive',
          narration:
            'Illustrative overview: Emergency response vehicles deploy equipment at the staging boundary.',
          entityIds: ['response-engine-1'],
          camera: {
            distanceM: 280,
            heading: 60,
            pitch: -30,
            framing: 'medium',
          },
        },
        {
          atSec: Math.round(duration * 0.55),
          title: 'Safety exclusion cordon',
          narration:
            'Illustrative staging: Marshals place barricades to divert civilians to safe assembly areas.',
          entityIds: ['safety-cordon-1', 'evacuees-group-1'],
          camera: {
            distanceM: 220,
            heading: 90,
            pitch: -25,
            framing: 'close',
          },
        },
        {
          atSec: Math.round(duration * 0.85),
          title: 'Hazard containment verified',
          narration:
            'Illustrative overview: Safety personnel secure the hazard boundary and conclude illustrative operations.',
          entityIds: ['safety-officers-1', 'safety-cordon-1'],
          camera: {
            distanceM: 500,
            heading: 40,
            pitch: -40,
            framing: 'wide',
          },
        },
      ];
      break;
    }

    default: {
      // venue / observation / building
      title = `${locName} — Illustrative Venue Overview`;
      entities = [
        {
          id: 'venue-security-1',
          type: 'police_vehicle',
          label: 'Venue Security Patrol Car',
          quantity: 2,
          position: { eastM: -25, northM: 10 },
          heading: 90,
        },
        {
          id: 'perimeter-patrol-1',
          type: 'police',
          label: 'Perimeter Foot Patrol Officers',
          quantity: 6,
          position: { eastM: 20, northM: -15 },
          heading: 270,
        },
        {
          id: 'access-control-1',
          type: 'barrier',
          label: 'Access Control Barricades',
          quantity: 8,
          position: { eastM: 0, northM: -25 },
          heading: 0,
        },
        {
          id: 'venue-visitors-1',
          type: 'person',
          label: 'Venue Attendees',
          quantity: 12,
          position: { eastM: 15, northM: 20 },
          heading: 180,
        },
      ];
      relationships = [
        {
          from: 'perimeter-patrol-1',
          to: 'access-control-1',
          relation: 'monitoring_entry',
        },
      ];
      beats = [
        {
          atSec: 0,
          title: 'Venue overview',
          narration:
            'Illustrative staging: Security units establish an observation presence around the venue grounds.',
          entityIds: ['venue-security-1', 'access-control-1'],
          camera: {
            distanceM: 400,
            heading: 45,
            pitch: -35,
            framing: 'wide',
          },
        },
        {
          atSec: Math.round(duration * 0.25),
          title: 'Access corridor monitoring',
          narration:
            'Illustrative overview: Foot patrols monitor visitor circulation along designated paths.',
          entityIds: ['perimeter-patrol-1', 'venue-visitors-1'],
          camera: {
            distanceM: 250,
            heading: 60,
            pitch: -30,
            framing: 'medium',
          },
        },
        {
          atSec: Math.round(duration * 0.55),
          title: 'Sector observation',
          narration:
            'Illustrative staging: Mobile patrols coordinate surveillance and observation across key sectors.',
          entityIds: ['perimeter-patrol-1', 'access-control-1'],
          camera: {
            distanceM: 180,
            heading: 90,
            pitch: -25,
            framing: 'close',
          },
        },
        {
          atSec: Math.round(duration * 0.85),
          title: 'Monitoring complete',
          narration:
            'Illustrative overview: Protective measures maintain stable containment around the illustrative site.',
          entityIds: ['venue-security-1', 'perimeter-patrol-1'],
          camera: {
            distanceM: 450,
            heading: 30,
            pitch: -40,
            framing: 'wide',
          },
        },
      ];
      break;
    }
  }

  const checkedAt = new Date().toISOString();
  const safeVerification = verification || {
    status: 'location_approximate',
    locationSource: 'template-fallback',
    checkedAt,
    limitations: [
      'All actors, placements, counts, camera motions and scene beats are illustrative staging, not observed facts.',
      'Deterministic template fallback generated when live planning models were unavailable.',
    ],
  };

  const safeCitations = Array.isArray(citations)
    ? citations.slice(0, 40).map((c) => ({
        url: c.url,
        ...(c.title ? { title: String(c.title).slice(0, 300) } : {}),
        ...(c.publishedAt
          ? { publishedAt: String(c.publishedAt).slice(0, 40) }
          : {}),
      }))
    : [];

  const rawPlan = {
    version: SCENE_PLAN_VERSION,
    title: String(title).slice(0, 200),
    illustrative: true,
    durationSec: duration,
    location: {
      name: String(location.name || 'Scene Location').slice(0, 300),
      lat: location.lat,
      lon: location.lon,
      ...(location.sourceUrl ? { sourceUrl: location.sourceUrl } : {}),
    },
    camera: {
      distanceM: 400,
      heading: 45,
      pitch: -35,
      framing: 'wide',
    },
    entities,
    relationships,
    beats,
    citations: safeCitations,
    verification: safeVerification,
  };

  return validateScenePlan(rawPlan);
}
