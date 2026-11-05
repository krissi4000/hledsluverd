import type { ConnectorType } from '$lib/types';

/** What matching needs to know about a car (subset of a cars-table row). */
export interface CarSpec {
	acConnector: ConnectorType | null;
	maxAcKw: number | null;
	dcConnector: ConnectorType | null;
	maxDcKw: number | null;
}

export interface StationConnector {
	type: ConnectorType;
	powerKw: number;
}

/**
 * The car's plug for a charging mode: its AC plug for AC, its DC plug for DC.
 * The station list shows one price per mode, so a car only "fits" a station through
 * the plug that price applies to — a Leaf must not match a DC row via its Type2 socket.
 */
export function carPlugForMode(car: CarSpec, mode: 'AC' | 'DC'): ConnectorType | null {
	return mode === 'AC' ? car.acConnector : car.dcConnector;
}

/**
 * Effective charging speed at a station = max over matching connectors of
 * min(car max for that kind, connector power). A null car max (plug-type fallback,
 * or a dataset record without a DC spec) does not limit — the connector power counts.
 */
export function effectiveKw(car: CarSpec, connectors: StationConnector[]): number | null {
	let best: number | null = null;
	for (const c of connectors) {
		let carMax: number | null;
		if (c.type === car.dcConnector) carMax = car.maxDcKw;
		else if (c.type === car.acConnector) carMax = car.maxAcKw;
		else continue;
		const kw = Math.min(carMax ?? Infinity, c.powerKw);
		if (best === null || kw > best) best = kw;
	}
	return best;
}
