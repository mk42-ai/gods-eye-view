import { siTiktok, siInstagram, siX, siSnapchat } from "simple-icons";

export const PLATFORM_LOGOS = Object.freeze({
  tiktok: siTiktok,
  instagram: siInstagram,
  x: siX,
  snapchat: siSnapchat,
});

const SVG_NS = "http://www.w3.org/2000/svg";

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Returns monochrome inline SVG markup for a supported platform logo.
 * Uses fill="currentColor" only, never the brand hex.
 *
 * @param {string} platform Platform key: "tiktok", "instagram", "x", "snapchat".
 * @param {{ label?: string, size?: number }} [options]
 * @returns {string} SVG markup string, or empty string for unknown platform.
 */
export function platformLogoMarkup(platform, { label = "", size = 14 } = {}) {
  const logo = PLATFORM_LOGOS[platform];
  if (!logo) return "";

  const cls = `od-platform-logo od-platform-logo--${platform}`;
  const sizeAttr = Number.isFinite(size) && size > 0 ? ` width="${size}" height="${size}"` : "";
  const a11yAttr = label
    ? ` role="img" aria-label="${escapeAttribute(label)}"`
    : ' aria-hidden="true" focusable="false"';
  const titleTag = label ? `<title>${escapeAttribute(label)}</title>` : "";

  return `<svg xmlns="${SVG_NS}" viewBox="0 0 24 24"${sizeAttr} fill="currentColor" class="${cls}"${a11yAttr}>${titleTag}<path d="${logo.path}"/></svg>`;
}

/**
 * Creates an inline SVG element for a supported platform logo.
 *
 * @param {string} platform Platform key: "tiktok", "instagram", "x", "snapchat".
 * @param {{ label?: string, size?: number, className?: string }} [options]
 * @param {Document} [documentRef] Owning document.
 * @returns {SVGSVGElement|null} SVG element, or null for unknown platform or missing document.
 */
export function createPlatformLogo(platform, options = {}, documentRef = typeof document !== "undefined" ? document : null) {
  const logo = PLATFORM_LOGOS[platform];
  if (!logo || !documentRef || typeof documentRef.createElementNS !== "function") return null;

  const { label = "", size = 14, className = "" } = options;
  const svg = documentRef.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "currentColor");
  if (Number.isFinite(size) && size > 0) {
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
  }
  const cls = ["od-platform-logo", `od-platform-logo--${platform}`, className].filter(Boolean).join(" ");
  svg.setAttribute("class", cls);

  if (label) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
    const title = documentRef.createElementNS(SVG_NS, "title");
    title.textContent = label;
    svg.appendChild(title);
  } else {
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
  }

  const path = documentRef.createElementNS(SVG_NS, "path");
  path.setAttribute("d", logo.path);
  svg.appendChild(path);

  return svg;
}
