import { StyleSheet } from 'react-native';

const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';

export const Colors = {
  // We use the Luminance Command palette overriding the default scheme.
  light: {
    text: '#191c1d', // on-surface
    background: '#f8f9fa', // surface
    tint: '#006875', // primary
    icon: '#bac9cc', // outline-variant
    tabIconDefault: '#bac9cc',
    tabIconSelected: '#006875',
    
    // Core surface tokens
    surface: '#f8f9fa',
    surfaceContainerLow: '#f3f4f5',
    surfaceContainerLowest: '#ffffff',
    surfaceContainerHigh: '#e7e8e9',
    surfaceDim: '#d9dadb',
    
    // Accents
    primary: '#006875',
    primaryContainer: '#00e5ff',
    primaryFixedDim: '#00daf3',
    secondary: '#466270',
    secondaryContainer: '#c6e4f4',
    
    // Semantic
    error: '#ba1a1a',
    ghostBorder: 'rgba(186, 201, 204, 0.4)', // Slightly darkened for visibility on device
    ambientShadow: 'rgba(25, 28, 29, 0.05)'
  },
  dark: {
    // Stage mode (Optional placeholder for later dark mode)
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
    
    surface: '#151718',
    surfaceContainerLow: '#1E1E1E',
    surfaceContainerLowest: '#2C2C2C',
    surfaceContainerHigh: '#111111',
    surfaceDim: '#000000',
    
    primary: '#00daf3',
    primaryContainer: '#006875',
    primaryFixedDim: '#00daf3',
    secondary: '#c6e4f4',
    secondaryContainer: '#466270',
    
    error: '#ffdad6',
    ghostBorder: 'rgba(255,255,255,0.1)',
    ambientShadow: 'rgba(0, 0, 0, 0.5)'
  },
};

export const Fonts = {
  headline: 'SpaceGrotesk_700Bold',
  headlineRegular: 'SpaceGrotesk_400Regular',
  body: 'Inter_400Regular',
  bodySemibold: 'Inter_600SemiBold',
};
