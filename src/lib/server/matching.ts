import type { ConnectorType, TariffKey } from '$lib/types';

export function deriveTariffKey(
	type: ConnectorType,
	powerKw: number,
	networkTariffs: ReadonlySet<TariffKey>
): TariffKey {
	if (type === 'Type2') return 'AC';
	if (powerKw >= 150 && networkTariffs.has('DC_150')) return 'DC_150';
	return 'DC';
}
