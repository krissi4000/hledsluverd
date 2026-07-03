export const CONNECTOR_TYPES = ['CCS2', 'CHAdeMO', 'Type2'] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

export const TARIFF_KEYS = ['AC', 'DC', 'DC_150'] as const;
export type TariffKey = (typeof TARIFF_KEYS)[number];
