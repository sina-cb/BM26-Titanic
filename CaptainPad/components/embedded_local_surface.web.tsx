import React, { memo, useEffect, useRef } from 'react';

import type { EmbeddedLocalSurfaceProps } from './embedded_local_surface';
import { teardownEmbeddedIframe } from '@/components/embedded_surface_lifecycle';

/** Browser implementation. An iframe is the native web primitive for this job. */
function EmbeddedLocalSurface({
  title,
  url,
  reloadToken,
  onLoad,
  onError,
}: EmbeddedLocalSurfaceProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => () => {
    if (iframeRef.current) teardownEmbeddedIframe(iframeRef.current);
  }, []);

  return React.createElement('iframe', {
    ref: iframeRef,
    key: `${url}:${reloadToken}`,
    src: url,
    title,
    allow: 'fullscreen',
    style: {
      border: 'none',
      display: 'block',
      width: '100%',
      height: '100%',
      background: 'transparent',
    },
    onLoad,
    onError: () => {
      onError(`${title} could not load in the browser`);
    },
  });
}

export default memo(EmbeddedLocalSurface);
