import type { LayoutServerLoad } from './$types';

// Access control is enforced in hooks.server.ts — all non-public routes
// require an authenticated admin. Nothing extra needed here.
export const load: LayoutServerLoad = async () => {
	return {};
};
