import type { ClimateServiceHandler } from '../../../../src/generated/server/worldmonitor/climate/v1/service_server';

import { getCo2Monitoring } from './get-co2-monitoring';
import { listClimateAnomalies } from './list-climate-anomalies';

export const climateHandler: ClimateServiceHandler = {
  getCo2Monitoring,
  listClimateAnomalies,
};
