/**
 * Module-level handle to the camera tracking session.
 * Lets the permission dialog (and the tutorial) start tracking without
 * threading callbacks through the component tree, and keeps `CameraPreview`
 * a component-only module for React Fast Refresh.
 */
let startTrackingRef: (() => Promise<void>) | null = null;

export function registerTrackingStarter(start: () => Promise<void>): () => void {
  startTrackingRef = start;
  return () => {
    if (startTrackingRef === start) startTrackingRef = null;
  };
}

/** Start hand tracking if the camera panel is mounted. */
export async function startTracking(): Promise<void> {
  await startTrackingRef?.();
}

export function isTrackingAvailable(): boolean {
  return startTrackingRef !== null;
}
