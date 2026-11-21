import { describe, expect, it } from 'vitest';
import {
	ambiguousTomtomIds,
	brandsInName,
	isUnderConstruction,
	isUnderConstructionName,
	networkConflicts
} from './station-audit';

describe('isUnderConstructionName', () => {
	it.each([
		'Ísorka - Olís Húsavík (Í uppsetningu)',
		'Hleðslustöð Selfossi - uppsetning',
		'Orkan Vík - Coming soon',
		'Tesla Supercharger Höfn (under construction)',
		'Ísorka Borgarnesi (í byggingu)',
		'N1 Hella - væntanleg',
		'Grindavík - opnar bráðlega'
	])('%s is under construction', (name) => {
		expect(isUnderConstructionName(name)).toBe(true);
	});
	it.each(['Ísorka - Olís Húsavík', 'Hótel Sel', 'Uppsalir', 'Bónus Smáratorgi'])(
		'%s is open',
		(name) => {
			expect(isUnderConstructionName(name)).toBe(false);
		}
	);
	it("an admin's flag overrides the name either way", () => {
		expect(isUnderConstruction({ name: 'X (Í uppsetningu)', underConstruction: false })).toBe(
			false
		);
		expect(isUnderConstruction({ name: 'X', underConstruction: true })).toBe(true);
		expect(isUnderConstruction({ name: 'X (Í uppsetningu)', underConstruction: null })).toBe(true);
	});
});

describe('brandsInName', () => {
	it('finds the networks a name names', () => {
		expect([...brandsInName('Vík (N1)')]).toEqual(['n1']);
		expect([...brandsInName('Ísorka - Olís Ánanaustum')]).toEqual(['isorka']);
		expect([...brandsInName('ON Krikjubæjarklaustri')]).toEqual(['on']);
		expect([...brandsInName('Hótel Edda [Orka Náttúrunnar]')]).toEqual(['on']);
		expect([...brandsInName('Staðarskáli Supercharger')]).toEqual(['tesla']);
		expect([...brandsInName('Baulan (Orkan)')]).toEqual(['orkan']);
	});
	it('ignores words that merely contain a brand', () => {
		expect(brandsInName('Hotel Selfoss on the river').size).toBe(0);
		expect(brandsInName('Orkuveitan').size).toBe(0);
		expect(brandsInName('Heimar - Lágmúli 6').size).toBe(0);
	});
});

describe('networkConflicts', () => {
	const st = (id: number, name: string, networkSlug: string, lat = 64, lng = -21) => ({
		id,
		name,
		networkSlug,
		lat,
		lng
	});
	it('flags a name that names another network, and a station on another one’s spot', () => {
		const vikOn = st(80, 'Vík (N1)', 'on', 63.41781, -19.00102);
		const vikN1 = st(61, 'Vík í Mýrdal (N1)', 'n1', 63.41775, -19.0019);
		const edda = st(42, 'Hótel Edda [Orka Náttúrunnar]', 'on', 64.25, -15.2);
		const out = networkConflicts([vikOn, vikN1, edda]);
		expect(out).toHaveLength(2);
		expect(out[0]).toMatchObject({ kind: 'name', station: { id: 80 }, brands: ['n1'] });
		expect(out[1]).toMatchObject({ kind: 'colocated', station: { id: 61 }, other: { id: 80 } });
	});
});

describe('ambiguousTomtomIds', () => {
	it('returns ids shared across networks, not within one, and ignores inactive stations', () => {
		const ids = ambiguousTomtomIds([
			{ networkId: 3, isActive: true, externalIds: { tomtom: 'stadarskali' } },
			{ networkId: 6, isActive: true, externalIds: { tomtom: 'stadarskali' } },
			{ networkId: 3, isActive: true, externalIds: { tomtom: 'hvols' } },
			{ networkId: 3, isActive: true, externalIds: { tomtom: 'hvols' } },
			{ networkId: 1, isActive: true, externalIds: { tomtom: 'egs' } },
			{ networkId: 3, isActive: false, externalIds: { tomtom: 'egs' } }
		]);
		expect([...ids]).toEqual(['stadarskali']);
	});
});
