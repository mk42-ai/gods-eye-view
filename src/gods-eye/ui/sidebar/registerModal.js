/**
 * "Add site to register?" modal dialog component.
 * @module ui/sidebar/registerModal
 */

import { POSTERS } from '../scene/posters.js';

/**
 * Show the AOI site register modal dialog.
 *
 * @param {object} params
 * @param {Document} [params.document]
 * @param {object} params.place
 * @param {string} params.place.name
 * @param {number} params.place.lat
 * @param {number} params.place.lon
 * @param {string} [params.place.country]
 * @param {(entry: object) => void} [params.onAccept]
 * @param {() => void} [params.onDecline]
 * @returns {{element: HTMLElement, close: () => void}}
 */
export function showRegisterModal({
  document = globalThis.document,
  place = {},
  onAccept,
  onDecline,
} = {}) {
  const doc = document;
  let isClosed = false;

  const overlay = doc.createElement('div');
  overlay.className = 'ge-reg-overlay';

  const modal = doc.createElement('div');
  modal.id = 'ge-register-modal';
  modal.className = 'ge-register-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'ge-reg-title');

  // 16:9 Header poster image
  const poster = doc.createElement('img');
  poster.className = 'ge-reg-poster';
  poster.src = POSTERS.outsideRegister;
  poster.alt = 'Outside Register';
  modal.appendChild(poster);

  const content = doc.createElement('div');
  content.className = 'ge-reg-content';

  const title = doc.createElement('h2');
  title.id = 'ge-reg-title';
  title.className = 'ge-reg-title';
  title.textContent = 'ADD SITE TO REGISTER?';
  content.appendChild(title);

  const placeName = place?.name || 'This location';
  const copy = doc.createElement('p');
  copy.className = 'ge-reg-copy';
  copy.textContent = `"${placeName}" is outside the UAE Interest Watch register. Add it to build this scene?`;
  content.appendChild(copy);

  // Form fields
  const form = doc.createElement('div');
  form.className = 'ge-reg-form';

  const makeField = (id, labelText, value = '') => {
    const wrap = doc.createElement('div');
    wrap.className = 'ge-reg-field';
    const lbl = doc.createElement('label');
    lbl.setAttribute('for', id);
    lbl.className = 'ge-reg-label';
    lbl.textContent = labelText;
    const inp = doc.createElement('input');
    inp.id = id;
    inp.className = 'ge-reg-input';
    inp.type = 'text';
    inp.value = String(value);
    wrap.append(lbl, inp);
    return { wrap, inp };
  };

  const nameField = makeField('ge-reg-name', 'SITE NAME', place?.name || '');
  const latField = makeField(
    'ge-reg-lat',
    'LATITUDE',
    place?.lat != null ? place.lat : '',
  );
  const lonField = makeField(
    'ge-reg-lon',
    'LONGITUDE',
    place?.lon != null ? place.lon : '',
  );
  const countryField = makeField(
    'ge-reg-country',
    'COUNTRY',
    place?.country || '',
  );

  // Category select
  const catWrap = doc.createElement('div');
  catWrap.className = 'ge-reg-field';
  const catLbl = doc.createElement('label');
  catLbl.setAttribute('for', 'ge-reg-category');
  catLbl.className = 'ge-reg-label';
  catLbl.textContent = 'CATEGORY';

  const catSelect = doc.createElement('select');
  catSelect.id = 'ge-reg-category';
  catSelect.className = 'ge-reg-select';

  const categories = [
    { value: 'active-presence', label: 'Active Presence' },
    { value: 'claim', label: 'Claim' },
    { value: 'border-protection', label: 'Border Protection' },
  ];
  for (const c of categories) {
    const opt = doc.createElement('option');
    opt.value = c.value;
    opt.textContent = c.label;
    catSelect.appendChild(opt);
  }
  catWrap.append(catLbl, catSelect);

  form.append(
    nameField.wrap,
    latField.wrap,
    lonField.wrap,
    countryField.wrap,
    catWrap,
  );
  content.appendChild(form);

  // Action buttons
  const actions = doc.createElement('div');
  actions.className = 'ge-reg-actions';

  const declineBtn = doc.createElement('button');
  declineBtn.type = 'button';
  declineBtn.id = 'ge-reg-decline';
  declineBtn.className = 'scene-btn ge-reg-btn-decline';
  declineBtn.textContent = 'DECLINE';

  const acceptBtn = doc.createElement('button');
  acceptBtn.type = 'button';
  acceptBtn.id = 'ge-reg-accept';
  acceptBtn.className = 'scene-btn ge-reg-btn-accept';
  acceptBtn.textContent = 'ADD & BUILD';

  actions.append(declineBtn, acceptBtn);
  content.appendChild(actions);
  modal.appendChild(content);
  overlay.appendChild(modal);

  (doc.body || doc.documentElement)?.appendChild?.(overlay);

  function handleDecline() {
    close();
    onDecline?.();
  }

  function handleAccept() {
    const entry = {
      name: nameField.inp.value.trim(),
      lat: Number(latField.inp.value),
      lon: Number(lonField.inp.value),
      country: countryField.inp.value.trim(),
      category: catSelect.value,
      radiusKm: 15,
    };
    close();
    onAccept?.(entry);
  }

  declineBtn.addEventListener('click', handleDecline);
  acceptBtn.addEventListener('click', handleAccept);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      handleDecline();
    }
  });

  const focusables = [
    nameField.inp,
    latField.inp,
    lonField.inp,
    countryField.inp,
    catSelect,
    declineBtn,
    acceptBtn,
  ];

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleDecline();
      return;
    }
    if (e.key === 'Tab') {
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = doc.activeElement;
      if (e.shiftKey) {
        if (active === first || !modal.contains(active)) {
          e.preventDefault();
          last.focus?.();
        }
      } else {
        if (active === last || !modal.contains(active)) {
          e.preventDefault();
          first.focus?.();
        }
      }
    }
  }

  doc.addEventListener?.('keydown', onKeyDown);
  nameField.inp.focus?.();

  function close() {
    if (isClosed) return;
    isClosed = true;
    doc.removeEventListener?.('keydown', onKeyDown);
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  }

  return {
    element: modal,
    close,
  };
}
