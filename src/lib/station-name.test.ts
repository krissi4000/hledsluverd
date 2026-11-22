import { describe, expect, it } from 'vitest';
import { stationDisplayName } from './station-name';

describe('stationDisplayName', () => {
	it('drops a trailing "(network)" that repeats the network shown beside it', () => {
		expect(stationDisplayName('Baulan (Orkan)', 'Orkan')).toBe('Baulan');
		expect(stationDisplayName('Staðarskáli (N1)', 'N1')).toBe('Staðarskáli');
		expect(stationDisplayName('Miklabraut Norður (Orkan)', 'Orkan')).toBe('Miklabraut Norður');
	});

	it('keeps names that only mention the network elsewhere, or another one', () => {
		expect(stationDisplayName('N1 Ísafirði', 'N1')).toBe('N1 Ísafirði');
		expect(stationDisplayName('Ísorka - Olís Fitjar', 'Ísorka')).toBe('Ísorka - Olís Fitjar');
		expect(stationDisplayName('Baulan (Orkan)', 'ON')).toBe('Baulan (Orkan)');
		expect(stationDisplayName('Hótel Edda [Orka Náttúrunnar]', 'ON')).toBe(
			'Hótel Edda [Orka Náttúrunnar]'
		);
	});

	it('never empties a name that is only the suffix', () => {
		expect(stationDisplayName(' (Orkan)', 'Orkan')).toBe(' (Orkan)');
		expect(stationDisplayName('(Orkan)', 'Orkan')).toBe('(Orkan)');
	});
});
