import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDom } from './testDom.mjs';
import { showRegisterModal } from './registerModal.js';

test('registerModal: accept payload', () => {
  const { document } = createTestDom();

  let acceptedEntry = null;
  const place = {
    name: 'Al Ruwais',
    lat: 24.1167,
    lon: 52.7333,
    country: 'UAE',
  };

  const modalHandle = showRegisterModal({
    document,
    place,
    onAccept: (entry) => {
      acceptedEntry = entry;
    },
  });

  const modalEl = document.querySelector('#ge-register-modal');
  assert.ok(modalEl);
  assert.equal(modalEl.getAttribute('role'), 'dialog');
  assert.equal(modalEl.getAttribute('aria-modal'), 'true');

  const poster = modalEl.querySelector('.ge-reg-poster');
  assert.ok(poster);
  assert.equal(poster.getAttribute('src'), '/assets/states/state-outside-aoi.png');

  const copy = modalEl.querySelector('.ge-reg-copy');
  assert.ok(copy);
  assert.equal(
    copy.textContent,
    '"Al Ruwais" is outside the UAE Interest Watch register. Add it to build this scene?',
  );

  const nameInput = modalEl.querySelector('#ge-reg-name');
  assert.equal(nameInput.value, 'Al Ruwais');

  const latInput = modalEl.querySelector('#ge-reg-lat');
  assert.equal(latInput.value, '24.1167');

  const lonInput = modalEl.querySelector('#ge-reg-lon');
  assert.equal(lonInput.value, '52.7333');

  const countryInput = modalEl.querySelector('#ge-reg-country');
  assert.equal(countryInput.value, 'UAE');

  const categorySelect = modalEl.querySelector('#ge-reg-category');
  assert.ok(categorySelect);
  categorySelect.value = 'border-protection';

  const acceptBtn = modalEl.querySelector('#ge-reg-accept');
  acceptBtn.click();

  assert.deepEqual(acceptedEntry, {
    name: 'Al Ruwais',
    lat: 24.1167,
    lon: 52.7333,
    country: 'UAE',
    category: 'border-protection',
    radiusKm: 15,
  });

  assert.equal(document.querySelector('#ge-register-modal'), null);
});

test('registerModal: decline on Esc, button click, and overlay click', () => {
  const { document } = createTestDom();

  // 1. Decline on Esc
  let declined = false;
  showRegisterModal({
    document,
    place: { name: 'Site A', lat: 25.0, lon: 55.0 },
    onDecline: () => {
      declined = true;
    },
  });
  assert.ok(document.querySelector('#ge-register-modal'));
  document.dispatchEvent({
    type: 'keydown',
    key: 'Escape',
    preventDefault() {},
  });
  assert.equal(declined, true);
  assert.equal(document.querySelector('#ge-register-modal'), null);

  // 2. Decline on button click
  declined = false;
  showRegisterModal({
    document,
    place: { name: 'Site B', lat: 25.0, lon: 55.0 },
    onDecline: () => {
      declined = true;
    },
  });
  const declineBtn = document.querySelector('#ge-reg-decline');
  assert.ok(declineBtn);
  declineBtn.click();
  assert.equal(declined, true);
  assert.equal(document.querySelector('#ge-register-modal'), null);

  // 3. Decline on backdrop click
  declined = false;
  showRegisterModal({
    document,
    place: { name: 'Site C', lat: 25.0, lon: 55.0 },
    onDecline: () => {
      declined = true;
    },
  });
  const overlay = document.querySelector('.ge-reg-overlay');
  assert.ok(overlay);
  overlay.click();
  assert.equal(declined, true);
  assert.equal(document.querySelector('#ge-register-modal'), null);
});
