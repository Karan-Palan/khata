FROM oven/bun:1.3.14 AS build
WORKDIR /khata
COPY . .
RUN bun install --frozen-lockfile --production --ignore-scripts
RUN bun build --compile --minify apps/cli/src/main.ts --outfile /khata/khata

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /khata/khata /usr/local/bin/khata
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/khata", "serve"]
