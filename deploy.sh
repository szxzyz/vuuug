#!/bin/bash

set -e

echo "🚀 Paid Adz VPS Deployment Starting..."

# Load environment variables from .env file
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
  echo "✅ Environment variables loaded from .env"
else
  echo "❌ ERROR: .env file not found! Please create it first."
  echo "   Run: nano .env"
  exit 1
fi

echo ""
echo "📦 Step 1: Installing dependencies..."
npm install

echo ""
echo "🔨 Step 2: Building the project..."
NODE_TLS_REJECT_UNAUTHORIZED=0 npm run build

echo ""
echo "🗄️  Step 3: Pushing database schema..."
NODE_TLS_REJECT_UNAUTHORIZED=0 npx drizzle-kit push --force

echo ""
echo "🔄 Step 4: Restarting app with PM2..."
if pm2 list | grep -q "cashwatch"; then
  pm2 restart cashwatch
  echo "✅ App restarted"
else
  pm2 start dist/index.js --name cashwatch
  echo "✅ App started for first time"
fi

pm2 save

echo ""
echo "📊 App Status:"
pm2 status cashwatch

echo ""
echo "✅ Deployment Complete!"
echo "🌐 Your app is running at: http://$(hostname -I | awk '{print $1}'):5000"
echo ""
echo "📋 Useful commands:"
echo "   pm2 logs cashwatch       → Live logs dekhne ke liye"
echo "   pm2 restart cashwatch    → Restart karne ke liye"
echo "   bash deploy.sh           → Dobara deploy karne ke liye"
