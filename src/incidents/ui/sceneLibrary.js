/**
 * Detached, DOM-only scene library. No SceneDirector or playback side effects.
 *
 * onSave(namedScene, { sceneDirector }) is authoritative when supplied. Otherwise
 * storage.save(namedScene) is used. Either may return a saved Scene (or void),
 * synchronously or asynchronously; throwing/rejecting/returning false means failure.
 * Optional storage.list() supplies the initial saved Scene[]; raw localStorage
 * must be wrapped by the caller (this UI deliberately owns no persistence key).
 * onSelect(scene, { sceneDirector, saved: true }) applies selection in the caller;
 * without it, selection only changes this library's view.
 *
 * installSidebar() is explicitly opt-in and must run AFTER SceneDirector setup.
 */
export function createSceneLibrary({
  document = globalThis.document,
  window = document?.defaultView || globalThis.window,
  sceneDirector,
  onSelect,
  onSave,
  storage,
} = {}) {
  if (!document?.createElement) throw new TypeError('Scene library requires a document');
  const disposers = [];
  let destroyed = false;
  let activeScene = null;
  let isSaved = false;
  let savedScenes = [];
  let saving = false;
  let version = 0;
  let listVersion = 0;
  let selectionVersion = 0;
  let sidebar = null;
  const canSave = typeof onSave === 'function' || typeof storage?.save === 'function';

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function listen(node, event, handler) {
    node.addEventListener(event, handler);
    disposers.push(() => node.removeEventListener(event, handler));
  }
  function text(value) {
    return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  }
  function title(scene) {
    return text(scene?.title) || text(scene?.name) || 'Untitled scene';
  }
  function sameScene(a, b) {
    return a === b || (a?.id != null && b?.id != null && String(a.id) === String(b.id));
  }
  function location(scene) {
    const place = scene?.anchor || scene?.location || scene?.place || scene?.geography || scene?.candidate;
    const label = text(place) || text(place?.name) || text(place?.label)
      || text(scene?.location_name) || text(scene?.aoi?.name) || text(scene?.aoi);
    if (label) return label;
    const point = place && typeof place === 'object' ? place : scene?.keyframes?.[0];
    const lat = point?.lat ?? point?.latitude;
    const lon = point?.lon ?? point?.lng ?? point?.longitude;
    return typeof lat === 'number' && Number.isFinite(lat)
      && typeof lon === 'number' && Number.isFinite(lon)
      ? `${lat.toFixed(4)}, ${lon.toFixed(4)}` : 'Not provided';
  }
  function provenance(scene) {
    const value = scene?.provenance || scene?.location?.provenance;
    if (value?.kind === 'geocoder') {
      const provider = value.source === 'osm-verified-cache' ? 'OSM verified cache' : 'OSM via OnDemand';
      const confidence = Number.isFinite(value.confidence) ? ` · ${Math.round(value.confidence * 100)}% location confidence` : '';
      return `${provider}${confidence}`;
    }
    const label = text(value) || text(value?.label) || text(value?.source)
      || text(value?.provider) || text(value?.type);
    if (label) return label;
    if (Array.isArray(value)) {
      const labels = value.map((item) => text(item) || text(item?.label) || text(item?.source)).filter(Boolean);
      if (labels.length) return labels.join(', ');
    }
    return Array.isArray(scene?.sources) && scene.sources.length
      ? `${scene.sources.length} supplied source${scene.sources.length === 1 ? '' : 's'}`
      : 'Not provided';
  }

  const element = el('section', 'scene-library');
  element.id = 'scene-library';
  element.setAttribute('aria-label', 'Scene library');
  element.append(el('h2', 'scene-library__heading', 'Scene library'));
  const form = el('form', 'scene-library__form');
  const nameLabel = el('label', 'scene-library__label', 'Scene name');
  nameLabel.htmlFor = 'scene-library-name';
  const nameInput = el('input', 'scene-library__name');
  nameInput.id = 'scene-library-name';
  nameInput.type = 'text';
  nameInput.maxLength = 160;
  nameInput.autocomplete = 'off';
  nameInput.placeholder = 'Name your scene';
  nameInput.setAttribute('aria-describedby', 'scene-library-status');
  const saveButton = el('button', 'scene-library__save', 'Save scene');
  saveButton.id = 'scene-library-save';
  saveButton.type = 'submit';
  form.append(nameLabel, nameInput, saveButton);
  const summary = el('div', 'scene-library__active');
  summary.id = 'scene-library-active';
  summary.setAttribute('role', 'status');
  summary.setAttribute('aria-live', 'polite');
  summary.setAttribute('aria-atomic', 'true');
  const savedLabel = el('label', 'scene-library__label', 'Saved scenes');
  savedLabel.htmlFor = 'scene-library-saved';
  const savedSelect = el('select', 'scene-library__saved');
  savedSelect.id = 'scene-library-saved';
  const status = el('p', 'scene-library__status');
  status.id = 'scene-library-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  element.append(form, summary, savedLabel, savedSelect, status);

  function syncControls() {
    nameInput.disabled = !activeScene;
    saveButton.disabled = !activeScene || !nameInput.value.trim() || !canSave || saving;
    saveButton.textContent = saving ? 'Saving…' : 'Save scene';
    form.setAttribute('aria-busy', String(saving));
    element.dataset.saved = String(isSaved);
  }
  function renderSummary() {
    summary.replaceChildren();
    if (!activeScene) {
      summary.append(el('p', 'scene-library__empty', 'No active scene. Build or select a scene to begin.'));
      return;
    }
    const count = Array.isArray(activeScene.keyframes) ? activeScene.keyframes.length
      : Array.isArray(activeScene.shots) ? activeScene.shots.length : 0;
    summary.append(
      el('p', 'scene-library__active-title', nameInput.value.trim() || title(activeScene)),
      el('p', 'scene-library__meta', `${count} keyframe${count === 1 ? '' : 's'} · ${isSaved ? 'Saved' : 'Unsaved'}`),
      el('p', 'scene-library__location', `Location: ${location(activeScene)}`),
      el('p', 'scene-library__provenance', `Provenance: ${provenance(activeScene)}`),
    );
    const evidence = el('div', 'scene-provenance');
    evidence.id = 'scene-provenance';
    evidence.textContent = activeScene.geographic
      ? `Authored geographic scene · not an incident report${activeScene.provenance?.observedAt ? ' · observed ' + activeScene.provenance.observedAt.slice(0, 19) + 'Z' : ''}`
      : 'Provider evidence as supplied; verify source timestamps.';
    if (activeScene.provenance?.sourceUrl) {
      const link = el('a', 'scene-provenance__source', 'Source');
      link.href = activeScene.provenance.sourceUrl;
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      evidence.append(link);
    }
    summary.append(evidence);
  }
  function syncSelection() {
    const index = savedScenes.findIndex((scene) => sameScene(scene, activeScene));
    savedSelect.value = index < 0 ? '' : String(index);
  }
  function setScene(scene, { saved = false } = {}) {
    if (destroyed) return;
    version += 1;
    selectionVersion += 1;
    activeScene = scene && typeof scene === 'object' ? scene : null;
    isSaved = Boolean(activeScene && saved);
    nameInput.value = activeScene ? title(activeScene) : '';
    status.textContent = !canSave ? 'Saving is not connected.' : '';
    syncControls();
    renderSummary();
    syncSelection();
  }
  function renderSaved(list = []) {
    if (destroyed) return;
    listVersion += 1;
    savedScenes = (Array.isArray(list) ? list : []).filter((scene) => scene && typeof scene === 'object');
    savedSelect.replaceChildren();
    const placeholder = el('option', '', savedScenes.length ? 'Choose a saved scene…' : 'No saved scenes yet');
    placeholder.value = '';
    savedSelect.append(placeholder);
    savedScenes.forEach((scene, index) => {
      const option = el('option', '', title(scene));
      option.value = String(index);
      savedSelect.append(option);
    });
    savedSelect.disabled = savedScenes.length === 0;
    syncSelection();
  }
  listen(nameInput, 'input', () => {
    version += 1;
    isSaved = false;
    status.textContent = canSave ? 'Name changed. Save to keep it.' : 'Saving is not connected.';
    syncControls();
    renderSummary();
  });
  listen(form, 'submit', async (event) => {
    event.preventDefault();
    if (destroyed || saving || !activeScene || !nameInput.value.trim() || !canSave) return;
    const namedScene = { ...activeScene, title: nameInput.value.trim() };
    if ('name' in activeScene) namedScene.name = namedScene.title;
    const saveVersion = version;
    saving = true;
    status.textContent = 'Saving scene…';
    syncControls();
    try {
      const result = typeof onSave === 'function'
        ? await onSave(namedScene, { sceneDirector }) : await storage.save(namedScene);
      if (result === false) throw new Error('Save was not accepted');
      if (destroyed) return;
      const stored = result && typeof result === 'object' && !Array.isArray(result) ? result : namedScene;
      const index = savedScenes.findIndex((scene) => sameScene(scene, stored) || sameScene(scene, activeScene) && version === saveVersion);
      const next = savedScenes.slice();
      if (index < 0) next.push(stored);
      else next[index] = stored;
      renderSaved(next);
      if (version === saveVersion) {
        setScene(stored, { saved: true });
        status.textContent = 'Scene saved.';
      }
    } catch {
      if (!destroyed && version === saveVersion) status.textContent = 'Could not save this scene. Please try again.';
    } finally {
      saving = false;
      if (!destroyed) syncControls();
    }
  });
  listen(savedSelect, 'change', async () => {
    if (savedSelect.value === '') return;
    const scene = savedScenes[Number(savedSelect.value)];
    if (!scene || destroyed) return;
    const request = ++selectionVersion;
    const selectedAtVersion = version;
    status.textContent = 'Selecting scene…';
    try {
      const result = typeof onSelect === 'function' ? await onSelect(scene, { sceneDirector, saved: true }) : undefined;
      if (result === false) throw new Error('Selection was not accepted');
      if (destroyed || request !== selectionVersion || selectedAtVersion !== version) return;
      setScene(scene, { saved: true });
    } catch {
      if (!destroyed && request === selectionVersion && selectedAtVersion === version) {
        syncSelection();
        status.textContent = 'Could not select this scene. Please try again.';
      }
    }
  });

  /**
   * Mount only after existing controls have initialized. Returns null if panels
   * are absent; repeated calls return the same installation. Original control
   * nodes/listeners are moved, not rebuilt, and restored by destroy().
   */
  function installSidebar({
    host = document.getElementById('left-panel-stack'),
    scenePanel = document.getElementById('scene-panel'),
    dataPanel = document.getElementById('data-panel'),
    advanced = true,
    initialTab = 'scenes',
    expanded = true,
  } = {}) {
    if (destroyed || !host || !scenePanel || !dataPanel) return null;
    if (sidebar) return sidebar;
    if (document.getElementById('sidebar-scenes-tab') || document.getElementById('sidebar-layers-tab')) {
      throw new Error('Sidebar tabs are already installed');
    }
    const inner = scenePanel.querySelector('.scene-panel-inner') || scenePanel;
    const originalParent = element.parentNode;
    const originalNext = element.nextSibling;
    const panelSnapshots = [scenePanel, dataPanel].map((panel) => ({
      panel,
      attrs: ['role', 'aria-labelledby', 'aria-hidden', 'hidden'].map((name) => [name, panel.getAttribute(name)]),
      collapsed: panel.classList.contains('collapsed'),
    }));
    const nav = el('div', 'workstation-sidebar-tabs');
    const tabs = el('div', 'workstation-sidebar-tabs__list');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Sidebar sections');
    const scenesTab = el('button', 'workstation-sidebar-tabs__tab', 'Scenes');
    scenesTab.id = 'sidebar-scenes-tab';
    const layersTab = el('button', 'workstation-sidebar-tabs__tab', 'Layers');
    layersTab.id = 'sidebar-layers-tab';
    [scenesTab, layersTab].forEach((button, index) => {
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', index === 0 ? scenePanel.id : dataPanel.id);
    });
    const toggle = el('button', 'scene-library__drawer-toggle');
    toggle.id = 'scene-drawer-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-controls', `${scenePanel.id} ${dataPanel.id}`);
    tabs.append(scenesTab, layersTab);
    nav.append(tabs, toggle);
    host.insertBefore(nav, host.firstChild);
    let details = null;
    const moved = [];
    if (advanced) {
      details = el('details', 'scene-library__advanced');
      details.append(el('summary', 'scene-library__advanced-summary', 'Advanced scene tools'));
      // Keep the incident panel (including #incident-playback-*) in place.
      for (const child of Array.from(inner.children)) {
        if (child === element || child.matches('.panel-header, .panel-glow, .incident-panel')
          || child.querySelector('#incident-playback') || child.id.startsWith('incident-')) continue;
        const marker = document.createComment('scene-library original control position');
        inner.insertBefore(marker, child);
        moved.push({ child, marker });
        details.append(child);
      }
      inner.append(details);
    }
    const firstContent = Array.from(inner.children).find((child) => !child.matches('.panel-header, .panel-glow'));
    inner.insertBefore(element, firstContent || null);
    let activeTab = initialTab === 'layers' ? 'layers' : 'scenes';
    let open = Boolean(expanded);
    function update() {
      [scenePanel, dataPanel].forEach((panel, index) => {
        const selected = activeTab === (index === 0 ? 'scenes' : 'layers');
        panel.hidden = !open || !selected;
        panel.classList.toggle('collapsed', !open || !selected);
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', index === 0 ? scenesTab.id : layersTab.id);
        panel.setAttribute('aria-hidden', String(!open || !selected));
      });
      [scenesTab, layersTab].forEach((button, index) => {
        const selected = activeTab === (index === 0 ? 'scenes' : 'layers');
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} sidebar drawer`);
      toggle.textContent = open ? 'Collapse drawer' : 'Expand drawer';
      nav.dataset.activeTab = activeTab;
      nav.dataset.expanded = String(open);
    }
    function selectTab(tab) {
      if (destroyed) return;
      activeTab = tab === 'layers' ? 'layers' : 'scenes';
      open = true;
      update();
    }
    listen(scenesTab, 'click', () => selectTab('scenes'));
    listen(layersTab, 'click', () => selectTab('layers'));
    listen(toggle, 'click', () => { open = !open; update(); });
    listen(tabs, 'keydown', (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      selectTab(event.key === 'Home' ? 'scenes' : event.key === 'End' ? 'layers' : activeTab === 'scenes' ? 'layers' : 'scenes');
      (activeTab === 'scenes' ? scenesTab : layersTab).focus();
    });
    [scenePanel, dataPanel].forEach((panel) => listen(panel, 'keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      open = false;
      update();
      toggle.focus();
    }));
    sidebar = {
      element: nav,
      selectTab,
      setExpanded(value) { if (!destroyed) { open = Boolean(value); update(); } },
      restore() {
        for (const { child, marker } of moved) { marker.parentNode?.replaceChild(child, marker); }
        details?.remove();
        if (originalParent) originalParent.insertBefore(element, originalNext?.parentNode === originalParent ? originalNext : null);
        else element.remove();
        nav.remove();
        for (const { panel, attrs, collapsed } of panelSnapshots) {
          for (const [name, value] of attrs) {
            if (value == null) panel.removeAttribute(name);
            else panel.setAttribute(name, value);
          }
          panel.classList.toggle('collapsed', collapsed);
        }
      },
    };
    update();
    return sidebar;
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    version += 1;
    selectionVersion += 1;
    for (const dispose of disposers.splice(0)) dispose();
    sidebar?.restore();
    sidebar = null;
    element.remove();
  }
  setScene(null);
  renderSaved([]);
  if (typeof storage?.list === 'function') {
    const initialListVersion = listVersion;
    Promise.resolve().then(() => destroyed ? [] : storage.list()).then((list) => {
      if (!destroyed && initialListVersion === listVersion) renderSaved(list);
    }).catch(() => {
      if (!destroyed && initialListVersion === listVersion) status.textContent = 'Could not load saved scenes.';
    });
  }
  // Kept injectable without accessing globals, timers, observers, or storage.
  void window;
  return { element, setScene, renderSaved, installSidebar, destroy };
}
