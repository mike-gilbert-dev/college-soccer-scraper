/**
 * Kickoff time for a scheduled game, in the viewer's local timezone.
 * Returns '' for a null start_time — the NCAA feed publishes contest dates
 * before times are set, so a scheduled game legitimately has no time yet.
 */
export function formatTime(iso: string | null): string {
	if (!iso) return '';
	return new Date(iso).toLocaleTimeString('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		timeZoneName: 'short'
	});
}
