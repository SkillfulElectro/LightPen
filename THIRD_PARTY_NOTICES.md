# Third-party notices

LightPen is MIT licensed (see [LICENSE](../LICENSE)). It bundles or depends on the
following third-party components. All are permissive licences; no copyleft code
is linked into the application.

## Runtime dependencies

| Component                                                                                                                   | Version     | Licence           | Use                                |
| --------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------- | ---------------------------------- |
| [Tauri](https://tauri.app) (`tauri`, plugins `dialog`, `fs`, `opener`)                                                      | 2.x         | MIT OR Apache-2.0 | native shell, dialogs, file access |
| [React](https://react.dev) / [React DOM](https://react.dev)                                                                 | 18.x        | MIT               | UI                                 |
| [Vite](https://vite.dev)                                                                                                    | 6.x         | MIT               | build tooling                      |
| [Zustand](https://zustand.docs.pmnd.rs)                                                                                     | 5.x         | MIT               | state management                   |
| [i18next](https://www.i18next.com) / [react-i18next](https://react.i18next.com)                                             | 23.x / 15.x | MIT               | internationalisation               |
| [pdf.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`)                                                                  | 4.x         | Apache-2.0        | PDF rendering                      |
| [pdf-lib](https://pdf-lib.js.org)                                                                                           | 1.17.x      | MIT               | PDF writing / vector export        |
| [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) (`@mediapipe/tasks-vision`) | 0.10.x      | Apache-2.0        | hand landmark inference (WASM)     |

## Bundled model

| Asset                                            | Source                        | Licence / terms                                                                                                                                                                                                                                    |
| ------------------------------------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hand_landmarker.task` (HandLandmarker, float16) | Google MediaPipe model bundle | Distributed by Google under the **Apache License 2.0**; the MediaPipe model card and the [Google AI Edge terms](https://ai.google.dev/terms) apply. Not committed to this repository; downloaded by `npm run fetch:model` and bundled into builds. |

The model runs entirely on the device. No audio, video or landmark data is sent
to Google or anyone else.

## Development-only dependencies

| Component                                                                         | Licence           | Use                  |
| --------------------------------------------------------------------------------- | ----------------- | -------------------- |
| TypeScript                                                                        | Apache-2.0        | type checking        |
| ESLint, typescript-eslint, eslint-plugin-react-hooks, eslint-plugin-react-refresh | MIT               | linting              |
| Prettier                                                                          | MIT               | formatting           |
| Vitest, @vitest/coverage-v8                                                       | MIT               | unit tests, coverage |
| jsdom                                                                             | MIT               | DOM test environment |
| @testing-library/react, @testing-library/jest-dom                                 | MIT               | component tests      |
| Playwright (`@playwright/test`)                                                   | Apache-2.0        | end-to-end tests     |
| @tauri-apps/cli                                                                   | MIT OR Apache-2.0 | Tauri build tooling  |
| actionlint (CI only, not shipped)                                                 | MIT               | workflow linting     |

## Fonts and icons

- No web fonts are bundled; the UI uses the operating system font stack.
- Icons in the UI are Unicode emoji rendered by the platform.
- The application icon (`src-tauri/icons/*`) is an original artwork created for
  this project and covered by the project's MIT licence.

## Attribution notes

- The One Euro filter is implemented from the published algorithm:
  G. Casiez, N. Roussel, D. Vogel, _"1€ Filter: A Simple Speed-based Low-pass
  Filter for Noisy Input in Interactive Systems"_, CHI 2012. The implementation
  in `src/core/oneEuro.ts` is original code, not copied.
- pdf.js is used under the Apache License 2.0; its `LICENSE` file is included in
  the packaged `pdfjs-dist` directory of `node_modules` at build time.

If you believe a component is missing or misattributed, please open an issue.
