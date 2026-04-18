import { View, Text } from 'react-native';
import { globalStyles } from '@/styles/globalStyles';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';

export default function ShipmentScreen() {
  return (
    <View style={globalStyles.container}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 48 }}>
        <View style={{ width: 120, height: 120, borderRadius: 60, backgroundColor: Colors.light.surfaceContainerLow, justifyContent: 'center', alignItems: 'center', ...globalStyles.ambientShadow, marginBottom: 32 }}>
          <IconSymbol name="local-shipping" size={64} color={Colors.light.primary} />
        </View>
        
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 32, color: Colors.light.text, marginBottom: 16 }}>
          NEXT SHIPMENT
        </Text>
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 16, color: Colors.light.secondary, textAlign: 'center', maxWidth: 400, lineHeight: 28 }}>
          Swarm Health Monitoring, System Routing, and App Settings will arrive in Phase 2.
        </Text>
      </View>
    </View>
  );
}
