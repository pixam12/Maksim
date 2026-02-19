# Build stage
FROM node:18-slim

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install --production

# Bundle app source
COPY . .

# Environment variables (defaults)
ENV PORT=3000
ENV VINTED_DOMAIN=www.vinted.pl

# Expose port
EXPOSE 3000

# Start command
CMD [ "node", "server.js" ]
