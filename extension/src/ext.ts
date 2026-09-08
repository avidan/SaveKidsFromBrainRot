// Cross-browser WebExtension API access.
//
// Chrome exposes promise-capable APIs on `chrome`; Safari exposes the
// standard promise-based APIs on `browser` (its `chrome` alias is
// callback-flavored, so awaiting it there would hang). Using whichever
// promise-based namespace exists lets one codebase serve the Chrome build
// and the Safari (macOS/iPadOS) build unchanged.
type Browser = typeof chrome;

export const ext: Browser =
  (globalThis as unknown as { browser?: Browser }).browser ?? chrome;
