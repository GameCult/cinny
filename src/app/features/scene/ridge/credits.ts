// What the Ridge background owes its data sources, shown in the Sky menu (SkyStateControl). Plain strings in their own module so the
// main chunk carries these and not the baked horizon table or the weather parser; credits.test.ts holds them equal to the sources'.

/** GeoSphere's own requested credit line. It names no licence: that is the dataset's (below). */
export const WEATHER_CREDIT = 'Datenquelle: GeoSphere Austria - https://data.hub.geosphere.at';
export const WEATHER_CREDIT_URL = 'https://data.hub.geosphere.at';
/** The dataset the weather is read from, and its licence as the dataset page names it (data.hub.geosphere.at, tawes-v1-10min). */
export const WEATHER_DATASET = 'TAWES weather stations, 10-minute data (station 11035), CC BY 4.0';
/** The terrain silhouette's credit, as the Copernicus DEM licence asks (equal to `HORIZON_ATTRIBUTION`). */
export const HORIZON_CREDIT =
  'Contains modified Copernicus data: DEM © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.';
