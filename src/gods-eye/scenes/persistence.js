/**
 * Gods-Eye scene engine — persistence adapter.
 * IndexedDB store 'scenes' (keyPath id) + in-memory fallback.
 * Best-effort mirror to `${base}/scenes/:id` via fetch PUT/GET/DELETE.
 */

/**
 * Creates persistence adapter with IndexedDB and in-memory fallback.
 *
 * @param {object} [options={}]
 * @param {IDBFactory} [options.indexedDB]
 * @param {string} [options.name='gods-eye']
 * @param {typeof fetch} [options.fetch]
 * @param {string} [options.base='/footage']
 * @returns {{
 *   save: (scene: object) => Promise<object>,
 *   load: (id: string) => Promise<object|null>,
 *   list: () => Promise<object[]>,
 *   remove: (id: string) => Promise<void>,
 *   clear: () => Promise<void>
 * }}
 */
export function createPersistence({
  indexedDB = globalThis.indexedDB,
  name = 'gods-eye',
  fetch = globalThis.fetch,
  base = '/footage',
} = {}) {
  const memoryStore = new Map();
  let dbPromise = null;

  function getDb() {
    if (!indexedDB) return Promise.resolve(null);
    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        try {
          const req = indexedDB.open(name, 1);
          req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('scenes')) {
              db.createObjectStore('scenes', { keyPath: 'id' });
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }
    return dbPromise;
  }

  async function save(scene) {
    if (!scene?.id) return scene;
    memoryStore.set(scene.id, scene);

    const db = await getDb();
    if (db) {
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction('scenes', 'readwrite');
          const store = tx.objectStore('scenes');
          const req = store.put(scene);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      } catch {
        // Fallback remains in memoryStore
      }
    }

    if (fetch) {
      try {
        const url = `${base}/scenes/${encodeURIComponent(scene.id)}`;
        fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(scene),
        }).catch(() => {});
      } catch {
        // swallowed
      }
    }

    return scene;
  }

  async function load(id) {
    if (!id) return null;
    let result = null;

    const db = await getDb();
    if (db) {
      try {
        result = await new Promise((resolve, reject) => {
          const tx = db.transaction('scenes', 'readonly');
          const store = tx.objectStore('scenes');
          const req = store.get(id);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        });
      } catch {
        result = null;
      }
    }

    if (!result) {
      result = memoryStore.get(id) || null;
    }

    if (!result && fetch) {
      try {
        const url = `${base}/scenes/${encodeURIComponent(id)}`;
        const res = await fetch(url);
        if (res && res.ok) {
          result = await res.json();
          if (result?.id) {
            memoryStore.set(result.id, result);
          }
        }
      } catch {
        // swallowed
      }
    }

    return result || null;
  }

  async function list() {
    let idbList = [];
    const db = await getDb();
    if (db) {
      try {
        idbList = await new Promise((resolve, reject) => {
          const tx = db.transaction('scenes', 'readonly');
          const store = tx.objectStore('scenes');
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        });
      } catch {
        idbList = [];
      }
    }

    const byId = new Map();
    for (const item of idbList) {
      if (item?.id) byId.set(item.id, item);
    }
    for (const [id, item] of memoryStore.entries()) {
      byId.set(id, item);
    }

    const all = Array.from(byId.values());
    all.sort((a, b) => {
      const ta = Date.parse(a.lifecycle?.createdAt || 0);
      const tb = Date.parse(b.lifecycle?.createdAt || 0);
      return tb - ta;
    });

    return all;
  }

  async function remove(id) {
    if (!id) return;
    memoryStore.delete(id);

    const db = await getDb();
    if (db) {
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction('scenes', 'readwrite');
          const store = tx.objectStore('scenes');
          const req = store.delete(id);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      } catch {
        // swallowed
      }
    }

    if (fetch) {
      try {
        const url = `${base}/scenes/${encodeURIComponent(id)}`;
        fetch(url, { method: 'DELETE' }).catch(() => {});
      } catch {
        // swallowed
      }
    }
  }

  async function clear() {
    memoryStore.clear();

    const db = await getDb();
    if (db) {
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction('scenes', 'readwrite');
          const store = tx.objectStore('scenes');
          const req = store.clear();
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      } catch {
        // swallowed
      }
    }
  }

  return {
    save,
    load,
    list,
    remove,
    clear,
  };
}
