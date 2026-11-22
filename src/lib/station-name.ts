/**
 * The name to show next to the network's logo and name. Many imported names end in the
 * network's own name ("Baulan (Orkan)", "Staðarskáli (N1)"), which the UI prints right
 * beside it anyway, so that suffix is dropped. Anything else is left as it is: a prefix
 * like "N1 Ísafirði" carries a case ending and doesn't read well cut short.
 */
export function stationDisplayName(name: string, networkName: string): string {
	const suffix = ` (${networkName})`;
	if (name.length > suffix.length && name.endsWith(suffix)) {
		return name.slice(0, -suffix.length).trimEnd();
	}
	return name;
}
