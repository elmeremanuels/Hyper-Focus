// PM2 config for the VPS (BOUWPLAN.md, 4). The worker process is added in step 1.3.
module.exports = {
  apps: [
    {
      name: 'hyperfocus-web',
      script: 'dist/server.js',
      node_args: '--enable-source-maps',
      instances: 1,
      env: { NODE_ENV: 'production' },
      max_memory_restart: '300M',
    },
  ],
};
