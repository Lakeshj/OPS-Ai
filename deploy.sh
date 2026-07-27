# ---------------------------------------------
 
#!/bin/bash
# /var/www/opsai.socialchamps.com/deploy.sh
 
# Set variables
CURRENT_DATE=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP_DIR="/var/www/opsai.socialchamps.com/backup/source_$CURRENT_DATE"
 
# Create a new backup
cp -r  /var/www/opsai.socialchamps.com/source "$BACKUP_DIR"
 
# Navigate to the project directory
cd /var/www/opsai.socialchamps.com/gitsource/ops-ai
 
# Pull the latest changes from the Git repository
git pull origin main --no-rebase
# git clone -b main https://github.com/Lakeshj/OPS-Ai.git
 
# Remove existing UI and API files
rm -rf /var/www/opsai.socialchamps.com/source/frontend/*
rm -rf /var/www/opsai.socialchamps.com/source/backend/*
 
# Copy new UI and API files
cp -r /var/www/opsai.socialchamps.com/gitsource/ops-ai/frontend/* /var/www/opsai.socialchamps.com/source/frontend/
cp -r /var/www/opsai.socialchamps.com/gitsource/ops-ai/backend/* /var/www/opsai.socialchamps.com/source/backend/
# rsync -av \
# --exclude=logs \
# /var/www/opsai.socialchamps.com/gitsource/visible-geo-compass/backend/ \
# /var/www/opsai.socialchamps.com/source/backend/
 
 
# Build UI
cd /var/www/opsai.socialchamps.com/source/frontend
npm install
npm run build
pm2 reload opsai-frontend
 
# Install dependencies and update bcrypt version for API
cd /var/www/opsai.socialchamps.com/source/backend/
npm install
pm2 reload opsai-backend
 
sudo systemctl reload nginx
 
# change server.js file (ssl) & backend .env file
# pm2 reload opsai.socialchamps.com