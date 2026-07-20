// Shared loader: all teams for the editor's tagging picker.
import { supabaseAdmin } from '$lib/server/supabase-admin';

export type TeamOpt = { id: number; name: string; short_name: string };

export async function loadAllTeams(): Promise<TeamOpt[]> {
	const { data, error } = await supabaseAdmin
		.from('teams')
		.select('id, name, short_name')
		.order('name', { ascending: true });
	if (error) throw new Error(`loadAllTeams failed: ${error.message}`);
	return (data ?? []) as TeamOpt[];
}
