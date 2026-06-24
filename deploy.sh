#!/bin/bash

set -e

APP_DIR="/var/www/paid-adz"
APP_NAME="paid-adz"

echo "🚀 Paid Adz — Auto Deploy Starting..."
cd $APP_DIR

# Load environment variables
if [ -f .env ]; then
  set -a && source .env && set +a
  echo "✅ Environment variables loaded"
else
  echo "❌ ERROR: .env file not found!"
  exit 1
fi

echo ""
echo "📦 Step 1: Pulling latest code from GitHub..."
git pull origin main

echo ""
echo "📚 Step 2: Installing dependencies..."
npm install --legacy-peer-deps

echo ""
echo "🔨 Step 3: Building app..."
npm run build

echo ""
echo "🗄️  Step 4: Pushing database schema..."
NODE_TLS_REJECT_UNAUTHORIZED=0 npx drizzle-kit push --force

echo ""
echo "♻️  Step 5: Restarting app..."
if pm2 list | grep -q "$APP_NAME"; then
  pm2 restart $APP_NAME --update-env
  echo "✅ App restarted"
else
  pm2 start dist/index.js --name $APP_NAME
  echo "✅ App started"
fi

pm2 save

echo ""
echo "📊 Status:"
pm2 status $APP_NAME

echo ""
echo "✅ Deployment complete! App running at https://paidadz.xyz"
echo ""
echo "📋 Useful commands:"
echo "   pm2 logs $APP_NAME          → Live logs"
echo "   pm2 restart $APP_NAME       → Restart"
echo "   bash $APP_DIR/deploy.sh     → Redeploy"
