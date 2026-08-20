import React from 'react';

import { EmbeddedServiceScreen } from '@/components/embedded_service_screen';
import { PerformanceRouteGuard } from '@/components/performance_route_guard';
import { simulationUrlFromApiBase } from '@/utils/simulation_url';

export default function SimulationScreen() {
  return (
    <PerformanceRouteGuard routeName="simulation">
      <EmbeddedServiceScreen
        title="2D PIXELS"
        description="CANONICAL SÁCN-IN SIMULATOR · PORT 6969"
        resolveUrl={simulationUrlFromApiBase}
      />
    </PerformanceRouteGuard>
  );
}
