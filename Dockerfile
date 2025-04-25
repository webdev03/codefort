# Use the official Bun image as base
FROM oven/bun:latest

RUN apt-get update && apt-get install -y python3 golang

WORKDIR /app

RUN apt-get install -y curl tar
RUN apt-get install -y bubblewrap

# Copy all project files to the container
COPY . .

RUN bash setup.bash -s -- -y

# Install dependencies
RUN bun install --frozen-lockfile

EXPOSE 3000

RUN apt-get clean all
RUN find / -type d -name '*cache*' -o -type f \( -name '*.pyc' -o -name '*.pyo' \) -exec rm -rf {} + 2>/dev/null

CMD ["bun", "run", "start"]
