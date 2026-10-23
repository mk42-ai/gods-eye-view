/**
 * @fileoverview Tests for scene player and banner formatting.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStubDocument } from './testDomStub.js';
import {
  createScenePlayer,
  extractYoutubeId,
  extractTiktokId,
} from './player.js';
import { formatRebuildBannerText } from './index.js';

test('extracts youtube and tiktok IDs correctly', () => {
  assert.equal(
    extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    'dQw4w9WgXcQ',
  );
  assert.equal(
    extractYoutubeId('https://www.youtube.com/shorts/pu6shIJmb5s'),
    'pu6shIJmb5s',
  );
  assert.equal(
    extractYoutubeId('https://www.youtube.com/embed/pu6shIJmb5s'),
    'pu6shIJmb5s',
  );
  assert.equal(
    extractTiktokId('https://www.tiktok.com/@user/video/7123456789012345678'),
    '7123456789012345678',
  );
});

test('player has no video/iframe before playNow and creates a youtube iframe after', () => {
  const document = createStubDocument();
  const player = createScenePlayer({ document });

  const root = player.element;
  assert.equal(root.dataset.playing, '0');
  assert.equal(root.dataset.kind, 'poster');

  // Verify NO video or iframe before playNow
  assert.equal(root.querySelector('iframe'), null);
  assert.equal(root.querySelector('video'), null);

  const item = {
    id: 'clip_yt',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    title: 'YouTube Clip',
  };

  const kind = player.playNow(item);
  assert.equal(kind, 'youtube');
  assert.equal(root.dataset.playing, '1');
  assert.equal(root.dataset.kind, 'youtube');

  // Verify YouTube iframe exists after playNow
  const iframe = root.querySelector('iframe');
  assert.ok(iframe);
  assert.match(iframe.src, /https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ/);

  // Stop removes iframe
  player.stop();
  assert.equal(root.dataset.playing, '0');
  assert.equal(root.dataset.kind, 'poster');
  assert.equal(root.querySelector('iframe'), null);
});

test('player handles mp4 video playback and ended event', () => {
  const document = createStubDocument();
  let endedCalled = false;
  const player = createScenePlayer({
    document,
    onEnded: () => {
      endedCalled = true;
    },
  });

  const item = {
    id: 'clip_vid',
    mediaUrl: 'https://cdn.example.com/footage.mp4',
  };

  const kind = player.playNow(item);
  assert.equal(kind, 'video');

  const video = player.element.querySelector('video');
  assert.ok(video);
  assert.equal(video.src, 'https://cdn.example.com/footage.mp4');

  video.dispatchEvent({ type: 'ended' });
  assert.equal(endedCalled, true);
});

test('banner text format for rebuild scenes', () => {
  const sceneWithFootage = {
    id: 's_reb1',
    kind: 'rebuild',
    tRef: '2026-09-26T07:00:00Z',
    footage: [
      { id: 'f1', uploadedAt: '2026-09-27T07:00:10Z' },
      { id: 'f2', uploadedAt: '2026-09-26T09:12:00Z' },
    ],
  };

  const bannerText = formatRebuildBannerText(sceneWithFootage);
  assert.equal(
    bannerText,
    'REBUILT FROM ARCHIVAL FOOTAGE — originally reported 2026-09-26',
  );

  const document = createStubDocument();
  const player = createScenePlayer({ document });
  player.showBanner(bannerText);

  const bannerEl = player.element.querySelector('#ge-banner');
  assert.equal(bannerEl.hidden, false);
  assert.equal(bannerEl.textContent, bannerText);

  player.showBanner(null);
  assert.equal(bannerEl.hidden, true);
});

test('player overlay updates metadata', () => {
  const document = createStubDocument();
  const player = createScenePlayer({ document });

  player.setOverlay({
    distanceText: '0.8 km from target',
    deltaText: '+14 min after incident',
    recency: 'RECENT',
    uploadedAt: '2026-09-26T07:14:00Z',
  });

  const distEl = player.element.querySelector('.ge-player-overlay-dist');
  const deltaEl = player.element.querySelector('.ge-player-overlay-delta');
  const recencyEl = player.element.querySelector('.ge-player-overlay-recency');

  assert.equal(distEl.textContent, '0.8 km from target');
  assert.equal(deltaEl.textContent, '+14 min after incident');
  assert.equal(recencyEl.textContent, 'RECENT');
});
