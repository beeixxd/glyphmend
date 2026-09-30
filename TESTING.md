# V3 validation

Passed JavaScript syntax checks for studio.js, repair.js and server.cjs.
Passed test-repair.cjs: solid color interpolation, linear gradient continuity, alpha preservation, bounds.
Passed test-flow.cjs with mocked DOM/Canvas: OCR JSON parsing, scaled symbol coordinates, auto-filling original text, locked size, overflow rejection, unknown source glyph rejection, invalidating stale selections after apply, undo.
Local server verified: index, studio.js and missing resource response.

Browser launch was blocked by sandbox IPC permissions (Chrome mojo platform channel Access Denied). test-browser.cjs is supplied for repeatable CDP checks with a browser listening on port 9223. It uses a stub OCR result, not a real recognition model. No successful real-browser render, OCR recognition or real image font accuracy check was completed in this environment.

External binary downloads were blocked, so vendor assets are installed by install-assets.ps1 or fetched on first online use. Real OCR first-use and offline behavior need checking after dependencies are downloaded. The package does not claim 100% fidelity.

Primary documentation:
- https://github.com/naptha/tesseract.js/blob/master/docs/api.md
- https://developer.chrome.com/docs/capabilities/web-apis/local-fonts
- https://github.com/google/fonts/tree/main/ofl/notosanssc
- https://github.com/google/fonts/tree/main/ofl/notoserifsc

Run: node --check dist/studio.js; node --check dist/repair.js; node --check server.cjs; node test-repair.cjs; node test-flow.cjs.

V3.1: mocked DOM/Canvas keyboard tests passed for Alt + all four arrows, 1 original pixel at 10x zoom, repeat suppression, boundary rollback, expanded patch size, source glyph movement and position reset. Real-browser rendering remains unverified in this environment.
