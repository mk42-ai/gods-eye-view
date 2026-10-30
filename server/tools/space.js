/**
 * server/tools/space.js — OnDemand-callable orbital rocket launch tracker
 * backed by the Launch Library 2 proxy (server/providers/space/launch-library.js).
 *
 * Queries recent and upcoming orbital rocket launches worldwide, with
 * provider agency, rocket configuration, launch pad coordinates, mission description,
 * and flight status.
 */
import { rocketLaunchesProxy } from '../providers/space/launch-library.js';
import { createPluginInvoker } from './_invoke.js';

const defaultInvoke = createPluginInvoker(() => rocketLaunchesProxy());

const isoUtc = (date = new Date()) =>
  (date instanceof Date ? date : new Date(date)).toISOString();

export const plugin = Object.freeze({
  id: 'space',
  name: 'OnDemand Spatial Space Launches (Launch Library 2)',
  description:
    'Recent and upcoming orbital rocket launches worldwide from The Space Devs ' +
    'Launch Library 2 (LL2). Tracks launch missions, launch service providers ' +
    '(SpaceX, NASA, ISRO, Roscosmos, Rocket Lab, ESA, Arianespace), rocket configuration, ' +
    'launch pad location coordinates, mission objectives, and launch status (success, ' +
    'failure, in-flight, upcoming). 15-minute server cache. Keyless open data.',
  category: 'Research',
  conversationStarters: [
    'What were the most recent orbital rocket launches worldwide?',
    'List upcoming space launches scheduled this month',
    'Are there any recent Falcon 9 or SpaceX launches recorded?',
    'Show rocket launches that took place from Cape Canaveral / Kennedy Space Center',
  ],
});

export const LAUNCH_STATUSES = Object.freeze([
  'all',
  'success',
  'failure',
  'upcoming',
]);

function matchesLaunchStatus(launch, targetStatus) {
  if (!targetStatus || targetStatus === 'all') return true;
  const statusId = launch?.status?.id;
  const statusName = String(launch?.status?.name || '').toLowerCase();

  // LL2 Status IDs:
  // 1 = Go for Launch, 2 = To Be Confirmed / Upcoming
  // 3 = Launch Successful
  // 4 = Launch Failure, 7 = Partial Failure
  if (targetStatus === 'success') {
    return statusId === 3 || statusName.includes('success');
  }
  if (targetStatus === 'failure') {
    return statusId === 4 || statusId === 7 || statusName.includes('failure');
  }
  if (targetStatus === 'upcoming') {
    return (
      statusId === 1 ||
      statusId === 2 ||
      statusName.includes('go') ||
      statusName.includes('tbd')
    );
  }
  return true;
}

export function createSpaceTools({ invoke = defaultInvoke } = {}) {
  const rocketLaunchesRecent = {
    name: 'rocket_launches_recent',
    summary:
      'Recent and upcoming orbital rocket launches worldwide (Launch Library 2)',
    description:
      'Queries orbital rocket launches worldwide from Launch Library 2 (LL2). ' +
      'Filterable by outcome status (all, success, failure, upcoming). Returns launch ' +
      'mission name, launch provider / agency, rocket configuration, launch pad coordinates, ' +
      'scheduled launch time (UTC), mission description, and flight outcome.',
    cacheSeconds: 900,
    params: {
      status: {
        type: 'enum',
        values: LAUNCH_STATUSES,
        default: 'all',
        description:
          'Filter launches by status: "all", "success", "failure", or "upcoming". Default all.',
      },
      limit: {
        type: 'integer',
        min: 1,
        max: 50,
        default: 20,
        description:
          'Maximum number of launches to return (1 to 50). Default 20.',
      },
    },
    async handler(params, ctx = {}) {
      const nowFn = typeof ctx.now === 'function' ? ctx.now : () => new Date();

      try {
        const answer = await invoke('/api/launches', {
          signal: ctx.signal,
        });

        if (answer.status !== 200 || !answer.json) {
          return {
            ok: false,
            status: answer.status === 503 ? 503 : 502,
            error: {
              code:
                answer.status === 503
                  ? 'upstream_unavailable'
                  : 'malformed_upstream',
              message:
                answer.json?.error ||
                `Launch Library 2 route answered HTTP ${answer.status}`,
            },
            provider: {
              status: 'unavailable',
              source: 'Launch Library 2',
              fetchedAt: null,
              ageSec: null,
              error: answer.json?.error || 'Launch Library 2 unavailable',
              count: 0,
            },
          };
        }

        const rawResults = Array.isArray(answer.json.results)
          ? answer.json.results
          : [];

        const filtered = [];
        for (const launch of rawResults) {
          if (!matchesLaunchStatus(launch, params.status)) continue;

          filtered.push({
            id: launch.id,
            name: launch.name,
            status: launch.status?.name || 'Unknown',
            statusDescription: launch.status?.description || null,
            netUtc: launch.net || null,
            provider: launch.launch_service_provider?.name || null,
            rocket: launch.rocket?.configuration?.name || null,
            mission: launch.mission
              ? {
                  name: launch.mission.name,
                  type: launch.mission.type,
                  description: launch.mission.description,
                }
              : null,
            pad: launch.pad
              ? {
                  name: launch.pad.name,
                  location: launch.pad.location?.name || null,
                  latitude: Number(launch.pad.latitude) || null,
                  longitude: Number(launch.pad.longitude) || null,
                  countryCode: launch.pad.country_code || null,
                }
              : null,
            webcastLive: launch.webcast_live === true,
          });
        }

        const launches = filtered.slice(0, params.limit);

        return {
          ok: true,
          data: {
            statusFilter: params.status,
            count: launches.length,
            totalAvailable: rawResults.length,
            launches,
          },
          provider: {
            status: 'live',
            source: 'Launch Library 2',
            fetchedAt: isoUtc(nowFn()),
            ageSec: 0,
            error: null,
            count: launches.length,
          },
          provenance: {
            provider: 'The Space Devs / Launch Library 2',
            source_url: 'https://ll.thespacedevs.com/2.3.0/launches/recent/',
            license: {
              name: 'The Space Devs Terms of Use (Attribution required)',
              url: 'https://thespacedevs.com/llapi',
              attribution: 'Data provided by The Space Devs Launch Library 2',
            },
            completeness: {
              status: 'sampled',
              note: 'Recent and scheduled orbital launches from public Launch Library 2 API.',
            },
          },
        };
      } catch (err) {
        return {
          ok: false,
          status: 502,
          error: {
            code: 'tool_failed',
            message: `rocket_launches_recent failed: ${String(err?.message || err).slice(0, 160)}`,
          },
        };
      }
    },
  };

  return [rocketLaunchesRecent];
}

export const tools = createSpaceTools();
