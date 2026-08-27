FROM node:22-alpine AS build

WORKDIR /app

# Toolchain para os modulos nativos OPCIONAIS do agente New Relic
# (@newrelic/native-metrics etc. — sem prebuild musl garantido). Sao
# optionalDependencies: o agente roda sem eles, isto so garante as metricas
# de VM/GC. Fica so neste stage; a imagem final nao carrega o toolchain.
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY newrelic.js ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package*.json ./
COPY --from=build /app/newrelic.js ./
COPY --from=build /app/dist ./dist

CMD ["node", "dist/index.js"]
