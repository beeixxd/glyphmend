# V4 verification

Passed JS syntax checks for all four application scripts, repair.js and server.cjs.

Passed test-workspace.cjs (mock DOM/Canvas): independent canvas/form/OCR/selection/history/preview/zoom state between tabs; close confirmation/cancel; Alt-arrow tap and repeated-key movement; queued movement; original-pixel drag scaling at 10x zoom; locked font size; expanded preview patch; dirty document revision; multiline rendering paths; leading estimates; Photopea message origin/source validation; PNG binary-return routing; rejecting wrong-tab source markers.

Passed actual TTF naming-table extraction against installed Arial: Arial / ArialMT. This reads a font file's metadata; it does not verify recognizing Arial from an image.

Passed classic background repair tests for solid color, gradient continuity, alpha preservation and bounds.

HTTP delivery checked with local server. Chromium launch failed due sandbox IPC access restrictions (mojo platform channel / Crashpad Access Denied). External binary downloads remain blocked in this execution environment. No successful real-browser visual QA, real OCR accuracy check, Google Fonts network download, editable Photopea text-layer creation or live Photopea round trip was completed here. These features are implemented against documented APIs, not declared live-verified.

Official sources:
- https://www.photopea.com/api/
- https://www.photopea.com/api/live
- https://www.photopea.com/api/environment
- https://www.photopea.com/api/fonts
- https://www.photopea.com/learn/scripts
- https://developers.google.com/fonts/docs/getting_started
- https://github.com/google/fonts
- https://learn.microsoft.com/en-us/typography/opentype/spec/name
- https://github.com/naptha/tesseract.js/blob/master/docs/api.md

The supplied browser test uses a stub OCR response; it is useful for local UI smoke checking after launching a browser with CDP port 9223, but it does not measure real OCR or matching fidelity.

Additional checks passed: supported font-weight filtering; variable weight bounds; compiling editable Photopea text-layer scripts; distinct fallback document markers. Actual installed Arial OS/2 weight parsed as 400. node test-all.cjs runs syntax/reference checks and both suites without child-process launch.
