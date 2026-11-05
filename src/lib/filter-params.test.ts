import { describe, expect, it } from 'vitest';
import { defaultNetworks, isDefault, parseShown, toggleParam } from './filter-params';

const nets = ['isorka', 'n1', 'on', 'orkan', 'tesla'];
const def = defaultNetworks(nets);

describe('defaultNetworks', () => {
	it('shows everything except own-brand-priced networks', () => {
		expect(def).toEqual(['isorka', 'n1', 'on', 'orkan']);
	});
	it('brings an own-brand network back for a car of that brand', () => {
		expect(defaultNetworks(nets, 'Tesla')).toEqual(nets);
		expect(defaultNetworks(nets, 'Kia')).toEqual(def);
	});
});

describe('parseShown', () => {
	it('uses the defaults when the param is missing', () => {
		expect(parseShown(null, nets, def)).toEqual(def);
	});
	it('reads a list in option order and drops unknown values', () => {
		expect(parseShown('tesla,bogus,on', nets, def)).toEqual(['on', 'tesla']);
	});
	it('keeps old single-network links working', () => {
		expect(parseShown('n1', nets, def)).toEqual(['n1']);
	});
	it('treats an empty value as "show nothing", not as the defaults', () => {
		expect(parseShown('', nets, def)).toEqual([]);
	});
});

describe('toggleParam', () => {
	it('hides a shown network', () => {
		expect(toggleParam(def, 'n1', nets, def)).toBe('isorka,on,orkan');
	});
	it('shows a hidden network', () => {
		expect(toggleParam(def, 'tesla', nets, def)).toBe('isorka,n1,on,orkan,tesla');
	});
	it('returns null when the result is the defaults', () => {
		expect(toggleParam(['isorka', 'on', 'orkan'], 'n1', nets, def)).toBeNull();
	});
	it('can hide the last one, leaving an empty (not default) value', () => {
		expect(toggleParam(['on'], 'on', nets, def)).toBe('');
	});
});

describe('isDefault', () => {
	it('ignores order', () => {
		expect(isDefault(['on', 'isorka', 'orkan', 'n1'], def)).toBe(true);
		expect(isDefault(['on'], def)).toBe(false);
	});
});
