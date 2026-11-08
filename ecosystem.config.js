// PM2 process file: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'email-bot',
      script: 'dist/index.js',
      instances: 1, // keep 1 for polling mode
      autorestart: true,
      max_memory_restart: '400M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
