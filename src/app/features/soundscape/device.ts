export interface DeviceHints {
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

/**
 * Off on weak phones. The thresholds are placeholders: no phone has been measured (grammar
 * section 7, item 4). Unknown hints (Safari reports neither) do not count as weak.
 */
export const isWeakDevice = ({ deviceMemory, hardwareConcurrency }: DeviceHints): boolean =>
  (deviceMemory !== undefined && deviceMemory < 4) ||
  (hardwareConcurrency !== undefined && hardwareConcurrency < 4);
