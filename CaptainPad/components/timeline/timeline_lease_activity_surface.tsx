import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTimeline } from '@/hooks/useTimeline';

interface TimelineLeaseActivitySurfaceProps {
  children: React.ReactNode;
}

/**
 * Refreshes an existing operator lease from real app interaction.
 *
 * This never starts a takeover. Deck/Mixer takeover remains an explicit
 * operator action; once held, every new touch pushes the engine-owned
 * two-minute inactivity deadline forward.
 */
export function TimelineLeaseActivitySurface({
  children,
}: TimelineLeaseActivitySurfaceProps) {
  const { state, activity } = useTimeline();
  const leaseHeldRef = useRef(state?.operatorLease !== null && state?.operatorLease !== undefined);
  const activityInFlightRef = useRef(false);

  useEffect(() => {
    leaseHeldRef.current = state?.operatorLease !== null && state?.operatorLease !== undefined;
  }, [state?.operatorLease]);

  const handleTouchStart = useCallback(() => {
    if (!leaseHeldRef.current || activityInFlightRef.current) return;
    activityInFlightRef.current = true;
    void activity().finally(() => {
      activityInFlightRef.current = false;
    });
  }, [activity]);

  return (
    <View style={styles.fill} onTouchStart={handleTouchStart}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
