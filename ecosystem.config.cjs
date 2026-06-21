module.exports = {
  apps: [
    {
      name: "paidadz",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork",
      node_args: "--experimental-vm-modules",
      env_production: {
        NODE_ENV: "production",
      },
      env_file: ".env",
      watch: false,
      max_memory_restart: "512M",
      restart_delay: 3000,
      max_restarts: 10,
      error_file: "logs/err.log",
      out_file: "logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
