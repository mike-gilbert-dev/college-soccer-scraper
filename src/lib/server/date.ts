const FALLBACK_TIME_ZONE = 'America/New_York';

// Games are ET-scheduled regardless of viewer location, so that's the sane
// default "today" when we don't yet know the visitor's own timezone.
export function todayInTimeZone(timeZone: string | undefined | null): string {
	const zone = timeZone || FALLBACK_TIME_ZONE;
	try {
		return new Date().toLocaleDateString('en-CA', { timeZone: zone });
	} catch {
		// Malformed/spoofed cookie value — fall back rather than throwing.
		return new Date().toLocaleDateString('en-CA', { timeZone: FALLBACK_TIME_ZONE });
	}
}
