// Single source of truth for the emoji/icon associated with each spot
// type. Cross-platform (no SVG asset needed) and used by both list cards
// and detail panels.

const TYPE_ICONS: Record<string, string> = {
  Cafe: "☕",
  Library: "📚",
  Coworking: "💼",
  Hotel: "🏨",
  Restaurant: "🍽️",
  Park: "🌳",
  Other: "📍",
};

export function typeIcon(type: string | null | undefined): string {
  if (!type) return TYPE_ICONS.Other;
  return TYPE_ICONS[type] ?? TYPE_ICONS.Other;
}
