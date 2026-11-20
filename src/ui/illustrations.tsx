/**
 * Inline SVG illustrations for the tutorial.
 *
 * Drawn with `currentColor` plus theme tokens, so they work in light and dark
 * themes, need no network access (no external images) and stay crisp at any
 * size. All wording lives in HTML captions next to the drawing, so the SVGs
 * themselves stay language-neutral and translate automatically.
 */

interface IllustrationProps {
  /** Accessible description of the drawing (not visible). */
  label: string;
}

/** Camera at eye level (good) vs. below the writing hand (avoid). */
export function PlacementIllustration({ label }: IllustrationProps) {
  return (
    <svg viewBox="0 0 320 132" role="img" aria-label={label} className="tutorial-art">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* ---- good: camera level with the eyes ---- */}
        <rect x="6" y="10" width="140" height="96" rx="8" />
        <g transform="translate(18,22)">
          <rect x="0" y="0" width="22" height="16" rx="3" />
          <circle cx="11" cy="8" r="4" />
          <path d="M22 8h14" strokeDasharray="4 4" />
        </g>
        <circle cx="86" cy="46" r="11" />
        <path d="M86 57v22M86 64l-12 8M86 64l12 8M86 79l-8 20M86 79l8 20" />
        {/* ---- avoid: camera looking up at the hand ---- */}
        <g transform="translate(166,0)">
          <rect x="6" y="10" width="140" height="96" rx="8" strokeDasharray="5 5" />
          <g transform="translate(18,80)">
            <rect x="0" y="0" width="22" height="16" rx="3" />
            <circle cx="11" cy="8" r="4" />
            <path d="M11 0v-12" strokeDasharray="4 4" />
          </g>
          <path d="M96 84v-24" />
          <circle cx="96" cy="52" r="10" />
          <path d="M96 62l-12-10M96 62l12-10" />
        </g>
      </g>
      {/* verdict marks */}
      <circle cx="24" cy="118" r="7" fill="var(--success)" />
      <path
        d="M20.5 118l2.5 2.5 4.5-5"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="184" cy="118" r="7" fill="var(--error)" />
      <path
        d="M181 115l6 6M187 115l-6 6"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Stand about one arm's length from the camera. */
export function DistanceIllustration({ label }: IllustrationProps) {
  return (
    <svg viewBox="0 0 320 100" role="img" aria-label={label} className="tutorial-art">
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        {/* camera */}
        <rect x="10" y="38" width="40" height="28" rx="5" />
        <circle cx="30" cy="52" r="8" />
        {/* dashed distance with arrow heads on both ends */}
        <path d="M62 52h150" strokeDasharray="6 6" />
        <path d="M62 52l10-5v10zM212 52l-10-5v10z" fill="currentColor" stroke="none" />
        {/* person */}
        <circle cx="252" cy="34" r="10" />
        <path d="M252 44v22M252 50l-12 8M252 50l12 8M252 66l-8 16M252 66l8 16" />
      </g>
      {/* measuring brackets */}
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M62 24v8M212 24v8M62 28h150" strokeDasharray="2 5" />
      </g>
    </svg>
  );
}

/** Hold a fist for one second to pause tracking. */
export function PauseIllustration({ label }: IllustrationProps) {
  return (
    <svg viewBox="0 0 260 90" role="img" aria-label={label} className="tutorial-art">
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        {/* closed fist: rounded square with knuckle bumps */}
        <rect x="12" y="26" width="46" height="38" rx="10" />
        <path d="M24 34v22M36 34v22M48 34v22" strokeWidth="1.5" />
        <path d="M62 45h34" strokeDasharray="5 5" />
        {/* clock: one second */}
        <circle cx="126" cy="45" r="22" />
        <path d="M126 32v13l9 7" />
        {/* pause bars */}
        <rect x="176" y="30" width="10" height="30" rx="2" />
        <rect x="196" y="30" width="10" height="30" rx="2" />
        <path d="M164 45h6" strokeDasharray="3 3" />
      </g>
    </svg>
  );
}
