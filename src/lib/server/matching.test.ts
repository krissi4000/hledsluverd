import { describe, expect, it } from 'vitest';
import { deriveTariffKey } from './matching';
import type { TariffKey } from '$lib/types';

const withTier = new Set<TariffKey>(['AC', 'DC', 'DC_150']);
const withoutTier = new Set<TariffKey>(['AC', 'DC']);

describe('deriveTariffKey', () => {
	it('maps Type2 to AC regardless of power', () => {
		expect(deriveTariffKey('Type2', 22, withTier)).toBe('AC');
	});
	it('keeps Type2 as AC even at tier-level power', () => {
		expect(deriveTariffKey('Type2', 150, withTier)).toBe('AC');
	});
	it('maps DC connectors to DC below 150 kW', () => {
		expect(deriveTariffKey('CCS2', 60, withTier)).toBe('DC');
		expect(deriveTariffKey('CHAdeMO', 50, withTier)).toBe('DC');
	});
	it('maps ≥150 kW to DC_150 when the network defines the tier', () => {
		expect(deriveTariffKey('CCS2', 150, withTier)).toBe('DC_150');
		expect(deriveTariffKey('CCS2', 250, withTier)).toBe('DC_150');
	});
	it('falls back to DC at ≥150 kW when the network has no tier', () => {
		expect(deriveTariffKey('CCS2', 250, withoutTier)).toBe('DC');
	});
});
