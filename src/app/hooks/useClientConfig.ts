import { createContext, useContext } from 'react';
import type { DingsConfig } from '../features/dings/dings';
import type { BackgroundSceneConfig } from '../features/scene/tier';

export type HashRouterConfig = {
  enabled?: boolean;
  basename?: string;
};

export type RegistrationConfig = {
  enabled?: boolean;
  url?: string;
};

export type ClientConfig = {
  defaultHomeserver?: number;
  homeserverList?: string[];
  allowCustomHomeservers?: boolean;

  featuredCommunities?: {
    openAsDefault?: boolean;
    spaces?: string[];
    rooms?: string[];
    servers?: string[];
  };

  hashRouter?: HashRouterConfig;

  backgroundScene?: BackgroundSceneConfig;

  // Per-Mind notification earcons (src/app/features/dings). Off unless `enabled: true`.
  dings?: DingsConfig;

  // Rooms (ids or aliases) shown as the album view; a room whose create type is org.gamecult.file_zone needs no entry.
  fileZoneRooms?: string[];

  // The sign-up entry on the sign-in page. Off unless `enabled` is true; `url` is the account
  // service's own registration page (a value, never a route this client invents).
  registration?: RegistrationConfig;

  // Dev preview only: the build answers a pretend homeserver in-page (src/preview-demo).
  previewDemo?: boolean;
};

const ClientConfigContext = createContext<ClientConfig | null>(null);

export const ClientConfigProvider = ClientConfigContext.Provider;

export function useClientConfig(): ClientConfig {
  const config = useContext(ClientConfigContext);
  if (!config) throw new Error('Client config are not provided!');
  return config;
}

export const clientDefaultServer = (clientConfig: ClientConfig): string =>
  clientConfig.homeserverList?.[clientConfig.defaultHomeserver ?? 0] ?? 'gamecult.org';

export const clientAllowedServer = (clientConfig: ClientConfig, server: string): boolean => {
  const { homeserverList, allowCustomHomeservers } = clientConfig;

  if (allowCustomHomeservers) return true;

  return homeserverList?.includes(server) === true;
};
