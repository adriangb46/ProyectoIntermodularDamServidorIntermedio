FROM node:20-alpine
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (if any)
RUN npm install

# Copy application source
COPY . .

# Expose port (as per docker-compose)
EXPOSE 3000

# Start the application
CMD ["node", "index.js"]
