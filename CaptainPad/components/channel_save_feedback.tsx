import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { usePalette } from '@/hooks/use-theme';
import { engineEvents } from '@/utils/engineEvents';
import { opError } from '@/utils/op_dialog';

import {
  channelSaveFailureMessage,
  channelSaveFeedback,
  type ChannelSaveMessage,
} from './channel_save_feedback_logic';

const SAVED_VISIBLE_MS = 1400;

/** Compact, layout-stable acknowledgement for Deck and Mixer parameter state. */
export function ChannelSaveFeedback({
  channelId,
  compact = false,
}: {
  channelId?: string;
  compact?: boolean;
}) {
  const C = usePalette();
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!channelId) return;
    return engineEvents.subscribe((rawMessage) => {
      const message = rawMessage as ChannelSaveMessage;
      const feedback = channelSaveFeedback(message, channelId);
      if (feedback === 'saved') {
        setSavedAt(Date.now());
      } else if (feedback === 'failed') {
        setSavedAt(null);
        opError('Parameters not saved', channelSaveFailureMessage(message));
      }
    });
  }, [channelId]);

  useEffect(() => {
    if (savedAt === null) return;
    const timer = setTimeout(() => setSavedAt(null), SAVED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [savedAt]);

  return (
    <View
      style={{
        minWidth: compact ? 58 : 70,
        minHeight: compact ? 18 : 22,
        justifyContent: 'center',
        alignItems: 'flex-start',
      }}
      accessibilityLiveRegion="polite"
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: compact ? 5 : 8,
          paddingVertical: 2,
          borderRadius: 4,
          backgroundColor: C.surfaceContainerHigh,
          opacity: savedAt === null ? 0 : 1,
        }}
      >
        <Text
          style={{
            color: C.tertiary,
            fontFamily: 'SpaceGrotesk_700Bold',
            fontSize: compact ? 8 : 9,
            letterSpacing: 0.6,
          }}
          numberOfLines={1}
        >
          ✓ SAVED
        </Text>
      </View>
    </View>
  );
}
