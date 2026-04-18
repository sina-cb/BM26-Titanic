import { StyleSheet } from 'react-native';
import { Colors } from '../constants/theme';

export const globalStyles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: Colors.light.background,
  },
  leftPane: {
    flex: 1,
    backgroundColor: Colors.light.surfaceContainerLow,
    marginLeft: 20,
    marginTop: 20,
    marginBottom: 20,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: Colors.light.ghostBorder,
  },
  rightPane: {
    flex: 2,
    padding: 20,
    flexDirection: 'column',
  },
  headline: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 20,
    color: Colors.light.text,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  subtext: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: Colors.light.secondary,
    marginTop: 8,
  },
  ambientShadow: {
    shadowColor: Colors.light.text,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 24,
    elevation: 3,
  },
  ghostBorder: {
    borderWidth: 1,
    borderColor: Colors.light.ghostBorder,
  },
  surfaceLow: {
    backgroundColor: Colors.light.surfaceContainerLow,
    borderRadius: 24,
  },
  surfaceLowest: {
    backgroundColor: Colors.light.surfaceContainerLowest,
    borderRadius: 16,
  },
  card: {
    backgroundColor: Colors.light.surfaceContainerLowest,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.ghostBorder,
  },
  macroButton: {
    backgroundColor: Colors.light.surfaceContainerLowest,
    height: 80,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.ghostBorder,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.light.text,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 24,
    elevation: 3,
  },
  glassOverlay: {
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderRadius: 12,
  } // Note: Blur requires expo-blur, using RGBA as fallback visually until specified.
});
