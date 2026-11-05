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
  get appUrl() { return process.env.APP_URL ?? "http://localhost:3000"; },
  get googleKey() { return process.env.GOOGLE_MAPS_API_KEY || ""; },
  get cronSecret() { return process.env.CRON_SECRET || ""; },
};
