interface Props {
  size?: number;
  className?: string;
}

export default function CrownMark({ size = 28, className = '' }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M6 20.6 4.4 10.4l6 4.6L16 6.6l5.6 8.4 6-4.6L26 20.6H6Z"
        fill="url(#crown-fill)"
        stroke="#e9b949"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path d="M5.6 22.4h20.8l-1.5 3.2H7.1l-1.5-3.2Z" fill="#e9b949" />
      <circle cx="16" cy="16.4" r="1.6" fill="#080d18" />
      <defs>
        <linearGradient id="crown-fill" x1="4" y1="6" x2="28" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f7dfa0" />
          <stop offset="1" stopColor="#c99a2e" />
        </linearGradient>
      </defs>
    </svg>
  );
}
