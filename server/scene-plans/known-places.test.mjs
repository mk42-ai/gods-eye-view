import test from 'node:test';
import assert from 'node:assert/strict';
import { KNOWN_PLACES, matchKnownPlace } from './known-places.js';

test('KNOWN_PLACES table contains required landmarks and centroids', () => {
  assert.ok(KNOWN_PLACES.length >= 12, 'table has at least 12 entries');

  const names = KNOWN_PLACES.map((p) => p.name);
  assert.ok(names.includes('Dubai Marina'));
  assert.ok(names.includes('Yas Mall'));
  assert.ok(names.includes('Burj Khalifa'));
  assert.ok(names.includes('Umm Suqeim'));
  assert.ok(names.includes('Burj Al Arab'));
  assert.ok(names.includes('Emirates Palace'));
  assert.ok(names.includes('Yas Marina Circuit'));
  assert.ok(names.includes('Sheikh Zayed Road (Dubai)'));
  assert.ok(names.includes('JBR'));
  assert.ok(names.includes('Dubai Mall'));
  assert.ok(names.includes('Abu Dhabi Corniche'));
  assert.ok(names.includes("Kane's Boxing Gym Abu Dhabi"));

  // Check every entry has approximate: true, source: 'known-place-table', and sourceUrl
  for (const place of KNOWN_PLACES) {
    assert.equal(place.approximate, true, `${place.name} approximate`);
    assert.equal(place.source, 'known-place-table', `${place.name} source`);
    assert.ok(
      typeof place.sourceUrl === 'string' &&
        place.sourceUrl.startsWith(
          'https://www.openstreetmap.org/search?query=',
        ),
      `${place.name} sourceUrl`,
    );
    assert.equal(place.country, 'AE', `${place.name} country`);
    assert.ok(Number.isFinite(place.lat) && place.lat > 22 && place.lat < 27);
    assert.ok(Number.isFinite(place.lon) && place.lon > 51 && place.lon < 57);
  }

  // Kane's Boxing Gym uses Abu Dhabi city centroid with precision: 'city', never invented street coordinates
  const kanes = KNOWN_PLACES.find(
    (p) => p.name === "Kane's Boxing Gym Abu Dhabi",
  );
  assert.equal(kanes.lat, 24.4539);
  assert.equal(kanes.lon, 54.3773);
  assert.equal(kanes.city, 'Abu Dhabi');
  assert.equal(kanes.kind, 'gym');
  assert.equal(kanes.precision, 'city');
});

test('matchKnownPlace matches the three baseline user prompts', () => {
  // 1. kanes boxing gym abu dhabi
  const m1 = matchKnownPlace('kanes boxing gym abu dhabi');
  assert.ok(m1, 'kanes prompt matched');
  assert.equal(m1.name, "Kane's Boxing Gym Abu Dhabi");
  assert.equal(m1.city, 'Abu Dhabi');
  assert.equal(m1.precision, 'city');
  assert.equal(m1.lat, 24.4539);
  assert.equal(m1.lon, 54.3773);

  // 2. im doinga. raid in the dubai marina
  const m2 = matchKnownPlace('im doinga. raid in the dubai marina');
  assert.ok(m2, 'dubai marina prompt matched with doinga. typo');
  assert.equal(m2.name, 'Dubai Marina');
  assert.equal(m2.lat, 25.0806);
  assert.equal(m2.lon, 55.1397);

  // 3. car crash outside yas mall
  const m3 = matchKnownPlace('car crash outside yas mall');
  assert.ok(m3, 'yas mall prompt matched');
  assert.equal(m3.name, 'Yas Mall');
  assert.equal(m3.lat, 24.4886);
  assert.equal(m3.lon, 54.6079);
});

test('matchKnownPlace matches Burj Khalifa and Umm Suqeim', () => {
  const bk = matchKnownPlace('Burj Khalifa');
  assert.ok(bk);
  assert.equal(bk.name, 'Burj Khalifa');
  assert.equal(bk.lat, 25.1972);
  assert.equal(bk.lon, 55.2744);

  const bkContext = matchKnownPlace(
    'VIP protection near Burj Khalifa downtown',
  );
  assert.ok(bkContext);
  assert.equal(bkContext.name, 'Burj Khalifa');

  const us = matchKnownPlace('Umm Suqeim');
  assert.ok(us);
  assert.equal(us.name, 'Umm Suqeim');
  assert.equal(us.lat, 25.1535);
  assert.equal(us.lon, 55.206);

  const usAlt = matchKnownPlace('police cordon in um suqeim beach');
  assert.ok(usAlt);
  assert.equal(usAlt.name, 'Umm Suqeim');
});

test('matchKnownPlace matches aliases correctly', () => {
  assert.equal(matchKnownPlace('the marina dubai')?.name, 'Dubai Marina');
  assert.equal(
    matchKnownPlace("kane's boxing academy")?.name,
    "Kane's Boxing Gym Abu Dhabi",
  );
  assert.equal(
    matchKnownPlace('kanes boxing academy')?.name,
    "Kane's Boxing Gym Abu Dhabi",
  );
  assert.equal(
    matchKnownPlace('yas marina circuit')?.name,
    'Yas Marina Circuit',
  );
  assert.equal(
    matchKnownPlace('traffic accident on szr')?.name,
    'Sheikh Zayed Road (Dubai)',
  );
  assert.equal(matchKnownPlace('evacuation at JBR')?.name, 'JBR');
  assert.equal(matchKnownPlace('fire alarm at Dubai Mall')?.name, 'Dubai Mall');
  assert.equal(
    matchKnownPlace('Abu Dhabi Corniche')?.name,
    'Abu Dhabi Corniche',
  );
});

test('matchKnownPlace returns null when no place is mentioned', () => {
  assert.equal(matchKnownPlace(''), null);
  assert.equal(matchKnownPlace(null), null);
  assert.equal(matchKnownPlace('im doing a raid in the'), null);
  assert.equal(matchKnownPlace('doinga.'), null);
  assert.equal(matchKnownPlace('random sentence without any landmarks'), null);
});
