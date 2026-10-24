import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  findAoi,
  nearestAoi,
  loadRegister,
  addAoi,
  listAoi,
} from './aoiRegister.js';
import {
  parsePrompt,
  geocodePlace,
  deriveTRef,
  KNOWN_INCIDENTS,
} from './prompt.js';
import { createPersistence } from './persistence.js';
import { createScene } from './models.js';

describe('AOI register', () => {
  it('finds Burj Khalifa inside home AOI and returns null for Lisbon', () => {
    loadRegister(); // ensure seed loaded
    const bk = findAoi(25.1972, 55.2744);
    assert.ok(bk, 'Burj Khalifa coordinate must be inside an AOI');
    assert.strictEqual(bk.inside, true);
    assert.strictEqual(bk.category, 'home');
    assert.ok(
      bk.name === 'Burj Khalifa' || bk.name === 'Dubai',
      'Matches Burj Khalifa or Dubai area',
    );

    const lisbon = findAoi(38.7223, -9.1393);
    assert.strictEqual(
      lisbon,
      null,
      'Lisbon must return null (outside all AOIs)',
    );
  });

  it('nearestAoi finds closest site even when outside', () => {
    const nearLisbon = nearestAoi(38.7223, -9.1393);
    assert.ok(nearLisbon);
    assert.strictEqual(nearLisbon.inside, false);
    assert.ok(nearLisbon.distanceKm > 1000);
  });

  it('addAoi adds user additions and persists to storage', () => {
    const fakeStorage = {
      data: {},
      getItem(k) {
        return this.data[k] || null;
      },
      setItem(k, v) {
        this.data[k] = String(v);
      },
    };

    const added = addAoi(
      {
        name: 'Custom Test Site',
        lat: 25.0,
        lon: 55.0,
        category: 'border-protection',
        radiusKm: 10,
      },
      { storage: fakeStorage },
    );

    assert.ok(added.id);
    assert.strictEqual(added.name, 'Custom Test Site');

    // Reload register with same storage
    const loaded = loadRegister({ storage: fakeStorage });
    const found = loaded.find((a) => a.id === added.id);
    assert.ok(found);
    assert.strictEqual(found.name, 'Custom Test Site');
  });
});

describe('prompt parser & geocoding', () => {
  it('parses prompts into structured intents', () => {
    // 1. Live bare place
    const pLive = parsePrompt('Burj Khalifa');
    assert.strictEqual(pLive.kind, 'live');
    assert.strictEqual(pLive.placeName, 'Burj Khalifa');
    assert.strictEqual(pLive.incident, '');

    // 2. Rebuild
    const pRebuild = parsePrompt(
      'rebuild the car crash reported in Umm Suqeim',
    );
    assert.strictEqual(pRebuild.kind, 'rebuild');
    assert.strictEqual(pRebuild.placeName, 'Umm Suqeim');
    assert.strictEqual(pRebuild.incident, 'car crash');
    assert.strictEqual(pRebuild.verb, 'rebuild');

    // 3. Incident
    const pIncident = parsePrompt('drone strike in Hodeidah');
    assert.strictEqual(pIncident.kind, 'incident');
    assert.strictEqual(pIncident.placeName, 'Hodeidah');
    assert.strictEqual(pIncident.incident, 'drone strike');
  });

  it('deriveTRef maps rebuild known incident to 2026-09-26', () => {
    const tRefResult = deriveTRef({
      kind: 'rebuild',
      text: 'rebuild the car crash reported in Umm Suqeim',
    });
    assert.strictEqual(tRefResult.tRef, '2026-09-26T07:00:00Z');
    assert.strictEqual(tRefResult.tRefLabel, 'reported 2026-09-26');
  });

  it('deriveTRef formats live/incident GST label', () => {
    const fixedNow = Date.parse('2026-10-23T10:30:00.000Z'); // 10:30 UTC = 14:30 GST
    const res = deriveTRef({ kind: 'live', now: () => fixedNow });
    assert.strictEqual(res.tRef, '2026-10-23T10:30:00.000Z');
    assert.strictEqual(res.tRefLabel, 'estimated 14:30 GST ±10 min');
  });

  it('geocodePlace cascades through dictionary, register, and nominatim', async () => {
    // Dictionary hit
    const dHit = await geocodePlace('Umm Suqeim');
    assert.ok(dHit);
    assert.strictEqual(dHit.geocodeSource, 'dictionary');
    assert.strictEqual(dHit.confidence, 0.95);

    // Register hit (Burj Khalifa is in AOI register seed)
    const rHit = await geocodePlace('Burj Khalifa');
    assert.ok(rHit);
    assert.strictEqual(rHit.geocodeSource, 'register');
    assert.strictEqual(rHit.confidence, 0.9);

    // Nominatim mock fetch hit
    const mockFetch = async () => ({
      ok: true,
      json: async () => [
        { display_name: 'Paris, France', lat: '48.8566', lon: '2.3522' },
      ],
    });
    const nHit = await geocodePlace('Paris', { fetch: mockFetch });
    assert.ok(nHit);
    assert.strictEqual(nHit.geocodeSource, 'nominatim');
    assert.strictEqual(nHit.confidence, 0.7);
    assert.strictEqual(nHit.lat, 48.8566);
  });
});

describe('persistence with in-memory fallback', () => {
  it('operates fully in memory when indexedDB is undefined', async () => {
    const mirroredPuts = [];
    const mirroredDeletes = [];
    const mockFetch = async (url, opts) => {
      if (opts?.method === 'PUT') mirroredPuts.push(url);
      if (opts?.method === 'DELETE') mirroredDeletes.push(url);
      return { ok: true, json: async () => ({}) };
    };

    const persistence = createPersistence({
      indexedDB: undefined,
      fetch: mockFetch,
      base: '/footage',
    });

    const s1 = createScene({
      id: 's_older',
      title: 'Older Scene',
      lifecycle: { createdAt: '2026-10-20T10:00:00.000Z' },
    });
    const s2 = createScene({
      id: 's_newer',
      title: 'Newer Scene',
      lifecycle: { createdAt: '2026-10-23T10:00:00.000Z' },
    });

    await persistence.save(s1);
    await persistence.save(s2);

    assert.strictEqual(mirroredPuts.length, 2);

    // List sorted by createdAt desc
    const list = await persistence.list();
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0].id, 's_newer');
    assert.strictEqual(list[1].id, 's_older');

    // Load
    const loaded = await persistence.load('s_newer');
    assert.strictEqual(loaded.title, 'Newer Scene');

    // Remove
    await persistence.remove('s_older');
    assert.strictEqual(mirroredDeletes.length, 1);
    const afterRemove = await persistence.list();
    assert.strictEqual(afterRemove.length, 1);
    assert.strictEqual(afterRemove[0].id, 's_newer');

    // Clear
    await persistence.clear();
    const afterClear = await persistence.list();
    assert.strictEqual(afterClear.length, 0);
  });
});
