FROM docker.io/oven/bun:1.4.2-debian
USER root
RUN apt-get update && apt-get install -y --no-install-recommends bash g++ python3 \
    && rm -rf /var/lib/apt/lists/*
COPY languages /opt/codefort/languages
RUN chmod -R a+rX /opt/codefort/languages && mkdir -p /work
USER 65534:65534
WORKDIR /work
