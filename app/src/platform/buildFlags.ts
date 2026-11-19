declare const process: { env: Record<string, string | undefined> };

/**
 * Test tooling (the test panel, the API host override, the mock's /__test routes) is compiled
 * in only when the build sets EXPO_PUBLIC_TEST_TOOLS=1. babel-preset-expo inlines the value at
 * bundle time, so with any other value the panel code is unreachable and the override is ignored.
 * This repository's test builds set it in app/.env; a production build must not.
 */
export const TEST_TOOLS_ENABLED = process.env.EXPO_PUBLIC_TEST_TOOLS === '1';
