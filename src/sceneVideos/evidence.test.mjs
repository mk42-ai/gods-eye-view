import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  tierFor,
  parseVideoUrl,
  tiktokIdToDate,
  instagramCdnMeta,
  playableFor,
  normalizeEvidence,
  dedupeEvidence,
  scoreEvidence,
  rankEvidence,
  countByPlatform,
  TIER_THRESHOLDS_HOURS,
} from './evidence.js';
import {
  clipLabel,
  archivalBanner,
  proxiedMediaSrc,
  iframeSrc,
  clipChatContext,
  formatDay,
} from './labels.js';

const NOW = new Date('2026-10-23T04:00:00Z');
// Real efg blob from the downloadInstagramMedia result for reel Ddyb6fvQ-Yn (asset_age_days 25, duration 31 s).
const IG_CDN =
  'https://scontent-cph2-1.cdninstagram.com/o1/v/t2/f2/m86/x.mp4?_nc_cat=108&efg=eyJ2ZW5jb2RlX3RhZyI6Inhwdl9wcm9ncmVzc2l2ZS5JTlNUQUdSQU0uQ0xJUFMuQzMuNzIwLmRhc2hfYmFzZWxpbmVfMV92MSIsInhwdl9hc3NldF9pZCI6MzE2MDQ3NDI4NDE1NzYyNywiYXNzZXRfYWdlX2RheXMiOjI1LCJ2aV91c2VjYXNlX2lkIjoxMDA5OSwiZHVyYXRpb25fcyI6MzEsInVybGdlbl9zb3VyY2UiOiJ3d3cifQ%3D%3D&ccb=17-1&oe=6ADCBDA5';

const plan = {
  bbox: [55.17, 25.12, 55.24, 25.17],
  anchor: { lat: 25.1425, lon: 55.2055 },
  places: ['Umm Suqeim', 'Jumeirah Street'],
  regions: ['Dubai', 'Dubai Police'],
  keywordsEn: ['Umm Suqeim', 'crash', 'accident', 'Dubai Police'],
  keywordsAr: ['حادث', 'أم سقيم'],
};

describe('tierFor (labeling thresholds)', () => {
  test('≤24 h is LIVE, ≤7 d RECENT, older ARCHIVAL', () => {
    assert.equal(tierFor('2026-10-23T01:00:00Z', NOW).tier, 'LIVE');
    assert.equal(tierFor('2026-10-22T04:00:00Z', NOW).tier, 'LIVE'); // exactly 24 h
    assert.equal(tierFor('2026-10-22T03:59:00Z', NOW).tier, 'RECENT');
    assert.equal(tierFor('2026-10-16T05:00:00Z', NOW).tier, 'RECENT');
    assert.equal(tierFor('2026-09-26T00:00:00Z', NOW).tier, 'ARCHIVAL');
    assert.equal(TIER_THRESHOLDS_HOURS.LIVE, 24);
  });
  test('undated and future-dated footage is ARCHIVAL, never LIVE', () => {
    assert.deepEqual(tierFor(null, NOW), {
      tier: 'ARCHIVAL',
      ageHours: null,
      undated: true,
    });
    assert.equal(tierFor('not a date', NOW).tier, 'ARCHIVAL');
    assert.equal(tierFor('2026-11-30T00:00:00Z', NOW).tier, 'ARCHIVAL');
  });
});

describe('URL parsing + platform metadata', () => {
  test('YouTube watch / shorts / youtu.be', () => {
    assert.equal(
      parseVideoUrl('https://www.youtube.com/shorts/pu6shIJmb5s').id,
      'pu6shIJmb5s',
    );
    assert.equal(
      parseVideoUrl('https://www.youtube.com/shorts/pu6shIJmb5s').isShort,
      true,
    );
    assert.equal(
      parseVideoUrl('https://youtu.be/XLN90wxeKuw').canonical,
      'https://www.youtube.com/watch?v=XLN90wxeKuw',
    );
    assert.equal(
      parseVideoUrl('https://www.youtube.com/user/dubaipolicehq'),
      null,
    );
  });
  test('TikTok + Instagram ids', () => {
    const tt = parseVideoUrl(
      'https://www.tiktok.com/@emirates_news/video/7627044985581374741',
    );
    assert.equal(tt.platform, 'tiktok');
    assert.equal(
      tt.canonical,
      'https://www.tiktok.com/@emirates_news/video/7627044985581374741',
    );
    assert.equal(
      parseVideoUrl('https://www.instagram.com/reel/Ddyb6fvQ-Yn').id,
      'Ddyb6fvQ-Yn',
    );
    assert.equal(
      parseVideoUrl('https://www.instagram.com/p/DdyBfSdl-zh/?hl=en').platform,
      'instagram',
    );
  });
  test('TikTok snowflake id → upload time', () => {
    assert.equal(
      tiktokIdToDate('7627044985581374741'),
      '2026-04-10T08:29:53.000Z',
    );
    assert.equal(tiktokIdToDate('12'), null);
  });
  test('Instagram CDN efg → asset age, duration, expiry', () => {
    const m = instagramCdnMeta(IG_CDN);
    assert.equal(m.assetAgeDays, 25);
    assert.equal(m.durationS, 31);
    assert.equal(m.expiresAt, '2026-10-24T14:16:05.000Z');
    assert.equal(instagramCdnMeta('https://example.com/a.mp4'), null);
  });
  test('Instagram prefers shortUrl as the playable target', () => {
    const p = parseVideoUrl('https://www.instagram.com/reel/Ddyb6fvQ-Yn');
    assert.deepEqual(
      playableFor(p, { shortUrl: 'https://is.gd/HNpafE', mediaUrl: IG_CDN }),
      {
        playableUrl: 'https://is.gd/HNpafE',
        playableKind: 'mp4',
      },
    );
    assert.equal(playableFor(p, {}).playableKind, 'link');
  });
});

describe('normalizeEvidence', () => {
  test('Instagram reel: date from asset_age_days, ARCHIVAL, anchor geo, provenance kept', () => {
    const e = normalizeEvidence(
      {
        sourceUrl: 'https://www.instagram.com/reel/Ddyb6fvQ-Yn',
        shortUrl: 'https://is.gd/HNpafE',
        mediaUrl: IG_CDN,
        title: 'Dubai collision',
        fetched_at: '2026-10-23T03:55:00Z',
        provenance: {
          pluginId: 'plugin-1762980461',
          operation: 'downloadInstagramMedia',
          query: 'shortcode Ddyb6fvQ-Yn',
          timestamp: '2026-10-23T03:55:00Z',
        },
      },
      { now: NOW, anchor: plan.anchor },
    );
    assert.equal(e.id, 'instagram:Ddyb6fvQ-Yn');
    assert.equal(e.playableUrl, 'https://is.gd/HNpafE');
    assert.equal(e.published_at, '2026-09-28T03:55:00.000Z');
    assert.equal(e.published_at_source, 'instagram-asset-age-days');
    assert.equal(e.tier, 'ARCHIVAL');
    assert.equal(e.durationS, 31);
    assert.equal(e.geo.precision, 'incident-anchor');
    assert.equal(e.provenance.pluginId, 'plugin-1762980461');
    assert.equal(e.fetched_at, '2026-10-23T03:55:00.000Z');
  });
  test('TikTok: date from snowflake; non-video URL → null', () => {
    const e = normalizeEvidence(
      {
        sourceUrl:
          'https://www.tiktok.com/@emirates_news/video/7627044985581374741',
      },
      { now: NOW },
    );
    assert.equal(e.published_at_source, 'tiktok-id-snowflake');
    assert.equal(e.tier, 'ARCHIVAL');
    assert.equal(e.playableKind, 'iframe');
    assert.equal(
      normalizeEvidence(
        { sourceUrl: 'https://www.gulftoday.ae/news/x' },
        { now: NOW },
      ),
      null,
    );
  });
  test('a fresh clip is LIVE, caption offset carried', () => {
    const e = normalizeEvidence(
      {
        sourceUrl: 'https://www.youtube.com/watch?v=AAAAAAAAAAA',
        published_at: '2026-10-23T02:00:00Z',
        captionStartOffset: 52,
      },
      { now: NOW },
    );
    assert.equal(e.tier, 'LIVE');
    assert.equal(e.captionStartOffset, 52);
  });
});

describe('dedupe + ranking', () => {
  test('dedupe keeps the mp4 copy over a link-only copy of the same reel', () => {
    const a = normalizeEvidence(
      {
        sourceUrl: 'https://www.instagram.com/p/Ddyb6fvQ-Yn/',
        caption: 'first',
      },
      { now: NOW },
    );
    const b = normalizeEvidence(
      {
        sourceUrl: 'https://www.instagram.com/reel/Ddyb6fvQ-Yn',
        shortUrl: 'https://is.gd/HNpafE',
      },
      { now: NOW },
    );
    const out = dedupeEvidence([a, b]);
    assert.equal(out.length, 1);
    assert.equal(out[0].playableKind, 'mp4');
    assert.equal(out[0].caption, 'first');
  });
  test('recency + geo + keyword ordering; off-topic "real estate crash" demoted', () => {
    const near = normalizeEvidence(
      {
        sourceUrl: 'https://www.youtube.com/watch?v=BBBBBBBBBBB',
        title: 'Crash on Umm Suqeim Street — Dubai Police',
        published_at: '2026-10-22T10:00:00Z',
      },
      { now: NOW },
    );
    const old = normalizeEvidence(
      {
        sourceUrl: 'https://www.youtube.com/watch?v=CCCCCCCCCCC',
        title: 'Dubai accident compilation',
        published_at: '2025-01-01T00:00:00Z',
      },
      { now: NOW },
    );
    const offTopic = normalizeEvidence(
      {
        sourceUrl: 'https://www.youtube.com/watch?v=DDDDDDDDDDD',
        title: 'Dubai real estate crash explained — Umm Suqeim villas',
      },
      { now: NOW },
    );
    const ranked = rankEvidence([offTopic, old, near], plan, { now: NOW });
    assert.deepEqual(
      ranked.map((r) => r.platformId),
      ['BBBBBBBBBBB', 'CCCCCCCCCCC', 'DDDDDDDDDDD'],
    );
    assert.equal(ranked[2].scoreParts.offTopic, true);
  });
  test('reported coords inside the bbox score geo 1; Arabic keywords match', () => {
    const e = normalizeEvidence(
      {
        sourceUrl: 'https://www.tiktok.com/@x/video/7689822370613169415',
        caption: 'حادث على شارع أم سقيم',
        lat: 25.14,
        lon: 55.2,
      },
      { now: NOW },
    );
    const s = scoreEvidence(e, plan, { now: NOW });
    assert.equal(s.scoreParts.geo, 1);
    assert.ok(s.scoreParts.keyword >= 0.5);
  });
  test('incidentTime lifts clips posted the day of an older incident', () => {
    const e = normalizeEvidence(
      {
        sourceUrl: 'https://www.tiktok.com/@x/video/7689822370613169415',
        caption: 'حادث أم سقيم',
      },
      { now: NOW },
    );
    const base = scoreEvidence(e, plan, { now: NOW }).scoreParts.recency;
    const lifted = scoreEvidence(
      e,
      { ...plan, incidentTime: '2026-09-26T00:00:00Z' },
      { now: NOW },
    ).scoreParts.recency;
    assert.ok(lifted > base);
    assert.ok(lifted > 0.7);
  });
  test('countByPlatform', () => {
    assert.deepEqual(
      countByPlatform([
        { platform: 'youtube' },
        { platform: 'instagram' },
        { platform: 'youtube' },
      ]),
      {
        youtube: 2,
        tiktok: 0,
        instagram: 1,
      },
    );
  });
});

describe('labels', () => {
  const archival = {
    id: 'instagram:x',
    platform: 'instagram',
    tier: 'ARCHIVAL',
    published_at: '2026-09-28T03:55:00Z',
    published_at_source: 'instagram-asset-age-days',
    playableKind: 'mp4',
    playableUrl: 'https://is.gd/HNpafE',
    sourceUrl: 'https://www.instagram.com/p/x/',
    provenance: { pluginId: 'plugin-1762980461' },
  };
  test('per-clip badge and "not live" date line', () => {
    const l = clipLabel(archival);
    assert.equal(l.badge.text, 'ARCHIVAL');
    assert.equal(l.dateLine, 'recorded ≈28 Sep 2026 · not live');
    assert.equal(
      clipLabel({
        tier: 'LIVE',
        published_at: '2026-10-23T01:00:00Z',
        published_at_source: 'plugin',
      }).dateLine,
      'LIVE · recorded 23 Oct 2026',
    );
    assert.equal(clipLabel({ tier: 'BOGUS' }).tier, 'ARCHIVAL');
  });
  test('rebuild banner text names the recording date and says not live', () => {
    const b = archivalBanner(
      { rebuild: true, reported_at: '2026-09-26T00:00:00Z' },
      [archival],
    );
    assert.equal(
      b.text,
      'REBUILT FROM ARCHIVAL FOOTAGE: recorded 26 Sep 2026, not live',
    );
    assert.equal(archivalBanner(null, [{ ...archival, tier: 'LIVE' }]), null);
    assert.match(
      archivalBanner(null, [archival]).text,
      /^REBUILT FROM ARCHIVAL FOOTAGE: recorded 28 Sep 2026, not live$/,
    );
  });
  test('media proxy path + YouTube caption offset', () => {
    assert.equal(
      proxiedMediaSrc(archival),
      '/api/ondemand/v2/scene/media?u=https%3A%2F%2Fis.gd%2FHNpafE',
    );
    assert.equal(
      iframeSrc({
        platform: 'youtube',
        playableKind: 'iframe',
        playableUrl:
          'https://www.youtube-nocookie.com/embed/AAAAAAAAAAA?autoplay=1&mute=1',
        captionStartOffset: 52.6,
      }),
      'https://www.youtube-nocookie.com/embed/AAAAAAAAAAA?autoplay=1&mute=1&start=52',
    );
    assert.equal(
      proxiedMediaSrc({ playableKind: 'iframe', playableUrl: 'x' }),
      null,
    );
  });
  test('clip chat context carries tier, dates and the not-live rule', () => {
    const ctx = clipChatContext(archival, {
      title: 'Umm Suqeim crash',
      reported_at: '2026-09-26T00:00:00Z',
    });
    assert.equal(ctx.objectId, 'instagram:x');
    assert.equal(ctx.fields.tier, 'ARCHIVAL');
    assert.equal(ctx.fields.incident_reported_at, '2026-09-26T00:00:00Z');
    assert.match(ctx.fields.label_rule, /never be described as live/);
    assert.match(ctx.provenance, /plugin-1762980461/);
  });
  test('formatDay is UTC', () => {
    assert.equal(formatDay('2026-09-26T23:30:00-02:00'), '27 Sep 2026');
    assert.equal(formatDay(null), null);
  });
});
