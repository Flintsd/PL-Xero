module.exports = {
  apps: [
    {
      name: "xero-bridge",
      script: "xero-bridge.js",

      env: {
        NODE_ENV: "development",
        PORT: process.env.PORT || 4002
      },

      env_production: {
        NODE_ENV: "production",
        PORT: process.env.PORT || 4002
      }
    }
  ]
};
