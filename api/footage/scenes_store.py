"""In-memory scene storage with MAX=200 eviction.
"""
from __future__ import annotations

from collections import OrderedDict
from typing import Any, Optional

MAX = 200
_store: OrderedDict[str, dict[str, Any]] = OrderedDict()


def put(scene_id: str, scene: dict[str, Any]) -> dict[str, Any]:
    """Store scene with FIFO eviction if capacity exceeds MAX."""
    if scene_id in _store:
        _store.move_to_end(scene_id)
        _store[scene_id] = scene
        return scene
    if len(_store) >= MAX:
        _store.popitem(last=False)
    _store[scene_id] = scene
    return scene


def get(scene_id: str) -> Optional[dict[str, Any]]:
    """Retrieve scene by id or None."""
    if scene_id in _store:
        _store.move_to_end(scene_id)
        return _store[scene_id]
    return None


def list_all() -> list[dict[str, Any]]:
    """List all stored scenes."""
    return list(_store.values())


def delete(scene_id: str) -> bool:
    """Delete a scene by id. Returns True if deleted, False if not found."""
    return _store.pop(scene_id, None) is not None


def clear() -> None:
    """Clear all scenes (primarily for tests)."""
    _store.clear()


def size() -> int:
    """Current number of stored scenes."""
    return len(_store)
