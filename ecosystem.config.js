module.exports = {
  apps: [
    {
      name: "xero-bridge",
      script: "xero-bridge.js",
      env: {
        PORT: process.env.PORT || 4002
      }
    }
  ]
};
