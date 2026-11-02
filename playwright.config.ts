import { defineConfig } from '@playwright/test';

const ci = !!process.env.CI;

export default defineConfig({
	testDir: 'e2e',
	forbidOnly: ci,
	// CI also writes an HTML report, uploaded as an artifact when the job fails
	reporter: ci ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
	webServer: {
		// CI builds in its own workflow step (clearer logs, no double build); locally the
		// webServer builds itself. Either way the tests hit the production build via preview.
		command: ci ? 'npm run preview' : 'npm run build && npm run preview',
		port: 4173,
		reuseExistingServer: !ci,
		timeout: 180_000
	},
	use: {
		baseURL: 'http://localhost:4173',
		trace: ci ? 'retain-on-failure' : 'off',
		launchOptions: {
			args: [
				'--enable-unsafe-swiftshader',
				// CI is hermetic: the browser can only resolve localhost, so the map style/tiles
				// (openfreemap.org) fail fast instead of making runs depend on a third party.
				// Map pins are DOM markers and render without a style.
				...(ci ? ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost'] : [])
			]
		}
	}
});
