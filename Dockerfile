# Use the official Bun image as base
FROM oven/bun:latest

RUN apt-get update && apt-get install -y python3 golang

WORKDIR /app

# Copy all project files to the container
COPY . .

RUN yes | bash setup.bash

# Install dependencies
RUN bun install --frozen-lockfile

EXPOSE 3000

CMD ["bun", "run", "start"]
