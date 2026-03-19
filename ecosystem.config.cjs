module.exports = { apps: [{ name: "@sha3/polymarket-model", script: "node", args: "--import tsx src/main.ts", env: { NODE_ENV: "production" } }] };
