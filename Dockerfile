FROM node:20-slim

WORKDIR /app

# Copy package configuration
COPY package*.json ./

# Install production dependencies
RUN npm install --production

# Copy source files
COPY . .

# Ensure data directory exists
RUN mkdir -p data

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["npm", "start"]
