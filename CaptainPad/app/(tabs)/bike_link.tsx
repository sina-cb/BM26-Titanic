import React from 'react';
import { ScrollView, Text, View } from 'react-native';

import { BikeColorLinkCard } from '@/components/BikeColorLinkCard';
import { ConfigSubviewFrame } from '@/components/config_subview_frame';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { usePalette } from '@/hooks/use-theme';
import { useGlobalStyles } from '@/styles/globalStyles';
import { PerformanceRouteGuard } from '@/components/performance_route_guard';

export default function BikeLinkScreen() {
  return (
    <PerformanceRouteGuard routeName="bike_link">
      <ConfigSubviewFrame routeName="bike_link">
        <BikeLinkScreenContent />
      </ConfigSubviewFrame>
    </PerformanceRouteGuard>
  );
}
function BikeLinkScreenContent() {
  const globalStyles = useGlobalStyles();
  const C = usePalette();

  return (
    <View style={globalStyles.container}>
      <ScrollView contentContainerStyle={{ padding: 48, alignItems: 'center' }} style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 32, gap: 16 }}>
          <IconSymbol name="network" size={32} color={C.primary} />
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold',
            fontSize: 32,
            color: C.text,
            letterSpacing: 2,
          }}>
            BIKE COLOR LINK
          </Text>
        </View>

        <BikeColorLinkCard />
      </ScrollView>
    </View>
  );
}
