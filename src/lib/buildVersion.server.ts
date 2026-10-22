// Next's configuration inlines only this scalar at compile time. Runtime
// environment overrides and npm lifecycle variables cannot change identity.
export const BUILD_VERSION = process.env.KOKPIT_BUILD_VERSION!;
