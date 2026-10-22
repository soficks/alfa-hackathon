import type { SVGProps } from 'react';

const paths = {
  home: <path d="M3.5 10.2 12 3.5l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-6h-5.6v6H5A1.5 1.5 0 0 1 3.5 19z" />,
  financing: (
    <>
      <rect x="3" y="7" width="18" height="13.5" rx="2" />
      <path d="M8.5 7V5.2A1.7 1.7 0 0 1 10.2 3.5h3.6a1.7 1.7 0 0 1 1.7 1.7V7" />
      <path d="M8 16.5v-3M12 16.5v-5.5M16 16.5v-4" />
    </>
  ),
  document: (
    <>
      <path d="M14 3.5H7.2A1.7 1.7 0 0 0 5.5 5.2v13.6a1.7 1.7 0 0 0 1.7 1.7h9.6a1.7 1.7 0 0 0 1.7-1.7V8z" />
      <path d="M14 3.5V8h4.5M9 12.5h6M9 16h6" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.5" />
      <circle cx="12" cy="16.6" r=".4" fill="currentColor" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.5h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  chevronsLeft: <path d="m11.5 17-5-5 5-5M18 17l-5-5 5-5" />,
  arrowRight: <path d="M4.5 12h15M13.5 6l6 6-6 6" />,
  arrowLeft: <path d="M19.5 12h-15M10.5 6l-6 6 6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.2 2" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.2v6" />
      <circle cx="12" cy="16.4" r=".5" fill="currentColor" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.3 2.8 2.8L16.2 9.6" />
    </>
  ),
  doubleCheck: <path d="m2.5 12.5 4 4L15 8M9.5 15.5l1 1L19 8" />,
  pencil: (
    <>
      <path d="M4 20h4.2L19.3 8.9a2.1 2.1 0 0 0 0-3L18.1 4.7a2.1 2.1 0 0 0-3 0L4 15.8z" />
      <path d="m13.6 6.2 4.2 4.2" />
    </>
  ),
  building: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M9 7h1.5M13.5 7H15M9 11h1.5M13.5 11H15M9 15h1.5M13.5 15H15M10.5 21v-3h3v3" />
    </>
  ),
  headset: (
    <>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <path d="M4 14h3v5H5.5A1.5 1.5 0 0 1 4 17.5zM20 14h-3v5h1.5a1.5 1.5 0 0 0 1.5-1.5z" />
      <path d="M17 19c0 1.2-1.3 2-3 2h-1.5" />
    </>
  ),
  paperclip: (
    <path d="m20 11.3-7.8 7.9a5 5 0 0 1-7.1-7.1l8-8a3.4 3.4 0 0 1 4.7 4.8l-8 7.9a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3" />
  ),
  send: <path d="M5 4.5 20 12 5 19.5l2.6-7.5z" fill="currentColor" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.8" r=".5" fill="currentColor" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15.5" rx="2" />
      <path d="M8 3v4M16 3v4M4 10h16" />
      <path d="M8 13.5h.01M12 13.5h.01M16 13.5h.01M8 17h.01M12 17h.01" strokeWidth="2.4" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M10.6 5.6A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.6 6.7A15.7 15.7 0 0 0 2.5 12S6 18.5 12 18.5a9.3 9.3 0 0 0 5.3-1.7" />
      <path d="M3.5 3.5l17 17M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  chat: <path d="M4 12a8 8 0 1 1 3.6 6.7L4 20l1.1-3.6A8 8 0 0 1 4 12z" />,
  upload: <path d="M12 15.5V4M7 9l5-5 5 5M5 19.5h14" />,
  download: <path d="M12 4v11.5M7 10.5l5 5 5-5M5 19.5h14" />,
  logout: <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M9.5 16.5 5 12l4.5-4.5M5 12h10" />,
  refresh: <path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  trash: <path d="M4 6.5h16M9.5 6.5V4h5v2.5M6.5 6.5l1 13.5h9l1-13.5M10 10.5v6M14 10.5v6" />,
  file: (
    <>
      <path d="M14 3.5H7.2A1.7 1.7 0 0 0 5.5 5.2v13.6a1.7 1.7 0 0 0 1.7 1.7h9.6a1.7 1.7 0 0 0 1.7-1.7V8z" />
      <path d="M14 3.5V8h4.5" />
    </>
  ),
};

export type IconName = keyof typeof paths;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}

export function Icon({ name, size = 24, strokeWidth = 1.8, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
