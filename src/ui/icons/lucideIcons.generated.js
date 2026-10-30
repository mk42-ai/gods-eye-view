// Derived from src/ui/icons/lucideNodes.js
import { LUCIDE_NODES, LUCIDE_PACKAGE_VERSION } from "./lucideNodes.js";

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function serializeNode([tag, attrs]) {
  const entries = Object.entries(attrs || {});
  if (entries.length === 0) return `<${tag}/>`;
  const attrStr = entries.map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(" ");
  return `<${tag} ${attrStr}/>`;
}

function serializeNodes(nodes) {
  return (nodes || []).map(serializeNode).join("");
}

export const LUCIDE_VERSION = LUCIDE_PACKAGE_VERSION;

export const LUCIDE_ICONS = Object.freeze(
  Object.fromEntries(
    Object.entries(LUCIDE_NODES).map(([name, nodes]) => [name, serializeNodes(nodes)])
  )
);
