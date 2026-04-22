FROM node:20-alpine
WORKDIR /app

# Copy package files
COPY --chown=node:node package*.json ./

# Install dependencies (if any)
RUN npm install

# Copy application source
COPY --chown=node:node . .

# Switch to non-root user
USER node

# Expose port (as per docker-compose)
EXPOSE 3000

# Start the application
CMD ["node", "index.js"]
