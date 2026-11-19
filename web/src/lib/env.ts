export const env = {
  get isProd() { return process.env.NODE_ENV === "production"; },
  /**
   * Demo mode exposes OTP codes and demo accounts. It can NEVER be on in production unless a deliberately long,
   * explicit acknowledgement is also set (for staging/demo deployments and production-build E2E runs).
   */
  get demoMode() {
    if (process.env.DEMO_MODE !== "true") return false;
    return process.env.NODE_ENV !== "production" || process.env.ALLOW_DEMO_IN_PRODUCTION === "yes-this-is-a-demo-deployment";
  },
  /**
   * Lets outbound integration calls reach http:// and private/loopback addresses even in a production build. For automated tests that run a
   * stub partner on localhost ONLY; the long value is deliberate, like the demo-mode acknowledgement. Never set it on a real deployment.
   */
  get allowPrivateOutbound() { return process.env.ALLOW_PRIVATE_OUTBOUND === "yes-this-is-a-test-deployment"; },
  get appUrl() { return process.env.APP_URL ?? "http://localhost:3000"; },
  get googleKey() { return process.env.GOOGLE_MAPS_API_KEY || ""; },
  /** Endpoints are overridable so tests and staging can point at a stub; production leaves them unset. */
  get googleRoutesUrl() { return process.env.GOOGLE_ROUTES_URL || "https://routes.googleapis.com/directions/v2:computeRoutes"; },
  get googleGeocodeUrl() { return process.env.GOOGLE_GEOCODE_URL || "https://maps.googleapis.com/maps/api/geocode/json"; },
  /**
   * Stops sent to Google per computeRoutes call (the destination + the optimised intermediates). Google allows at most 25 intermediates,
   * i.e. 26 stops per call; the default of 25 leaves one spare. Longer routes are split into balanced chunks of at most this size.
   */
  get routeChunkSize() { const n = Math.floor(Number(process.env.ROUTE_STOPS_PER_CALL)); return Number.isFinite(n) && n >= 3 ? Math.min(n, 26) : 25; },
  get cronSecret() { return process.env.CRON_SECRET || ""; },
};
