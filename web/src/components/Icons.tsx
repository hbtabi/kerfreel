import type { SVGProps } from 'react';

const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export const Play = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M7 4v16l13-8z" fill="currentColor" />
  </svg>
);
export const Pause = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="6" y="4" width="4" height="16" fill="currentColor" />
    <rect x="14" y="4" width="4" height="16" fill="currentColor" />
  </svg>
);
export const Upload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
  </svg>
);
export const Sparkles = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
    <path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
  </svg>
);
export const Scissors = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" />
  </svg>
);
export const Download = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M12 4v12M6 10l6 6 6-6M4 20h16" />
  </svg>
);
export const Trash = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
);
export const Plus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const Film = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4" />
  </svg>
);
export const Loop = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4" />
    <path d="M21 13v2a3 3 0 01-3 3H3" />
  </svg>
);
export const Phone = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="7" y="2" width="10" height="20" rx="2" />
  </svg>
);
export const Monitor = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="2" y="5" width="20" height="12" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
);
export const Logo = () => (
  <svg width="30" height="30" viewBox="0 0 64 64" aria-hidden>
    <rect width="64" height="64" rx="14" fill="#fdf9f3" />
    <rect x="14" y="12" width="10" height="40" rx="3" fill="#1a1714" />
    <path d="M30 32 L48 14 L54 20 L40 32 L54 44 L48 50 Z" fill="#1a1714" />
    <circle cx="50" cy="52" r="4" fill="#7b5cff" />
  </svg>
);
