import React, { useId } from "react";
export function Icon({ name, size = 22, ...props }) {
  const paths = {
    home: "M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9",
    finance: "M4 21V11h5v10M9 21V5h6v16M15 21V9h5v12M2 21h20",
    file: "M6 3h8l5 5v13H6zM14 3v6h5M9 13h7M9 17h7",
    chat: "M21 11a9 9 0 0 1-9 9H4l-3 2 2-6A9 9 0 1 1 21 11ZM7 10h.01M12 10h.01M17 10h.01",
    user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21a8 8 0 0 1 16 0Z",
    bell: "M5 17h14l-2-3V9a5 5 0 0 0-10 0v5ZM10 21h4",
    arrow: "M4 12h16M14 6l6 6-6 6",
    back: "M20 12H4m6-6-6 6 6 6",
    check: "m5 12 4 4L19 6",
    close: "m6 6 12 12M6 18 18 6",
    chevron: "m8 5 7 7-7 7",
    down: "m6 9 6 6 6-6",
    upload: "M12 16V3M7 8l5-5 5 5M4 15v6h16v-6",
    clip: "m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l9-9",
    logout: "M9 4H4v16h5M9 12h12m-5-5 5 5-5 5",
    clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    info: "M12 11v6m0-10v.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
    building: "M4 21V3h12v18M16 10h4v11M8 7h4M8 11h4M8 15h4M2 21h20",
    search: "M21 21l-6-6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
    trash: "M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name] || paths.file} />
    </svg>
  );
}
export function Logo() {
  return (
    <div className="logo">
      <span className="brand-mark">
        <i />
        <i />
      </span>
      <span>
        Бизнес
        <br />
        кабинет
      </span>
    </div>
  );
}
export function Ribbon({ className = "" }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      className={`ribbon ${className}`}
      viewBox="0 0 600 340"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={`${id}a`}
          x1="100"
          y1="0"
          x2="420"
          y2="320"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#ff5562" />
          <stop offset=".4" stopColor="#f90826" />
          <stop offset=".7" stopColor="#b8001c" />
          <stop offset="1" stopColor="#ff3348" />
        </linearGradient>
        <linearGradient
          id={`${id}b`}
          x1="160"
          y1="100"
          x2="340"
          y2="240"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#fff6ef" />
          <stop offset=".55" stopColor="#fbd0c6" />
          <stop offset="1" stopColor="#e04b50" />
        </linearGradient>
      </defs>
      <path
        d="M-40 310C80 340 75 0 240 45c100 25 130 220 255 180 55-16 76-125 140-135l25 108c-110 22-105 151-235 119C285 282 282 147 205 136 135 126 136 340-10 375Z"
        fill={`url(#${id}a)`}
      />
      <path
        d="M14 275C93 263 134 88 211 57c20-9 35-5 51 2-80 33-87 165-76 235-75-68-100-45-172-19Z"
        fill={`url(#${id}b)`}
      />
      <path
        d="M240 45c76 20 104 133 172 170-89-20-111-68-143-75-24-6-41 1-64-4 14-41 26-72 35-91Z"
        fill={`url(#${id}a)`}
      />
    </svg>
  );
}
export function Cat({ className = "" }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={`cat ${className}`} viewBox="0 0 90 96" aria-hidden="true">
      <defs>
        <radialGradient id={id} cx=".35" cy=".25" r=".85">
          <stop stopColor="#ff634e" />
          <stop offset=".6" stopColor="#f51d16" />
          <stop offset="1" stopColor="#b90014" />
        </radialGradient>
      </defs>
      <path
        d="M14 44 17 8Q20 1 27 10l13 13h14L67 9q8-7 10 3l3 34Z"
        fill={`url(#${id})`}
      />
      <path d="m21 15 3 20 12-9Zm50 1-12 12 13 5Z" fill="#4d161c" />
      <ellipse cx="46" cy="49" rx="35" ry="30" fill={`url(#${id})`} />
      <path
        d="M28 43q5-6 10 0m17 0q5-6 10 0"
        fill="none"
        stroke="#3b1119"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="m42 52 4 4 4-4Z" fill="#42121b" />
      <path
        d="M46 56v6m0-1q-9 8-13-1m13 1q9 8 13-1"
        fill="none"
        stroke="#42121b"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <ellipse cx="27" cy="55" rx="6" ry="3" fill="#f27c69" opacity=".7" />
      <ellipse cx="65" cy="55" rx="6" ry="3" fill="#f27c69" opacity=".7" />
      <path
        d="M22 73q24 12 48 0"
        fill="none"
        stroke="#e9b738"
        strokeWidth="7"
      />
      <circle
        cx="46"
        cy="82"
        r="11"
        fill="#ffd76c"
        stroke="#d3a035"
        strokeWidth="2"
      />
      <text
        x="46"
        y="87"
        textAnchor="middle"
        fontSize="16"
        fontWeight="900"
        fill="#e61b22"
      >
        А
      </text>
    </svg>
  );
}
export function GoalArt({ type }) {
  return (
    <div className={`goal-art art-${type}`}>
      <Ribbon />
      {type === 0 ? (
        <div className="bars">
          <i />
          <i />
          <i />
          <i />
        </div>
      ) : type === 1 ? (
        <div className="machine">
          <span>✳</span>
          <i />
          <b />
        </div>
      ) : (
        <div className="city">
          <i />
          <i />
          <i />
        </div>
      )}
    </div>
  );
}
