/** The Wiener Labs "W", traced from the brand artwork, in a 607 × 424 box. */
export const MARK_PATH =
  'M2 0 122 1 122 279 127 291 134 298 148 303 221 302 233 296 233 294 238 290 242 281 243 1 363 1 365 281 370 292 372 292 377 298 386 302 485 304 485 424 364 424 253 312 248 316 243 328 242 424 121 424 117 421 11 315 4 304 1 295 0 2Z M487 0 605 0 607 2 607 177 601 189 545 243 488 243 486 241 486 183 533 182 541 178 546 169 546 122 487 122 485 119Z'

/** The mark in the text color, so it works in both themes. */
export function Mark() {
  return (
    <svg viewBox="0 0 607 424" className="h-[15px] w-auto shrink-0 text-ink" fill="currentColor" aria-hidden>
      <path fillRule="evenodd" d={MARK_PATH} />
    </svg>
  )
}
