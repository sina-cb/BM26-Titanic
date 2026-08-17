// The React half of `utils/spatial_fullscreen.ts` — see that module's header
// for why the Live Touch spatial surface is a broker and not a prop.
//
// The server snapshot is the same getter: expo-router server-renders the tab
// layout on web, and a spatial surface is never open before the first paint.
import { useSyncExternalStore } from 'react';

import {
  spatialFullscreenActive,
  subscribeSpatialFullscreen,
} from '@/utils/spatial_fullscreen';

export function useSpatialFullscreen(): boolean {
  return useSyncExternalStore(
    subscribeSpatialFullscreen,
    spatialFullscreenActive,
    spatialFullscreenActive,
  );
}
