// Line icons (24×24, stroke = currentColor). Kept inline so the app works offline with no icon font.
const svg = (body, cls = "ic") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const AREA_PATHS = {
  HVAC: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/>',
  Plumbing: '<path d="M12 3.5s6 6.4 6 10.8a6 6 0 0 1-12 0C6 9.9 12 3.5 12 3.5Z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5"/>',
  Kitchen: '<path d="M7 3v7M5 3v4.5a2 2 0 0 0 4 0V3M7 10v11M17 21V3c-2 1.4-3.2 3.8-3.2 7.2H17"/>',
  Appliances: '<rect x="4.5" y="3" width="15" height="18" rx="2.5"/><circle cx="12" cy="13.5" r="4"/><path d="M8 6.5h.01M11 6.5h.01"/>',
  Safety: '<path d="M12 3 19 6v5.2c0 4.4-2.9 7.9-7 9.8-4.1-1.9-7-5.4-7-9.8V6l7-3Z"/><path d="m9 12 2 2 4-4"/>',
  Exterior: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>',
  Yard: '<path d="M6 19c-.5-8 4.5-13.5 13-14 .5 8.5-5 14-13 14Z"/><path d="M6 19c2.5-4 5.5-6.5 9-8"/>',
  Interior: '<path d="M5 11V8.5A2.5 2.5 0 0 1 7.5 6h9A2.5 2.5 0 0 1 19 8.5V11"/><path d="M3 12a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v5H3v-5Z"/><path d="M5.5 17v2M18.5 17v2"/>',
  Other: '<path d="M14.6 6.4a4 4 0 0 0-5.3 5.3L4 17l3 3 5.3-5.3a4 4 0 0 0 5.3-5.3l-2.5 2.5-2.4-.6-.6-2.4 2.5-2.5Z"/>',
};

export const areaIcon = (area, cls = "ic") => svg(AREA_PATHS[area] || AREA_PATHS.Other, cls);

export const icon = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', "ic check-ic"),
  tasks: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17"/>'),
  history: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  home: svg('<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h5v-5h3v5h5V9.5"/>'),
  settings: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  chevron: svg('<path d="m9.5 6 6 6-6 6"/>', "ic chev"),
  calendar: svg('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  snooze: svg('<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z"/>'),
  edit: svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>'),
  receipt: svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/>'),
  camera: svg('<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.5-2h5L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-8Z"/><circle cx="12" cy="12.5" r="3.5"/>'),
  sparkle: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>'),
  shield: svg('<path d="M12 3 19 6v5.2c0 4.4-2.9 7.9-7 9.8-4.1-1.9-7-5.4-7-9.8V6l7-3Z"/>'),
};
