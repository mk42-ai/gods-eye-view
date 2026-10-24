import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIncidentQuery } from './query.js';

for (const input of [
  'burj khalifa check if there is any incidents',
  'Burj Khalifa',
]) {
  test(`query regression: ${input}`, () => {
    const out = parseIncidentQuery(input);
    assert.equal(out.place.toLowerCase(), 'burj khalifa');
    assert.equal(out.intent, 'incident_search');
    assert.equal(out.originalText, input);
    assert.equal(out.radiusKm, 5);
    assert.equal(out.windowHours, 72);
  });
}
for (const input of [
  'check for incidents near Burj Khalifa',
  'are there any incidents around Burj Khalifa',
]) {
  test(`intent-first query: ${input}`, () =>
    assert.equal(parseIncidentQuery(input).place, 'Burj Khalifa'));
}
test('an explicit event retains the existing scene-building path', () => {
  for (const input of [
    'pipeline rupture at Habshan',
    'drone strike near Das Island',
    'rebuild the car crash reported in Umm Suqeim',
  ])
    assert.equal(parseIncidentQuery(input).intent, 'build_scene');
});
test('an incident question is not an incident report', () => {
  assert.equal(
    parseIncidentQuery('check for any fire near Burj Khalifa').intent,
    'incident_search',
  );
});
test('explicit interval is bounded and not part of the place', () => {
  const result = parseIncidentQuery(
    'incidents near Burj Khalifa in the last 24 hours',
  );
  assert.equal(result.place, 'Burj Khalifa');
  assert.equal(result.windowHours, 24);
  assert.equal(
    parseIncidentQuery('Burj Khalifa last 999 days').windowHours,
    168,
  );
});


for (const { input, place, sceneStyle } of [
  {
    input: 'Create a waterfront orbit scene around Dubai Marina',
    place: 'Dubai Marina',
    sceneStyle: 'waterfront orbit',
  },
  {
    input: 'Dubai Marina — waterfront orbit',
    place: 'Dubai Marina',
    sceneStyle: 'waterfront orbit',
  },
  { input: 'Build a scene of Dubai Marina', place: 'Dubai Marina' },
  { input: 'Generate the scene near Dubai Marina', place: 'Dubai Marina' },
  {
    input: 'CREATE an aerial flyover scene of Museum of the Future',
    place: 'Museum of the Future',
    sceneStyle: 'aerial flyover',
  },
  {
    input: 'Dubai Marina – cinematic orbit scene',
    place: 'Dubai Marina',
    sceneStyle: 'cinematic orbit',
  },
  { input: 'build a scene for Dubai Marina', place: 'Dubai Marina' },
]) {
  test(`scene intent and clean place: ${input}`, () => {
    const result = parseIncidentQuery(input);
    assert.equal(result.intent, 'build_scene');
    assert.equal(result.place, place);
    assert.equal(result.sceneStyle, sceneStyle);
    assert.equal(result.originalText, input);
    assert.equal(result.radiusKm, 5);
    assert.equal(result.windowHours, 72);
    assert.ok(!('latitude' in result));
    assert.ok(!('longitude' in result));
    assert.ok(!('coordinates' in result));
  });
}

test('bare and hyphenated places stay incident searches without fabricated styles', () => {
  for (const place of ['Dubai Marina', 'Museum of the Future', 'Al-Maryah Island', 'Dubai Marina — JBR']) {
    const result = parseIncidentQuery(place);
    assert.equal(result.intent, 'incident_search');
    assert.equal(result.place, place);
    assert.ok(!('sceneStyle' in result));
  }
});

test('incident checks retain clean places and do not become scenes', () => {
  for (const input of [
    'Dubai Marina check if there is any incidents',
    'check for incidents around Dubai Marina',
    'are there any incidents near Dubai Marina',
    'Dubai Marina check for any fire',
  ]) {
    const result = parseIncidentQuery(input);
    assert.equal(result.intent, 'incident_search');
    assert.equal(result.place, 'Dubai Marina');
    assert.ok(!('sceneStyle' in result));
  }
});

test('explicit scene construction retains priority and bounded time-window fields', () => {
  const result = parseIncidentQuery(
    'Build a scene of Dubai Marina in the last 2 days',
  );
  assert.equal(result.intent, 'build_scene');
  assert.equal(result.place, 'Dubai Marina');
  assert.equal(result.windowHours, 48);
  assert.equal(parseIncidentQuery('Dubai Marina in the past 12 hours').place, 'Dubai Marina');
});

test('BUILD SCENE form can opt into bare-location construction without changing other callers', () => {
  for (const text of ['Dubai Marina', 'Abu Dhabi', 'Burj Khalifa', 'Al-Maryah Island']) {
    assert.equal(parseIncidentQuery(text).intent, 'incident_search');
    const parsed = parseIncidentQuery(text, { defaultIntent: 'build_scene' });
    assert.equal(parsed.intent, 'build_scene');
    assert.equal(parsed.place, text);
    assert.ok(!('coordinates' in parsed));
  }
  for (const text of ['check for incidents near Dubai Marina', 'Dubai Marina any incidents', 'what happened in Abu Dhabi'])
    assert.equal(parseIncidentQuery(text, { defaultIntent: 'build_scene' }).intent, 'incident_search');
});
