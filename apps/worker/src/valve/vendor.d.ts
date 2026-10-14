declare module 'steam-user' {
	const SteamUser: new (options?: Record<string, unknown>) => unknown;
	export default SteamUser;
}

declare module 'globaloffensive' {
	const GlobalOffensive: new (steamUser: unknown) => unknown;
	export default GlobalOffensive;
}
